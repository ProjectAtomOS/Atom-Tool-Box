'use strict';
// Full-app smoke harness: sweeps every nav view with renderer console-error
// capture, then exercises the key pages added this session (CONTEXT MENU live
// states, PERSONALIZE 21 rows, POWER PLAN STUDIO presence, STARTUP MANAGER,
// HISTORY entries) and re-checks source wiring on disk.
//
// Run: node qa/smoke-live.js   (app is killed/relaunched on port 9233)

const fs = require('fs');
const path = require('path');
const { ROOT, sleep, launchApp, waitFor, clickNav, result, finish } = require('./lib/cdp.js');

const PORT = 9233;

const VIEWS = [
  'dashboard', 'monitor', 'shortcuts',
  'windows', 'gaming', 'gpu', 'power', 'network', 'privacy',
  'contextmenu', 'brave', 'cleaner', 'powerplans', 'startup', 'personalize',
  'backup', 'apps', 'applist', 'history', 'settings'
];

(async () => {
  const results = [];

  // ---- source wiring checks (fast, on-disk)
  try {
    const idx = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
    const ren = fs.readFileSync(path.join(ROOT, 'src', 'renderer.js'), 'utf8');
    const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    const pcfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'config', 'personalize.json'), 'utf8'));
    const rows = Array.isArray(pcfg.tweaks) ? pcfg.tweaks : (Array.isArray(pcfg) ? pcfg : []);
    const good =
      idx.includes('data-view="personalize"') && idx.includes('data-view="powerplans"') &&
      (idx.match(/nav-locked/g) || []).length === 4 && idx.includes('data-cta="optimizer"') &&
      (idx.match(/data-locked="/g) || []).length === 4 &&
      !idx.includes('data-view="advpower"') && !idx.includes('data-view="winupdate"') &&
      !idx.includes('data-view="dns"') && !idx.includes('data-view="drivers"') &&
      !idx.includes('data-view="optimizer"') &&
      ren.includes("'personalize'") && ren.includes('pps-sel-tag') &&
      ren.includes('openProModal') && ren.includes('pro-modal') && !ren.includes('renderOptimizerPage') &&
      main.includes('windowsVerbatimArguments: verbatim') && main.includes('windowsVerbatimArguments: true') &&
      main.includes('optimizerOnly(') &&
      rows.length === 21;
    results.push(result('source wiring: nav buttons, ADVANCED locked (PRO popup), verbatim spawn fix, 21 personalize rows', good, JSON.stringify({ personalizeRows: rows.length })));
  } catch (e) {
    results.push(result('source wiring: nav buttons, verbatim spawn fix, pps-sel-tag, 21 personalize rows', false, String(e.message || e)));
  }

  const app = await launchApp(PORT);
  const { cdp, errors } = app;

  try {
    // ---- nav sweep: every view renders content
    const navDetails = [];
    let navOk = true;
    for (const v of VIEWS) {
      try {
        await clickNav(cdp, v);
        await waitFor(cdp, `document.getElementById('content-area') && document.getElementById('content-area').children.length > 0`, 30000, 'content for ' + v);
        await sleep(300);
        navDetails.push(v + ':ok');
      } catch (e) {
        navOk = false;
        navDetails.push(v + ':FAIL(' + String(e.message || e).slice(0, 50) + ')');
      }
    }
    results.push(result(`nav sweep: all ${VIEWS.length} views render content`, navOk, navDetails.join(' ')));

    // ---- windows / gaming / power: tweak rows present
    await clickNav(cdp, 'windows');
    await waitFor(cdp, `document.querySelectorAll('#content-area .tweak-toggle[data-id]').length >= 10`, 20000, 'windows rows');
    const winCount = await cdp.eval(`document.querySelectorAll('#content-area .tweak-toggle[data-id]').length`);
    await clickNav(cdp, 'gaming');
    await waitFor(cdp, `document.querySelectorAll('#content-area .tweak-toggle[data-id]').length >= 10`, 20000, 'gaming rows');
    const gamCount = await cdp.eval(`document.querySelectorAll('#content-area .tweak-toggle[data-id]').length`);
    await clickNav(cdp, 'power');
    await waitFor(cdp, `document.querySelectorAll('#content-area .tweak-toggle[data-id]').length >= 5`, 20000, 'power rows');
    const powCount = await cdp.eval(`document.querySelectorAll('#content-area .tweak-toggle[data-id]').length`);
    results.push(result('windows / gaming / power pages render tweak rows', winCount >= 10 && gamCount >= 10 && powCount >= 5, JSON.stringify({ winCount, gamCount, powCount })));

    // ---- context menu: 5 add rows + correct live state (TakeOwnership ON, others OFF)
    await clickNav(cdp, 'contextmenu');
    await waitFor(cdp, `!!document.querySelector('.tweak-toggle[data-cm="take_ownership"]')`, 30000, 'context menu add rows');
    await waitFor(cdp, `document.querySelector('.tweak-toggle[data-cm="take_ownership"]').classList.contains('active')`, 30000, 'take_ownership live state ON');
    const cmStates = await cdp.eval(`(() => { const ids = ['copy_path','cmd_here','powershell_here','notepad','take_ownership']; const o = {}; for (const i of ids) { const el = document.querySelector('.tweak-toggle[data-cm="' + i + '"]'); o[i] = el ? el.classList.contains('active') : null; } return o; })()`);
    const cmOk = cmStates.take_ownership === true && cmStates.copy_path === false && cmStates.cmd_here === false && cmStates.powershell_here === false && cmStates.notepad === false;
    results.push(result('context menu: 5 add rows live-verified (TakeOwnership ON, rest OFF)', cmOk, JSON.stringify(cmStates)));

    // ---- personalize: 21 rows after LOAD MORE
    await clickNav(cdp, 'personalize');
    await waitFor(cdp, `document.querySelectorAll('#content-area .tweak-toggle[data-id]').length >= 20`, 25000, 'personalize rows');
    for (let i = 0; i < 6; i++) {
      const n = await cdp.eval(`document.querySelectorAll('#content-area .tweak-toggle[data-id]').length`);
      if (n >= 21) break;
      await cdp.eval(`(() => { const b = document.getElementById('btn-tweak-more'); if (b) b.click(); return true; })()`);
      await sleep(400);
    }
    const pCount = await cdp.eval(`document.querySelectorAll('#content-area .tweak-toggle[data-id]').length`);
    const hasAccent = await cdp.eval(`!!document.querySelector('#content-area .tweak-toggle[data-id="accent_blue"]')`);
    results.push(result('personalize: 21 rows + accent presets render', pCount === 21 && hasAccent === true, JSON.stringify({ pCount, hasAccent })));

    // ---- power plans studio presence
    await clickNav(cdp, 'powerplans');
    await waitFor(cdp, `document.querySelectorAll('[data-pps-plan]').length >= 3`, 40000, 'studio plan list');
    const ppInfo = await cdp.eval(`(() => ({ plans: document.querySelectorAll('[data-pps-plan]').length, hasImport: !!document.getElementById('btn-import-plan'), hasRefresh: !!document.getElementById('btn-refresh-plans'), hasDetail: !!document.getElementById('pps-detail') }))()`);
    results.push(result('power plans studio: plan list + import/refresh/detail UI present', ppInfo.plans >= 3 && ppInfo.hasImport && ppInfo.hasRefresh && ppInfo.hasDetail, JSON.stringify(ppInfo)));

    // ---- startup manager rows
    await clickNav(cdp, 'startup');
    await waitFor(cdp, `document.querySelectorAll('#startup-rows .tweak-row').length >= 1`, 60000, 'startup rows');
    const stCount = await cdp.eval(`document.querySelectorAll('#startup-rows .tweak-row').length`);
    results.push(result('startup manager lists entries', stCount >= 1, 'entries=' + stCount));

    // ---- history: entries from earlier harness runs + revert buttons
    await clickNav(cdp, 'history');
    await waitFor(cdp, `document.querySelectorAll('#history-rows .tweak-row').length >= 3`, 15000, 'history rows');
    const histInfo = await cdp.eval(`(() => ({ rows: document.querySelectorAll('#history-rows .tweak-row').length, btns: document.querySelectorAll('#history-rows .history-revert-btn').length, hasRevertAll: !!document.getElementById('btn-revert-all') }))()`);
    results.push(result('history view lists prior entries with REVERT controls', histInfo.rows >= 3 && histInfo.btns === histInfo.rows && histInfo.hasRevertAll === true, JSON.stringify(histInfo)));

    // ---- applist rows (installed apps scan)
    await clickNav(cdp, 'applist');
    await waitFor(cdp, `document.querySelectorAll('#applist-rows .applist-row').length >= 2`, 90000, 'installed apps rows');
    const appCount = await cdp.eval(`document.querySelectorAll('#applist-rows .applist-row').length`);
    results.push(result('installed apps list renders', appCount >= 2, 'apps=' + appCount));

    // ---- monitor renders after its async scan
    await clickNav(cdp, 'monitor');
    await sleep(3000);
    const monOk = await cdp.eval(`document.getElementById('content-area').children.length > 0`);
    results.push(result('background monitor renders after async scan', monOk === true, 'ok=' + monOk));

    // ---- back to dashboard: app still responsive
    await clickNav(cdp, 'dashboard');
    await waitFor(cdp, `document.getElementById('content-area').children.length > 0`, 15000, 'dashboard render');
    results.push(result('app responsive at end of sweep (dashboard renders)', true, ''));

    // ---- console errors
    const exc = errors.filter(e => String(e).startsWith('EXCEPTION:'));
    results.push(result('no renderer exceptions during the whole sweep', exc.length === 0, exc.slice(0, 3).map(s => String(s).slice(0, 160)).join(' || ')));
  } finally {
    app.kill();
    await sleep(1200);
  }

  await finish('smoke-live', results, {});
  process.exit(results.every(r => r.pass) ? 0 : 2);
})().catch(async (e) => {
  console.error('HARNESS CRASH:', (e && e.stack) || e);
  process.exit(3);
});
