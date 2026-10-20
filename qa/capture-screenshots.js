'use strict';
// Capture every accessible AtomToolBox page in light / dark / OLED themes.
// Output: screenshots/<theme>/<nn>-<slug>.png (+ -full.png when the page scrolls)
// Also writes screenshots/manifest.json and index.html.
//
// Run:  node qa/capture-screenshots.js
// Test: set CAPTURE_TEST=1 to capture only the Windows page in light mode.
//
// The app is launched from the installed 0.2.0 build, with an elevated token
// (the capture process is elevated), so admin-only warning banners are absent.

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { getJson, CDP, sleep, waitFor, ensureDirs, LOG_DIR } = require('./lib/cdp');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'screenshots');
const PORT = 9241;
const EXE = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'AtomToolBox', 'AtomToolBox.exe');
const W = 1600;
const H = 1000;
const TEST = process.env.CAPTURE_TEST === '1';

const THEMES = TEST ? ['light'] : ['light', 'dark', 'oled'];
const VIEWS = [
  { id: 'dashboard',   num: '01', slug: 'dashboard',         title: 'Dashboard' },
  { id: 'monitor',     num: '02', slug: 'background-monitor', title: 'Background Monitor' },
  { id: 'shortcuts',   num: '03', slug: 'shortcuts',          title: 'Shortcuts' },
  { id: 'windows',     num: '04', slug: 'windows',            title: 'Windows' },
  { id: 'gaming',      num: '05', slug: 'gaming',             title: 'Gaming' },
  { id: 'gpu',         num: '06', slug: 'gpu',                title: 'GPU' },
  { id: 'power',       num: '07', slug: 'power',              title: 'Power' },
  { id: 'network',     num: '08', slug: 'network',            title: 'Network' },
  { id: 'privacy',     num: '09', slug: 'privacy-settings',   title: 'Privacy Settings' },
  { id: 'contextmenu', num: '10', slug: 'context-menu',       title: 'Context Menu' },
  { id: 'brave',       num: '11', slug: 'brave-debloater',    title: 'Brave Debloater' },
  { id: 'cleaner',     num: '12', slug: 'cleaner',            title: 'Cleaner' },
  { id: 'powerplans',  num: '13', slug: 'power-plans',        title: 'Power Plans' },
  { id: 'startup',     num: '14', slug: 'startup-manager',    title: 'Startup Manager' },
  { id: 'personalize', num: '15', slug: 'personalize',        title: 'Personalize' },
  { id: 'backup',      num: '16', slug: 'backup-restore',     title: 'Backup & Restore' },
  { id: 'apps',        num: '17', slug: 'app-installer',      title: 'App Installer' },
  { id: 'applist',     num: '18', slug: 'installed-apps',     title: 'Installed Apps' },
  { id: 'history',     num: '19', slug: 'history',            title: 'History' },
  { id: 'settings',    num: '20', slug: 'settings',           title: 'Settings' }
];

const VIEWS_RUN = TEST ? VIEWS.filter(v => v.id === 'windows') : VIEWS;
const errors = [];
const records = [];
let launchInfo = null;
let initial = { theme: 'light', saved: 'light', admin: null };
let restored = false;

function rel(file) {
  return path.relative(OUT, file).split(path.sep).join('/');
}

function pngSize(file) {
  const b = fs.readFileSync(file);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), bytes: b.length };
}

async function findPage() {
  for (let i = 0; i < 120; i++) {
    try {
      const list = await getJson('http://127.0.0.1:' + PORT + '/json/list');
      const page = (list || []).find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {}
    await sleep(500);
  }
  throw new Error('installed app did not expose a CDP page on port ' + PORT);
}

function killApp() {
  try { execSync('taskkill /IM AtomToolBox.exe /F', { stdio: 'ignore' }); } catch {}
  try { execSync('taskkill /IM electron.exe /F', { stdio: 'ignore' }); } catch {}
}

async function launchApp() {
  if (!fs.existsSync(EXE)) throw new Error('installed app not found: ' + EXE);
  killApp();
  await sleep(1500);
  const log = fs.openSync(path.join(LOG_DIR, 'capture-app.log'), 'a');
  const child = spawn(EXE, ['--remote-debugging-port=' + PORT], {
    stdio: ['ignore', log, log],
    windowsHide: false
  });
  child.on('error', (e) => console.error('spawn error:', e.message));
  const page = await findPage();
  const cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Runtime.enable');
  await waitFor(cdp, `!!document.querySelector('.nav-item')`, 40000, 'app DOM');
  await sleep(1000);
  return { child, cdp, log };
}

async function setViewport(cdp, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: W, height, deviceScaleFactor: 1, mobile: false
  });
  await sleep(300);
}

async function shot(cdp, file) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, 120000);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  return { file, ...pngSize(file) };
}

async function gotoView(cdp, view) {
  const ok = await cdp.eval(`(() => {
    const b = document.querySelector('.nav-item[data-view="${view}"]');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  if (!ok) throw new Error('navigation item not found: ' + view);
  await waitFor(cdp, `(() => {
    const a = document.querySelector('.nav-item.active');
    return !!a && a.dataset && a.dataset.view === '${view}';
  })()`, 10000, 'active view ' + view);
  await sleep(250);
}

async function switchTheme(cdp, theme) {
  await gotoView(cdp, 'settings');
  await waitFor(cdp, `!!document.querySelector('[data-theme-opt="${theme}"]')`, 10000, 'theme buttons');
  await cdp.eval(`document.querySelector('[data-theme-opt="${theme}"]').click(); true`);
  await waitFor(cdp, `document.documentElement.dataset.theme === '${theme}'`, 10000, 'theme ' + theme);
  await sleep(700);
}

async function prepareCapture(cdp) {
  await cdp.eval(`(() => {
    const c = document.getElementById('content-area');
    if (c) c.scrollTop = 0;
    const a = document.querySelector('.nav-item.active');
    const s = document.getElementById('sidebar');
    if (a && s) {
      const ar = a.getBoundingClientRect();
      const sr = s.getBoundingClientRect();
      if (ar.bottom > sr.bottom - 12) s.scrollTop += Math.ceil(ar.bottom - sr.bottom + 12);
      else if (ar.top < sr.top + 12) s.scrollTop -= Math.ceil(sr.top - ar.top + 12);
    }
    return true;
  })()`);
  await sleep(300);
}

async function metrics(cdp) {
  return await cdp.eval(`(() => {
    const c = document.getElementById('content-area');
    const s = document.getElementById('sidebar');
    return {
      innerW: innerWidth, innerH: innerHeight, dpr: devicePixelRatio,
      contentClient: c ? c.clientHeight : 0,
      contentScroll: c ? c.scrollHeight : 0,
      sidebarClient: s ? s.clientHeight : 0,
      sidebarScroll: s ? s.scrollHeight : 0,
      chrome: innerHeight - (c ? c.clientHeight : 0),
      adminWarn: document.querySelectorAll('#content-area .admin-warn').length,
      theme: document.documentElement.dataset.theme || ''
    };
  })()`);
}

async function waitPageReady(cdp, view) {
  const warnings = [];
  const waitQuiet = async (expr, ms, label) => {
    try { await waitFor(cdp, expr, ms, label); }
    catch { warnings.push(label + ' timeout'); }
  };

  if (view === 'dashboard') {
    await waitQuiet(`(() => {
      const e = document.getElementById('metric-cpu');
      return !!e && e.textContent !== '--%';
    })()`, 20000, 'dashboard metrics');
  }
  if (view === 'powerplans') {
    await waitQuiet(`document.querySelectorAll('[data-pps-plan]').length >= 2`, 60000, 'power plan list');
    await waitQuiet(`document.querySelectorAll('#pps-featured [data-pps-row]').length >= 10`, 60000, 'power plan rows');
  }
  if (view === 'applist') {
    await waitQuiet(`document.querySelectorAll('#applist-rows .applist-row').length > 0 ||
      /NO APPLICATIONS|NO MATCHING/.test((document.getElementById('content-area') || {}).innerText || '')`, 30000, 'installed apps');
  }
  if (view === 'startup') {
    await waitQuiet(`(() => {
      const r = document.getElementById('startup-rows');
      if (!r) return false;
      return r.querySelectorAll('.tweak-row').length > 0 || /NO STARTUP ENTRIES/.test(r.innerText || '');
    })()`, 30000, 'startup rows');
  }
  if (view === 'contextmenu') {
    await waitQuiet(`document.querySelectorAll('#content-area .tweak-row').length > 0`, 20000, 'context menu rows');
  }
  if (['windows', 'gaming', 'gpu', 'power', 'network', 'privacy', 'brave', 'personalize'].includes(view)) {
    await waitQuiet(`document.querySelectorAll('#tweak-rows .tweak-row').length > 0`, 20000, 'tweak rows');
  }

  // Generic: wait for visible LOADING / SCANNING / READING / FETCHING / CHECKING
  // text to clear. Some pages render such text while a local IPC read completes.
  const start = Date.now();
  let stillLoading = true;
  while (Date.now() - start < 20000) {
    try {
      stillLoading = await cdp.eval(`/\\b(LOADING|SCANNING|READING|FETCHING|CHECKING)\\b/.test(
        document.getElementById('content-area') ? document.getElementById('content-area').innerText : ''
      )`);
    } catch { stillLoading = false; }
    if (!stillLoading) break;
    await sleep(400);
  }
  if (stillLoading) warnings.push('loading text still present after 20s');

  await sleep(900);
  return warnings;
}

async function captureFull(cdp, file, m) {
  let need = Math.min(5000, Math.max(m.contentScroll, m.sidebarScroll) + m.chrome + 32);
  await setViewport(cdp, need);
  let m2 = await metrics(cdp);
  let overflow = Math.max(m2.contentScroll - m2.contentClient, m2.sidebarScroll - m2.sidebarClient);
  if (overflow > 8 && need < 5000) {
    need = Math.min(5000, need + overflow + 32);
    await setViewport(cdp, need);
    m2 = await metrics(cdp);
  }
  await cdp.eval(`(() => {
    const c = document.getElementById('content-area');
    const s = document.getElementById('sidebar');
    if (c) c.scrollTop = 0;
    if (s) s.scrollTop = 0;
    return true;
  })()`);
  await sleep(400);
  const full = await shot(cdp, file);
  return { full, metrics: m2, requestedHeight: need };
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function writeOutputs() {
  const manifest = {
    app: 'AtomToolBox',
    version: '0.2.0',
    capturedAt: new Date().toISOString(),
    source: 'installed build: ' + EXE,
    viewport: { width: W, height: H, deviceScaleFactor: 1 },
    themes: THEMES,
    initialTheme: initial.theme,
    admin: initial.admin,
    adminWarningsVisible: records.some(r => r.adminWarn > 0),
    note: 'PRO-only ADVANCED entries are navigation locks, not pages; they are not included. Full-page PNGs are generated for pages that scroll.',
    errors,
    pages: records
  };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  const byTheme = {};
  for (const r of records) (byTheme[r.theme] = byTheme[r.theme] || []).push(r);

  const html = [];
  html.push('<!doctype html><html lang="en"><head><meta charset="utf-8">');
  html.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  html.push('<title>AtomToolBox 0.2.0 — Screenshots</title>');
  html.push('<style>');
  html.push(':root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#101010;color:#eee;font:14px/1.5 "Segoe UI",sans-serif}');
  html.push('header{padding:32px 40px 12px}h1{margin:0 0 6px;font-size:24px;letter-spacing:.06em}header p{margin:4px 0;color:#9a9a9a}');
  html.push('main{padding:0 40px 60px}.theme{margin-top:40px}.theme h2{font-size:16px;letter-spacing:.14em;margin:0 0 4px;color:#fff}');
  html.push('.theme .meta{color:#777;font-size:12px;margin-bottom:16px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:22px}');
  html.push('figure{margin:0;background:#181818;border:1px solid #2b2b2b;border-radius:6px;overflow:hidden}');
  html.push('figure img{display:block;width:100%;height:auto;background:#0b0b0b}');
  html.push('figcaption{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;font-size:12px;color:#cfcfcf}');
  html.push('figcaption a{color:#7fd1b9;text-decoration:none}figcaption a:hover{text-decoration:underline}');
  html.push('.theme.light h2{color:#f4f5f7}.theme.dark h2{color:#adadad}.theme.oled h2{color:#fff}');
  html.push('</style></head><body><header><h1>ATOM TOOLBOX <span style="color:#7fd1b9">0.2.0</span></h1>');
  html.push('<p>1600×1000 captures of all 20 accessible pages in light, dark and OLED.</p>');
  html.push('</header><main>');
  for (const theme of THEMES) {
    html.push('<section class="theme ' + theme + '"><h2>' + theme.toUpperCase() + '</h2>');
    html.push('<div class="meta">' + (byTheme[theme] || []).length + ' pages</div><div class="grid">');
    for (const r of byTheme[theme] || []) {
      html.push('<figure><a href="' + esc(r.file) + '"><img loading="lazy" src="' + esc(r.file) + '" alt="' + esc(r.title + ' — ' + theme) + '"></a>');
      html.push('<figcaption><span>' + r.num + ' · ' + esc(r.title) + '</span><span><a href="' + esc(r.file) + '">PNG</a>' +
        (r.fullFile ? ' · <a href="' + esc(r.fullFile) + '">FULL</a>' : '') + '</span></figcaption></figure>');
    }
    html.push('</div></section>');
  }
  html.push('</main></body></html>');
  fs.writeFileSync(path.join(OUT, 'index.html'), html.join('\n'), 'utf8');

  console.log('\nWrote ' + path.join(OUT, 'manifest.json'));
  console.log('Wrote ' + path.join(OUT, 'index.html'));
}

async function main() {
  ensureDirs();
  launchInfo = await launchApp();
  const cdp = launchInfo.cdp;

  try {
    initial = await cdp.eval(`({
      theme: document.documentElement.dataset.theme || 'dark',
      saved: localStorage.getItem('atom-theme') || '',
      innerW: innerWidth, innerH: innerHeight, dpr: devicePixelRatio
    })`);
    initial.admin = await cdp.eval(`require('electron').ipcRenderer.invoke('check-admin')`);
    console.log('initial:', JSON.stringify(initial));
    if (!initial.admin) console.log('WARNING: app is not elevated; admin banners will be visible.');

    await setViewport(cdp, H);
    await cdp.eval(`document.querySelector('.nav-item[data-view="dashboard"]').click(); true`);
    await sleep(1200);

    for (const theme of THEMES) {
      console.log('\n=== ' + theme.toUpperCase() + ' ===');
      await switchTheme(cdp, theme);

      for (const p of VIEWS_RUN) {
        const base = p.num + '-' + p.slug;
        try {
          await gotoView(cdp, p.id);
          const warnings = await waitPageReady(cdp, p.id);
          await prepareCapture(cdp);
          const m = await metrics(cdp);
          if (m.theme !== theme) warnings.push('theme mismatch: ' + m.theme);

          const normalFile = path.join(OUT, theme, base + '.png');
          const normal = await shot(cdp, normalFile);
          let full = null;
          let fullMetrics = null;
          let requestedHeight = null;
          let fullExceeded = false;

          if (m.contentScroll > m.contentClient + 4) {
            const f = await captureFull(cdp, path.join(OUT, theme, base + '-full.png'), m);
            full = f.full;
            fullMetrics = f.metrics;
            requestedHeight = f.requestedHeight;
            fullExceeded = f.requestedHeight >= 5000;
            await setViewport(cdp, H);
            await sleep(300);
          }

          const record = {
            theme,
            id: p.id,
            num: p.num,
            title: p.title,
            file: rel(normal.file),
            width: normal.width,
            height: normal.height,
            fullFile: full ? rel(full.file) : null,
            fullWidth: full ? full.width : null,
            fullHeight: full ? full.height : null,
            requestedFullHeight: requestedHeight,
            fullPageCapped: fullExceeded,
            contentClient: m.contentClient,
            contentScroll: m.contentScroll,
            adminWarn: m.adminWarn,
            themeActual: m.theme,
            warnings
          };
          records.push(record);

          const warn = warnings.length ? '  warnings: ' + warnings.join('; ') : '';
          console.log('[' + theme + '] ' + p.num + ' ' + p.title +
            ' -> ' + normal.width + 'x' + normal.height +
            (full ? ' + full ' + full.width + 'x' + full.height : '') +
            (m.adminWarn ? '  ADMIN-WARN' : '') + warn);
        } catch (e) {
          const msg = theme + '/' + p.id + ': ' + e.message;
          errors.push(msg);
          console.error('FAILED ' + msg);
          try {
            await prepareCapture(cdp);
            const errShot = await shot(cdp, path.join(OUT, theme, base + '-error.png'));
            records.push({
              theme, id: p.id, num: p.num, title: p.title,
              file: rel(errShot.file), width: errShot.width, height: errShot.height,
              fullFile: null, fullWidth: null, fullHeight: null,
              requestedFullHeight: null, fullPageCapped: false,
              contentClient: 0, contentScroll: 0, adminWarn: 0,
              themeActual: theme, warnings: ['capture error: ' + e.message]
            });
          } catch {}
        }
      }
    }

    await switchTheme(cdp, initial.theme);
    restored = true;
    try { await gotoView(cdp, 'dashboard'); } catch {}
    console.log('\nRestored theme:', initial.theme);
  } catch (e) {
    errors.push('FATAL: ' + e.message);
    console.error('FATAL:', e.message);
  } finally {
    if (!restored && launchInfo && launchInfo.cdp) {
      try { await switchTheme(launchInfo.cdp, initial.theme); restored = true; } catch {}
    }
    try { writeOutputs(); } catch (e) { console.error('writeOutputs failed:', e.message); }
    try { if (launchInfo && launchInfo.cdp) launchInfo.cdp.close(); } catch {}
    try { if (launchInfo && launchInfo.child) launchInfo.child.kill(); } catch {}
    await sleep(400);
    killApp();
    try { if (launchInfo && launchInfo.log) fs.closeSync(launchInfo.log); } catch {}
    console.log('\nCaptured ' + records.length + ' page records, ' + errors.length + ' error(s).');
  }
}

main();
