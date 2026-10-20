'use strict';
// PERSONALIZE page live harness: drives the real UI (CDP), verifies every
// accent preset (write + read-back of all 5 registry values incl. the palette
// binary), every registry toggle (ON + OFF direction), small taskbar buttons
// (both restarts), the CHECK STATE sync, and finally restores the pre-state
// byte-identically.
//
// Run: node qa/personalize-live.js   (app is killed/relaunched on port 9231)

const fs = require('fs');
const path = require('path');
const { ROOT, sleep, launchApp, waitFor, clickNav, regQuery, regQueryBinary, regSetDword, regDeleteValue, hex32, run, psRun, result, finish } = require('./lib/cdp.js');

const PORT = 9231;
const QA = path.join(ROOT, 'qa');
const TMP = path.join(QA, 'tmp');

const P = {
  personalize: 'Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize',
  dwm: 'Software\\Microsoft\\Windows\\DWM',
  accent: 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Accent',
  advanced: 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced',
  newstart: 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\HideDesktopIcons\\NewStartPanel',
  hideDesktop: 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\HideDesktopIcons',
  explorer: 'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer'
};

// Presets: hex6 = bat input; dword = 0xAABBGGRR AccentColor; col = 0xC4RRGGBB
// ColorizationColor; rgb = palette slot-4 bytes (R,G,B).
const ACCENTS = {
  blue:   { hex6: '0078D7', dword: 'FFD77800', col: 'C40078D7', rgb: [0x00, 0x78, 0xD7], start: 'FF8F7C80' },
  teal:   { hex6: '038387', dword: 'FF878303', col: 'C4038387', rgb: [0x03, 0x83, 0x87] },
  green:  { hex6: '107C10', dword: 'FF107C10', col: 'C4107C10', rgb: [0x10, 0x7C, 0x10] },
  lime:   { hex6: '7FBA00', dword: 'FF00BA7F', col: 'C47FBA00', rgb: [0x7F, 0xBA, 0x00] },
  gold:   { hex6: 'FFB900', dword: 'FF00B9FF', col: 'C4FFB900', rgb: [0xFF, 0xB9, 0x00] },
  orange: { hex6: 'CA5010', dword: 'FF1050CA', col: 'C4CA5010', rgb: [0xCA, 0x50, 0x10] },
  red:    { hex6: 'E81123', dword: 'FF2311E8', col: 'C4E81123', rgb: [0xE8, 0x11, 0x23] },
  pink:   { hex6: 'E3008C', dword: 'FF8C00E3', col: 'C4E3008C', rgb: [0xE3, 0x00, 0x8C] },
  purple: { hex6: '744DA9', dword: 'FFA94D74', col: 'C4744DA9', rgb: [0x74, 0x4D, 0xA9] },
  gray:   { hex6: '4C4A48', dword: 'FF484A4C', col: 'C44C4A48', rgb: [0x4C, 0x4A, 0x48] }
};

// Registry toggle rows: [path, valueName, onValue, offValue]
const ROWS = {
  tb_tint: [P.personalize, 'ColorPrevalence', 1, 0],
  dwm_tint: [P.dwm, 'ColorPrevalence', 1, 0],
  taskbar_no_combine: [P.advanced, 'TaskbarGlomLevel', 2, 0],
  clock_seconds: [P.advanced, 'ShowSecondsInSystemClock', 1, 0],
  tray_all_icons: [P.explorer, 'EnableAutoTray', 0, 1],
  start_recent: [P.advanced, 'Start_TrackDocs', 1, 0],
  start_frequent: [P.advanced, 'Start_TrackProgs', 1, 0],
  desk_thispc: [P.newstart, '{20D04FE0-3AEA-1069-A2D8-08002B30309D}', 0, 1],
  desk_recyclebin: [P.newstart, '{645FF040-5081-101B-9F08-00AA002F954E}', 0, 1],
  desk_userfiles: [P.newstart, '{59031a47-3f72-44a7-89c5-5595fe6b30ee}', 0, 1]
};

function runTree(mode, keysFile, snapFile) {
  return psRun(`& "${path.join(QA, 'lib', 'reg_tree.ps1')}" -Mode ${mode} -KeysFile "${keysFile}" -File "${snapFile}"`, 120000);
}

function paletteSlot4(b64) {
  try {
    const b = Buffer.from(b64, 'base64');
    if (b.length !== 32) return null;
    return [b[12], b[13], b[14]];
  } catch { return null; }
}

async function ensureState(cdp, id, on, timeoutMs = 90000) {
  const r = await cdp.eval(`(() => {
    const el = document.querySelector('.tweak-toggle[data-id="${id}"][data-config="personalize"]');
    if (!el) return 'no-row';
    const active = el.classList.contains('active');
    if (active !== ${on}) el.click();
    return 'ok';
  })()`);
  if (r === 'no-row') throw new Error('toggle element missing from DOM: ' + id);
  await waitFor(cdp, `(() => { const el = document.querySelector('.tweak-toggle[data-id="${id}"][data-config="personalize"]'); return el && !el.classList.contains('executing'); })()`, timeoutMs, id + ' toggle finish');
  await sleep(300);
}

function readAccentSet() {
  return {
    accentColor: hex32(regQuery(P.dwm, 'AccentColor').value),
    colorization: hex32(regQuery(P.dwm, 'ColorizationColor').value),
    menu: hex32(regQuery(P.accent, 'AccentColorMenu').value),
    start: hex32(regQuery(P.accent, 'StartColorMenu').value),
    palette: regQueryBinary(P.accent, 'AccentPalette')
  };
}

(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const keysFile = path.join(TMP, 'personalize-keys.json');
  const snapBefore = path.join(TMP, 'personalize-snapshot-before.json');
  const snapAfter = path.join(TMP, 'personalize-snapshot-after.json');
  fs.writeFileSync(keysFile, JSON.stringify([P.personalize, P.dwm, P.accent, P.advanced, P.hideDesktop]), 'utf8');

  const results = [];
  const snapR = runTree('snapshot', keysFile, snapBefore);
  results.push(result('snapshot pre-state', snapR.ok && /SNAPSHOT OK/.test(snapR.out), snapR.out.slice(0, 200)));

  // capture pristine accent values + EnableAutoTray (value-level, whole-Explorer key is not snapshotted)
  const pre = readAccentSet();
  const prePrevalence = hex32(regQuery(P.personalize, 'ColorPrevalence').value);
  const preTray = regQuery(P.explorer, 'EnableAutoTray');
  const extra = { pristine: { accentColor: pre.accentColor, colorization: pre.colorization, menu: pre.menu, start: pre.start, paletteLen: pre.palette.exists ? Buffer.from(pre.palette.b64, 'base64').length : 0 }, prePrevalence, preTray };

  const app = await launchApp(PORT);
  const { cdp, errors } = app;

  try {
    // Clear persisted personalize row states from earlier runs so the UI starts
    // from known defaults, then reload so the renderer re-reads localStorage.
    // (Marker + sleep so we never touch the pre-reload DOM: the nav-item wait
    // alone would pass instantly against the old document.)
    try {
      await cdp.eval(`(() => { try { const s = JSON.parse(localStorage.getItem('atom-tweak-states') || '{}'); delete s.personalize; localStorage.setItem('atom-tweak-states', JSON.stringify(s)); } catch (e) {} window.__qaReloadMarker = 1; location.reload(); return true; })()`);
    } catch (e) { /* context destroyed by reload — expected */ }
    await sleep(2500);
    await waitFor(cdp, `typeof window.__qaReloadMarker === 'undefined' && document.querySelectorAll('.nav-item').length > 0`, 30000, 'renderer reload complete');
    await clickNav(cdp, 'personalize');
    await waitFor(cdp, `document.querySelectorAll('.tweak-toggle[data-config="personalize"]').length >= 20`, 40000, 'personalize rows (first page)');
    // rows are chunked (TWEAK_CHUNK = 20) — click LOAD MORE until all 21 are visible
    for (let i = 0; i < 5; i++) {
      const n = await cdp.eval(`document.querySelectorAll('.tweak-toggle[data-config="personalize"]').length`);
      if (n >= 21) break;
      await cdp.eval(`(() => { const b = document.getElementById('btn-tweak-more'); if (b && b.offsetParent !== null) b.click(); return true; })()`);
      await sleep(400);
    }
    await waitFor(cdp, `document.querySelectorAll('.tweak-toggle[data-config="personalize"]').length >= 21`, 20000, 'all 21 personalize rows');

    const rowInfo = await cdp.eval(`(() => {
      const names = [...document.querySelectorAll('.tweak-row')].map(r => (r.querySelector('.tweak-name') || {}).textContent || '');
      const toggles = document.querySelectorAll('.tweak-toggle[data-config="personalize"]').length;
      return { count: toggles, has3desk: ['THIS PC', 'RECYCLE BIN', "USER'S FILES"].every(n => names.some(x => x.toUpperCase().includes(n))), hasAccents: ['BLUE', 'TEAL', 'GREEN', 'LIME', 'GOLD', 'ORANGE', 'RED', 'PINK', 'PURPLE', 'GRAPHITE'].every(n => names.some(x => x.includes(n))) };
    })()`);
    results.push(result('21 personalize rows rendered (3 desktop + 10 accents)', rowInfo.count === 21 && rowInfo.has3desk && rowInfo.hasAccents, JSON.stringify(rowInfo)));

    // ---- accent via UI: teal ON (Explorer restart), then blue ON (restore path)
    await ensureState(cdp, 'accent_teal', true);
    const t = readAccentSet();
    const tSlot = t.palette.exists ? paletteSlot4(t.palette.b64) : null;
    const tealOk = t.accentColor === ACCENTS.teal.dword && t.menu === ACCENTS.teal.dword && t.start === ACCENTS.teal.dword && t.colorization === ACCENTS.teal.col && tSlot && tSlot.join(',') === ACCENTS.teal.rgb.join(',');
    results.push(result('UI click TEAL -> all 5 accent values verified (Explorer restarted)', tealOk, JSON.stringify({ accentColor: t.accentColor, menu: t.menu, start: t.start, colorization: t.colorization, slot4: tSlot })));

    await ensureState(cdp, 'accent_blue', true);
    const b = readAccentSet();
    const blueOk = b.accentColor === pre.accentColor && b.menu === pre.menu && b.start === pre.start && b.colorization === pre.colorization && b.palette.exists && pre.palette.exists && b.palette.b64 === pre.palette.b64;
    results.push(result('UI click BLUE -> byte-exact pristine accent restored (palette equal)', blueOk, JSON.stringify({ accentColor: b.accentColor, start: b.start, colorization: b.colorization, paletteEqual: !!(b.palette.exists && pre.palette.exists && b.palette.b64 === pre.palette.b64) })));

    // ---- direct sweep of the remaining presets (no restarts) + independent read-back
    const sweepOrder = ['green', 'lime', 'gold', 'orange', 'red', 'pink', 'purple', 'gray'];
    const sweepDetails = [];
    let sweepOk = true;
    for (const name of sweepOrder) {
      const a = ACCENTS[name];
      const r = run(`powershell -NoProfile -ExecutionPolicy Bypass -File "src\\scripts\\personalize\\accent_set.ps1" -Color ${a.hex6} -NoRestart`, 60000);
      const v = readAccentSet();
      const slot = v.palette.exists ? paletteSlot4(v.palette.b64) : null;
      const ok = r.ok && v.accentColor === a.dword && v.menu === a.dword && v.start === a.dword && v.colorization === a.col && slot && slot.join(',') === a.rgb.join(',');
      if (!ok) sweepOk = false;
      sweepDetails.push(`${name}:${ok ? 'OK' : JSON.stringify({ exit: r.ok, got: v.accentColor, want: a.dword, col: v.colorization, slot })}`);
    }
    results.push(result('direct sweep 8 presets (write + read-back all values)', sweepOk, sweepDetails.join(' ').slice(0, 400)));

    // restore pristine blue (byte-exact palette) after the sweep
    run(`powershell -NoProfile -ExecutionPolicy Bypass -File "src\\scripts\\personalize\\accent_set.ps1" -Color 0078D7 -StartDword FF8F7C80 -NoRestart`, 60000);
    const b2 = readAccentSet();
    const blue2Ok = b2.accentColor === pre.accentColor && b2.start === pre.start && b2.palette.exists && pre.palette.exists && b2.palette.b64 === pre.palette.b64;
    results.push(result('post-sweep pristine blue restore (byte-exact palette)', blue2Ok, JSON.stringify({ accentColor: b2.accentColor, start: b2.start, paletteEqual: !!(b2.palette.exists && pre.palette.exists && b2.palette.b64 === pre.palette.b64) })));

    // ---- registry toggle rows via UI (both directions each)
    for (const [id, spec] of Object.entries(ROWS)) {
      const [key, valueName, onVal, offVal] = spec;
      const preOn = await cdp.eval(`(() => { const el = document.querySelector('.tweak-toggle[data-id="${id}"][data-config="personalize"]'); if (!el) { const all = [...document.querySelectorAll('.tweak-toggle[data-config="personalize"]')].map(e => e.dataset.id); return { missing: true, count: all.length, ids: all.join(',') }; } return { active: el.classList.contains('active') }; })()`);
      if (preOn.missing) {
        results.push(result(`row ${id} toggled ON+OFF -> values verified`, false, 'row missing from DOM: count=' + preOn.count + ' ids=' + preOn.ids));
        continue;
      }
      const initiallyOn = !!preOn.active;
      let ok = true;
      const steps = [];
      const sequence = initiallyOn ? [false, true] : [true, false];
      for (const want of sequence) {
        await ensureState(cdp, id, want);
        const v = hex32(regQuery(key, valueName).value);
        const wantVal = want ? onVal : offVal;
        const stepOk = v === (wantVal >>> 0).toString(16).toUpperCase().padStart(8, '0');
        if (!stepOk) ok = false;
        steps.push(`${want ? 'ON' : 'OFF'}->${v}${stepOk ? '' : ' (want ' + wantVal.toString(16).toUpperCase() + ')'}`);
      }
      results.push(result(`row ${id} toggled ${sequence.map(s => s ? 'ON' : 'OFF').join('+')} -> values verified`, ok, steps.join(' | ')));
    }

    // ---- small taskbar buttons (both Explorer restarts)
    await ensureState(cdp, 'small_icons', true);
    const s1 = hex32(regQuery(P.advanced, 'TaskbarSmallIcons').value);
    results.push(result('small_icons ON -> TaskbarSmallIcons=1 (Explorer restarted)', s1 === '00000001', s1));
    await ensureState(cdp, 'small_icons', false);
    const s2 = hex32(regQuery(P.advanced, 'TaskbarSmallIcons').value);
    results.push(result('small_icons OFF -> TaskbarSmallIcons=0 (Explorer restarted)', s2 === '00000000', s2));

    // ---- CHECK STATE integration: re-sync rows from the live registry
    await cdp.eval(`document.getElementById('btn-detect-state').click(); true`);
    await waitFor(cdp, `(() => { const b = document.getElementById('btn-detect-state'); return b && !b.disabled && b.textContent === 'CHECK STATE'; })()`, 180000, 'CHECK STATE scan');
    await sleep(600);
    const sync = await cdp.eval(`(() => {
      const blue = document.querySelector('.tweak-toggle[data-id="accent_blue"][data-config="personalize"]');
      const clock = document.querySelector('.tweak-toggle[data-id="clock_seconds"][data-config="personalize"]');
      const small = document.querySelector('.tweak-toggle[data-id="small_icons"][data-config="personalize"]');
      return { blue: blue ? blue.classList.contains('active') : null, clock: clock ? clock.classList.contains('active') : null, small: small ? small.classList.contains('active') : null };
    })()`);
    results.push(result('CHECK STATE sync: blue=ON, clock=OFF, small=OFF (matches registry)', sync.blue === true && sync.clock === false && sync.small === false, JSON.stringify(sync)));

    // ---- history entries for the UI actions
    const hist = await cdp.eval(`(() => { try { const h = JSON.parse(localStorage.getItem('atom-tweak-history') || '[]').filter(e => e.config === 'personalize'); return { script: h.filter(e => e.script_on).length, cmdOn: h.filter(e => e.command_on).length }; } catch (e) { return { error: String(e) }; } })()`);
    results.push(result('history entries recorded (accents via script, rows via command)', hist.script >= 3 && hist.cmdOn >= 10, JSON.stringify(hist)));

    const consErr = errors.filter(e => e.startsWith('EXCEPTION:'));
    results.push(result('no renderer exceptions during run', consErr.length === 0, consErr.slice(0, 3).join(' || ').slice(0, 300)));
  } finally {
    app.kill();
    await sleep(1200);
  }

  // ---- restore + byte-compare cleanliness
  const restoreR = runTree('restore', keysFile, snapBefore);
  results.push(result('restore pre-state', restoreR.ok && /RESTORE OK/.test(restoreR.out), restoreR.out.slice(0, 160)));
  if (preTray.exists) regSetDword(P.explorer, 'EnableAutoTray', parseInt(preTray.value, 10)); else regDeleteValue(P.explorer, 'EnableAutoTray');
  const snap2 = runTree('snapshot', keysFile, snapAfter);
  let same = false;
  try {
    same = JSON.stringify(JSON.parse(fs.readFileSync(snapBefore, 'utf8'))) === JSON.stringify(JSON.parse(fs.readFileSync(snapAfter, 'utf8')));
  } catch { same = false; }
  results.push(result('snapshot keys byte-identical to pre-state', snap2.ok && same, same ? 'snapshots equal' : 'snapshots differ'));

  const post = readAccentSet();
  const postOk = post.accentColor === pre.accentColor && post.colorization === pre.colorization && post.menu === pre.menu && post.start === pre.start && post.palette.exists && pre.palette.exists && post.palette.b64 === pre.palette.b64 && hex32(regQuery(P.personalize, 'ColorPrevalence').value) === prePrevalence;
  results.push(result('final machine accent state == pristine (all 5 values + ColorPrevalence)', postOk, JSON.stringify({ accentColor: post.accentColor, colorization: post.colorization, menu: post.menu, start: post.start, paletteEqual: !!(post.palette.exists && pre.palette.exists && post.palette.b64 === pre.palette.b64) })));

  await finish('personalize-live', results, extra);
  process.exit(results.every(r => r.pass) ? 0 : 2);
})().catch(async (e) => {
  console.error('HARNESS CRASH:', (e && e.stack) || e);
  process.exit(3);
});
