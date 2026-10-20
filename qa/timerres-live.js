'use strict';
// TIMER RESOLUTION live harness: drives the real UI (CDP) through the feature —
// initial state, guide strip + timer card render, text-visibility CSS check,
// SET 0.5 ms (UI -> helper process -> independent PS read-back + pid file),
// idempotent re-apply, switch to 1 ms (helper restart), RESTORE DEFAULT
// (helper gone, state file gone, live timer released), a second 0.5 ms hold,
// then a hard app kill to prove the helper stops with the app. Final cleanup
// releases everything and re-checks the machine is back to its pre-test timer.
//
// Run: node qa/timerres-live.js   (app is killed/relaunched on port 9235)

const fs = require('fs');
const path = require('path');
const { ROOT, sleep, launchApp, waitFor, clickNav, run, result, finish } = require('./lib/cdp.js');

const PORT = 9235;
const SCRIPT = path.join(ROOT, 'src', 'scripts', 'powerplans', 'timer_res.ps1');
const PIDFILE = path.join(process.env.LOCALAPPDATA || '', 'AtomToolBox', 'timer_res.json');

function trScript(args) {
  return run('powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + SCRIPT + '" ' + args);
}

function trStatus() {
  const r = trScript('-Action status');
  const line = String(r.out || '').trim().split(/\r?\n/).filter(Boolean).pop() || '{}';
  try { return JSON.parse(line); } catch { return null; }
}

function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function readPidfile() {
  try { return JSON.parse(fs.readFileSync(PIDFILE, 'utf8')); } catch { return null; }
}

async function waitStatus(pred, timeoutMs, label) {
  const t0 = Date.now();
  let last = null;
  for (;;) {
    last = trStatus();
    if (last && pred(last)) return last;
    if (Date.now() - t0 > timeoutMs) throw new Error('timeout waiting for timer status: ' + label + ' (last=' + JSON.stringify(last) + ')');
    await sleep(700);
  }
}

// Click a timer control only once the UI has unlocked it. While an apply/release
// is in flight the buttons are `disabled`, and a disabled button ignores a
// programmatic click — under load that produced a false "restore did nothing".
async function clickEnabled(cdp, id, timeoutMs = 30000) {
  await waitFor(cdp, `(() => { const b = document.getElementById('${id}'); return b && !b.disabled; })()`, timeoutMs, id + ' enabled');
  await cdp.eval(`document.getElementById('${id}').click(); true`);
}

const consoleText = (cdp) => cdp.eval(`(document.getElementById('tweak-console-content') || {}).textContent || ''`);

const trDom = (cdp) => cdp.eval(`(() => {
  const cur = document.getElementById('tr-current');
  const st = document.getElementById('tr-hold-state');
  const desc = document.getElementById('tr-desc');
  return cur && st && desc ? { cur: cur.textContent, state: st.textContent, desc: desc.textContent } : null;
})()`);

(async () => {
  const results = [];

  // ---- pre-state: release anything left over, then read the machine
  trScript('-Action release');
  await sleep(600);
  const PRE = trStatus();
  results.push(result('pre-state: timer state readable, no helper held', !!(PRE && PRE.ok) && PRE.holder === false, JSON.stringify(PRE)));

  const app = await launchApp(PORT);
  const { cdp, errors } = app;
  let pidA = null, pidB = null, pidC = null;

  try {
    await clickNav(cdp, 'powerplans');

    // ---- page renders: guide strip + timer card + live status read
    await waitFor(cdp, `(() => { const el = document.getElementById('tr-current'); return el && /ms|--/.test(el.textContent); })()`, 30000, 'timer status widget');
    await sleep(1200); // let the first status call land
    const dom0 = await trDom(cdp);
    const guides = await cdp.eval(`document.querySelectorAll('.guide-step').length`);
    const guideLines = await cdp.eval(`document.querySelectorAll('.tr-guide-line').length`);
    const hasButtons = await cdp.eval(`['tr-set-05','tr-set-1','tr-restore','tr-refresh'].every(id => !!document.getElementById(id))`);
    results.push(result('page: 3-step guide strip + timer card with all controls + quick guide', guides === 3 && guideLines === 5 && hasButtons, JSON.stringify({ guides, guideLines, hasButtons })));
    results.push(result('live timer read straight from the machine (UI shows real value)', !!dom0 && dom0.desc.indexOf('SUPPORTED RANGE') !== -1 && dom0.state.indexOf('DEFAULT') !== -1, JSON.stringify(dom0)));

    // ---- text visibility: dim text brightened + names semibold (theme-aware)
    const css = await cdp.eval(`(() => {
      const theme = document.documentElement.getAttribute('data-theme') || 'dark';
      const d = document.querySelector('.tweak-desc');
      const n = document.querySelector('.tweak-name');
      const g = document.querySelector('.guide-step b');
      return {
        theme,
        descColor: d ? getComputedStyle(d).color : null,
        nameWeight: n ? getComputedStyle(n).fontWeight : null,
        guideWeight: g ? getComputedStyle(g).fontWeight : null
      };
    })()`);
    const expectedDim = { dark: 'rgb(173, 173, 173)', oled: 'rgb(162, 162, 162)', light: 'rgb(71, 76, 85)' }[css.theme];
    results.push(result('text visibility: description text brighter + titles semibold (theme: ' + css.theme + ')', css.descColor === expectedDim && css.nameWeight === '600' && css.guideWeight === '600', JSON.stringify(css)));

    // ---- SET 0.5 ms through the UI
    await clickEnabled(cdp, 'tr-set-05');
    const S05 = await waitStatus(s => s.holder && s.holderUnits === 5000, 60000, 'holder 0.5 ms');
    await waitFor(cdp, `(document.getElementById('tr-hold-state') || {}).textContent.indexOf('HELD') === 0`, 20000, 'held pill');
    const file05 = readPidfile();
    pidA = S05 && S05.holderPid;
    const log05 = await consoleText(cdp);
    results.push(result('SET 0.5 ms: helper running, request verified via independent PS read-back', !!(S05 && S05.ok) && S05.holder === true && S05.holderUnits === 5000 && S05.currentMs <= 0.6 && pidAlive(pidA), JSON.stringify({ holder: S05 && S05.holder, units: S05 && S05.holderUnits, currentMs: S05 && S05.currentMs, pid: pidA, alive: pidAlive(pidA) })));
    results.push(result('SET 0.5 ms: state file written with matching PID + units', !!file05 && file05.pid === pidA && file05.units === 5000, JSON.stringify(file05)));
    results.push(result('SET 0.5 ms: UI shows HELD + PID and the log reports the verified request', !!(pidA && String(pidA).length) && /Timer request active: helper PID/.test(log05), (log05.match(/\[[^\]]+\] Timer request active[^\n]*/) || [''])[0]));

    // ---- re-apply same value: idempotent (no helper restart)
    await clickEnabled(cdp, 'tr-set-05');
    await sleep(2500);
    const AGAIN = trStatus();
    const logAgain = await consoleText(cdp);
    results.push(result('SET 0.5 ms again: reported as already held, same helper PID (no restart)', !!(AGAIN && AGAIN.holder) && AGAIN.holderPid === pidA && /already holds/.test(logAgain), JSON.stringify({ pid: AGAIN && AGAIN.holderPid, samePid: AGAIN.holderPid === pidA })));

    // ---- switch to 1 ms: helper restarts, new PID, live timer <= 1.1 ms
    await clickEnabled(cdp, 'tr-set-1');
    const S1 = await waitStatus(s => s.holder && s.holderUnits === 10000, 60000, 'holder 1 ms');
    await sleep(500);
    const log1 = await consoleText(cdp);
    pidB = S1 && S1.holderPid;
    results.push(result('SET 1 ms: helper switched (new PID), request reads 1 ms live (<= 1.1 ms)', !!(S1 && S1.ok) && S1.holder === true && S1.holderUnits === 10000 && S1.currentMs <= 1.1 && pidB !== pidA && pidAlive(pidB), JSON.stringify({ units: S1 && S1.holderUnits, currentMs: S1 && S1.currentMs, oldPid: pidA, newPid: pidB, alive: pidAlive(pidB) })));
    results.push(result('SET 1 ms: log shows the clean switch, old helper gone', /Switching timer resolution/.test(log1) && !pidAlive(pidA), (log1.match(/\[[^\]]+\] Switching[^\n]*/) || [''])[0] + ' | oldAlive=' + pidAlive(pidA)));

    // ---- RESTORE DEFAULT
    await clickEnabled(cdp, 'tr-restore');
    const SR = await waitStatus(s => s.holder === false, 30000, 'holder released');
    await waitFor(cdp, `(document.getElementById('tr-hold-state') || {}).textContent.indexOf('DEFAULT') === 0`, 20000, 'DEFAULT pill');
    const logR = await consoleText(cdp);
    results.push(result('RESTORE DEFAULT: helper process stopped, state file removed', !!(SR && SR.ok) && SR.holder === false && !pidAlive(pidB) && !fs.existsSync(PIDFILE), JSON.stringify({ holder: SR && SR.holder, oldPidAlive: pidAlive(pidB), pidfileExists: fs.existsSync(PIDFILE), currentMs: SR && SR.currentMs })));
    results.push(result('RESTORE DEFAULT: UI pill returns to DEFAULT + log confirms helper stop', /Helper stopped|No timer helper was running/.test(logR), (logR.match(/\[[^\]]+\] (Helper stopped|No timer helper)[^\n]*/) || [''])[0]));

    // ---- second hold at 0.5 ms, then hard-kill the app (simulates app close)
    await clickEnabled(cdp, 'tr-set-05');
    const S05b = await waitStatus(s => s.holder && s.holderUnits === 5000, 60000, 'second holder 0.5 ms');
    pidC = S05b && S05b.holderPid;
    results.push(result('second hold: 0.5 ms active again (PID C alive)', !!(S05b && S05b.holder) && pidAlive(pidC), JSON.stringify({ pid: pidC, currentMs: S05b && S05b.currentMs })));

    run('taskkill /IM electron.exe /F');
    let stoppedMs = -1;
    const t0 = Date.now();
    for (let i = 0; i < 24; i++) {
      await sleep(250);
      const s = trStatus();
      if (s && s.ok && !s.holder) { stoppedMs = Date.now() - t0; break; }
    }
    results.push(result('app closed: helper stops with the app (timer request released, no leftover process)', stoppedMs >= 0 && !pidAlive(pidC) && !fs.existsSync(PIDFILE), JSON.stringify({ stoppedAfterMs: stoppedMs, pidAlive: pidAlive(pidC), pidfileExists: fs.existsSync(PIDFILE) })));

    const consErr = errors.filter(e => e.startsWith('EXCEPTION:'));
    results.push(result('no renderer exceptions during run', consErr.length === 0, consErr.slice(0, 3).join(' || ').slice(0, 300)));
  } finally {
    app.kill();
    await sleep(1000);
  }

  // ---- final machine state: no helper, timer released, machine clean
  trScript('-Action release');
  await sleep(500);
  const POST = trStatus();
  results.push(result('final machine state: no helper, state file gone, pristine timer values reported', !!(POST && POST.ok) && POST.holder === false && !fs.existsSync(PIDFILE) && POST.fastestMs === 0.5 && POST.slowestMs === 15.625, JSON.stringify(POST)));

  await finish('timerres-live', results, { pre: PRE, post: POST, pids: { pidA, pidB, pidC } });
  process.exit(results.every(r => r.pass) ? 0 : 2);
})().catch(async (e) => {
  console.error('HARNESS CRASH:', (e && e.stack) || e);
  try { trScript('-Action release'); } catch {}
  process.exit(3);
});
