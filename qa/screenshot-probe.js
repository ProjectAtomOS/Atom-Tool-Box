'use strict';
// Probe: confirm CDP screenshot sizing (native window vs emulated 1600x1000)
// for the installed AtomToolBox before running the full screenshot pass.

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { getJson, CDP, sleep, waitFor, ensureDirs, LOG_DIR } = require('./lib/cdp');

const PORT = 9241;
const EXE = path.join(process.env.ProgramFiles, 'AtomToolBox', 'AtomToolBox.exe');

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
  throw new Error('no page');
}

async function shot(cdp, name) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const file = path.join(LOG_DIR, name);
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  return { file, ...pngSize(file) };
}

async function main() {
  ensureDirs();
  try { execSync('taskkill /IM AtomToolBox.exe /F', { stdio: 'ignore' }); } catch {}
  try { execSync('taskkill /IM electron.exe /F', { stdio: 'ignore' }); } catch {}
  await sleep(1500);

  const log = fs.openSync(path.join(LOG_DIR, 'capture-app.log'), 'a');
  const child = spawn(EXE, ['--remote-debugging-port=' + PORT], { stdio: ['ignore', log, log], windowsHide: false });
  child.on('error', () => {});

  let cdp;
  try {
    const page = await findPage();
    cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Runtime.enable');
    await waitFor(cdp, `!!document.querySelector('.nav-item')`, 40000, 'app DOM');
    await sleep(1500);

    const native = await cdp.eval(`({
      innerWidth, innerHeight, dpr: devicePixelRatio,
      theme: document.documentElement.dataset.theme,
      saved: localStorage.getItem('atom-theme'),
      bodyW: document.body.clientWidth, bodyH: document.body.clientHeight,
      contentH: document.getElementById('content-area').clientHeight
    })`);
    console.log('native metrics:', JSON.stringify(native));
    console.log('native shot:', JSON.stringify(await shot(cdp, 'probe-native.png')));

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false
    });
    await sleep(500);
    const emu = await cdp.eval(`({ innerWidth, innerHeight, dpr: devicePixelRatio })`);
    console.log('emulated metrics:', JSON.stringify(emu));
    console.log('emulated shot:', JSON.stringify(await shot(cdp, 'probe-emulated.png')));

    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await sleep(300);
    let bounds = null;
    try {
      const w = await cdp.send('Browser.getWindowForTarget');
      bounds = w.bounds;
      await cdp.send('Browser.setWindowBounds', { windowId: w.windowId, bounds: { windowState: 'normal' } });
      await cdp.send('Browser.setWindowBounds', { windowId: w.windowId, bounds: { left: 80, top: 80, width: 1600, height: 1000 } });
      await sleep(600);
      console.log('after setWindowBounds:', JSON.stringify(await cdp.eval(`({ innerWidth, innerHeight, dpr: devicePixelRatio })`)));
      console.log('resized shot:', JSON.stringify(await shot(cdp, 'probe-resized.png')));
    } catch (e) {
      console.log('setWindowBounds failed:', e.message, 'original bounds:', JSON.stringify(bounds));
    }

    // Leave on dashboard with the original theme for inspection.
    await cdp.eval(`document.querySelector('.nav-item[data-view="dashboard"]').click(); true`);
  } catch (e) {
    console.error('probe error:', e.message);
  } finally {
    try { if (cdp) cdp.close(); } catch {}
    try { child.kill(); } catch {}
    await sleep(500);
    try { execSync('taskkill /IM AtomToolBox.exe /F', { stdio: 'ignore' }); } catch {}
    try { fs.closeSync(log); } catch {}
  }
}

main();
