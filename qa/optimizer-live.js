'use strict';
// ADVANCED lock popup live harness — port 9238.
// Verifies the simplified free-build gate:
//   1. ADVANCED shows 4 locked entries with a PRO tag + a GET ATOM OPTIMIZER CTA
//   2. clicking a locked entry opens a POPUP that says the tool only comes with
//      Atom Optimizer — and does NOT navigate anywhere
//   3. the popup closes with NOT NOW, Escape and backdrop clicks
//   4. backend refuses every advanced IPC; search hides Windows Update tweaks
//   5. the rest of the app still works; zero renderer exceptions
//
// Run: node qa/optimizer-live.js   (app is killed/relaunched on port 9238)

const fs = require('fs');
const path = require('path');
const { ROOT, sleep, launchApp, waitFor, clickNav, result, finish } = require('./lib/cdp.js');

const PORT = 9238;
const URL_OPTIMIZER = 'https://www.atom-os.com/optimizer';
const FEATURES = [
  { id: 'advpower', name: 'ADVANCED POWER', nav: 'ADVANCED POWER' },
  { id: 'winupdate', name: 'WINDOWS UPDATE CONTROL', nav: 'WINDOWS UPDATE' },
  { id: 'dns', name: 'DNS OPTIMIZER', nav: 'DNS OPTIMIZER' },
  { id: 'drivers', name: 'DRIVER HUB', nav: 'DRIVER HUB' }
];

async function openPopup(cdp, featureId) {
  await cdp.eval(`document.querySelector('[data-locked="${featureId}"]').click(); true`);
  await waitFor(cdp, `(() => { const m = document.getElementById('pro-modal'); return !!m && m.style.display !== 'none'; })()`, 10000, 'popup for ' + featureId);
  return cdp.eval(`(() => {
    const m = document.getElementById('pro-modal');
    const active = document.querySelector('.nav-item.active');
    return {
      title: (document.getElementById('pro-modal-title') || {}).textContent || '',
      body: (document.getElementById('pro-modal-body') || {}).textContent || '',
      buy: (document.getElementById('pro-modal-buy') || {}).textContent || '',
      close: (document.getElementById('pro-modal-close') || {}).textContent || '',
      hasUrlLine: !!m.querySelector('.pro-modal-url'),
      active: active ? (active.textContent || '').replace(/PRO/, '').trim() : null,
      page: (document.querySelector('#content-area .section-title') || {}).textContent || ''
    };
  })()`);
}

async function closePopup(cdp, how) {
  if (how === 'button') await cdp.eval(`document.getElementById('pro-modal-close').click(); true`);
  else if (how === 'escape') await cdp.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
  else if (how === 'backdrop') await cdp.eval(`document.getElementById('pro-modal').click(); true`);
  await waitFor(cdp, `document.getElementById('pro-modal').style.display === 'none'`, 8000, 'popup closed via ' + how);
}

(async () => {
  const results = [];

  // ---- source wiring (on disk)
  try {
    const idx = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');
    const ren = fs.readFileSync(path.join(ROOT, 'src', 'renderer.js'), 'utf8');
    const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
    const good =
      (idx.match(/nav-locked/g) || []).length === 4 &&
      (idx.match(/data-locked="/g) || []).length === 4 &&
      idx.includes('data-cta="optimizer"') && !idx.includes('data-view="optimizer"') &&
      !idx.includes('data-view="advpower"') && !idx.includes('data-view="winupdate"') &&
      !idx.includes('data-view="dns"') && !idx.includes('data-view="drivers"') &&
      ren.includes("const OPTIMIZER_URL = 'https://www.atom-os.com/optimizer'") &&
      ren.includes('function openProModal(') && ren.includes('pro-modal-backdrop') &&
      ren.includes('This tool only comes with Atom Optimizer.') &&
      ren.includes("ipcRenderer.invoke('open-external', OPTIMIZER_URL)") &&
      !ren.includes('renderOptimizerPage') &&
      main.includes('function optimizerOnly(') &&
      main.includes("const OPTIMIZER_URL = 'https://www.atom-os.com/optimizer'") &&
      main.includes('Only http(s) links can be opened');
    results.push(result('source wiring: 4 PRO-locked nav entries, popup, official URL, http(s)-only opener, backend gate',
      good, JSON.stringify({ locked: (idx.match(/nav-locked/g) || []).length })));
  } catch (e) {
    results.push(result('source wiring: 4 PRO-locked nav entries, popup, official URL, http(s)-only opener, backend gate', false, String(e.message || e)));
  }

  const app = await launchApp(PORT);
  const { cdp, errors } = app;

  try {
    await clickNav(cdp, 'dashboard');
    await waitFor(cdp, `!!document.querySelector('.nav-item.nav-locked')`, 30000, 'locked nav entries');

    // ---- 1. nav structure: locked entries never navigate
    const nav = await cdp.eval(`(() => {
      const locked = [...document.querySelectorAll('.nav-item.nav-locked')];
      const cta = document.querySelector('.nav-item.nav-cta');
      return {
        locked: locked.map(el => ({ locked: el.dataset.locked || null, view: el.dataset.view || null, pro: (el.querySelector('.nav-pro') || {}).textContent || '', text: (el.textContent || '').replace(/\\s+/g, ' ').trim() })),
        cta: cta ? { text: (cta.textContent || '').replace(/\\s+/g, ' ').trim(), cta: cta.dataset.cta || null, view: cta.dataset.view || null } : null,
        oldViews: ['advpower', 'winupdate', 'dns', 'drivers', 'optimizer'].filter(v => !!document.querySelector('.nav-item[data-view="' + v + '"]'))
      };
    })()`);
    const lockedOk = nav.locked.length === 4 &&
      FEATURES.every(f => nav.locked.some(l => l.locked === f.id && l.view === null && l.pro === 'PRO' && l.text.replace(/\s*PRO$/, '').trim() === f.nav)) &&
      nav.oldViews.length === 0 &&
      !!nav.cta && /GET ATOM OPTIMIZER/.test(nav.cta.text) && nav.cta.cta === 'optimizer' && nav.cta.view === null;
    results.push(result('ADVANCED group: 4 locked entries with PRO tag + GET ATOM OPTIMIZER CTA (no working views)',
      lockedOk, JSON.stringify(nav).slice(0, 420)));

    // ---- 2. clicking each locked entry opens the popup, stays on the current page
    for (const f of FEATURES) {
      const p = await openPopup(cdp, f.id);
      const ok = p.title === f.name &&
        p.body === 'This tool only comes with Atom Optimizer.' &&
        p.hasUrlLine === false &&
        /GET ATOM OPTIMIZER/.test(p.buy) &&
        p.close === 'CLOSE' &&
        p.active === 'DASHBOARD' && /SYSTEM_DASHBOARD/.test(p.page);
      results.push(result(`"${f.name}" click -> popup says PRO / Atom Optimizer only (no navigation)`, ok, JSON.stringify(p).slice(0, 340)));
      await closePopup(cdp, 'button');
    }

    // ---- 3. popup can be dismissed with Escape and with a backdrop click
    await openPopup(cdp, 'advpower');
    await closePopup(cdp, 'escape');
    results.push(result('popup closes with Escape', true, ''));
    await openPopup(cdp, 'dns');
    await closePopup(cdp, 'backdrop');
    results.push(result('popup closes with a backdrop click', true, ''));

    // ---- 4. backend gate: every advanced IPC refuses
    const gate = await cdp.eval(`(async () => {
      const ipc = require('electron').ipcRenderer;
      const calls = [
        ['advpower-list', undefined], ['advpower-set', {}], ['advpower-unlock', { mode: 'unlock' }],
        ['driver-scan', undefined], ['dns-list-adapters', undefined], ['dns-apply', {}], ['dns-reset-dhcp', {}], ['dns-flush', undefined]
      ];
      const out = {};
      for (const [ch, arg] of calls) {
        try { await ipc.invoke(ch, arg); out[ch] = 'ALLOWED'; }
        catch (e) { out[ch] = String((e && e.message) || e); }
      }
      return out;
    })()`);
    const gateBad = Object.keys(gate).filter(k => !/Atom Optimizer/i.test(gate[k]));
    results.push(result('backend gate: all 8 advanced IPC handlers refuse with an Atom Optimizer message',
      gateBad.length === 0, JSON.stringify(gate).slice(0, 420)));

    // ---- 5. search no longer exposes Windows Update tweaks (real search UI)
    const search = await cdp.eval(`(async () => {
      const input = document.getElementById('gsearch-input');
      const panel = document.getElementById('gsearch-results');
      if (!input || !panel) return { error: 'search UI missing' };
      input.focus();
      input.value = 'defer feature updates';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 350));
      const wu = {
        text: (panel.textContent || '').slice(0, 180),
        rows: panel.querySelectorAll('.gsearch-row').length,
        tags: [...panel.querySelectorAll('.gsearch-tag')].map(e => (e.textContent || '').trim())
      };
      input.value = 'telemetry';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 350));
      const control = {
        rows: panel.querySelectorAll('.gsearch-row').length,
        tags: [...panel.querySelectorAll('.gsearch-tag')].map(e => (e.textContent || '').trim())
      };
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.blur();
      return { wu, control };
    })()`);
    results.push(result('global search: no Windows Update tweaks, no UPDATES tag (other search results still work)',
      !search.error && search.wu.rows === 0 && !search.wu.tags.includes('UPDATES') && search.control.rows > 0,
      JSON.stringify(search).slice(0, 360)));

    // ---- 6. the official link is wired through the http(s)-only opener
    const ext = await cdp.eval(`(async () => {
      const ipc = require('electron').ipcRenderer;
      const out = {};
      for (const u of ['file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'ftp://example.com']) {
        try { await ipc.invoke('open-external', u); out[u] = 'ALLOWED'; }
        catch (e) { out[u] = String((e && e.message) || e); }
      }
      return out;
    })()`);
    const extBad = Object.keys(ext).filter(k => !/http\(s\)/i.test(ext[k]));
    results.push(result('external opener rejects non-http(s) targets (official URL stays wired in the popup)',
      extBad.length === 0, JSON.stringify(ext).slice(0, 300)));

    // ---- 7. the free app still works around the lock
    await clickNav(cdp, 'powerplans');
    await waitFor(cdp, `document.querySelectorAll('[data-pps-plan]').length >= 3`, 40000, 'power plans list');
    await waitFor(cdp, `document.querySelectorAll('#pps-featured [data-pps-row]').length >= 12`, 60000, 'everyday settings');
    const pps = await cdp.eval(`(() => ({ rows: document.querySelectorAll('#pps-featured [data-pps-row]').length, hint: (document.querySelector('.pps-hint') || {}).textContent || '' }))()`);
    results.push(result('POWER PLANS still works and now points to ATOM OPTIMIZER for hidden settings',
      pps.rows >= 12 && /ATOM OPTIMIZER/.test(pps.hint),
      JSON.stringify({ rows: pps.rows, hint: pps.hint }).slice(0, 260)));

    await clickNav(cdp, 'dashboard');
    await waitFor(cdp, `document.getElementById('content-area').children.length > 0`, 15000, 'dashboard responsive');
    results.push(result('app remains responsive after the lock', true, ''));

    const exc = errors.filter(e => String(e).startsWith('EXCEPTION:'));
    results.push(result('no renderer exceptions during run', exc.length === 0, exc.slice(0, 3).map(s => String(s).slice(0, 160)).join(' || ')));
  } finally {
    app.kill();
    await sleep(1200);
  }

  await finish('optimizer-live', results, {});
  process.exit(results.every(r => r.pass) ? 0 : 2);
})().catch(async (e) => {
  console.error('HARNESS CRASH:', (e && e.stack) || e);
  process.exit(3);
});
