'use strict';
// Recapture the two long pages whose complete page height exceeded the initial
// 5,000 px safety cap: Background Monitor and History. Saves to temp files,
// validates dimensions, then replaces the old -full.png images and updates the
// existing manifest. The normal 1600x1000 images are not touched.

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { getJson, CDP, sleep, waitFor, ensureDirs, LOG_DIR } = require('./lib/cdp');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'screenshots');
const PORT = 9242;
const EXE = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'AtomToolBox', 'AtomToolBox.exe');
const W = 1600;
const H = 1000;
const THEMES = (process.env.RECAPTURE_THEMES || 'light,dark,oled')
  .split(',').map(s => s.trim()).filter(Boolean);
const ALL_TARGETS = [
  { id: 'monitor', num: '02', slug: 'background-monitor', title: 'Background Monitor' },
  { id: 'history', num: '19', slug: 'history', title: 'History' }
];
const TARGETS = (process.env.RECAPTURE_TARGETS || 'monitor,history')
  .split(',').map(s => s.trim()).filter(Boolean)
  .map(id => ALL_TARGETS.find(t => t.id === id)).filter(Boolean);
const RESTORE_THEME = process.env.RESTORE_THEME || '';

const results = [];
const errors = [];
let cdp = null;
let child = null;
let log = null;
let initialTheme = 'light';
let restoreTheme = '';
let restored = false;

function rel(file) { return path.relative(OUT, file).split(path.sep).join('/'); }

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
  log = fs.openSync(path.join(LOG_DIR, 'recapture-app.log'), 'a');
  child = spawn(EXE, ['--remote-debugging-port=' + PORT], { stdio: ['ignore', log, log], windowsHide: false });
  child.on('error', (e) => console.error('spawn error:', e.message));
  const page = await findPage();
  cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send('Runtime.enable');
  await waitFor(cdp, `!!document.querySelector('.nav-item')`, 40000, 'app DOM');
  await sleep(1000);
}

async function setViewport(height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: W, height, deviceScaleFactor: 1, mobile: false
  });
  await sleep(350);
}

async function shot(file) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, 180000);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  return { file, ...pngSize(file) };
}

async function gotoView(view) {
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

async function switchTheme(theme) {
  await gotoView('settings');
  await waitFor(cdp, `!!document.querySelector('[data-theme-opt="${theme}"]')`, 10000, 'theme buttons');
  await cdp.eval(`document.querySelector('[data-theme-opt="${theme}"]').click(); true`);
  await waitFor(cdp, `document.documentElement.dataset.theme === '${theme}'`, 10000, 'theme ' + theme);
  await sleep(700);
}

async function metrics() {
  return await cdp.eval(`(() => {
    const c = document.getElementById('content-area');
    const s = document.getElementById('sidebar');
    return {
      contentClient: c ? c.clientHeight : 0,
      contentScroll: c ? c.scrollHeight : 0,
      sidebarClient: s ? s.clientHeight : 0,
      sidebarScroll: s ? s.scrollHeight : 0,
      chrome: innerHeight - (c ? c.clientHeight : 0),
      theme: document.documentElement.dataset.theme || ''
    };
  })()`);
}

async function waitPageReady(view) {
  if (view === 'monitor') {
    await waitFor(cdp, `/\\d+ PROCESSES/.test((document.getElementById('content-area') || {}).innerText || '')`, 30000, 'process list');
    // Give the block list its own moment to load.
    await sleep(1200);
  }
  if (view === 'history') {
    await waitFor(cdp, `document.querySelectorAll('#content-area .tweak-row').length > 0`, 15000, 'history rows');
    await sleep(700);
  }
  const start = Date.now();
  while (Date.now() - start < 20000) {
    const loading = await cdp.eval(`/\\b(LOADING|SCANNING|READING|FETCHING|CHECKING)\\b/.test(
      document.getElementById('content-area') ? document.getElementById('content-area').innerText : ''
    )`);
    if (!loading) return;
    await sleep(400);
  }
  throw new Error('page still shows a loading label after 20s');
}

async function captureFull(theme, target) {
  const base = target.num + '-' + target.slug;
  const finalFile = path.join(OUT, theme, base + '-full.png');
  const tempFile = path.join(OUT, theme, base + '-full.tmp.png');

  await gotoView(target.id);
  await waitPageReady(target.id);

  const startMetrics = await metrics();
  let need = Math.max(startMetrics.contentScroll, startMetrics.sidebarScroll) + startMetrics.chrome + 48;
  need = Math.min(15000, need);
  await setViewport(need);

  let endMetrics = await metrics();
  let overflow = Math.max(endMetrics.contentScroll - endMetrics.contentClient, endMetrics.sidebarScroll - endMetrics.sidebarClient);
  if (overflow > 8 && need < 15000) {
    need = Math.min(15000, need + overflow + 48);
    await setViewport(need);
    endMetrics = await metrics();
  }

  await cdp.eval(`(() => {
    const c = document.getElementById('content-area');
    const s = document.getElementById('sidebar');
    if (c) c.scrollTop = 0;
    if (s) s.scrollTop = 0;
    return true;
  })()`);
  await sleep(500);

  const temp = await shot(tempFile);
  await setViewport(H);
  await sleep(300);

  const complete = temp.width === W && temp.height >= need - 8 &&
    endMetrics.contentScroll <= endMetrics.contentClient + 8 &&
    endMetrics.sidebarScroll <= endMetrics.sidebarClient + 8;

  if (!complete) {
    try { fs.unlinkSync(tempFile); } catch {}
    throw new Error('captured ' + temp.width + 'x' + temp.height + ' for requested ' + need +
      ' (content ' + endMetrics.contentScroll + '/' + endMetrics.contentClient +
      ', sidebar ' + endMetrics.sidebarScroll + '/' + endMetrics.sidebarClient + ')');
  }

  fs.copyFileSync(tempFile, finalFile);
  try { fs.unlinkSync(tempFile); } catch {}

  return {
    theme,
    id: target.id,
    num: target.num,
    title: target.title,
    file: rel(finalFile),
    width: temp.width,
    height: temp.height,
    requestedHeight: need,
    contentClient: endMetrics.contentClient,
    contentScroll: endMetrics.contentScroll,
    sidebarClient: endMetrics.sidebarClient,
    sidebarScroll: endMetrics.sidebarScroll,
    complete: true
  };
}

function updateManifest(allComplete) {
  const manifestPath = path.join(OUT, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const r of results) {
    const rec = (manifest.pages || []).find(p => p.theme === r.theme && p.id === r.id);
    if (!rec) continue;
    rec.fullFile = r.file;
    rec.fullWidth = r.width;
    rec.fullHeight = r.height;
    rec.requestedFullHeight = r.requestedHeight;
    rec.fullPageCapped = false;
    rec.fullContentClient = r.contentClient;
    rec.fullContentScroll = r.contentScroll;
    rec.fullRecapturedAt = new Date().toISOString();
  }
  manifest.fullPagesRecapturedAt = new Date().toISOString();
  const longRecords = (manifest.pages || []).filter(p => p.id === 'monitor' || p.id === 'history');
  const allLongComplete = longRecords.length === 6 &&
    longRecords.every(p => p.fullFile && p.fullPageCapped === false && p.fullHeight > 5000);
  const complete = allComplete && allLongComplete;
  manifest.fullPageRecapture = {
    errors,
    complete,
    pages: longRecords.map(p => ({
      theme: p.theme,
      id: p.id,
      width: p.fullWidth,
      height: p.fullHeight,
      complete: !p.fullPageCapped
    }))
  };
  if (complete) {
    manifest.note = (manifest.note || '').replace(/ Some long full-page images remain capped\./g, '');
  } else {
    manifest.note = (manifest.note || '') + ' Some long full-page images remain capped.';
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}

async function main() {
  ensureDirs();
  await launchApp();
  try {
    const info = await cdp.eval(`({ theme: document.documentElement.dataset.theme || 'dark' })`);
    initialTheme = info.theme;
    restoreTheme = RESTORE_THEME || initialTheme;
    console.log('initial theme:', initialTheme, '-> restore:', restoreTheme);

    await setViewport(H);
    await gotoView('dashboard');
    await sleep(800);

    for (const theme of THEMES) {
      console.log('\n=== ' + theme.toUpperCase() + ' ===');
      await switchTheme(theme);
      for (const target of TARGETS) {
        try {
          console.log('capturing complete full page: ' + theme + '/' + target.id + '...');
          const r = await captureFull(theme, target);
          results.push(r);
          console.log('  -> ' + r.width + 'x' + r.height + ' (content ' + r.contentScroll + 'px, complete=' + r.complete + ')');
        } catch (e) {
          const msg = theme + '/' + target.id + ': ' + e.message;
          errors.push(msg);
          console.error('  FAILED: ' + msg);
          await setViewport(H).catch(() => {});
          await sleep(400);
        }
      }
    }

    await switchTheme(restoreTheme);
    restored = true;
    console.log('\nrestored theme:', restoreTheme);
  } catch (e) {
    errors.push('FATAL: ' + e.message);
    console.error('FATAL:', e.message);
  } finally {
    if (!restored) { try { await switchTheme(restoreTheme || initialTheme); } catch {} }
    const expected = THEMES.length * TARGETS.length;
    const allComplete = results.length === expected && errors.length === 0;
    try { updateManifest(allComplete); } catch (e) { console.error('manifest update failed:', e.message); }
    try { if (cdp) cdp.close(); } catch {}
    try { if (child) child.kill(); } catch {}
    await sleep(400);
    killApp();
    try { if (log) fs.closeSync(log); } catch {}
    console.log('\nRecaptured ' + results.length + '/' + expected + ' complete full pages; ' + errors.length + ' error(s).');
    if (errors.length) { for (const e of errors) console.log('  - ' + e); }
  }
}

main();
