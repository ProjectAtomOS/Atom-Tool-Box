'use strict';
// Smoke-test the *installed* AtomToolBox 0.2.0 package (not the dev tree).
// Launches C:\Program Files\AtomToolBox\AtomToolBox.exe with CDP, checks the
// packaged UI, PRO lock popup, power plans basic-only page, and version label.
//
// Run: node qa/installed-smoke.js

const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const {
  getJson, CDP, sleep, waitFor, result, finish, LOG_DIR, ensureDirs
} = require('./lib/cdp');

const EXE = path.join(process.env.ProgramFiles, 'AtomToolBox', 'AtomToolBox.exe');
const PORT = 9240;

function killApp() {
  try { execSync('taskkill /IM AtomToolBox.exe /F', { stdio: 'ignore' }); } catch {}
  try { execSync('taskkill /IM electron.exe /F', { stdio: 'ignore' }); } catch {}
}

async function findInstalledPage() {
  for (let i = 0; i < 120; i++) {
    try {
      const list = await getJson('http://127.0.0.1:' + PORT + '/json/list');
      const page = (list || []).find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {}
    await sleep(500);
  }
  throw new Error('installed app did not expose a CDP page');
}

async function main() {
  ensureDirs();
  killApp();
  await sleep(1200);

  const logFile = fs.openSync(path.join(LOG_DIR, 'installed-app.log'), 'a');
  const child = spawn(EXE, ['--remote-debugging-port=' + PORT], {
    stdio: ['ignore', logFile, logFile],
    windowsHide: false
  });
  child.on('error', () => {});

  const results = [];
  let cdp;
  let errors = [];
  try {
    if (!fs.existsSync(EXE)) throw new Error('installed exe missing: ' + EXE);
    const page = await findInstalledPage();
    cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.connect();
    cdp.on((msg) => {
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params && msg.params.exceptionDetails;
        errors.push('EXCEPTION: ' + ((d && d.exception && d.exception.description) || (d && d.text) || 'unknown'));
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const p = msg.params || {};
        if (p.type === 'error') {
          const text = (p.args || []).map(a => (a && (a.value !== undefined ? String(a.value) : a.description)) || '').join(' ');
          if (text) errors.push('CONSOLE: ' + text);
        }
      }
    });
    await cdp.send('Runtime.enable');
    try { await cdp.send('Log.enable'); } catch {}
    await waitFor(cdp, `!!document.querySelector('.nav-item')`, 40000, 'app DOM');
    await sleep(1500);

    // ---- 1. packaged shell / nav inventory
    const shell = await cdp.eval(`({
      title: document.title,
      views: document.querySelectorAll('.nav-item[data-view]').length,
      locked: document.querySelectorAll('.nav-item.nav-locked').length,
      cta: !!document.querySelector('.nav-cta[data-cta="optimizer"]'),
      active: (document.querySelector('.nav-item.active') || {}).dataset ? document.querySelector('.nav-item.active').dataset.view : ''
    })`);
    results.push(result('installed package boots and renders the 20-view shell (4 PRO locks + optimizer CTA)',
      shell.views === 20 && shell.locked === 4 && shell.cta === true,
      JSON.stringify(shell).slice(0, 300)));

    // ---- 2. PRO gate popup (no navigation)
    await cdp.eval(`document.querySelector('.nav-item.nav-locked[data-locked="advpower"]').click(); true`);
    await waitFor(cdp, `(() => { const m = document.getElementById('pro-modal'); return !!m && m.style.display !== 'none'; })()`, 10000, 'pro modal');
    const popup = await cdp.eval(`({
      title: (document.getElementById('pro-modal-title') || {}).textContent || '',
      body: (document.getElementById('pro-modal-body') || {}).textContent || '',
      buy: (document.getElementById('pro-modal-buy') || {}).textContent || '',
      close: (document.getElementById('pro-modal-close') || {}).textContent || '',
      active: (document.querySelector('.nav-item.active') || {}).dataset ? document.querySelector('.nav-item.active').dataset.view : '',
      hasUrlLine: !!document.querySelector('#pro-modal .pro-modal-url')
    })`);
    results.push(result('PRO lock popup copy is minimal and navigation is blocked',
      popup.title === 'ADVANCED POWER' &&
      popup.body === 'This tool only comes with Atom Optimizer.' &&
      /GET ATOM OPTIMIZER/.test(popup.buy) && /CLOSE/.test(popup.close) &&
      popup.active === 'dashboard' && popup.hasUrlLine === false,
      JSON.stringify(popup).slice(0, 320)));
    await cdp.eval(`document.getElementById('pro-modal-close').click(); true`);
    await waitFor(cdp, `document.getElementById('pro-modal').style.display === 'none'`, 8000, 'pro modal closed');

    // ---- 3. power plans: basic-only page still functional
    await cdp.eval(`document.querySelector('.nav-item[data-view="powerplans"]').click(); true`);
    await waitFor(cdp, `document.querySelectorAll('[data-pps-plan]').length >= 3`, 60000, 'power plans list');
    await waitFor(cdp, `document.querySelectorAll('#pps-featured [data-pps-row]').length >= 12`, 60000, 'power plan rows');
    const pps = await cdp.eval(`({
      rows: document.querySelectorAll('#pps-featured [data-pps-row]').length,
      noModeTabs: !document.getElementById('pps-mode-basic') && !document.getElementById('pps-mode-advanced'),
      noAdvancedWidgets: !document.getElementById('pps-filter') && !document.getElementById('pps-show-all') && !document.getElementById('pps-load-more') && !document.getElementById('pps-settings'),
      create: !!document.getElementById('btn-create-plan'),
      exportBtn: !!document.getElementById('pps-export'),
      countText: (document.getElementById('pps-settings-count') || {}).textContent || ''
    })`);
    results.push(result('POWER PLANS in the installed build is BASIC-only (12-16 everyday rows, no ADVANCED controls, create/export present)',
      pps.rows >= 12 && pps.rows <= 16 && pps.noModeTabs && pps.noAdvancedWidgets && pps.create && pps.exportBtn,
      JSON.stringify(pps).slice(0, 320)));

    // ---- 4. version label on SETTINGS
    await cdp.eval(`document.querySelector('.nav-item[data-view="settings"]').click(); true`);
    await waitFor(cdp, `document.body.textContent.includes('Atom ToolBox v0.2.0')`, 15000, 'version label');
    const versionText = await cdp.eval(`(document.body.textContent.match(/Atom ToolBox v[0-9.]+/) || [''])[0]`);
    results.push(result('installed package is v0.2.0', versionText === 'Atom ToolBox v0.2.0', versionText));

    // ---- 5. no renderer crashes while exercising the app
    await cdp.eval(`document.querySelector('.nav-item[data-view="dashboard"]').click(); true`);
    await sleep(1200);
    results.push(result('no renderer exceptions/console errors during the installed-app smoke run',
      errors.length === 0, errors.slice(0, 3).join(' | ').slice(0, 320)));

    await finish('installed-smoke', results, { exe: EXE, title: shell.title, errors });
  } catch (e) {
    results.push(result('installed smoke completed without harness errors', false, e.message));
    try { await finish('installed-smoke', results, { exe: EXE, errors }); } catch {}
  } finally {
    try { if (cdp) cdp.close(); } catch {}
    try { child.kill(); } catch {}
    await sleep(500);
    killApp();
    try { fs.closeSync(logFile); } catch {}
  }
}

main();
