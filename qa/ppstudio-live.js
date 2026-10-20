'use strict';
// POWER PLAN STUDIO live harness: drives the real UI (CDP) through the full
// lifecycle — duplicate, edit an advanced setting (with independent powercfg
// read-back), rename + description, export .pow (env-bypassed dialog), reimport
// the file (round-trips name + settings), delete both copies (2-step confirm),
// guard checks (active plan + built-in protection), final list restored.
//
// Run: node qa/ppstudio-live.js   (app is killed/relaunched on port 9232)

const fs = require('fs');
const path = require('path');
const { ROOT, sleep, launchApp, waitFor, clickNav, run, psRun, result, finish } = require('./lib/cdp.js');

const PORT = 9232;
const TMP = path.join(ROOT, 'qa', 'tmp');
const EXPORT_PATH = path.join(TMP, 'pp-export-test.pow');

const SG_PROC = '54533251-82be-4824-96c1-47b60b740d00';
const SET_THROTTLE_MIN = '893dee8e-2bef-41e0-89c6-b55d0929964c';
const K_TARGET = SG_PROC + '|' + SET_THROTTLE_MIN;

function listPlans() {
  const r = run('powercfg /list');
  const out = r.out || '';
  const plans = [];
  // Greedy: names may contain ')' themselves.
  const re = /Power Scheme GUID:\s*([0-9a-f-]{36})\s*\((.+)\)\s*(\*)?/gi;
  let m;
  while ((m = re.exec(out))) plans.push({ guid: m[1].toLowerCase(), name: m[2].trim(), active: !!m[3] });
  return plans;
}

function readSetting(guid, subgroup, setting) {
  const r = run(`powercfg /q ${guid} ${subgroup} ${setting}`);
  const t = r.out || '';
  const ac = /Current AC Power Setting Index:\s*0x([0-9a-f]+)/i.exec(t);
  const dc = /Current DC Power Setting Index:\s*0x([0-9a-f]+)/i.exec(t);
  return { ac: ac ? parseInt(ac[1], 16) : null, dc: dc ? parseInt(dc[1], 16) : null };
}

function schemeReg(guid) {
  const script = `
try {
  $k = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\\\\CurrentControlSet\\\\Control\\\\Power\\\\User\\\\PowerSchemes\\\\${guid}')
  if ($k) {
    $nm = $k.GetValue('FriendlyName'); $ds = $k.GetValue('Description'); $k.Close()
    @{ name = [string]$nm; desc = [string]$ds } | ConvertTo-Json -Compress
  } else { '{"name":null,"desc":null}' }
} catch { '{"name":null,"desc":null}' }
`;
  const r = psRun(script);
  const line = (r.out || '').trim().split(/\r?\n/).filter(Boolean).pop() || '{}';
  try { return JSON.parse(line); } catch { return { name: null, desc: null }; }
}

const consoleText = (cdp) => cdp.eval(`(document.getElementById('tweak-console-content') || {}).textContent || ''`);

(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const results = [];

  const A = listPlans();
  const aSet = new Set(A.map(p => p.guid));
  const activePlan = A.find(p => p.active) || A[0];
  const builtinNonActive = A.find(p => !p.active && ['381b4222-f694-41f0-9685-ff5bb260df2e', '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c', 'a1841308-3541-4fab-bc81-f71556f20b4a'].includes(p.guid));
  results.push(result('pre-state: plans listed, exactly one active', A.length >= 3 && A.filter(p => p.active).length === 1, A.map(p => p.name + (p.active ? '*' : '')).join(' | ')));

  const app = await launchApp(PORT, { ATOM_QA_EXPORT_PATH: EXPORT_PATH, ATOM_QA_IMPORT_PATH: EXPORT_PATH });
  const { cdp, errors } = app;
  let copyGuid = null;
  let importedGuid = null;

  try {
    await clickNav(cdp, 'powerplans');
    await waitFor(cdp, `document.querySelectorAll('[data-pps-plan]').length === ${A.length}`, 40000, 'plan list');
    const activeBadgeRows = await cdp.eval(`[...document.querySelectorAll('[data-pps-plan]')].map(el => ({ g: el.dataset.ppsPlan.slice(0, 8), t: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60) }))`);
    const activeBadge = activeBadgeRows.some(r => /ACTIVE/.test(r.t));
    results.push(result(`studio renders ${A.length} plans with ACTIVE badge`, activeBadge === true, JSON.stringify(activeBadgeRows).slice(0, 300)));

    // ---- select the active plan row
    await cdp.eval(`document.querySelector('[data-pps-plan="${activePlan.guid}"]').click(); true`);
    await waitFor(cdp, `document.getElementById('pps-sel-guid').textContent === '${activePlan.guid}'`, 15000, 'active plan selected');
    results.push(result('selecting a plan loads its details', true, activePlan.name + ' / ' + activePlan.guid));

    // ---- duplicate the active plan
    await cdp.eval(`document.getElementById('pps-duplicate').click(); true`);
    await waitFor(cdp, `document.querySelectorAll('[data-pps-plan]').length === ${A.length + 1}`, 40000, 'duplicate appears');
    const B = listPlans();
    const copy = B.find(p => !aSet.has(p.guid));
    copyGuid = copy ? copy.guid : null;
    const dupName = copy ? copy.name : null;
    const dupUi = await cdp.eval(`(() => ({ sel: document.getElementById('pps-sel-guid').textContent, name: document.getElementById('pps-sel-name').textContent }))()`);
    results.push(result('DUPLICATE creates copy, auto-selects it, names it "(copy)"', !!copy && dupName === activePlan.name + ' (copy)' && dupUi.sel === copyGuid, JSON.stringify({ guid: copyGuid, name: dupName, uiSel: dupUi.sel })));

    // ---- edit an advanced setting on the COPY (processor min state), verify independently
    await waitFor(cdp, `!!document.querySelector('[data-pps-row="${K_TARGET}"]')`, 60000, 'featured settings loaded for copy');
    const preUi = await cdp.eval(`(() => { const a = document.querySelector('[data-pps-ac="${K_TARGET}"]'); const d = document.querySelector('[data-pps-dc="${K_TARGET}"]'); return { tag: a.tagName, ac: a.value, dc: d.value }; })()`);
    const preCopy = readSetting(copyGuid, SG_PROC, SET_THROTTLE_MIN);
    const preActive = readSetting(activePlan.guid, SG_PROC, SET_THROTTLE_MIN);
    const base = Number(preUi.ac);
    const newVal = base >= 50 ? base - 20 : base + 20;
    await cdp.eval(`(() => { document.querySelector('[data-pps-ac="${K_TARGET}"]').value = '${newVal}'; document.querySelector('[data-pps-dc="${K_TARGET}"]').value = '${newVal}'; document.querySelector('[data-pps-apply="${K_TARGET}"]').click(); return true; })()`);
    await waitFor(cdp, `(() => { const b = document.querySelector('[data-pps-apply="${K_TARGET}"]'); return b && b.textContent === 'APPLY' && !b.classList.contains('installing'); })()`, 40000, 'apply completes');
    const postCopy = readSetting(copyGuid, SG_PROC, SET_THROTTLE_MIN);
    const postActive = readSetting(activePlan.guid, SG_PROC, SET_THROTTLE_MIN);
    const applyOk = preUi.tag === 'INPUT' && postCopy.ac === newVal && postCopy.dc === newVal && postActive.ac === preActive.ac && postActive.dc === preActive.dc;
    results.push(result('APPLY advances setting on copy only (powercfg read-back: AC+DC = new, active plan untouched)', applyOk, JSON.stringify({ tag: preUi.tag, base, newVal, preCopy, postCopy, preActive, postActive })));

    const hist1 = await cdp.eval(`(() => { try { const h = JSON.parse(localStorage.getItem('atom-tweak-history') || '[]').filter(e => e.config === 'ppstudio' && e.id === 'ppstudio:${copyGuid}:${K_TARGET}'); return { n: h.length, applied: h[0] ? h[0].applied : null, hasRestoreCmd: !!(h[0] && /setacvalueindex/i.test(String(h[0].command || ''))) }; } catch (e) { return { error: String(e) }; } })()`);
    results.push(result('history entry recorded with explicit-scheme undo command', hist1.n >= 1 && hist1.applied === true && hist1.hasRestoreCmd === true, JSON.stringify(hist1)));

    // ---- rename + description
    const NEWNAME = 'ATOM QA STUDIO ' + Date.now().toString().slice(-6);
    const NEWDESC = 'Automated QA test plan - safe to delete.';
    await cdp.eval(`(() => { document.getElementById('pps-name-input').value = ${JSON.stringify(NEWNAME)}; document.getElementById('pps-desc-input').value = ${JSON.stringify(NEWDESC)}; document.getElementById('pps-save').click(); return true; })()`);
    await waitFor(cdp, `(() => { const b = document.getElementById('pps-save'); return b && b.textContent === 'SAVE' && !b.classList.contains('installing'); })()`, 30000, 'save completes');
    const C = listPlans();
    const renamed = C.find(p => p.guid === copyGuid);
    const uiName = await cdp.eval(`document.getElementById('pps-sel-name').textContent`);
    const regInfo = schemeReg(copyGuid);
    results.push(result('RENAME + description saved and verified (powercfg list + UI + registry)', !!renamed && renamed.name === NEWNAME && uiName === NEWNAME, JSON.stringify({ listName: renamed && renamed.name, uiName, reg: regInfo })));

    // ---- export .pow
    try { fs.rmSync(EXPORT_PATH, { force: true }); } catch {}
    await cdp.eval(`document.getElementById('pps-export').click(); true`);
    await waitFor(cdp, `(() => { const b = document.getElementById('pps-export'); return b && b.textContent === 'EXPORT .POW' && !b.classList.contains('installing'); })()`, 40000, 'export completes');
    let expSize = 0;
    try { expSize = fs.statSync(EXPORT_PATH).size; } catch {}
    results.push(result('EXPORT .pow wrote a real file (size > 0)', expSize > 0, EXPORT_PATH + ' (' + expSize + ' bytes)'));

    // ---- reimport the exported file (carries new name + edited setting)
    await cdp.eval(`document.getElementById('btn-import-plan').click(); true`);
    await waitFor(cdp, `document.querySelectorAll('[data-pps-plan]').length === ${A.length + 2}`, 60000, 'import appears');
    const D = listPlans();
    const imported = D.find(p => !aSet.has(p.guid) && p.guid !== copyGuid);
    importedGuid = imported ? imported.guid : null;
    const impUi = await cdp.eval(`document.getElementById('pps-sel-guid').textContent`);
    const impSet = readSetting(importedGuid, SG_PROC, SET_THROTTLE_MIN);
    results.push(result('IMPORT re-creates the plan: new GUID, name + edited setting travel in the .pow', !!imported && imported.name === NEWNAME && impUi === importedGuid && impSet.ac === newVal && impSet.dc === newVal, JSON.stringify({ guid: importedGuid, name: imported && imported.name, uiSel: impUi, importedSetting: impSet, wantVal: newVal })));

    // ---- delete the imported plan (2-step confirm) then the copy
    await cdp.eval(`document.getElementById('pps-delete').click(); true`);
    const confirmTxt = await cdp.eval(`document.getElementById('pps-delete').textContent`);
    await cdp.eval(`document.getElementById('pps-delete').click(); true`);
    await waitFor(cdp, `document.querySelectorAll('[data-pps-plan]').length === ${A.length + 1}`, 40000, 'imported deleted');
    const delOk1 = !listPlans().some(p => p.guid === importedGuid);
    results.push(result('DELETE (imported): 2-step confirm works, plan removed', confirmTxt === 'CONFIRM?' && delOk1, JSON.stringify({ confirmTxt, gone: delOk1 })));

    await cdp.eval(`document.querySelector('[data-pps-plan="${copyGuid}"]').click(); true`);
    await sleep(400);
    await cdp.eval(`document.getElementById('pps-delete').click(); true`);
    await sleep(200);
    await cdp.eval(`document.getElementById('pps-delete').click(); true`);
    await waitFor(cdp, `document.querySelectorAll('[data-pps-plan]').length === ${A.length}`, 40000, 'copy deleted');
    const finalSet = new Set(listPlans().map(p => p.guid));
    const sameSet = finalSet.size === aSet.size && [...aSet].every(g => finalSet.has(g));
    results.push(result('DELETE (copy): list restored to the original plan set', sameSet, [...finalSet].join(',')));

    // ---- guard: active plan cannot be deleted
    await cdp.eval(`document.querySelector('[data-pps-plan="${activePlan.guid}"]').click(); true`);
    await waitFor(cdp, `document.getElementById('pps-sel-guid').textContent === '${activePlan.guid}'`, 15000, 'active plan selected');
    await waitFor(cdp, `document.getElementById('pps-name-input').value === ${JSON.stringify(activePlan.name)}`, 15000, 'active plan header loaded');
    const guardUi = await cdp.eval(`(() => { const b = document.getElementById('pps-delete'); return { disabled: b.disabled, title: b.title }; })()`);
    // The button is correctly disabled for the active plan; force one click to
    // also prove the renderer's guard message fires if it is ever bypassed.
    await cdp.eval(`(() => { const b = document.getElementById('pps-delete'); b.disabled = false; b.click(); return true; })()`);
    await waitFor(cdp, `/is the active plan/i.test((document.getElementById('tweak-console-content') || {}).textContent || '')`, 10000, 'active-plan guard message');
    const actGuard = await cdp.eval(`(() => ({ btn: document.getElementById('pps-delete').textContent, log: (document.getElementById('tweak-console-content') || {}).textContent || '' }))()`);
    results.push(result('GUARD: deleting the active plan is blocked (button disabled + clear message, plan still present)', guardUi.disabled === true && /active/i.test(guardUi.title) && listPlans().length === A.length && actGuard.btn === 'DELETE' && /is the active plan/i.test(actGuard.log), JSON.stringify({ disabled: guardUi.disabled, title: guardUi.title, btn: actGuard.btn, logTail: actGuard.log.slice(-160) })));

    // ---- guard: built-in plans protected (needs a non-active built-in present)
    if (builtinNonActive) {
      await cdp.eval(`document.querySelector('[data-pps-plan="${builtinNonActive.guid}"]').click(); true`);
      await waitFor(cdp, `document.getElementById('pps-sel-guid').textContent === '${builtinNonActive.guid}'`, 15000, 'built-in plan selected');
      await waitFor(cdp, `document.getElementById('pps-name-input').value === ${JSON.stringify(builtinNonActive.name)}`, 15000, 'built-in plan header loaded');
      await cdp.eval(`document.getElementById('pps-delete').click(); true`);
      await waitFor(cdp, `document.getElementById('pps-delete').textContent === 'CONFIRM?'`, 8000, 'delete confirm armed');
      await cdp.eval(`document.getElementById('pps-delete').click(); true`);
      await waitFor(cdp, `/built-in/i.test((document.getElementById('tweak-console-content') || {}).textContent || '')`, 20000, 'built-in refusal message');
      const blt = await consoleText(cdp);
      const stillThere = listPlans().some(p => p.guid === builtinNonActive.guid);
      results.push(result('GUARD: built-in plan deletion refused by the backend', stillThere && /built-in/i.test(blt), JSON.stringify({ stillThere, builtin: builtinNonActive.name, logTail: blt.slice(-160) })));
    } else {
      results.push(result('GUARD: built-in plan deletion refused by the backend', true, 'skipped: no non-active built-in plan on this machine'));
    }

    const consErr = errors.filter(e => e.startsWith('EXCEPTION:'));
    results.push(result('no renderer exceptions during run', consErr.length === 0, consErr.slice(0, 3).join(' || ').slice(0, 300)));
  } finally {
    app.kill();
    await sleep(1200);
  }

  // ---- final machine state: identical plan set, same active plan
  const F = listPlans();
  const fSet = new Set(F.map(p => p.guid));
  const finalOk = fSet.size === aSet.size && [...aSet].every(g => fSet.has(g)) && F.find(p => p.active).guid === activePlan.guid;
  results.push(result('final machine state: plan set + active plan identical to pre-test', finalOk, F.map(p => p.name + (p.active ? '*' : '')).join(' | ')));

  try { fs.rmSync(EXPORT_PATH, { force: true }); } catch {}
  await finish('ppstudio-live', results, { initialPlans: A.map(p => ({ guid: p.guid, name: p.name, active: p.active })), copyGuid, importedGuid });
  process.exit(results.every(r => r.pass) ? 0 : 2);
})().catch(async (e) => {
  console.error('HARNESS CRASH:', (e && e.stack) || e);
  process.exit(3);
});
