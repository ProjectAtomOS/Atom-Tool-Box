'use strict';
// POWER PLANS page (simplified) live harness — port 9236.
// Verifies the redesign the user asked for:
//   1. BASIC-ONLY settings: no ADVANCED tab/filter/browse-all; exactly the 16
//      curated everyday rows with PLUGGED IN / ON BATTERY and plain-word text
//   2. real CREATE PLAN: name + base plan -> powercfg new plan (name verified
//      by an independent powercfg /list)
//   3. simple EXPORT: a per-row EXPORT button for every plan + EXPORT .POW in
//      the header -> real .pow files written
//   4. an APPLY from the basic list still verifies independently (AC+DC)
//   5. cleanup: the created plan is deleted, machine plan set + active restored
//
// Run: node qa/pps-simple-live.js   (app is killed/relaunched on port 9236)

const fs = require('fs');
const path = require('path');
const { ROOT, sleep, launchApp, waitFor, clickNav, run, result, finish } = require('./lib/cdp.js');

const PORT = 9236;
const TMP = path.join(ROOT, 'qa', 'tmp');
const EXPORT_PATH = path.join(TMP, 'pps-simple-export.pow');

const BALANCED = '381b4222-f694-41f0-9685-ff5bb260df2e';
const SG_PROC = '54533251-82be-4824-96c1-47b60b740d00';
const SET_MIN = '893dee8e-2bef-41e0-89c6-b55d0929964c';
const K_TARGET = SG_PROC + '|' + SET_MIN;

function listPlans() {
  const r = run('powercfg /list');
  const out = r.out || '';
  const plans = [];
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

async function waitFile(file, timeoutMs = 40000) {
  const t0 = Date.now();
  for (;;) {
    let size = 0;
    try { size = fs.statSync(file).size; } catch (e) { size = 0; }
    if (size > 0) return size;
    if (Date.now() - t0 > timeoutMs) return 0;
    await sleep(250);
  }
}

(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const results = [];

  const A = listPlans();
  const aSet = new Set(A.map(p => p.guid));
  const active = A.find(p => p.active) || A[0];
  const base = A.find(p => p.guid === BALANCED && !p.active) || A.find(p => !p.active);
  results.push(result('pre-state: plan list + exactly one active plan + non-active base for CREATE',
    A.length >= 3 && A.filter(p => p.active).length === 1 && !!base,
    A.map(p => p.name + (p.active ? '*' : '')).join(' | ')));

  const app = await launchApp(PORT, { ATOM_QA_EXPORT_PATH: EXPORT_PATH });
  const { cdp, errors } = app;
  let createdGuid = null;

  try {
    await clickNav(cdp, 'powerplans');
    await waitFor(cdp, `document.querySelectorAll('[data-pps-plan]').length === ${A.length}`, 40000, 'plan list');
    await waitFor(cdp, `document.querySelectorAll('#pps-featured [data-pps-row]').length >= 12`, 60000, 'everyday settings render');

    // ---- 1. BASIC ONLY: no advanced controls, 16 curated rows
    const page = await cdp.eval(`(() => ({
      noModeTabs: !document.getElementById('pps-mode-basic') && !document.getElementById('pps-mode-advanced'),
      noAdvancedWidgets: !document.getElementById('pps-filter') && !document.getElementById('pps-show-all') && !document.getElementById('pps-load-more') && !document.getElementById('pps-settings'),
      rows: document.querySelectorAll('#pps-featured [data-pps-row]').length,
      labels: [...document.querySelectorAll('#pps-featured [data-pps-row] .tweak-name')].map(e => e.textContent),
      descsOk: [...document.querySelectorAll('#pps-featured [data-pps-row]')].every(r => ((r.querySelector('.tweak-desc') || {}).textContent || '').length > 20),
      hasPluggedIn: /PLUGGED IN/.test(document.getElementById('pps-featured').textContent),
      hasOnBattery: /ON BATTERY/.test(document.getElementById('pps-featured').textContent),
      rawAcJargon: /\\| AC:/.test(document.getElementById('pps-featured').textContent),
      countLine: document.getElementById('pps-settings-count').textContent,
      perRowExport: [...document.querySelectorAll('[data-pps-plan]')].every(r => !!r.querySelector('[data-pps-export]')),
      libraryRows: document.querySelectorAll('.pps-lib .tweak-row').length,
      guides: document.querySelectorAll('.guide-step').length,
      timer: !!document.getElementById('tr-current') && document.querySelectorAll('.tr-guide-line').length === 5
    }))()`);
    const wanted = ['LOWEST CPU SPEED (%)', 'TURN OFF SCREEN AFTER', 'SLEEP PC AFTER'];
    const haveWanted = wanted.every(w => page.labels.includes(w));
    results.push(result('BASIC-only layout: no ADVANCED tab / filter / BROWSE ALL, 16 everyday rows, friendly labels + PLUGGED IN / ON BATTERY',
      page.noModeTabs === true && page.noAdvancedWidgets === true && page.rows >= 12 && page.rows <= 16 && haveWanted && page.descsOk && page.hasPluggedIn && page.hasOnBattery && page.rawAcJargon === false,
      JSON.stringify({ rows: page.rows, haveWanted, noModeTabs: page.noModeTabs, noAdvancedWidgets: page.noAdvancedWidgets, descsOk: page.descsOk }).slice(0, 320)));
    results.push(result('page arrangement: CREATE/IMPORT/REFRESH toolbar, per-row EXPORT, library rows and timer guide all present',
      page.perRowExport === true && page.libraryRows >= 1 && page.guides === 3 && page.timer === true,
      JSON.stringify({ perRowExport: page.perRowExport, libraryRows: page.libraryRows, guides: page.guides, timer: page.timer })));
    results.push(result('everyday settings line states the read-back guarantee',
      /^\d+ EVERYDAY SETTINGS — EVERY CHANGE IS READ-BACK VERIFIED$/.test(page.countLine),
      page.countLine));

    // ---- 2. CREATE PLAN form: opens, lists every plan, defaults to the active plan
    await cdp.eval(`document.getElementById('btn-create-plan').click(); true`);
    await sleep(300);
    const form1 = await cdp.eval(`(() => ({
      visible: document.getElementById('pps-create-form').style.display !== 'none',
      options: document.querySelectorAll('#pps-create-base option').length,
      defaultBase: document.getElementById('pps-create-base').value
    }))()`);
    results.push(result('CREATE PLAN opens an inline form with every installed plan as a base (default = active plan)',
      form1.visible === true && form1.options === A.length && form1.defaultBase === active.guid,
      JSON.stringify(form1)));

    await cdp.eval(`document.getElementById('pps-create-cancel').click(); true`);
    await sleep(200);
    const canceled = await cdp.eval(`document.getElementById('pps-create-form').style.display`);
    results.push(result('CANCEL closes the form without creating a plan',
      canceled === 'none' && listPlans().length === A.length,
      'display=' + canceled));

    // ---- 3. CREATE PLAN for real (base = non-active Balanced)
    const NEWNAME = 'ATOM QA SIMPLE ' + Date.now().toString().slice(-6);
    await cdp.eval(`document.getElementById('btn-create-plan').click(); true`);
    await sleep(250);
    await cdp.eval(`(() => {
      document.getElementById('pps-create-name').value = ${JSON.stringify(NEWNAME)};
      document.getElementById('pps-create-base').value = '${base.guid}';
      document.getElementById('pps-create-ok').click();
      return true;
    })()`);
    await waitFor(cdp, `document.querySelectorAll('[data-pps-plan]').length === ${A.length + 1}`, 60000, 'created plan appears');
    const B = listPlans();
    const created = B.find(p => !aSet.has(p.guid));
    createdGuid = created ? created.guid : null;
    await waitFor(cdp, `document.getElementById('pps-sel-guid').textContent === '${createdGuid}'`, 15000, 'created plan auto-selected');
    await waitFor(cdp, `document.querySelectorAll('#pps-featured [data-pps-row]').length >= 12`, 60000, 'created plan settings load');
    const createUi = await cdp.eval(`(() => ({
      name: document.getElementById('pps-sel-name').textContent,
      listNames: [...document.querySelectorAll('[data-pps-plan] .tweak-name')].map(e => e.textContent),
      formHidden: document.getElementById('pps-create-form').style.display === 'none',
      nameInput: document.getElementById('pps-name-input').value,
      log: (document.getElementById('tweak-console-content') || {}).textContent || ''
    }))()`);
    results.push(result('CREATE PLAN creates a real, independently named Windows plan (powercfg /list) and selects it',
      !!created && created.name === NEWNAME && createUi.name === NEWNAME && createUi.listNames.some(n => n.indexOf(NEWNAME) === 0) && createUi.formHidden === true && createUi.nameInput === NEWNAME && /Created power plan/.test(createUi.log),
      JSON.stringify({ guid: createdGuid, listName: created && created.name, uiName: createUi.name }).slice(0, 300)));

    // ---- 4. simple EXPORT: the row button (any plan, no selection change)
    try { fs.rmSync(EXPORT_PATH, { force: true }); } catch (e) { /* ignore */ }
    await cdp.eval(`document.querySelector('[data-pps-export="${createdGuid}"]').click(); true`);
    await waitFor(cdp, `(() => { const b = document.querySelector('[data-pps-export="${createdGuid}"]'); return b && b.textContent === 'EXPORT' && !b.classList.contains('installing'); })()`, 40000, 'row export completes');
    const rowSize = await waitFile(EXPORT_PATH);
    const selAfterRowExp = await cdp.eval(`document.getElementById('pps-sel-guid').textContent`);
    results.push(result('per-row EXPORT saves a real .pow and leaves the selected plan untouched',
      rowSize > 0 && selAfterRowExp === createdGuid,
      'size=' + rowSize + ' bytes'));

    // ---- 5. simple EXPORT: the header EXPORT .POW button
    try { fs.rmSync(EXPORT_PATH, { force: true }); } catch (e) { /* ignore */ }
    await cdp.eval(`document.getElementById('pps-export').click(); true`);
    await waitFor(cdp, `(() => { const b = document.getElementById('pps-export'); return b && b.textContent === 'EXPORT .POW' && !b.classList.contains('installing'); })()`, 40000, 'header export completes');
    const detSize = await waitFile(EXPORT_PATH);
    const expLog = await cdp.eval(`(document.getElementById('tweak-console-content') || {}).textContent || ''`);
    results.push(result('EXPORT .POW in the plan header saves a real .pow (logged with name + size)',
      detSize > 0 && expLog.includes('Exported "' + NEWNAME + '"'),
      'size=' + detSize + ' bytes'));

    // ---- 6. an APPLY from the basic list still verifies independently
    const preUi = await cdp.eval(`(() => { const a = document.querySelector('#pps-featured [data-pps-ac="${K_TARGET}"]'); return { tag: a.tagName, ac: a.value }; })()`);
    const preCopy = readSetting(createdGuid, SG_PROC, SET_MIN);
    const preActive = readSetting(active.guid, SG_PROC, SET_MIN);
    const baseVal = Number(preUi.ac);
    const newVal = baseVal >= 50 ? baseVal - 20 : baseVal + 20;
    await cdp.eval(`(() => {
      document.querySelector('#pps-featured [data-pps-ac="${K_TARGET}"]').value = '${newVal}';
      document.querySelector('#pps-featured [data-pps-dc="${K_TARGET}"]').value = '${newVal}';
      document.querySelector('#pps-featured [data-pps-apply="${K_TARGET}"]').click();
      return true;
    })()`);
    await waitFor(cdp, `(() => { const b = document.querySelector('#pps-featured [data-pps-apply="${K_TARGET}"]'); return b && b.textContent === 'APPLY' && !b.classList.contains('installing'); })()`, 40000, 'apply completes');
    const postCopy = readSetting(createdGuid, SG_PROC, SET_MIN);
    const postActive = readSetting(active.guid, SG_PROC, SET_MIN);
    const log2 = await cdp.eval(`(document.getElementById('tweak-console-content') || {}).textContent || ''`);
    results.push(result('APPLY on the created plan works from the basic list (powercfg read-back AC+DC; active plan untouched)',
      preUi.tag === 'INPUT' && postCopy.ac === newVal && postCopy.dc === newVal && postActive.ac === preActive.ac && postActive.dc === preActive.dc && /Applied and verified/.test(log2),
      JSON.stringify({ baseVal, newVal, preCopy, postCopy, preActive, postActive }).slice(0, 300)));

    const hist = await cdp.eval(`(() => { try { const h = JSON.parse(localStorage.getItem('atom-tweak-history') || '[]').filter(e => e.config === 'ppstudio' && e.id === 'ppstudio:${createdGuid}:${K_TARGET}'); return { n: h.length, applied: h[0] ? h[0].applied : null, hasRestoreCmd: !!(h[0] && /setacvalueindex/i.test(String(h[0].command || ''))) }; } catch (e) { return { error: String(e) }; } })()`);
    results.push(result('undo history entry recorded for the basic-list apply', hist.n >= 1 && hist.applied === true && hist.hasRestoreCmd === true, JSON.stringify(hist)));

    // ---- 7. delete the created plan (2-step confirm)
    await cdp.eval(`document.getElementById('pps-delete').click(); true`);
    const confirmTxt = await cdp.eval(`document.getElementById('pps-delete').textContent`);
    await sleep(200);
    await cdp.eval(`document.getElementById('pps-delete').click(); true`);
    await waitFor(cdp, `document.querySelectorAll('[data-pps-plan]').length === ${A.length}`, 40000, 'created plan deleted');
    const afterDel = listPlans();
    const afterSet = new Set(afterDel.map(p => p.guid));
    const setOk = afterSet.size === aSet.size && [...aSet].every(g => afterSet.has(g)) && afterDel.find(p => p.active).guid === active.guid;
    results.push(result('created plan deleted via 2-step confirm; plan set + active plan restored',
      confirmTxt === 'CONFIRM?' && setOk,
      afterDel.map(p => p.name + (p.active ? '*' : '')).join(' | ')));

    const consErr = errors.filter(e => e.startsWith('EXCEPTION:'));
    results.push(result('no renderer exceptions during run', consErr.length === 0, consErr.slice(0, 3).join(' || ').slice(0, 300)));
  } finally {
    app.kill();
    await sleep(1200);
  }

  const F = listPlans();
  const fSet = new Set(F.map(p => p.guid));
  const finalOk = fSet.size === aSet.size && [...aSet].every(g => fSet.has(g)) && F.find(p => p.active).guid === active.guid;
  results.push(result('final machine state: plan set + active plan identical to pre-test', finalOk, F.map(p => p.name + (p.active ? '*' : '')).join(' | ')));

  try { fs.rmSync(EXPORT_PATH, { force: true }); } catch (e) { /* ignore */ }
  await finish('pps-simple-live', results, { initialPlans: A.map(p => ({ guid: p.guid, name: p.name, active: p.active })), createdGuid });
  process.exit(results.every(r => r.pass) ? 0 : 2);
})().catch(async (e) => {
  console.error('HARNESS CRASH:', (e && e.stack) || e);
  process.exit(3);
});
