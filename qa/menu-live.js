'use strict';
// Context MENU live harness: drives the real UI (CDP), verifies every add-entry
// against the live registry (independent .NET reads), proves the clipboard /
// cwd mechanics of the registered commands, tests the live-state roundtrip,
// then removes everything and byte-compares the restored state.
//
// Run: node qa/menu-live.js     (app is killed/relaunched on port 9230)

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, sleep, launchApp, waitFor, clickNav, regQuery, psRun, result, finish } = require('./lib/cdp.js');

const PORT = 9230;
const QA = path.join(ROOT, 'qa');
const TMP = path.join(QA, 'tmp');
const KEYS = [
  'Software\\Classes\\AllFilesystemObjects\\shell\\AtomCopyPath',
  'Software\\Classes\\Directory\\shell\\AtomCmdHere',
  'Software\\Classes\\Directory\\Background\\shell\\AtomCmdHere',
  'Software\\Classes\\Directory\\shell\\AtomPwshHere',
  'Software\\Classes\\Directory\\Background\\shell\\AtomPwshHere',
  'Software\\Classes\\*\\shell\\AtomOpenNotepad',
  'Software\\Classes\\*\\shell\\TakeOwnership',
  'Software\\Classes\\Directory\\shell\\TakeOwnership'
];

const VERBS = {
  copy_path: {
    keys: ['Software\\Classes\\AllFilesystemObjects\\shell\\AtomCopyPath'],
    mui: 'Copy as path',
    cmd: `powershell.exe -NoProfile -WindowStyle Hidden -Command "Set-Clipboard -Value '%1'"`
  },
  cmd_here: {
    keys: ['Software\\Classes\\Directory\\shell\\AtomCmdHere', 'Software\\Classes\\Directory\\Background\\shell\\AtomCmdHere'],
    mui: 'Open Command Prompt here',
    cmd: 'cmd.exe /s /k pushd "%V"'
  },
  powershell_here: {
    keys: ['Software\\Classes\\Directory\\shell\\AtomPwshHere', 'Software\\Classes\\Directory\\Background\\shell\\AtomPwshHere'],
    mui: 'Open PowerShell here',
    cmd: `powershell.exe -NoProfile -NoExit -Command "Set-Location -LiteralPath '%V'"`
  },
  notepad: {
    keys: ['Software\\Classes\\*\\shell\\AtomOpenNotepad'],
    mui: 'Open with Notepad',
    cmd: 'notepad.exe "%1"'
  },
  take_ownership: {
    keys: ['Software\\Classes\\*\\shell\\TakeOwnership', 'Software\\Classes\\Directory\\shell\\TakeOwnership'],
    mui: 'Take Ownership',
    cmd: 'powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Process cmd -Verb RunAs -ArgumentList \'/c takeown /f \\"%1\\" /r /d y && icacls \\"%1\\" /grant *S-1-5-32-544:F /t\'"'
  }
};

function runTree(mode, keysFile, snapFile) {
  return psRun(`& "${path.join(QA, 'lib', 'reg_tree.ps1')}" -Mode ${mode} -KeysFile "${keysFile}" -File "${snapFile}"`, 120000);
}

function keyExists(key) {
  const r = psRun(`$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('${String(key).replace(/'/g, "''")}'); if ($k) { $k.Close(); 'YES' } else { 'NO' }`);
  return /YES/.test(r.out);
}

// Run a raw command line exactly as written (no Node re-quoting) — mimics how
// the shell executes the registry verb command strings.
function runRawCmd(rawLine, timeoutMs = 30000) {
  const r = spawnSync('cmd', ['/d', '/s', '/c', rawLine], { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, windowsVerbatimArguments: true });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
}

async function toggle(cdp, id, on) {
  await cdp.eval(`(() => {
    const el = document.querySelector('.tweak-toggle[data-cm="${id}"]');
    if (!el) return 'no-row';
    const active = el.classList.contains('active');
    if (active !== ${on}) el.click();
    return 'clicked';
  })()`);
  await waitFor(cdp, `document.querySelector('.tweak-toggle[data-cm="${id}"]') && !document.querySelector('.tweak-toggle[data-cm="${id}"]').classList.contains('executing')`, 45000, id + ' toggle finish');
  await sleep(400);
}

(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const keysFile = path.join(TMP, 'menu-keys.json');
  const snapBefore = path.join(TMP, 'menu-snapshot-before.json');
  const snapAfter = path.join(TMP, 'menu-snapshot-after.json');
  fs.writeFileSync(keysFile, JSON.stringify(KEYS), 'utf8');

  const results = [];
  const snapR = runTree('snapshot', keysFile, snapBefore);
  results.push(result('snapshot pre-state', snapR.ok && /SNAPSHOT OK/.test(snapR.out), snapR.out.slice(0, 200)));

  const app = await launchApp(PORT);
  const { cdp, errors } = app;

  try {
    await clickNav(cdp, 'contextmenu');
    await waitFor(cdp, `!!document.querySelector('.tweak-toggle[data-cm="copy_path"]')`, 30000, 'context menu rows');

    // 1. rows exist
    const rowInfo = await cdp.eval(`(() => {
      const out = {};
      for (const id of ['copy_path','cmd_here','powershell_here','notepad','take_ownership']) {
        const el = document.querySelector('.tweak-toggle[data-cm="' + id + '"]');
        const row = el ? el.closest('.tweak-row') : null;
        out[id] = row ? (row.querySelector('.tweak-name') || {}).textContent : null;
      }
      return out;
    })()`);
    const rowsOk = ['copy_path', 'cmd_here', 'powershell_here', 'notepad', 'take_ownership']
      .every(id => rowInfo[id] && rowInfo[id].length > 3);
    results.push(result('5 add-rows rendered in UI', rowsOk, JSON.stringify(rowInfo)));

    // 2. toggle everything ON via UI, then verify registry (with brief retries
    //    to tolerate transient registry-write visibility under load)
    for (const id of Object.keys(VERBS)) {
      await toggle(cdp, id, true);
      const v = VERBS[id];
      let ok = true;
      const details = [];
      for (const key of v.keys) {
        let mui = { exists: false };
        let cmd = { exists: false };
        for (let attempt = 0; attempt < 6; attempt++) {
          mui = regQuery(key, 'MUIVerb');
          cmd = regQuery(key + '\\command', '');
          if (mui.exists && cmd.exists) break;
          await sleep(600);
        }
        const muiOk = mui.exists && mui.value === v.mui;
        const cmdOk = cmd.exists && (cmd.value === v.cmd || (id === 'take_ownership' && cmd.value.includes('takeown /f \\"%1\\" /r /d y') && cmd.value.includes('*S-1-5-32-544') && !cmd.value.includes('*S-1-3-4')));
        if (!muiOk || !cmdOk) ok = false;
        details.push(`${key.split('\\').pop()}: mui=${muiOk ? 'OK' : JSON.stringify(mui)} cmd=${cmdOk ? 'OK' : JSON.stringify(cmd)}`);
      }
      if (id === 'take_ownership') {
        let shield = { exists: false };
        for (let attempt = 0; attempt < 4; attempt++) {
          shield = regQuery(v.keys[0], 'HasLUAShield');
          if (shield.exists) break;
          await sleep(400);
        }
        if (!shield.exists) { ok = false; details.push('HasLUAShield missing'); }
      }
      results.push(result(`verb ${id} ON -> registry verified`, ok, details.join(' | ').slice(0, 300)));
    }

    // 3. live-state roundtrip: navigate away and back, copy_path must show ON
    await clickNav(cdp, 'dashboard');
    await sleep(400);
    await clickNav(cdp, 'contextmenu');
    await waitFor(cdp, `!!document.querySelector('.tweak-toggle[data-cm="copy_path"]')`, 30000, 'context menu rows (roundtrip)');
    let roundtripOk = true;
    let roundtripDetail = 'active=true (live registry state)';
    try {
      await waitFor(cdp, `(() => { const el = document.querySelector('.tweak-toggle[data-cm="copy_path"]'); return !!(el && el.classList.contains('active')); })()`, 25000, 'copy_path active after roundtrip', 400);
    } catch (e) {
      roundtripOk = false;
      const dbg = await cdp.eval(`(() => { try { return JSON.stringify({ toggles: document.querySelectorAll('.tweak-toggle[data-cm]').length, cm: JSON.parse(localStorage.getItem('atom-cm-states') || '{}').copy_path }); } catch (err) { return 'debug failed'; } })()`);
      roundtripDetail = 'not active within 25s — ' + dbg;
    }
    results.push(result('live cm-state roundtrip (copy_path shows ON after nav away/back)', roundtripOk, roundtripDetail));

    // 4. clipboard E2E: run the registered command exactly as stored (with %1 -> path)
    const weirdDir = path.join(TMP, 'we ird & (dir)');
    fs.mkdirSync(weirdDir, { recursive: true });
    const weirdFile = path.join(weirdDir, 'sam ple & (1).txt');
    fs.writeFileSync(weirdFile, 'atom-qa', 'utf8');
    // control: prove clipboard roundtrip works in this context at all
    spawnSync('powershell', ['-NoProfile', '-Command', `Set-Clipboard -Value 'CONTROL-${Date.now()}'`], { windowsHide: true, timeout: 20000 });
    const ctl = spawnSync('powershell', ['-NoProfile', '-Command', 'Get-Clipboard -Raw'], { encoding: 'utf8', timeout: 20000 });
    results.push(result('clipboard control roundtrip works', /^CONTROL-\d+/.test((ctl.stdout || '').trim()), 'got: ' + JSON.stringify((ctl.stdout || '').trim().slice(0, 40))));
    const storedCopyCmd = regQuery(VERBS.copy_path.keys[0] + '\\command', '').value || '';
    const substCopy = storedCopyCmd.replace(/%1/g, weirdFile);
    const copyRun = runRawCmd(substCopy);
    await sleep(600);
    const clip = spawnSync('powershell', ['-NoProfile', '-Command', 'Get-Clipboard -Raw'], { encoding: 'utf8', timeout: 20000 });
    const clipText = (clip.stdout || '').trim();
    results.push(result('copy_path E2E: clipboard == "we ird & (1).txt" path', clipText === weirdFile, 'got: ' + JSON.stringify(clipText.slice(0, 120)) + ' | run status ' + copyRun.status + ' ' + JSON.stringify(copyRun.stderr.slice(0, 80))));

    // 5. cmd_here E2E: run the stored command's body (prefix stripped) non-interactively, verbatim line
    const storedCmdHere = regQuery(VERBS.cmd_here.keys[0] + '\\command', '').value || '';
    const cmdBody = storedCmdHere.replace(/%V/g, weirdDir).replace(/^cmd\.exe\s+\/s\s+\/k\s+/i, '') + ' && cd';
    const cmdOut = runRawCmd(cmdBody, 20000);
    const cmdCwd = (cmdOut.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
    results.push(result('cmd_here E2E: pushd opens the weird folder (cwd match)', cmdCwd.toLowerCase() === weirdDir.toLowerCase(), 'cwd: ' + JSON.stringify(cmdCwd.slice(0, 120))));

    // 6. powershell_here E2E: Set-Location -LiteralPath with the weird path (NoExit stripped, cwd printed)
    const storedPsh = regQuery(VERBS.powershell_here.keys[0] + '\\command', '').value || '';
    let substPsh = storedPsh.replace(/-NoExit/, '').replace(/%V/g, weirdDir);
    substPsh = substPsh.slice(0, -1) + '; (Get-Location).Path"';
    const psOut = runRawCmd(substPsh);
    const psCwd = (psOut.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
    results.push(result('powershell_here E2E: Set-Location literal path (cwd match)', psCwd.toLowerCase() === weirdDir.toLowerCase(), 'cwd: ' + JSON.stringify(psCwd.slice(0, 120))));

    // 7. history entries recorded for the toggles
    const histCount = await cdp.eval(`(() => { try { return JSON.parse(localStorage.getItem('atom-tweak-history') || '[]').filter(e => e.config === 'contextmenu' && e.script_on).length; } catch { return -1; } })()`);
    results.push(result('history entries recorded for script toggles', histCount >= 5, 'contextmenu script entries: ' + histCount));

    // 8. toggle everything OFF via UI, then verify keys are gone
    for (const id of Object.keys(VERBS)) {
      await toggle(cdp, id, false);
      const v = VERBS[id];
      let ok = true;
      const details = [];
      for (const key of v.keys) {
        if (keyExists(key)) { ok = false; details.push(key + ' still present'); }
      }
      results.push(result(`verb ${id} OFF -> registry key gone`, ok, details.join(' | ') || 'all keys removed'));
    }

    const consErr = errors.filter(e => e.startsWith('EXCEPTION:'));
    results.push(result('no renderer exceptions during run', consErr.length === 0, consErr.slice(0, 3).join(' || ').slice(0, 300)));
  } finally {
    app.kill();
    await sleep(1200);
  }

  // restore + byte-compare cleanliness
  const restoreR = runTree('restore', keysFile, snapBefore);
  results.push(result('restore pre-state', restoreR.ok && /RESTORE OK/.test(restoreR.out), restoreR.out.slice(0, 160)));
  const snap2 = runTree('snapshot', keysFile, snapAfter);
  let same = false;
  try {
    const a = JSON.parse(fs.readFileSync(snapBefore, 'utf8'));
    const b = JSON.parse(fs.readFileSync(snapAfter, 'utf8'));
    same = JSON.stringify(a) === JSON.stringify(b);
  } catch (e) { same = false; }
  results.push(result('machine state byte-identical to pre-state', snap2.ok && same, same ? 'snapshots equal' : 'snapshots differ'));

  await finish('menu-live', results);
  process.exit(results.every(r => r.pass) ? 0 : 2);
})().catch(async (e) => {
  console.error('HARNESS CRASH:', e && e.stack || e);
  process.exit(3);
});
