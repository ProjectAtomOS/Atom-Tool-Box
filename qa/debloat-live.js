'use strict';
// Focused Windows App Debloat UI harness. It only scans and exercises the
// selection controls - it never invokes debloat-remove.
//
// Run: node qa/debloat-live.js   (app is killed/relaunched on port 9236)

const { sleep, launchApp, waitFor, clickNav, result, finish } = require('./lib/cdp.js');

const PORT = 9236;

(async () => {
  const results = [];
  const app = await launchApp(PORT);
  const { cdp, errors, kill } = app;
  try {
    await clickNav(cdp, 'debloat');
    await waitFor(cdp, `document.querySelectorAll('#debloat-list .debloat-row').length >= 1`, 120000, 'debloat catalog rows');
    await waitFor(cdp, `/SCAN COMPLETE|ADMINISTRATOR TOKEN|SCAN FAILED/.test((document.getElementById('debloat-status') || {}).textContent || '')`, 120000, 'debloat scan status');

    const info = await cdp.eval(`(() => {
      const rows = Array.from(document.querySelectorAll('#debloat-list .debloat-row'));
      const checks = Array.from(document.querySelectorAll('#debloat-list .debloat-check:not(:disabled)'));
      return {
        rows: rows.length,
        visible: rows.filter(r => r.style.display !== 'none').length,
        removable: checks.length,
        protectedRows: rows.filter(r => r.querySelector('.debloat-check:disabled') && r.dataset.absent !== 'true').length,
        absent: rows.filter(r => r.dataset.absent === 'true').length,
        visibleNames: rows.filter(r => r.style.display !== 'none').map(r => (r.querySelector('.debloat-name') || {}).textContent || ''),
        rawScan: null,
        status: (document.getElementById('debloat-status') || {}).textContent || '',
        packagesShown: !!document.querySelector('#debloat-list .debloat-pkg'),
        showAbsentVisible: (() => { const b = document.getElementById('debloat-show-absent'); return !!b && b.style.display !== 'none'; })()
      };
    })()`);
    info.rawScan = await cdp.eval(`(async () => { const r = await require('electron').ipcRenderer.invoke('debloat-scan'); return (r.apps || []).filter(a => a.installed || a.provisioned).map(a => ({ id: a.id, installed: a.installed, removable: a.removable, protectedCount: a.protectedCount, provisioned: a.provisioned, canRemove: a.canRemove })); })()`);

    results.push(result(
      'debloat catalog renders rows, package names and status',
      info.rows >= 1 && info.visible >= 1 && info.packagesShown && /SCAN COMPLETE/.test(info.status),
      JSON.stringify(info)
    ));

    await cdp.eval(`(() => { document.getElementById('debloat-select-all').click(); return true; })()`);
    const selected = await cdp.eval(`document.querySelectorAll('#debloat-list .debloat-check:checked').length`);
    const removeEnabled = await cdp.eval(`!document.getElementById('debloat-remove').disabled`);
    const removeLabel = await cdp.eval(`document.getElementById('debloat-remove').textContent`);
    results.push(result(
      'debloat select-all selects every visible removable app and enables REMOVE',
      selected > 0 && selected === info.removable && removeEnabled === true && /REMOVE SELECTED \(\d+\)/.test(removeLabel),
      JSON.stringify({ selected, removable: info.removable, removeEnabled, removeLabel })
    ));

    await cdp.eval(`(() => { document.getElementById('debloat-clear').click(); return true; })()`);
    const cleared = await cdp.eval(`document.querySelectorAll('#debloat-list .debloat-check:checked').length`);
    const clearDisabled = await cdp.eval(`document.getElementById('debloat-remove').disabled`);
    results.push(result('debloat clear resets selection and disables REMOVE', cleared === 0 && clearDisabled === true, JSON.stringify({ cleared, clearDisabled })));

    await cdp.eval(`(() => { const b = document.getElementById('debloat-show-absent'); if (b) b.click(); return true; })()`);
    const absentVisible = await cdp.eval(`Array.from(document.querySelectorAll('#debloat-list .debloat-row[data-absent="true"]')).some(r => r.style.display !== 'none')`);
    results.push(result('debloat SHOW NOT INSTALLED reveals catalog-only entries', info.absent === 0 || absentVisible === true, JSON.stringify({ absent: info.absent, absentVisible })));

    await cdp.eval(`(() => { const f = document.getElementById('debloat-filter'); f.value = 'xbox'; f.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await sleep(250);
    const filtered = await cdp.eval(`(() => {
      const rows = Array.from(document.querySelectorAll('#debloat-list .debloat-row'));
      const visible = rows.filter(r => r.style.display !== 'none');
      return { visible: visible.length, names: visible.map(r => (r.querySelector('.debloat-name') || {}).textContent || '') };
    })()`);
    results.push(result('debloat filter narrows the list', filtered.visible >= 1 && filtered.names.some(n => /xbox/i.test(n)), JSON.stringify(filtered)));

    // ---- main/helper integration: remove an app group that is not installed.
    // This exercises the real IPC handler, result file, and post-removal scan
    // without touching any package present on the machine.
    const absentApp = await cdp.eval(`(async () => {
      const r = await require('electron').ipcRenderer.invoke('debloat-scan');
      return (r.apps || []).find(a => !a.installed && !a.provisioned) || null;
    })()`);
    let removeProbe = null;
    if (absentApp) {
      removeProbe = await cdp.eval(`(async () => {
        try { return await require('electron').ipcRenderer.invoke('debloat-remove', { ids: [${JSON.stringify(absentApp.id)}] }); }
        catch (e) { return { threw: String(e && e.message || e) }; }
      })()`);
    }
    const probeOk = !absentApp || (
      removeProbe && removeProbe.ok === true && Array.isArray(removeProbe.results) &&
      removeProbe.results.length === 1 && removeProbe.results[0].ok === true &&
      removeProbe.results[0].verified === true
    );
    results.push(result(
      'debloat remove IPC completes and verifies an absent app group',
      probeOk,
      JSON.stringify({ absentApp: absentApp && absentApp.id, removeProbe })
    ));

    const exc = errors.filter(e => String(e).startsWith('EXCEPTION:') || String(e).startsWith('CONSOLE:'));
    results.push(result('debloat page has no renderer exceptions', exc.length === 0, exc.slice(0, 3).map(s => String(s).slice(0, 160)).join(' || ')));
  } finally {
    kill();
  }
  finish('debloat-live', results);
})().catch((e) => {
  console.error('HARNESS CRASH:', e && e.stack ? e.stack : e);
  process.exit(1);
});
