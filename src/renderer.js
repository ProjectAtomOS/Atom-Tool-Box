const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, 'config');
const content = document.getElementById('content-area');
const configCache = {};
let pollInterval = null;

// Limit config cache to prevent memory bloat on old devices
const MAX_CACHE_KEYS = 8;

const state = { tweakStates: {}, systemInfo: null, isAdmin: false };

(function loadPersistedState() {
  try {
    const saved = localStorage.getItem('atom-tweak-states');
    if (saved) state.tweakStates = JSON.parse(saved);
  } catch {}
  ipcRenderer.invoke('check-admin').then(r => { state.isAdmin = r; }).catch(() => {});
})();

function persistState() {
  try {
    localStorage.setItem('atom-tweak-states', JSON.stringify(state.tweakStates));
  } catch {}
}

// ---------- UNDO HISTORY ----------

const MAX_HISTORY = 200;

function getHistory() {
  try {
    const raw = localStorage.getItem('atom-tweak-history');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function addHistoryEntry(entry) {
  const history = getHistory();
  history.unshift({
    ...entry,
    timestamp: Date.now()
  });
  while (history.length > MAX_HISTORY) history.pop();
  try {
    localStorage.setItem('atom-tweak-history', JSON.stringify(history));
  } catch {}
}

function clearHistory() {
  try { localStorage.removeItem('atom-tweak-history'); } catch {}
}

function removeHistoryEntry(index) {
  const history = getHistory();
  history.splice(index, 1);
  try {
    localStorage.setItem('atom-tweak-history', JSON.stringify(history));
  } catch {}
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

// Live execution log
const tweakLogs = [];
function logToConsole(msg) {
  tweakLogs.push(msg);
  const el = document.getElementById('tweak-console-content');
  if (el) {
    el.textContent = tweakLogs.slice(-100).join('\n');
    el.scrollTop = el.scrollHeight;
  }
}
function clearConsole() {
  tweakLogs.length = 0;
  const el = document.getElementById('tweak-console-content');
  if (el) el.textContent = '-- Ready --';
}
ipcRenderer.on('tweak-log', (_, data) => {
  logToConsole(data.message);
});

function loadJSON(file) {
  if (!configCache[file]) {
    const keys = Object.keys(configCache);
    if (keys.length >= MAX_CACHE_KEYS) {
      delete configCache[keys[0]];
    }
    let raw;
    try {
      raw = fs.readFileSync(path.join(CONFIG_DIR, file), 'utf8');
    } catch (e) {
      console.error('Failed to read config:', file, e);
      return [];
    }
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    try {
      configCache[file] = JSON.parse(raw);
    } catch (e) {
      console.error('Failed to parse config:', file, e);
      return [];
    }
  }
  return configCache[file];
}

function formatUptime(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatBytes(b) {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'], i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
}

function clearPoll() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    el.classList.add('active');
    clearPoll();
    navigateTo(el.dataset.view);
  });
});

function navigateTo(view) {
  // Clean up any orphaned IPC listeners from previous pages (prevents memory leaks on old PCs)
  ipcRenderer.removeAllListeners('download-progress');
  ipcRenderer.removeAllListeners('app-install-done');
  content.innerHTML = '';
  switch (view) {
    case 'dashboard': renderDashboard(); break;
    case 'windows': renderTweaks('windows', 'WINDOWS & VISUAL OPTIMIZATIONS'); break;
    case 'power': renderTweaks('power', 'POWER & USB MANAGEMENT'); break;
    case 'gaming': renderTweaks('gaming', 'GAMING OPTIMIZATIONS'); break;
    case 'network': renderTweaks('network', 'NETWORK & LATENCY'); break;
    case 'gpu': renderTweaks('gpu', 'GPU CONFIGURATIONS'); break;
    case 'privacy': renderTweaks('privacy', 'PRIVACY SETTINGS'); break;
    case 'brave': renderTweaks('brave', 'BRAVE BROWSER DEBLOAT'); break;
    case 'contextmenu': renderContextMenu(); break;
    case 'shortcuts': renderShortcuts(); break;
    case 'cleaner': renderCleaner(); break;
    case 'history': renderHistory(); break;
    case 'powerplans': renderPowerPlans(); break;
    case 'apps': renderApps(); break;
    case 'applist': renderAppList(); break;
    case 'settings': renderSettings(); break;
  }
}

async function fetchAndRenderDashboard() {
  try {
    const info = await ipcRenderer.invoke('get-system-info');
    state.systemInfo = info;
    const cpuEl = document.getElementById('metric-cpu');
    const memEl = document.getElementById('metric-mem');
    const diskEl = document.getElementById('metric-disk');
    const uptimeEl = document.getElementById('metric-uptime');
    const barFills = content.querySelectorAll('.metric-bar-fill');
    const memSub = content.querySelector('#metric-mem + .metric-sub');
    const diskSub = content.querySelector('#metric-disk + .metric-sub');
    if (cpuEl) { cpuEl.textContent = info.cpuLoad + '%'; if (barFills[0]) barFills[0].style.width = info.cpuLoad + '%'; }
    if (memEl) { memEl.textContent = info.memUsed + '%'; if (barFills[1]) barFills[1].style.width = info.memUsed + '%'; }
    if (memSub) memSub.textContent = `${formatBytes(info.memAvailable)} free / ${formatBytes(info.memTotal)}`;
    if (diskEl) { diskEl.textContent = info.diskUsed + '%'; if (barFills[2]) barFills[2].style.width = info.diskUsed + '%'; }
    if (diskSub) diskSub.textContent = `${formatBytes(info.diskTotal - info.diskTotal * info.diskUsed / 100)} free / ${formatBytes(info.diskTotal)}`;
    if (uptimeEl) uptimeEl.textContent = formatUptime(info.uptime);
    updateStripInfo(info);
    document.getElementById('session-time').textContent = formatUptime(info.uptime);
  } catch(e) {}
}

async function renderDashboard() {
  content.innerHTML = `
    <div class="section-title">SYSTEM_DASHBOARD</div>
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-label">CPU_LOAD_INTENSITY</div>
        <div class="metric-value" id="metric-cpu">--%</div>
        <div class="metric-bar"><div class="metric-bar-fill" style="width:0%"></div></div>
      </div>
      <div class="metric-card">
        <div class="metric-label">MEMORY_AVAILABILITY</div>
        <div class="metric-value" id="metric-mem">--%</div>
        <div class="metric-sub">--</div>
        <div class="metric-bar"><div class="metric-bar-fill" style="width:0%"></div></div>
      </div>
      <div class="metric-card">
        <div class="metric-label">SYSTEM_DISK_UTIL</div>
        <div class="metric-value" id="metric-disk">--%</div>
        <div class="metric-sub">--</div>
        <div class="metric-bar"><div class="metric-bar-fill" style="width:0%"></div></div>
      </div>
      <div class="metric-card">
        <div class="metric-label">ACTIVE_SESSION_TIME</div>
        <div class="metric-value" id="metric-uptime">00:00:00</div>
        <div class="metric-sub">UPTIME</div>
      </div>
    </div>`;

  await fetchAndRenderDashboard();
  clearPoll();
  pollInterval = setInterval(() => {
    if (document.visibilityState === 'visible') {
      fetchAndRenderDashboard();
    }
  }, 60000);
}

function updateStripInfo(info) {
  document.getElementById('cpu-label').textContent = `CPU: ${info.cpuLoad}%`;
  document.getElementById('gpu-label').textContent = `GPU: ${info.gpuModel || '--'}`;
  document.getElementById('os-label').textContent = `OS: ${info.os.release}`;
  document.getElementById('integrity-status').textContent = 'SYSTEM_SECURE';
  document.getElementById('active-profile').textContent = info.os.distro || 'DEFAULT';
}

function renderTweaks(configName, title) {
  const tweaks = loadJSON(`${configName}.json`);
  if (!state.tweakStates[configName]) {
    state.tweakStates[configName] = {};
  }

  const TWEAK_CHUNK = 20;
  let tweakOffset = 0;

  let html = `<div class="section-title">${title} <span class="tweak-count">(${tweaks.length} TWEAKS)</span></div>`;
  if (!state.isAdmin) {
    html += `<div class="admin-warn">[!] MANY TWEAKS REQUIRE ADMIN — RUN APP AS ADMINISTRATOR FOR FULL EFFECT</div>`;
  }
  html += `<div id="tweak-rows"></div>`;
  html += `<div id="tweak-more" style="display:none; margin:8px 0; text-align:center;"><button class="settings-btn" id="btn-tweak-more">LOAD MORE</button></div>`;
  html += `<div style="margin-bottom:12px"><button class="settings-btn" id="btn-detect-state">DETECT CURRENT STATE</button></div>`;
  html += `<div class="script-preview"><div class="script-header">LIVE BATCH SCRIPT PREVIEW</div><div class="script-content" id="script-preview-content">-- NO ACTIVE TWEAKS --</div></div>`;
  html += `<div class="tweak-console"><div class="tweak-console-header">&gt; EXECUTION LOG <button class="console-clear" id="btn-clear-console">CLEAR</button></div><div class="tweak-console-content" id="tweak-console-content">-- Ready --</div></div>`;
  content.innerHTML = html;

  const container = document.getElementById('tweak-rows');
  const moreContainer = document.getElementById('tweak-more');
  const loadMoreBtn = document.getElementById('btn-tweak-more');

  function renderTweakRows(append = false) {
    const end = append ? Math.min(tweakOffset + TWEAK_CHUNK, tweaks.length) : Math.min(TWEAK_CHUNK, tweaks.length);
    const toRender = append ? tweaks.slice(tweakOffset, end) : tweaks.slice(0, end);
    if (!append) container.innerHTML = '';
    tweakOffset = end;

    const frag = document.createDocumentFragment();
    toRender.forEach(t => {
      const active = state.tweakStates[configName][t.id] ? 'active' : '';
      const div = document.createElement('div');
      div.className = 'tweak-row';
      div.innerHTML = `<div class="tweak-info"><div class="tweak-name">${t.name}</div><div class="tweak-desc">${t.description}</div></div><div class="tweak-toggle ${active}" data-id="${t.id}" data-config="${configName}"></div><span class="tweak-status ${active ? 'ok' : ''}" data-sid="${t.id}">${state.tweakStates[configName][t.id] ? 'ON' : 'OFF'}</span>`;
      frag.appendChild(div);
    });
    container.appendChild(frag);

    moreContainer.style.display = tweakOffset < tweaks.length ? 'block' : 'none';
  }

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => renderTweakRows(true));
  }

  renderTweakRows(false);

  const clearBtn = document.getElementById('btn-clear-console');
  if (clearBtn) clearBtn.addEventListener('click', clearConsole);

  const detectBtn = document.getElementById('btn-detect-state');
  if (detectBtn) {
    detectBtn.addEventListener('click', async () => {
      detectBtn.textContent = 'DETECTING...';
      detectBtn.disabled = true;
      await runAutoDetect(configName, tweaks);
      detectBtn.textContent = 'DETECT CURRENT STATE';
      detectBtn.disabled = false;
    });
  }

  // Event delegation for toggles — single listener for all rows, efficient on old devices
  container.addEventListener('click', async (e) => {
    const el = e.target.closest('.tweak-toggle');
    if (!el || el.classList.contains('executing')) return;
    const id = el.dataset.id, config = el.dataset.config;
    const statusEl = document.querySelector(`.tweak-status[data-sid="${id}"]`);
    const tweak = tweaks.find(t => t.id === id);
    if (!tweak) return;

    logToConsole(`[${new Date().toLocaleTimeString()}] Applying: ${tweak.name}`);

    state.tweakStates[config][id] = !state.tweakStates[config][id];
    el.classList.toggle('active');
    const scriptPath = state.tweakStates[config][id] ? tweak.script_on : tweak.script_off;
    el.classList.add('executing');
    if (statusEl) { statusEl.textContent = '...'; statusEl.className = 'tweak-status running'; }

    const turningOn = state.tweakStates[config][id];
    try {
      await ipcRenderer.invoke('execute-tweak', { scriptPath, command: tweak.command });

      // Batch succeeded — show OK immediately. Don't punish user if our check script is imperfect.
      if (statusEl) {
        statusEl.textContent = 'OK';
        statusEl.className = 'tweak-status ok';
      }
      logToConsole(`[${new Date().toLocaleTimeString()}] ${tweak.name}: ${turningOn ? 'APPLIED' : 'REVERTED'}`);

      // Background verification (non-blocking, doesn't change UI status)
      if (turningOn && tweak.check) {
        ipcRenderer.invoke('check-tweak', { command: tweak.check }).then(result => {
          if (!result.enabled) {
            const errMsg = result.error || result.stderr || `exit code ${result.exitCode}`;
            logToConsole(`[${new Date().toLocaleTimeString()}] ${tweak.name}: VERIFY WARN - ${errMsg.substring(0, 200)}`);
          }
        }).catch(chkErr => {
          logToConsole(`[${new Date().toLocaleTimeString()}] ${tweak.name}: VERIFY ERR - ${chkErr.message || chkErr}`);
        });
      }
    } catch (e) {
      console.error('Tweak failed:', e);
      state.tweakStates[config][id] = false;
      el.classList.remove('active');
      if (statusEl) {
        statusEl.textContent = (e.message || e).includes('ADMIN_REQUIRED') ? 'ADMIN' : 'FAIL';
        statusEl.className = 'tweak-status fail';
        statusEl.title = e.message || e || 'Failed';
      }
      logToConsole(`[${new Date().toLocaleTimeString()}] ${tweak.name}: ERROR - ${e.message || e}`);
    }

    el.classList.remove('executing');
    setTimeout(() => {
      if (statusEl) {
        statusEl.textContent = state.tweakStates[config][id] ? 'ON' : 'OFF';
        statusEl.className = `tweak-status ${state.tweakStates[config][id] ? 'ok' : ''}`;
      }
    }, 3000);

    persistState();
    updateScriptPreview(configName, tweaks);

    // Track in history (only if execution didn't throw)
    const finalState = state.tweakStates[config][id];
    addHistoryEntry({
      id: tweak.id,
      name: tweak.name,
      config: config,
      applied: finalState,
      script_on: tweak.script_on || null,
      script_off: tweak.script_off || null,
      command: tweak.command || null,
      check: tweak.check || null
    });
  });

  updateScriptPreview(configName, tweaks);
}

async function runAutoDetect(configName, tweaks) {
  const batchSize = 3;
  const total = tweaks.length;
  let done = 0;
  logToConsole(`[${new Date().toLocaleTimeString()}] Auto-detecting ${total} tweaks...`);
  for (let i = 0; i < total; i += batchSize) {
    const batch = tweaks.slice(i, i + batchSize);
    const checks = batch.map(async t => {
      if (!t.check) return { id: t.id, enabled: false };
      try {
        const result = await ipcRenderer.invoke('check-tweak', { command: t.check });
        return { id: t.id, enabled: result.enabled };
      } catch {
        return { id: t.id, enabled: false };
      }
    });
    const results = await Promise.all(checks);
    results.forEach(r => {
      state.tweakStates[configName][r.id] = r.enabled;
      updateToggleVisual(r.id, configName, r.enabled);
    });
    done += batch.length;
    logToConsole(`[${new Date().toLocaleTimeString()}] Detected ${done}/${total}...`);
    // Small delay between batches to reduce CPU load on VMs and old PCs
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  logToConsole(`[${new Date().toLocaleTimeString()}] Auto-detect complete: ${total} tweaks checked`);
}

function updateToggleVisual(id, configName, enabled) {
  const toggle = document.querySelector(`.tweak-toggle[data-id="${id}"]`);
  const status = document.querySelector(`.tweak-status[data-sid="${id}"]`);
  if (toggle) toggle.classList.toggle('active', enabled);
  if (status) {
    status.textContent = enabled ? 'ON' : 'OFF';
    status.className = `tweak-status ${enabled ? 'ok' : ''}`;
  }
}

function updateScriptPreview(configName, tweaks) {
  const preview = document.getElementById('script-preview-content');
  if (!preview) return;
  const lines = tweaks.filter(t => state.tweakStates[configName][t.id]).map(t => t.command).filter(Boolean);
  preview.textContent = lines.length ? lines.join('\n') : '-- NO ACTIVE TWEAKS --';
}

function renderPowerPlans() {
  const plans = loadJSON('powerplans.json');
  let html = `<div class="section-title">POWER PLANS <span class="tweak-count">(${plans.length} PLANS)</span></div>`;
  if (!state.isAdmin) {
    html += `<div class="admin-warn">[!] APPLYING POWER PLANS REQUIRES ADMIN — RUN APP AS ADMINISTRATOR</div>`;
  }
  html += `<div class="applist-status">CLICK APPLY TO IMPORT AND ACTIVATE A POWER PLAN. EACH PLAN IS OPTIMIZED FOR DIFFERENT WORKLOADS.</div>`;
  plans.forEach(p => {
    html += `<div class="tweak-row"><div class="tweak-info"><div class="tweak-name">${p.name}</div><div class="tweak-desc">${p.description}</div></div><button class="app-install-btn" data-plan="${p.id}" data-script="${p.script}">APPLY</button></div>`;
  });
  html += `<div class="tweak-console" style="margin-top:16px"><div class="tweak-console-header">&gt; EXECUTION LOG <button class="console-clear" id="btn-clear-console">CLEAR</button></div><div class="tweak-console-content" id="tweak-console-content">-- Ready --</div></div>`;
  content.innerHTML = html;

  const clearBtn = document.getElementById('btn-clear-console');
  if (clearBtn) clearBtn.addEventListener('click', clearConsole);

  content.querySelectorAll('.app-install-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.classList.contains('installing')) return;
      btn.classList.add('installing');
      btn.textContent = 'APPLYING...';
      clearConsole();
      logToConsole(`[${new Date().toLocaleTimeString()}] Applying power plan: ${btn.dataset.plan}`);
      try {
        await ipcRenderer.invoke('execute-tweak', { scriptPath: btn.dataset.script, command: null });
        btn.textContent = 'APPLIED';
        btn.classList.remove('installing');
        logToConsole(`[${new Date().toLocaleTimeString()}] Power plan applied successfully`);
        // Reset other buttons
        content.querySelectorAll('.app-install-btn').forEach(b => {
          if (b !== btn && b.textContent === 'APPLIED') {
            b.textContent = 'APPLY';
          }
        });
      } catch (e) {
        btn.textContent = 'FAILED';
        btn.classList.remove('installing');
        const msg = e.message || e || 'Unknown error';
        logToConsole(`[${new Date().toLocaleTimeString()}] ERROR: ${msg}`);
      }
    });
  });
}

async function renderApps() {
  const apps = loadJSON('apps.json');
  const categories = {};
  apps.forEach(a => {
    if (!categories[a.category]) categories[a.category] = [];
    categories[a.category].push(a);
  });

  let html = `<div class="section-title">APPLICATION INSTALLER</div>`;
  html += `<div id="install-progress-bar" style="display:none"><div class="progress-bar"><div class="progress-fill" id="progress-fill"></div></div><div class="progress-text" id="progress-text">READY</div><button class="settings-btn" id="btn-cancel-install" style="margin-top:8px;display:none">CANCEL</button></div>`;
  Object.keys(categories).sort().forEach(cat => {
    html += `<div class="app-category"><div class="app-category-title">${cat}</div>`;
    categories[cat].forEach(app => {
      html += `<div class="app-row"><div class="app-name">${app.name}</div><button class="app-install-btn" data-id="${app.id}" data-url="${app.url}" data-filename="${app.filename}" data-type="${app.type}">INSTALL</button></div>`;
    });
    html += `</div>`;
  });

  content.innerHTML = html;

  content.querySelectorAll('.app-install-btn').forEach(btn => {
    let cancelled = false;
    btn.addEventListener('click', async () => {
      if (cancelled || btn.classList.contains('installing')) return;
      btn.classList.add('installing');
      btn.textContent = 'INSTALLING...';
      const bar = document.getElementById('install-progress-bar');
      const fill = document.getElementById('progress-fill');
      const txt = document.getElementById('progress-text');
      const cancelBtn = document.getElementById('btn-cancel-install');
      bar.style.display = 'block';
      fill.style.width = '0%';
      txt.textContent = `DOWNLOADING ${btn.dataset.id.toUpperCase()}...`;
      cancelBtn.style.display = 'block';
      cancelBtn.onclick = async () => {
        cancelled = true;
        cancelBtn.style.display = 'none';
        txt.textContent = `CANCELLING ${btn.dataset.id.toUpperCase()}...`;
        await ipcRenderer.invoke('cancel-install', { id: btn.dataset.id });
      };

      const onProgress = (_, data) => {
        if (data.id === btn.dataset.id && !cancelled) {
          if (data.stage === 'DOWNLOADING') {
            fill.style.width = data.progress + '%';
            txt.textContent = `DOWNLOADING ${btn.dataset.id.toUpperCase()}... ${data.progress}%`;
          } else if (data.stage === 'INSTALLING') {
            fill.style.width = '100%';
            txt.textContent = `INSTALLING ${btn.dataset.id.toUpperCase()}...`;
          }
        }
      };
      const onDone = (_, data) => {
        ipcRenderer.removeListener('download-progress', onProgress);
        ipcRenderer.removeListener('app-install-done', onDone);
        if (data.id === btn.dataset.id) {
          cancelBtn.style.display = 'none';
          fill.style.width = '100%';
          if (data.success) {
            btn.textContent = 'INSTALLED';
            txt.textContent = `${btn.dataset.id.toUpperCase()} INSTALLED`;
          } else {
            btn.textContent = cancelled ? 'CANCELLED' : 'FAILED';
            txt.textContent = cancelled ? `${btn.dataset.id.toUpperCase()} CANCELLED` : `${btn.dataset.id.toUpperCase()} FAILED`;
            btn.classList.remove('installing');
          }
          setTimeout(() => { bar.style.display = 'none'; }, 3000);
        }
      };
      ipcRenderer.on('download-progress', onProgress);
      ipcRenderer.on('app-install-done', onDone);

      try {
        if (!cancelled) await ipcRenderer.invoke('install-app', { id: btn.dataset.id, url: btn.dataset.url, filename: btn.dataset.filename, type: btn.dataset.type });
        if (!cancelled) {
          btn.textContent = 'INSTALLED';
          btn.classList.remove('installing');
        }
      } catch (e) {
        const msg = e.message || e || 'Unknown error';
        console.error('[install-app] error:', msg);
        if (btn.textContent !== 'FAILED' && btn.textContent !== 'CANCELLED') {
          btn.textContent = 'FAILED';
          btn.classList.remove('installing');
          btn.title = String(msg).substring(0, 200);
        }
      }
    });
  });
}

async function renderAppList() {
  const list = document.createElement('div');
  list.innerHTML = `<div class="section-title">INSTALLED APPLICATIONS <span class="tweak-count">LOADING...</span></div><div class="applist-status">FETCHING INSTALLED PACKAGES FROM SYSTEM REGISTRY...</div>`;
  content.appendChild(list);
  try {
    const apps = await ipcRenderer.invoke('get-installed-apps');
    const msKeyWords = ['microsoft', 'windows', 'office', 'edge', 'onedrive', 'skype', 'teams', 'xbox', 'cortana', 'visual studio', '.net', 'directx', 'adobe'];
    const msApps = [], userApps = [];
    (apps || []).forEach(a => {
      if (a.name) {
        const lower = (a.name + ' ' + (a.publisher || '')).toLowerCase();
        if (msKeyWords.some(k => lower.includes(k))) msApps.push(a);
        else userApps.push(a);
      }
    });

    const RENDER_LIMIT = 50;
    let currentTab = 'all', filterText = '', renderOffset = 0;

    content.innerHTML = `
      <div class="section-title">INSTALLED APPLICATIONS <span class="tweak-count">${apps.length} TOTAL</span></div>
      <div class="applist-tabs">
        <button class="applist-tab active" data-tab="all">ALL (${apps.length})</button>
        <button class="applist-tab" data-tab="ms">MS BLOAT (${msApps.length})</button>
        <button class="applist-tab" data-tab="user">USER (${userApps.length})</button>
      </div>
      <div class="applist-search"><input type="text" class="applist-input" placeholder="FILTER APPS..." id="applist-filter"></div>
      <div class="applist-count"><span class="text-dim">SHOWING: </span><span id="applist-showing">0</span></div>
      <div id="applist-rows"></div>
      <div id="applist-more" style="display:none; margin-top:8px; text-align:center;">
        <button class="settings-btn" id="applist-load-more">LOAD MORE</button>
      </div>`;

    const container = document.getElementById('applist-rows');
    const moreContainer = document.getElementById('applist-more');
    const loadMoreBtn = document.getElementById('applist-load-more');
    const showingEl = document.getElementById('applist-showing');

    // Use event delegation for uninstall buttons to avoid thousands of listeners
    container.addEventListener('click', async (e) => {
      const btn = e.target.closest('.applist-del-btn');
      if (!btn) return;
      if (btn.classList.contains('installing')) return;
      btn.textContent = 'UNINSTALLING...';
      btn.classList.add('installing');
      try {
        await ipcRenderer.invoke('uninstall-app', {
          name: btn.dataset.name,
          uninstall: btn.dataset.uninstall,
          isWindowsApp: btn.dataset.iswinapp === 'true',
          packageName: btn.dataset.pkgname
        });
        btn.textContent = 'UNINSTALLED';
        btn.classList.remove('installing');
        btn.style.borderColor = '#33aa33';
        setTimeout(() => { btn.textContent = 'UNINSTALL'; btn.style.borderColor = ''; }, 3000);
      } catch (e) {
        btn.textContent = 'FAILED';
        btn.classList.remove('installing');
        btn.title = typeof e === 'string' ? e : (e.message || 'Unknown error');
      }
    });

    function getFiltered() {
      const source = currentTab === 'all' ? apps : currentTab === 'ms' ? msApps : userApps;
      const ft = filterText.toLowerCase();
      return source.filter(a => !ft || a.name.toLowerCase().includes(ft));
    }

    function renderRows(append = false) {
      const filtered = getFiltered();
      const total = filtered.length;
      const end = append ? Math.min(renderOffset + RENDER_LIMIT, total) : Math.min(RENDER_LIMIT, total);
      const toRender = append ? filtered.slice(renderOffset, end) : filtered.slice(0, end);

      if (!append) container.innerHTML = '';
      renderOffset = end;

      const frag = document.createDocumentFragment();
      if (toRender.length === 0 && !append) {
        const empty = document.createElement('div');
        empty.className = 'applist-status';
        empty.textContent = total === 0 ? 'NO APPLICATIONS FOUND IN REGISTRY.' : 'NO MATCHING APPLICATIONS.';
        frag.appendChild(empty);
      }
      toRender.forEach(a => {
        const div = document.createElement('div');
        div.className = 'applist-row';
        const isWinApp = a.isWindowsApp ? 'true' : 'false';
        const pkgName = (a.packageName || '').replace(/"/g, '&quot;');
        div.innerHTML = `
          <div class="applist-info">
            <div class="applist-name">${a.name}</div>
            <div class="applist-meta">${a.publisher || 'UNKNOWN'} ${a.version ? '| ' + a.version : ''}${a.size ? ' | ' + (a.size/1024).toFixed(1) + ' MB' : ''}${a.isWindowsApp ? ' | [WINDOWS APP]' : ''}</div>
          </div>
          <button class="applist-del-btn" data-name="${a.name.replace(/"/g, '&quot;')}" data-uninstall="${(a.uninstall || '').replace(/"/g, '&quot;')}" data-iswinapp="${isWinApp}" data-pkgname="${pkgName}">UNINSTALL</button>`;
        frag.appendChild(div);
      });
      container.appendChild(frag);

      showingEl.textContent = `${Math.min(renderOffset, total)} / ${total}`;
      moreContainer.style.display = renderOffset < total ? 'block' : 'none';
    }

    loadMoreBtn.addEventListener('click', () => renderRows(true));

    content.querySelectorAll('.applist-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        content.querySelectorAll('.applist-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentTab = tab.dataset.tab;
        renderOffset = 0;
        renderRows(false);
      });
    });

    document.getElementById('applist-filter').addEventListener('input', debounce(e => {
      filterText = e.target.value;
      renderOffset = 0;
      renderRows(false);
    }, 300));

    renderRows(false);

  } catch (e) {
    console.error('[renderAppList] error:', e);
    content.innerHTML = `<div class="section-title">INSTALLED APPLICATIONS</div><div class="applist-status">FAILED TO FETCH INSTALLED APPS: ${(e.message || e || '').toString().substring(0, 200)}</div>`;
  }
}

function renderSettings() {
  let activeCount = 0;
  Object.keys(state.tweakStates).forEach(c => {
    Object.values(state.tweakStates[c]).forEach(v => { if (v) activeCount++; });
  });

  content.innerHTML = `
    <div class="section-title">SETTINGS</div>

    <div class="settings-grid">
      <div class="settings-card">
        <div class="settings-card-title">APPLICATION</div>
        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-name">RESET ALL TWEAKS</div>
            <div class="settings-row-desc">Deactivates all toggles across every tweak category (${activeCount} currently active)</div>
          </div>
          <button class="settings-btn" id="btn-reset-tweaks">RESET</button>
        </div>
        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-name">THEME</div>
            <div class="settings-row-desc">SWITCH BETWEEN DARK AND LIGHT MODE</div>
          </div>
          <button class="settings-btn" id="btn-toggle-theme">${document.documentElement.dataset.theme === 'light' ? 'LIGHT' : 'DARK'}</button>
        </div>
        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-name">APP VERSION</div>
            <div class="settings-row-desc">Atom ToolBox v1.0.0</div>
          </div>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-title">LINKS</div>
        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-name">YOUTUBE</div>
            <div class="settings-row-desc">youtube.com/@projectatom</div>
          </div>
          <button class="settings-btn" data-url="https://www.youtube.com/@projectatom">OPEN</button>
        </div>
        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-name">DISCORD</div>
            <div class="settings-row-desc">discord.gg/9ZCgxhaYV6</div>
          </div>
          <button class="settings-btn" data-url="https://discord.gg/9ZCgxhaYV6">OPEN</button>
        </div>
        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-name">X (TWITTER)</div>
            <div class="settings-row-desc">x.com/ProjectAtomOS</div>
          </div>
          <button class="settings-btn" data-url="https://x.com/ProjectAtomOS">OPEN</button>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-title">SYSTEM</div>
        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-name">ACTIVE TWEAKS</div>
            <div class="settings-row-desc">${activeCount} tweaks currently enabled across all categories</div>
          </div>
          <div class="settings-tag">${activeCount}</div>
        </div>
        <div class="settings-row">
      </div>
    </div>`;

  content.querySelectorAll('[data-url]').forEach(btn => {
    btn.addEventListener('click', () => {
      ipcRenderer.invoke('open-external', btn.dataset.url);
    });
  });

  const resetBtn = document.getElementById('btn-reset-tweaks');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      Object.keys(state.tweakStates).forEach(c => {
        Object.keys(state.tweakStates[c]).forEach(k => { state.tweakStates[c][k] = false; });
      });
      persistState();
      resetBtn.textContent = 'DONE';
      setTimeout(() => resetBtn.textContent = 'RESET', 2000);
    });
  }
  const themeBtn = document.getElementById('btn-toggle-theme');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const html = document.documentElement;
      const isLight = html.dataset.theme === 'light';
      html.dataset.theme = isLight ? 'dark' : 'light';
      themeBtn.textContent = isLight ? 'DARK' : 'LIGHT';
      document.getElementById('brand-logo-img').src = isLight ? '../assets/logos/logo-dark.png' : '../assets/logos/logo-light.png';
      localStorage.setItem('atom-theme', html.dataset.theme);
    });
  }
}

// ---------- CONTEXT MENU EDITOR ----------

const contextMenuEntries = [
  { id: 'show_more_options', name: 'RESTORE OLD CONTEXT MENU', desc: 'Bypasses Windows 11 condensed menu and restores classic right-click.', reg: 'HKCU\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\\InprocServer32', type: 'key' },
  { id: 'give_access_to', name: 'REMOVE "GIVE ACCESS TO"', desc: 'Removes "Give access to" from context menu.', reg: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Shell Extensions\\Blocked', val: '{f81e9010-6ea4-11ce-a7ff-00aa003ca9f6}', type: 'block' },
  { id: 'share', name: 'REMOVE "SHARE"', desc: 'Removes the Share option from context menu.', reg: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Shell Extensions\\Blocked', val: '{e2bf9676-5f8f-435c-9253-8a2b481b5f52}', type: 'block' },
  { id: 'cast_to_device', name: 'REMOVE "CAST TO DEVICE"', desc: 'Removes "Cast to Device" from context menu.', reg: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Shell Extensions\\Blocked', val: '{7AD84985-87B4-4a16-BE58-8B72A5B390F7}', type: 'block' },
  { id: 'scan_defender', name: 'REMOVE "SCAN WITH DEFENDER"', desc: 'Removes "Scan with Microsoft Defender" from context menu.', reg: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Shell Extensions\\Blocked', val: '{09A47860-11B0-4DA5-AFA5-26D86198A780}', type: 'block' },
  { id: 'pin_start', name: 'REMOVE "PIN TO START"', desc: 'Removes "Pin to Start" from context menu.', reg: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Shell Extensions\\Blocked', val: '{90AA3A4E-1CBA-4233-B8BB-535773D48449}', type: 'block' },
  { id: 'pin_taskbar', name: 'REMOVE "PIN TO TASKBAR"', desc: 'Removes "Pin to taskbar" from context menu.', reg: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Shell Extensions\\Blocked', val: '{538C0999-6A52-4C66-8E61-8D5F7B2A0F6A}', type: 'block' },
  { id: 'previous_versions', name: 'REMOVE "PREVIOUS VERSIONS"', desc: 'Removes "Previous Versions" from context menu.', reg: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Shell Extensions\\Blocked', val: '{596AB062-B4D2-4215-9F74-E9109B0A8153}', type: 'block' },
  { id: 'new_bing_search', name: 'REMOVE "BING SEARCH"', desc: 'Removes Bing search from right-click on selected text.', reg: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', val: 'DisableSearchBoxSuggestions', type: 'dword' },
  { id: 'copy_path', name: 'ADD "COPY AS PATH"', desc: 'Adds "Copy as path" to the top of context menu.', reg: 'HKCU\\Software\\Classes\\Allfilesystemobjects\\shell\\windows.copyaspath', val: 'CanonicalName', type: 'key' },
  { id: 'cmd_here', name: 'ADD "OPEN CMD HERE"', desc: 'Adds "Open Command Prompt here" to folder context menu.', reg: 'HKCU\\Software\\Classes\\Directory\\shell\\cmd_here', val: 'Icon', type: 'key' },
  { id: 'powershell_here', name: 'ADD "OPEN POWERSHELL HERE"', desc: 'Adds "Open PowerShell here" admin context menu entry.', reg: 'HKCU\\Software\\Classes\\Directory\\shell\\powershell_here', val: 'Icon', type: 'key' },
  { id: 'take_ownership', name: 'ADD "TAKE OWNERSHIP"', desc: 'Adds "Take Ownership" to file/folder context menu.', reg: 'HKLM\\SOFTWARE\\Classes\\*\\shell\\TakeOwnership', val: 'Icon', type: 'key' },
  { id: 'print', name: 'REMOVE "PRINT"', desc: 'Removes "Print" from context menu.', reg: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Shell Extensions\\Blocked', val: '{b1eb6d45-4f1b-11ce-abe1-00aa00b9e6ba}', type: 'block' },
  { id: 'send_to', name: 'REMOVE "SEND TO"', desc: 'Removes "Send to" from context menu.', reg: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Shell Extensions\\Blocked', val: '{7BA4C740-9E81-11CF-99D3-00AA004AE837}', type: 'block' },
  { id: 'copy_to_folder', name: 'REMOVE "COPY TO FOLDER"', desc: 'Removes "Copy to folder" from context menu.', reg: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Shell Extensions\\Blocked', val: '{C2FBB630-2971-11d1-A18C-00C04FD75D13}', type: 'block' },
  { id: 'move_to_folder', name: 'REMOVE "MOVE TO FOLDER"', desc: 'Removes "Move to folder" from context menu.', reg: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Shell Extensions\\Blocked', val: '{C2FBB631-2971-11d1-A18C-00C04FD75D13}', type: 'block' },
  { id: 'include_in_library', name: 'REMOVE "INCLUDE IN LIBRARY"', desc: 'Removes "Include in library" from folder context menu.', reg: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Shell Extensions\\Blocked', val: '{a9701f5c-3b2e-40c1-8b4e-8e3e3b8c3e8f}', type: 'block' },
  { id: 'edit_with_paint', name: 'REMOVE "EDIT WITH PAINT"', desc: 'Removes "Edit with Paint" from image context menu.', reg: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Shell Extensions\\Blocked', val: '{c6624218-5d5d-4c31-a9a6-9e5e8b7e9b8a}', type: 'block' },
  { id: 'set_as_desktop', name: 'REMOVE "SET AS DESKTOP"', desc: 'Removes "Set as desktop background" from image context menu.', reg: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Shell Extensions\\Blocked', val: '{9b8e8b4f-3e7a-4c9f-8b4c-3e7a4c9f8b4c}', type: 'block' },
];

async function renderContextMenu() {
  let html = `<div class="section-title">CONTEXT MENU EDITOR <span class="tweak-count">(${contextMenuEntries.length} ENTRIES)</span></div>`;
  if (!state.isAdmin) {
    html += `<div class="admin-warn">[!] MANY CONTEXT MENU CHANGES REQUIRE ADMIN — RUN APP AS ADMINISTRATOR</div>`;
  }
  html += `<div class="applist-status">TOGGLE ENTRIES TO ADD OR REMOVE THEM FROM THE RIGHT-CLICK CONTEXT MENU. CHANGES TAKE EFFECT IMMEDIATELY.</div>`;

  html += `<div class="script-preview"><div class="script-header">LIVE REGISTRY PREVIEW</div><div class="script-content" id="cm-preview-content">-- NO CHANGES --</div></div>`;
  html += `<div class="tweak-console"><div class="tweak-console-header">&gt; EXECUTION LOG <button class="console-clear" id="btn-clear-console">CLEAR</button></div><div class="tweak-console-content" id="tweak-console-content">-- Ready --</div></div>`;

  content.innerHTML = html;

  const clearBtn = document.getElementById('btn-clear-console');
  if (clearBtn) clearBtn.addEventListener('click', clearConsole);

  const preview = document.getElementById('cm-preview-content');

  // Load persisted context menu states
  let cmStates = {};
  try {
    const saved = localStorage.getItem('atom-cm-states');
    if (saved) cmStates = JSON.parse(saved);
  } catch {}

  function persistCm() {
    try {
      localStorage.setItem('atom-cm-states', JSON.stringify(cmStates));
    } catch {}
  }

  function buildPreview() {
    const lines = [];
    contextMenuEntries.forEach(e => {
      const enabled = cmStates[e.id];
      if (enabled) {
        if (e.type === 'block') {
          lines.push(`reg add "${e.reg}" /v "${e.val}" /t REG_SZ /d "" /f`);
        } else if (e.type === 'key') {
          lines.push(`reg add "${e.reg}" /f`);
        } else if (e.type === 'dword') {
          lines.push(`reg add "${e.reg}" /v "${e.val}" /t REG_DWORD /d 1 /f`);
        }
      } else {
        if (e.type === 'block') {
          lines.push(`reg delete "${e.reg}" /v "${e.val}" /f`);
        } else if (e.type === 'key') {
          lines.push(`reg delete "${e.reg}" /f`);
        } else if (e.type === 'dword') {
          lines.push(`reg delete "${e.reg}" /v "${e.val}" /f`);
        }
      }
    });
    preview.textContent = lines.length ? lines.join('\n') : '-- NO CHANGES --';
  }

  // Build entries
  const container = document.createElement('div');
  container.style.marginTop = '8px';
  contextMenuEntries.forEach(e => {
    const active = cmStates[e.id] ? 'active' : '';
    const row = document.createElement('div');
    row.className = 'tweak-row';
    row.innerHTML = `<div class="tweak-info"><div class="tweak-name">${e.name}</div><div class="tweak-desc">${e.desc}</div></div><div class="tweak-toggle ${active}" data-cm="${e.id}"></div><span class="tweak-status ${active ? 'ok' : ''}" data-cms="${e.id}">${cmStates[e.id] ? 'ON' : 'OFF'}</span>`;
    container.appendChild(row);
  });
  content.insertBefore(container, content.querySelector('.script-preview'));

  // Event delegation for toggles — single listener, efficient on old devices
  container.addEventListener('click', async (e) => {
    const el = e.target.closest('.tweak-toggle');
    if (!el || el.classList.contains('executing')) return;
    const id = el.dataset.cm;
    const entry = contextMenuEntries.find(c => c.id === id);
    const statusEl = document.querySelector(`.tweak-status[data-cms="${id}"]`);
    if (!entry) return;

    cmStates[id] = !cmStates[id];
    el.classList.toggle('active');
    if (statusEl) {
      statusEl.textContent = cmStates[id] ? 'ON' : 'OFF';
      statusEl.className = `tweak-status ${cmStates[id] ? 'ok' : ''}`;
    }
    persistCm();
    buildPreview();

    logToConsole(`[${new Date().toLocaleTimeString()}] ${entry.name}: ${cmStates[id] ? 'APPLYING' : 'REVERTING'}`);

    let cmd;
    if (cmStates[id]) {
      if (entry.type === 'block') {
        cmd = `reg add "${entry.reg}" /v "${entry.val}" /t REG_SZ /d "" /f`;
      } else if (entry.type === 'key') {
        cmd = `reg add "${entry.reg}" /f`;
      } else if (entry.type === 'dword') {
        cmd = `reg add "${entry.reg}" /v "${entry.val}" /t REG_DWORD /d 1 /f`;
      }
    } else {
      if (entry.type === 'block') {
        cmd = `reg delete "${entry.reg}" /v "${entry.val}" /f`;
      } else if (entry.type === 'key') {
        cmd = `reg delete "${entry.reg}" /f`;
      } else if (entry.type === 'dword') {
        cmd = `reg delete "${entry.reg}" /v "${entry.val}" /f`;
      }
    }

    if (cmd) {
      try {
        await ipcRenderer.invoke('execute-tweak', { scriptPath: null, command: cmd });
        logToConsole(`[${new Date().toLocaleTimeString()}] ${entry.name}: ${cmStates[id] ? 'APPLIED' : 'REVERTED'}`);
        addHistoryEntry({
          id: entry.id,
          name: entry.name,
          config: 'contextmenu',
          applied: cmStates[id],
          script_on: null,
          script_off: null,
          command: cmd,
          check: null
        });
      } catch (e) {
        const msg = e.message || e || 'Unknown error';
        logToConsole(`[${new Date().toLocaleTimeString()}] ${entry.name}: ERROR - ${msg}`);
        // Revert UI state on failure
        cmStates[id] = !cmStates[id];
        el.classList.toggle('active', cmStates[id]);
        if (statusEl) {
          statusEl.textContent = cmStates[id] ? 'ON' : 'OFF';
          statusEl.className = `tweak-status ${cmStates[id] ? 'ok' : ''}`;
        }
        persistCm();
        buildPreview();
      }
    }
  });

  buildPreview();
}

// ---------- HISTORY ----------

function renderHistory() {
  const history = getHistory();
  let html = `<div class="section-title">UNDO HISTORY <span class="tweak-count">(${history.length} ENTRIES)</span></div>`;
  if (history.length === 0) {
    html += `<div class="applist-status">NO TWEAKS HAVE BEEN APPLIED YET IN THIS SESSION. TOGGLE ANY TWEAK TO SEE IT HERE.</div>`;
    content.innerHTML = html;
    return;
  }

  html += `<div class="applist-status">CLICK REVERT TO UNDO A SPECIFIC TWEAK. REVERT ALL WILL PROCESS EVERY ENTRY FROM MOST RECENT TO OLDEST.</div>`;
  html += `<div style="display:flex;gap:8px;margin-bottom:12px;">`;
  html += `<button class="settings-btn" id="btn-revert-all">REVERT ALL</button>`;
  html += `<button class="settings-btn" id="btn-clear-history">CLEAR HISTORY</button>`;
  html += `</div>`;
  html += `<div id="history-rows"></div>`;
  content.innerHTML = html;

  const container = document.getElementById('history-rows');

  function renderRows() {
    container.innerHTML = '';
    const frag = document.createDocumentFragment();
    history.forEach((h, i) => {
      const div = document.createElement('div');
      div.className = 'tweak-row';
      const time = new Date(h.timestamp).toLocaleTimeString();
      const date = new Date(h.timestamp).toLocaleDateString();
      const actionText = h.applied ? 'APPLIED' : 'REVERTED';
      const actionClass = h.applied ? 'ok' : '';
      div.innerHTML = `
        <div class="tweak-info">
          <div class="tweak-name">${h.name}</div>
          <div class="tweak-desc">${h.config.toUpperCase()} | ${date} ${time} | ${actionText}</div>
        </div>
        <button class="settings-btn history-revert-btn" data-idx="${i}">REVERT</button>
      `;
      frag.appendChild(div);
    });
    container.appendChild(frag);
  }

  renderRows();

  // Event delegation for revert buttons
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('.history-revert-btn');
    if (!btn || btn.classList.contains('executing')) return;
    const idx = parseInt(btn.dataset.idx, 10);
    const entry = history[idx];
    if (!entry) return;

    btn.classList.add('executing');
    btn.textContent = '...';

    // Determine reverse action
    const reverseScript = entry.applied ? entry.script_off : entry.script_on;
    const reverseCommand = entry.command; // For context menu, we re-run the same command since it was a toggle

    try {
      if (reverseScript) {
        await ipcRenderer.invoke('execute-tweak', { scriptPath: reverseScript, command: null });
      } else if (reverseCommand) {
        // For context menu, the command was deterministic for the toggle direction.
        // We need to run the OPPOSITE command. Since we don't store the opposite command,
        // for CM entries we'll rebuild the reverse command based on current state.
        // However, for simplicity, if it's a CM entry, we toggle it again via the same mechanism.
        // Actually, for CM, the command was already the toggle command.
        // Since CM is stored in cmStates, we can just invoke execute-tweak with the opposite.
        // But we don't have cmStates here. Let's handle CM by running a reverse command.
        // For now, if it's a CM entry (config === 'contextmenu'), we'll notify user.
        if (entry.config === 'contextmenu') {
          // Rebuild reverse command
          const cmEntry = contextMenuEntries.find(c => c.id === entry.id);
          if (cmEntry) {
            let revCmd;
            const currentlyApplied = !entry.applied; // we're reverting, so target is opposite
            if (currentlyApplied) {
              if (cmEntry.type === 'block') revCmd = `reg add "${cmEntry.reg}" /v "${cmEntry.val}" /t REG_SZ /d "" /f`;
              else if (cmEntry.type === 'key') revCmd = `reg add "${cmEntry.reg}" /f`;
              else if (cmEntry.type === 'dword') revCmd = `reg add "${cmEntry.reg}" /v "${cmEntry.val}" /t REG_DWORD /d 1 /f`;
            } else {
              if (cmEntry.type === 'block') revCmd = `reg delete "${cmEntry.reg}" /v "${cmEntry.val}" /f`;
              else if (cmEntry.type === 'key') revCmd = `reg delete "${cmEntry.reg}" /f`;
              else if (cmEntry.type === 'dword') revCmd = `reg delete "${cmEntry.reg}" /v "${cmEntry.val}" /f`;
            }
            if (revCmd) await ipcRenderer.invoke('execute-tweak', { scriptPath: null, command: revCmd });
          }
        } else {
          await ipcRenderer.invoke('execute-tweak', { scriptPath: null, command: reverseCommand });
        }
      }

      // Update tweak state to reflect revert
      if (entry.config !== 'contextmenu' && state.tweakStates[entry.config]) {
        state.tweakStates[entry.config][entry.id] = !entry.applied;
        persistState();
      }

      btn.textContent = 'REVERTED';
      btn.style.borderColor = '#33aa33';
      setTimeout(() => {
        btn.textContent = 'REVERT';
        btn.style.borderColor = '';
        btn.classList.remove('executing');
      }, 1500);
    } catch (e) {
      btn.textContent = 'FAILED';
      btn.classList.remove('executing');
      btn.title = e.message || e;
    }
  });

  document.getElementById('btn-clear-history').addEventListener('click', () => {
    clearHistory();
    renderHistory();
  });

  document.getElementById('btn-revert-all').addEventListener('click', async () => {
    const btn = document.getElementById('btn-revert-all');
    btn.textContent = 'REVERTING...';
    btn.disabled = true;
    for (let i = 0; i < history.length; i++) {
      const entry = history[i];
      const reverseScript = entry.applied ? entry.script_off : entry.script_on;
      try {
        if (reverseScript) {
          await ipcRenderer.invoke('execute-tweak', { scriptPath: reverseScript, command: null });
        }
        if (entry.config !== 'contextmenu' && state.tweakStates[entry.config]) {
          state.tweakStates[entry.config][entry.id] = !entry.applied;
        }
      } catch (e) {
        console.error('Revert all failed for', entry.name, e);
      }
    }
    persistState();
    clearHistory();
    btn.textContent = 'DONE';
    setTimeout(() => renderHistory(), 500);
  });
}

// ---------- TEMP FILE CLEANER ----------
// NOTE: No synchronous recursive directory scanning — prevents freeze/crash on old PCs.

const cleanerCategories = [
  { id: 'win_temp', name: 'WINDOWS TEMP', desc: 'Temp files from C:\\Windows\\Temp and user %TEMP%', command: 'powershell -NoProfile -Command "Remove-Item -Path \"$env:TEMP\\*\" -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item -Path \"C:\\Windows\\Temp\\*\" -Recurse -Force -ErrorAction SilentlyContinue"' },
  { id: 'prefetch', name: 'PREFETCH', desc: 'Windows application prefetch cache', command: 'powershell -NoProfile -Command "Remove-Item -Path \"C:\\Windows\\Prefetch\\*\" -Recurse -Force -ErrorAction SilentlyContinue"' },
  { id: 'recent', name: 'RECENT ITEMS', desc: 'Recent files and folders history', command: 'powershell -NoProfile -Command "Remove-Item -Path \"$env:APPDATA\\Microsoft\\Windows\\Recent\\*\" -Recurse -Force -ErrorAction SilentlyContinue"' },
  { id: 'recycle_bin', name: 'RECYCLE BIN', desc: 'Empty all Recycle Bins', command: 'powershell -NoProfile -Command "Get-ChildItem -Path \"C:\\`$Recycle.Bin\" -Force -Recurse -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue"' },
  { id: 'event_logs', name: 'EVENT LOGS', desc: 'Clear Windows event logs', command: 'wevtutil cl Application && wevtutil cl System && wevtutil cl Security && wevtutil cl Setup && wevtutil cl ForwardedEvents' },
  { id: 'dns_cache', name: 'DNS CACHE', desc: 'Flush DNS resolver cache', command: 'ipconfig /flushdns' },
  { id: 'wu_cache', name: 'WINDOWS UPDATE CACHE', desc: 'SoftwareDistribution download cache', command: 'powershell -NoProfile -Command "Stop-Service wuauserv -Force -ErrorAction SilentlyContinue; Remove-Item -Path \"C:\\Windows\\SoftwareDistribution\\Download\" -Recurse -Force -ErrorAction SilentlyContinue; Start-Service wuauserv -ErrorAction SilentlyContinue"' },
  { id: 'thumb_cache', name: 'THUMBNAIL CACHE', desc: 'Explorer thumbnail cache files', command: 'powershell -NoProfile -Command "Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue; Remove-Item -Path \"$env:LOCALAPPDATA\\Microsoft\\Windows\\Explorer\\thumbcache_*\" -Force -ErrorAction SilentlyContinue; Start-Process explorer"' },
  { id: 'crash_dumps', name: 'CRASH DUMPS', desc: 'Windows minidumps and app crash dumps', command: 'powershell -NoProfile -Command "Remove-Item -Path \"C:\\Windows\\Minidump\\*\" -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item -Path \"$env:LOCALAPPDATA\\CrashDumps\\*\" -Recurse -Force -ErrorAction SilentlyContinue"' },
];

function renderCleaner() {
  let html = `<div class="section-title">TEMP FILE CLEANER</div>`;
  html += `<div class="applist-status">CLICK CLEAN TO REMOVE TEMPORARY FILES. NO FILES ARE SCANNED AHEAD — CLEANING IS INSTANT.</div>`;
  html += `<div id="cleaner-rows"></div>`;
  html += `<div class="tweak-console"><div class="tweak-console-header">&gt; CLEANUP LOG <button class="console-clear" id="btn-clear-console">CLEAR</button></div><div class="tweak-console-content" id="tweak-console-content">-- Ready --</div></div>`;
  content.innerHTML = html;

  const clearBtn = document.getElementById('btn-clear-console');
  if (clearBtn) clearBtn.addEventListener('click', clearConsole);

  const container = document.getElementById('cleaner-rows');
  const frag = document.createDocumentFragment();
  cleanerCategories.forEach(cat => {
    const div = document.createElement('div');
    div.className = 'tweak-row';
    div.innerHTML = `
      <div class="tweak-info">
        <div class="tweak-name">${cat.name}</div>
        <div class="tweak-desc">${cat.desc}</div>
      </div>
      <button class="settings-btn cleaner-btn" data-id="${cat.id}">CLEAN</button>
    `;
    frag.appendChild(div);
  });
  container.appendChild(frag);

  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('.cleaner-btn');
    if (!btn || btn.classList.contains('executing')) return;
    const cat = cleanerCategories.find(c => c.id === btn.dataset.id);
    if (!cat) return;

    btn.classList.add('executing');
    btn.textContent = 'CLEANING...';
    logToConsole(`[${new Date().toLocaleTimeString()}] Cleaning: ${cat.name}`);

    try {
      await ipcRenderer.invoke('run-cleaner', { command: cat.command });
      btn.textContent = 'CLEANED';
      btn.style.borderColor = '#33aa33';
      logToConsole(`[${new Date().toLocaleTimeString()}] ${cat.name}: CLEANED`);
    } catch (err) {
      const msg = err.message || err || 'Unknown error';
      btn.textContent = 'FAILED';
      logToConsole(`[${new Date().toLocaleTimeString()}] ${cat.name}: ERROR - ${msg}`);
    }

    setTimeout(() => {
      btn.textContent = 'CLEAN';
      btn.style.borderColor = '';
      btn.classList.remove('executing');
    }, 2000);
  });
}

// ---------- WINDOWS SHORTCUTS ----------

const shortcutCategories = [
  {
    name: 'SYSTEM',
    items: [
      { name: 'System Properties', cmd: 'sysdm.cpl' },
      { name: 'System Information', cmd: 'msinfo32' },
      { name: 'About Windows', cmd: 'winver' },
      { name: 'Advanced Settings', cmd: 'SystemPropertiesAdvanced' },
      { name: 'Performance Options', cmd: 'SystemPropertiesPerformance' },
      { name: 'Environment Variables', cmd: 'rundll32 sysdm.cpl,EditEnvironmentVariables' },
      { name: 'Date & Time', cmd: 'timedate.cpl' },
      { name: 'Region Settings', cmd: 'intl.cpl' },
    ]
  },
  {
    name: 'UPDATE & SECURITY',
    items: [
      { name: 'Windows Update', cmd: 'ms-settings:windowsupdate' },
      { name: 'Update History', cmd: 'ms-settings:windowsupdate-history' },
      { name: 'Update Options', cmd: 'ms-settings:windowsupdate-options' },
      { name: 'Active Hours', cmd: 'ms-settings:windowsupdate-activehours' },
      { name: 'Windows Security', cmd: 'ms-settings:windowsdefender' },
      { name: 'Virus & Threat', cmd: 'windowsdefender:' },
      { name: 'Recovery', cmd: 'ms-settings:recovery' },
      { name: 'Backup', cmd: 'ms-settings:backup' },
      { name: 'Find My Device', cmd: 'ms-settings:findmydevice' },
      { name: 'Activation', cmd: 'ms-settings:activation' },
    ]
  },
  {
    name: 'HARDWARE',
    items: [
      { name: 'Device Manager', cmd: 'devmgmt.msc' },
      { name: 'Disk Management', cmd: 'diskmgmt.msc' },
      { name: 'Sound Settings', cmd: 'mmsys.cpl' },
      { name: 'Power Options', cmd: 'powercfg.cpl' },
      { name: 'Display Settings', cmd: 'ms-settings:display' },
      { name: 'Bluetooth', cmd: 'ms-settings:bluetooth' },
      { name: 'Printers', cmd: 'ms-settings:printers' },
      { name: 'Mouse Settings', cmd: 'main.cpl' },
      { name: 'Keyboard Settings', cmd: 'ms-settings:keyboard' },
      { name: 'Game Controllers', cmd: 'joy.cpl' },
    ]
  },
  {
    name: 'NETWORK',
    items: [
      { name: 'Network Connections', cmd: 'ncpa.cpl' },
      { name: 'Network Status', cmd: 'ms-settings:network-status' },
      { name: 'WiFi Settings', cmd: 'ms-settings:network-wifi' },
      { name: 'Ethernet', cmd: 'ms-settings:network-ethernet' },
      { name: 'Proxy', cmd: 'ms-settings:network-proxy' },
      { name: 'VPN', cmd: 'ms-settings:network-vpn' },
      { name: 'Airplane Mode', cmd: 'ms-settings:network-airplanemode' },
      { name: 'Mobile Hotspot', cmd: 'ms-settings:network-mobilehotspot' },
      { name: 'Windows Firewall', cmd: 'wf.msc' },
      { name: 'Advanced Firewall', cmd: 'wf.msc' },
    ]
  },
  {
    name: 'APPS',
    items: [
      { name: 'Installed Apps', cmd: 'ms-settings:appsfeatures' },
      { name: 'Default Apps', cmd: 'ms-settings:defaultapps' },
      { name: 'Optional Features', cmd: 'ms-settings:optionalfeatures' },
      { name: 'Startup Apps', cmd: 'ms-settings:startupapps' },
      { name: 'Offline Maps', cmd: 'ms-settings:maps' },
      { name: 'Apps for Websites', cmd: 'ms-settings:appsforwebsites' },
      { name: 'Video Playback', cmd: 'ms-settings:apps-videoplayback' },
    ]
  },
  {
    name: 'PERSONALIZATION',
    items: [
      { name: 'Personalization', cmd: 'ms-settings:personalization' },
      { name: 'Colors', cmd: 'ms-settings:colors' },
      { name: 'Lock Screen', cmd: 'ms-settings:lockscreen' },
      { name: 'Themes', cmd: 'ms-settings:themes' },
      { name: 'Start Menu', cmd: 'ms-settings:personalization-start' },
      { name: 'Taskbar', cmd: 'ms-settings:taskbar' },
      { name: 'Fonts', cmd: 'ms-settings:fonts' },
      { name: 'Notifications', cmd: 'ms-settings:notifications' },
    ]
  },
  {
    name: 'ACCOUNTS & PRIVACY',
    items: [
      { name: 'Your Info', cmd: 'ms-settings:yourinfo' },
      { name: 'Sign-in Options', cmd: 'ms-settings:signinoptions' },
      { name: 'Family', cmd: 'ms-settings:family' },
      { name: 'Sync Settings', cmd: 'ms-settings:sync' },
      { name: 'Privacy', cmd: 'ms-settings:privacy' },
      { name: 'Location', cmd: 'ms-settings:privacy-location' },
      { name: 'Camera', cmd: 'ms-settings:privacy-webcam' },
      { name: 'Microphone', cmd: 'ms-settings:privacy-microphone' },
      { name: 'Speech', cmd: 'ms-settings:privacy-speech' },
      { name: 'Diagnostics', cmd: 'ms-settings:privacy-feedback' },
    ]
  },
  {
    name: 'STORAGE',
    items: [
      { name: 'Storage', cmd: 'ms-settings:storagesense' },
      { name: 'Storage Sense', cmd: 'ms-settings:storagepolicies' },
      { name: 'Disk Cleanup', cmd: 'cleanmgr' },
      { name: 'Save Locations', cmd: 'ms-settings:savelocations' },
    ]
  },
  {
    name: 'TOOLS',
    items: [
      { name: 'Registry Editor', cmd: 'regedit' },
      { name: 'Task Manager', cmd: 'taskmgr' },
      { name: 'Event Viewer', cmd: 'eventvwr.msc' },
      { name: 'Services', cmd: 'services.msc' },
      { name: 'Local Security', cmd: 'secpol.msc' },
      { name: 'Group Policy', cmd: 'gpedit.msc' },
      { name: 'Resource Monitor', cmd: 'resmon' },
      { name: 'Performance Monitor', cmd: 'perfmon.msc' },
      { name: 'Component Services', cmd: 'comexp.msc' },
      { name: 'Task Scheduler', cmd: 'taskschd.msc' },
      { name: 'Command Prompt', cmd: 'cmd' },
      { name: 'PowerShell', cmd: 'powershell' },
      { name: 'Windows Terminal', cmd: 'wt' },
      { name: 'Calculator', cmd: 'calc' },
      { name: 'Notepad', cmd: 'notepad' },
      { name: 'Paint', cmd: 'mspaint' },
      { name: 'Snipping Tool', cmd: 'snippingtool' },
      { name: 'Character Map', cmd: 'charmap' },
    ]
  },
];

function renderShortcuts() {
  const total = shortcutCategories.reduce((sum, c) => sum + c.items.length, 0);
  let html = `<div class="section-title">WINDOWS SHORTCUTS <span class="tweak-count">(${total} SHORTCUTS)</span></div>`;
  html += `<div class="applist-status">CLICK ANY BUTTON TO OPEN THE CORRESPONDING WINDOWS SETTING OR TOOL INSTANTLY.</div>`;
  html += `<div id="shortcuts-grid"></div>`;
  content.innerHTML = html;

  const grid = document.getElementById('shortcuts-grid');

  shortcutCategories.forEach(cat => {
    const section = document.createElement('div');
    section.className = 'app-category';
    section.innerHTML = `<div class="app-category-title">${cat.name}</div>`;

    const btnWrap = document.createElement('div');
    btnWrap.style.display = 'grid';
    btnWrap.style.gridTemplateColumns = 'repeat(auto-fill, minmax(160px, 1fr))';
    btnWrap.style.gap = '8px';

    cat.items.forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'settings-btn shortcut-btn';
      btn.textContent = item.name;
      btn.dataset.cmd = item.cmd;
      btn.style.textAlign = 'center';
      btn.style.width = '100%';
      btnWrap.appendChild(btn);
    });

    section.appendChild(btnWrap);
    grid.appendChild(section);
  });

  // Event delegation — single listener for all shortcut buttons
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.shortcut-btn');
    if (!btn) return;
    const cmd = btn.dataset.cmd;
    if (!cmd) return;
    ipcRenderer.invoke('open-shortcut', { command: cmd });
    btn.textContent = 'OPENED';
    btn.style.borderColor = '#33aa33';
    setTimeout(() => {
      btn.textContent = shortcutCategories.flatMap(c => c.items).find(i => i.cmd === cmd)?.name || cmd;
      btn.style.borderColor = '';
    }, 1500);
  });
}

// Restore saved theme
const saved = localStorage.getItem('atom-theme');
if (saved === 'light') {
  document.documentElement.dataset.theme = 'light';
  document.getElementById('brand-logo-img').src = '../assets/logos/logo-light.png';
} else if (saved === 'dark') {
  document.documentElement.dataset.theme = 'dark';
}

document.getElementById('btn-minimize').addEventListener('click', () => ipcRenderer.invoke('window-minimize'));
document.getElementById('btn-maximize').addEventListener('click', () => ipcRenderer.invoke('window-maximize'));
document.getElementById('btn-close').addEventListener('click', () => ipcRenderer.invoke('window-close'));

navigateTo('dashboard');
