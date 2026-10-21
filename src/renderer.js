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

// ---------- THEME STATE MANAGER ----------
// One attribute on <html> drives the whole palette through CSS variables —
// switching is instant, with no layout work and no background footprint.
// Persisted to localStorage ('dark' | 'oled' | 'light'); deep-gray dark is default.

function applyTheme(name) {
  const theme = (name === 'oled' || name === 'light') ? name : 'dark';
  document.documentElement.dataset.theme = theme;
  const logo = document.getElementById('brand-logo-img');
  if (logo) logo.src = theme === 'light' ? '../assets/logos/logo-light.png' : '../assets/logos/logo-dark.png';
  try { localStorage.setItem('atom-theme', theme); } catch {}
  try { Promise.resolve(ipcRenderer.invoke('set-theme', theme)).catch(() => {}); } catch {}
}

// ---------- GLOBAL SEARCH (CTRL+K) ----------
// Zero-cost by design: the index builds once, lazily, from the same config
// files the pages already read, then every keystroke is a plain in-memory
// substring scan — no IPC, no debounce, no DOM churn beyond the result list.
// Results jump to the owning page and flash the exact row.

const SEARCH_SOURCES = [
  { cfg: 'windows', view: 'windows', tag: 'WINDOWS' },
  { cfg: 'personalize', view: 'personalize', tag: 'THEME' },
  { cfg: 'gaming', view: 'gaming', tag: 'GAMING' },
  { cfg: 'gpu', view: 'gpu', tag: 'GPU' },
  { cfg: 'power', view: 'power', tag: 'POWER' },
  { cfg: 'network', view: 'network', tag: 'NETWORK' },
  { cfg: 'privacy', view: 'privacy', tag: 'PRIVACY' },
  { cfg: 'brave', view: 'brave', tag: 'BRAVE' },
  { cfg: 'apps', view: 'apps', tag: 'APP' },
  { cfg: 'powerplans', view: 'powerplans', tag: 'PLAN' }
];

const SEARCH_MAX = 40;
let searchIndex = null;
let searchSelected = 0;
let searchResults = [];

function makeSearchEntry(src, t) {
  const name = t.name || t.id || '';
  const desc = t.description || '';
  return {
    c: src.cfg, v: src.view, g: src.tag, i: t.id,
    n: name, d: desc,
    s: (name + ' ' + (t.id || '') + ' ' + desc).toLowerCase(),
    ln: name.toLowerCase()
  };
}

function buildSearchIndex() {
  if (searchIndex) return searchIndex;
  searchIndex = [];
  for (const src of SEARCH_SOURCES) {
    const list = loadJSON(src.cfg + '.json');
    if (Array.isArray(list)) for (const t of list) if (t && t.id) searchIndex.push(makeSearchEntry(src, t));
  }
  return searchIndex;
}

// Pure scoring core: every token must match somewhere; exact prefix ranks
// above name hits, above name tokens, above description-only matches.
function searchFilter(list, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  const hits = [];
  for (const it of list) {
    let ok = true;
    for (const tk of tokens) { if (it.s.indexOf(tk) === -1) { ok = false; break; } }
    if (!ok) continue;
    const n = it.ln;
    let sc = 3;
    if (n.startsWith(q)) sc = 0;
    else if (n.indexOf(q) !== -1) sc = 1;
    else if (tokens.every(tk => n.indexOf(tk) !== -1)) sc = 2;
    hits.push([sc, it.n.length, it]);
  }
  hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return hits.slice(0, SEARCH_MAX).map(h => h[2]);
}

const gsInput = document.getElementById('gsearch-input');
const gsPanel = document.getElementById('gsearch-results');

function closeSearch(clear) {
  if (gsPanel) gsPanel.style.display = 'none';
  searchSelected = 0;
  if (clear && gsInput) gsInput.value = '';
}

function renderSearchPanel(q) {
  if (!gsInput || !gsPanel) return;
  const query = String(q || '');
  if (!query.trim()) { searchResults = []; closeSearch(false); return; }
  searchSelected = 0;
  searchResults = searchFilter(buildSearchIndex(), query);
  if (!searchResults.length) {
    const safe = query.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    gsPanel.innerHTML = `<div class="gsearch-empty">NO MATCHES FOR "${safe}"</div>`;
  } else {
    let html = '';
    for (let i = 0; i < searchResults.length; i++) {
      const r = searchResults[i];
      html += `<div class="gsearch-row${i === 0 ? ' selected' : ''}" data-idx="${i}">` +
        `<div class="gsearch-row-info"><div class="gsearch-row-name">${r.n}</div>` +
        `<div class="gsearch-row-desc">${r.d || '&nbsp;'}</div></div>` +
        `<span class="gsearch-tag">${r.g}</span></div>`;
    }
    html += `<div class="gsearch-foot">${searchResults.length} RESULT${searchResults.length === 1 ? '' : 'S'} — ENTER TO OPEN</div>`;
    gsPanel.innerHTML = html;
  }
  gsPanel.style.display = 'block';
}

function moveSearchSelection(delta) {
  if (!gsPanel || !searchResults.length) return;
  const rows = gsPanel.querySelectorAll('.gsearch-row');
  if (!rows.length) return;
  if (rows[searchSelected]) rows[searchSelected].classList.remove('selected');
  searchSelected = (searchSelected + delta + rows.length) % rows.length;
  rows[searchSelected].classList.add('selected');
  rows[searchSelected].scrollIntoView({ block: 'nearest' });
}

function flashSearchTarget(r) {
  let row = null;
  if (r.g === 'APP') {
    const btn = content.querySelector(`.app-install-btn[data-id="${r.i}"]`);
    row = btn && btn.closest('.app-row');
  } else if (r.g === 'PLAN') {
    const btn = content.querySelector(`.app-install-btn[data-plan="${r.i}"]`);
    row = btn && btn.closest('.tweak-row');
  } else {
    let toggle = null, guard = 60;
    while (!toggle && guard-- > 0) {
      toggle = content.querySelector(`.tweak-toggle[data-id="${r.i}"][data-config="${r.c}"]`);
      if (toggle) break;
      const more = document.getElementById('btn-tweak-more');
      if (!more || more.parentElement.style.display === 'none') break;
      more.click(); // rows append synchronously — instant reveal, no waiting
    }
    row = toggle && toggle.closest('.tweak-row');
  }
  if (!row) return;
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  row.classList.add('search-hit');
  setTimeout(() => row.classList.remove('search-hit'), 1900);
}

function runSearchSelection() {
  const r = searchResults[searchSelected];
  if (!r) return;
  closeSearch(true);
  if (gsInput) gsInput.blur();
  const activeNav = document.querySelector('.nav-item.active');
  if (!activeNav || activeNav.dataset.view !== r.v) {
    const nav = document.querySelector(`.nav-item[data-view="${r.v}"]`);
    if (nav) nav.click();
  }
  flashSearchTarget(r);
}

function openSearch() {
  if (!gsInput) return;
  buildSearchIndex();
  gsInput.focus();
  gsInput.select();
  renderSearchPanel(gsInput.value);
}

if (gsInput && gsPanel) {
  gsInput.addEventListener('input', () => renderSearchPanel(gsInput.value));
  gsInput.addEventListener('focus', () => { if (gsInput.value.trim()) renderSearchPanel(gsInput.value); });
  gsInput.addEventListener('blur', () => {
    setTimeout(() => { if (document.activeElement !== gsInput) closeSearch(false); }, 160);
  });
  gsInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSearchSelection(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSearchSelection(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); runSearchSelection(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeSearch(true); gsInput.blur(); }
  });
  // mousedown + preventDefault keeps focus so the row activation lands
  gsPanel.addEventListener('mousedown', (e) => {
    const rowEl = e.target.closest('.gsearch-row');
    if (!rowEl) return;
    e.preventDefault();
    searchSelected = parseInt(rowEl.dataset.idx, 10) || 0;
    runSearchSelection();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openSearch(); }
  });
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('#global-search')) closeSearch(false);
  });
  // One-shot warm-up after startup so the first CTRL+K is already instant
  setTimeout(() => { try { buildSearchIndex(); } catch {} }, 1500);
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
    // Locked ADVANCED entries: no navigation, show the Atom Optimizer popup.
    if (el.dataset.locked) { openProModal(el.dataset.locked); return; }
    // "GET ATOM OPTIMIZER" CTA: open the official page in the browser.
    if (el.dataset.cta === 'optimizer') { openOptimizerSite(); return; }
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    el.classList.add('active');
    clearPoll();
    navigateTo(el.dataset.view);
  });
});

// ---------- SMOOTH WHEEL SCROLLING ----------
// Low-end friendly: one rAF loop that only runs while a wheel glide is active.
// Wheel-scrolls #content-area with a short ease-out curve instead of hard jumps
// (a curve, not motion blur — blur repaints the whole page every frame, which is
// the opposite of smooth and fast on low-end machines).
// The curve is time-based, so speed and feel stay identical at 60 Hz, 120 Hz,
// or right after a dropped frame.
// Keyboard, scrollbar drag, and inner scrollables (console, previews) stay native.
// Can be turned off in SETTINGS ("SMOOTH SCROLLING", default ON).
function isSmoothScrollOn() {
  try { return localStorage.getItem('atom-smooth-scroll') !== 'off'; } catch { return true; }
}

(function initSmoothWheel() {
  const area = document.getElementById('content-area');
  if (!area) return;

  const TAU = 50;         // ms — ease-out curve time constant (~0.28/frame at 60 Hz)
  const MAX_DT = 40;      // ms — cap one stall's catch-up so a long hiccup never jumps
  const MIN_STEP = 1.5;   // px — tail step floor: some systems quantize scroll to whole pixels,
                          //      so sub-pixel steps would otherwise never arrive (and loop forever)
  let target = null;      // destination scrollTop while gliding
  let raf = null;
  let lastApplied = null; // scrollTop value our loop wrote last (detects external moves)
  let lastT = 0;          // timestamp of the last glide frame
  let prevCur = null;     // previous frame's position (endless-loop safety)
  let stuck = 0;          // consecutive no-progress frames

  function couldScroll(el) {
    return el.scrollHeight - el.clientHeight > 2 && el.clientHeight > 0;
  }

  function innerScrollable(node) {
    while (node && node !== area) {
      if (node.nodeType === 1 && couldScroll(node)) {
        const ov = getComputedStyle(node).overflowY;
        if (ov === 'auto' || ov === 'scroll') return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  function step(now) {
    const dt = Math.max(4, Math.min(MAX_DT, now - lastT));
    lastT = now;
    const cur = area.scrollTop;
    // The scroll position moved from under us (scrollbar drag, keyboard, native
    // wheel when smoothing is off, script) - cancel the glide instead of fighting.
    if (lastApplied !== null && Math.abs(cur - lastApplied) > 2.5) {
      raf = null; target = null; lastApplied = null; prevCur = null; stuck = 0;
      return;
    }
    const diff = target - cur;
    if (Math.abs(diff) <= 2) { area.scrollTop = target; raf = null; target = null; lastApplied = null; prevCur = null; stuck = 0; return; }
    // Endless-loop safety: if a frame makes no progress at all (position quantized
    // back, target out of reach), give up after 3 tries - the next wheel restarts.
    if (prevCur !== null && Math.abs(cur - prevCur) < 0.5) stuck++; else stuck = 0;
    prevCur = cur;
    if (stuck >= 3) { raf = null; target = null; lastApplied = null; prevCur = null; stuck = 0; return; }
    const k = 1 - Math.exp(-dt / TAU);   // the curve: fraction of the remaining distance this frame
    let next = cur + diff * k;
    if (Math.abs(next - cur) < MIN_STEP) next = cur + (diff > 0 ? MIN_STEP : -MIN_STEP);
    area.scrollTop = next;
    lastApplied = area.scrollTop;
    raf = requestAnimationFrame(step);
  }

  area.addEventListener('wheel', (e) => {
    if (!isSmoothScrollOn()) return;              // SETTINGS: SMOOTH SCROLLING = OFF
    if (e.ctrlKey) return;                        // pinch-zoom
    if (innerScrollable(e.target)) return;        // let console / preview scroll natively
    if (!couldScroll(area)) return;
    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 40;           // lines -> px
    else if (e.deltaMode === 2) delta *= area.clientHeight; // pages -> px
    if (!delta) return;
    e.preventDefault();
    const max = area.scrollHeight - area.clientHeight;
    if (target === null || Math.abs(target - area.scrollTop) > 800) target = area.scrollTop;
    lastApplied = area.scrollTop;
    target = Math.max(0, Math.min(max, target + delta));
    if (!raf) { lastT = performance.now(); prevCur = null; stuck = 0; raf = requestAnimationFrame(step); }
  }, { passive: false });

  // Hand control back to the browser when the user switches to the keyboard.
  window.addEventListener('keydown', (e) => {
    if (target !== null && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].indexOf(e.key) !== -1) target = null;
  });
})();

// ---------- ATOM OPTIMIZER (paid companion app) ----------
// The four ADVANCED tools are intentionally NOT available in the free
// AtomToolBox build. Their nav entries are locked (PRO) and clicking one shows
// a popup saying the tool ships with Atom Optimizer; their IPC handlers are
// refused in main.js as a second layer.
const OPTIMIZER_URL = 'https://www.atom-os.com/optimizer';

const OPTIMIZER_FEATURES = [
  { id: 'advpower', name: 'ADVANCED POWER', desc: 'Every power setting of any plan — hidden ones included — with AC/DC control, filtering and read-back verification.' },
  { id: 'winupdate', name: 'WINDOWS UPDATE CONTROL', desc: 'Defer, pause and block updates, exclude drivers and control the update services on your schedule.' },
  { id: 'dns', name: 'DNS OPTIMIZER', desc: 'Switch any network adapter to fast, private resolvers (Cloudflare, Google, Quad9, OpenDNS, AdGuard) or custom servers.' },
  { id: 'drivers', name: 'DRIVER HUB', desc: 'A clean, read-only inventory of every installed driver — name, provider, class, version and date.' }
];

function openOptimizerSite() {
  ipcRenderer.invoke('open-external', OPTIMIZER_URL)
    .then(() => showToast('Opening Atom Optimizer', OPTIMIZER_URL))
    .catch((e) => showToast('Could not open the browser', (e && e.message) || String(e)));
}

let proModalEl = null;

function ensureProModal() {
  if (proModalEl) return proModalEl;
  const wrap = document.createElement('div');
  wrap.className = 'pro-modal-backdrop';
  wrap.id = 'pro-modal';
  wrap.style.display = 'none';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.innerHTML = `<div class="pro-modal">` +
    `<div class="pro-modal-kicker-row"><span class="pro-modal-kicker">ATOM OPTIMIZER</span><span class="nav-pro">PRO</span></div>` +
    `<div class="pro-modal-title" id="pro-modal-title">THIS TOOL IS LOCKED</div>` +
    `<div class="pro-modal-body" id="pro-modal-body">This tool only comes with Atom Optimizer.</div>` +
    `<div class="pro-modal-actions">` +
    `<button class="pro-buy" id="pro-modal-buy">GET ATOM OPTIMIZER &rarr;</button>` +
    `<button class="app-install-btn" id="pro-modal-close">CLOSE</button>` +
    `</div></div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeProModal(); });
  wrap.querySelector('#pro-modal-close').addEventListener('click', closeProModal);
  wrap.querySelector('#pro-modal-buy').addEventListener('click', () => { closeProModal(); openOptimizerSite(); });
  proModalEl = wrap;
  return wrap;
}

function openProModal(featureId) {
  const f = OPTIMIZER_FEATURES.find(x => x.id === featureId);
  const el = ensureProModal();
  const title = el.querySelector('#pro-modal-title');
  const body = el.querySelector('#pro-modal-body');
  if (title) title.textContent = f ? f.name : 'THIS TOOL';
  if (body) body.textContent = 'This tool only comes with Atom Optimizer.';
  el.style.display = 'flex';
  setTimeout(() => { const b = el.querySelector('#pro-modal-buy'); if (b) b.focus(); }, 30);
}

function closeProModal() {
  if (proModalEl) proModalEl.style.display = 'none';
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && proModalEl && proModalEl.style.display !== 'none') closeProModal();
});

function navigateTo(view) {
  // Clean up any orphaned IPC listeners from previous pages (prevents memory leaks on old PCs)
  ipcRenderer.removeAllListeners('download-progress');
  ipcRenderer.removeAllListeners('app-install-done');
  ipcRenderer.removeAllListeners('audit-progress');
  content.innerHTML = '';
  switch (view) {
    case 'dashboard': renderDashboard(); break;
    case 'windows': renderTweaks('windows', 'WINDOWS & VISUAL OPTIMIZATIONS'); break;
    case 'personalize': renderTweaks('personalize', 'PERSONALIZE & APPEARANCE'); break;
    case 'power': renderTweaks('power', 'POWER & USB MANAGEMENT'); break;
    case 'gaming': renderTweaks('gaming', 'GAMING OPTIMIZATIONS'); break;
    case 'network': renderTweaks('network', 'NETWORK & LATENCY'); break;
    case 'gpu': renderTweaks('gpu', 'GPU CONFIGURATIONS'); break;
    case 'privacy': renderTweaks('privacy', 'PRIVACY SETTINGS'); break;
    case 'brave': renderTweaks('brave', 'BRAVE BROWSER DEBLOAT'); break;
    case 'debloat': renderDebloat(); break;
    case 'contextmenu': renderContextMenu(); break;
    case 'shortcuts': renderShortcuts(); break;
    case 'cleaner': renderCleaner(); break;
    case 'monitor': renderBackgroundMonitor(); break;
    case 'history': renderHistory(); break;
    case 'powerplans': renderPowerPlans(); break;
    case 'startup': renderStartup(); break;
    case 'optimizer':
    case 'advpower':      // legacy ids — these tools ship with Atom Optimizer
    case 'winupdate':
    case 'dns':
    case 'drivers':
      renderDashboard(); break;
    case 'backup': renderBackupRestore(); break;
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
  html += `<div style="margin-bottom:12px"><button class="settings-btn" id="btn-detect-state">CHECK STATE</button></div>`;
  html += `<div id="tweak-rows"></div>`;
  html += `<div id="tweak-more" style="display:none; margin:8px 0; text-align:center;"><button class="settings-btn" id="btn-tweak-more">LOAD MORE</button></div>`;
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
      detectBtn.textContent = 'SCANNING REGISTRY...';
      detectBtn.disabled = true;
      const stats = await runAutoDetect(configName, tweaks);
      detectBtn.textContent = 'CHECK STATE';
      detectBtn.disabled = false;
      if (stats) showToast('REGISTRY STATE SYNCHRONIZED', `${stats.active} OF ${stats.total} TWEAKS VERIFIED ACTIVE`);
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
    const turningOn = state.tweakStates[config][id];
    const scriptPath = turningOn ? tweak.script_on : tweak.script_off;
    const directionCommand = turningOn ? (tweak.command_on || tweak.command) : (tweak.command_off || tweak.command);
    el.classList.add('executing');
    if (statusEl) { statusEl.textContent = '...'; statusEl.className = 'tweak-status running'; }

    try {
      await ipcRenderer.invoke('execute-tweak', { scriptPath, command: directionCommand });

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
      command_on: tweak.command_on || null,
      command_off: tweak.command_off || null,
      check: tweak.check || null
    });
  });

  updateScriptPreview(configName, tweaks);
}

async function runAutoDetect(configName, tweaks) {
  // Checks run in chunks inside ONE PowerShell process per chunk (the main
  // process batches them). 15 per chunk keeps the spawn count tiny even on
  // 90+ tweak pages while still streaming progress to the log.
  const BATCH = 15;
  const total = tweaks.length;
  let done = 0;
  let activeCount = 0;
  logToConsole(`[${new Date().toLocaleTimeString()}] Checking system state for ${total} tweaks...`);
  for (let i = 0; i < total; i += BATCH) {
    const chunk = tweaks.slice(i, i + BATCH);
    const items = chunk.filter(t => t.check).map(t => ({ id: t.id, check: t.check }));
    const map = {};
    if (items.length) {
      try {
        const res = await ipcRenderer.invoke('check-tweaks-batch', { items });
        if (res && res.results) Object.assign(map, res.results);
      } catch (e) {
        logToConsole(`[${new Date().toLocaleTimeString()}] NOTE: batch check failed (${e.message || e}) — falling back to individual checks`);
        for (const t of items) {
          try {
            const r = await ipcRenderer.invoke('check-tweak', { command: t.check });
            map[t.id] = !!(r && r.enabled);
          } catch {
            map[t.id] = false;
          }
        }
      }
    }
    chunk.forEach(t => {
      const enabled = !!map[t.id];
      if (enabled) activeCount++;
      state.tweakStates[configName][t.id] = enabled;
      updateToggleVisual(t.id, configName, enabled);
    });
    done += chunk.length;
    logToConsole(`[${new Date().toLocaleTimeString()}] Detected ${done}/${total}...`);
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  logToConsole(`[${new Date().toLocaleTimeString()}] State check complete: ${total} tweaks checked, ${activeCount} active`);
  persistState();
  updateScriptPreview(configName, tweaks);
  return { active: activeCount, total };
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

// Lightweight toast: one reused node, no polling, auto-dismisses.
function showToast(msg, sub) {
  let el = document.getElementById('atom-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'atom-toast';
    document.body.appendChild(el);
  }
  el.innerHTML = `<div class="atom-toast-msg">${msg}</div>` + (sub ? `<div class="atom-toast-sub">${sub}</div>` : '');
  el.classList.add('show');
  clearTimeout(el._atomTimer);
  el._atomTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

function updateScriptPreview(configName, tweaks) {
  const preview = document.getElementById('script-preview-content');
  if (!preview) return;
  const lines = tweaks.filter(t => state.tweakStates[configName][t.id]).map(t => t.command).filter(Boolean);
  preview.textContent = lines.length ? lines.join('\n') : '-- NO ACTIVE TWEAKS --';
}

function renderPowerPlans() {
  const plans = loadJSON('powerplans.json');
  let html = `<div class="section-title">POWER PLANS <span class="tweak-count">(YOUR PLANS + ${plans.length} READY-MADE)</span></div>`;
  if (!state.isAdmin) {
    html += `<div class="admin-warn">[!] APPLYING POWER PLANS REQUIRES ADMIN — RUN APP AS ADMINISTRATOR</div>`;
  }
  html += `<div class="applist-status">CREATE, IMPORT, ACTIVATE, TWEAK AND EXPORT YOUR WINDOWS POWER PLANS — ALL IN ONE PLACE, WITHOUT THE 140-SETTING WALL.</div>`;
  html += `<div class="guide-strip">` +
    `<div class="guide-step"><b>1 · CREATE OR PICK</b>Build a new plan from any existing one, import a .pow, or select a plan from the list.</div>` +
    `<div class="guide-step"><b>2 · TWEAK IT</b>16 everyday settings in plain words — screen, sleep, CPU, USB, battery. Each change is verified with a read-back.</div>` +
    `<div class="guide-step"><b>3 · ACTIVATE OR EXPORT</b>ACTIVATE makes it your current plan; EXPORT .POW saves a backup you can import on any PC.</div>` +
    `</div>`;

  // ---- YOUR POWER PLANS (studio: create / import / activate / tweak / export)
  html += `<div class="settings-grid" style="margin-top:12px"><div class="settings-card" style="grid-column:1/-1"><div class="settings-card-title">YOUR POWER PLANS <span class="tweak-count" id="pps-plan-count"></span></div>`;
  html += `<div class="pps-toolbar"><button class="app-install-btn" id="btn-create-plan">+ CREATE PLAN</button><button class="app-install-btn" id="btn-import-plan">IMPORT .POW</button><button class="app-install-btn" id="btn-refresh-plans">REFRESH</button></div>`;
  html += `<div class="pps-create-form" id="pps-create-form" style="display:none">` +
    `<span class="pps-create-label">NEW PLAN NAME</span><input class="applist-input" id="pps-create-name" style="width:200px" maxlength="120" placeholder="MY POWER PLAN">` +
    `<span class="pps-create-label">BASED ON</span><select class="applist-input" id="pps-create-base" style="width:220px"></select>` +
    `<button class="app-install-btn" id="pps-create-ok">CREATE PLAN</button><button class="app-install-btn" id="pps-create-cancel">CANCEL</button>` +
    `</div>`;
  html += `<div id="pps-plan-list"><div class="applist-status">LOADING INSTALLED PLANS...</div></div>`;
  html += `<div id="pps-detail" style="display:none">`;
  html += `<div class="pps-detail-head"><div style="min-width:0"><div class="pps-detail-name" id="pps-sel-name">--</div><div class="pps-detail-sub"><span id="pps-sel-guid">--</span><span class="tweak-status" id="pps-protected" style="display:none;margin-left:8px">BUILT-IN</span></div></div>` +
    `<div class="pps-actions"><button class="app-install-btn" id="pps-activate">ACTIVATE</button><button class="app-install-btn" id="pps-export">EXPORT .POW</button><button class="app-install-btn" id="pps-duplicate">DUPLICATE</button><button class="app-install-btn" id="pps-delete">DELETE</button></div></div>`;
  html += `<div class="tweak-row"><div class="tweak-info"><div class="tweak-name">PLAN NAME &amp; DESCRIPTION</div><div class="tweak-desc">Rename this plan and give it a description. Both values travel inside the exported .pow file.</div></div><div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;margin-left:auto;align-items:center"><input class="applist-input" id="pps-name-input" style="width:200px" maxlength="120" placeholder="PLAN NAME"><input class="applist-input" id="pps-desc-input" style="width:300px" maxlength="400" placeholder="DESCRIPTION (OPTIONAL)"><button class="app-install-btn" id="pps-save">SAVE</button></div></div>`;
  html += `<div class="pps-settings-head"><span class="pps-settings-title">EVERYDAY SETTINGS</span><span class="applist-count" id="pps-settings-count">SELECT A PLAN TO LOAD ITS SETTINGS</span></div>`;
  html += `<div id="pps-featured"></div>`;
  html += `<div class="pps-hint">NEED EVERY HIDDEN SETTING OF THIS PLAN? THE FULL EDITOR IS NOW PART OF <b>ATOM OPTIMIZER</b> — SEE <b>ADVANCED</b> IN THE SIDEBAR.</div>`;
  html += `</div>`;
  html += `</div></div>`;

  // ---- READY-MADE PLAN LIBRARY (one-click import + activate)
  html += `<div class="settings-grid" style="margin-top:16px"><div class="settings-card" style="grid-column:1/-1"><div class="settings-card-title">READY-MADE PLAN LIBRARY <span class="tweak-count">(${plans.length} ONE-CLICK IMPORTS)</span></div>`;
  html += `<div class="pps-lib">`;
  plans.forEach(p => {
    html += `<div class="tweak-row"><div class="tweak-info"><div class="tweak-name">${p.name}</div><div class="tweak-desc">${p.description}</div></div><button class="app-install-btn" data-plan="${p.id}" data-script="${p.script}">APPLY</button></div>`;
  });
  html += `</div>`;
  html += `</div></div>`;
  html += `<div class="settings-grid" style="margin-top:16px"><div class="settings-card" style="grid-column:1/-1"><div class="settings-card-title">TIMER RESOLUTION <span class="tweak-count">(LOW-LATENCY MODE)</span></div>`;
  html += `<div class="applist-status">Windows wakes timers on a fixed system tick — 15.625 ms by default. Games, audio tools and browsers ask Windows for a faster 0.5-1 ms tick while they run; a faster tick means more precise sleeps and snappier frame pacing. Turn this on to hold a fast tick for the WHOLE system in one click. It costs a little extra power, so switch it back off when you are done.</div>`;
  html += `<div class="tweak-row"><div class="tweak-info"><div class="tweak-name">LIVE SYSTEM TIMER</div><div class="tweak-desc" id="tr-desc">READING TIMER STATE...</div></div><div style="display:flex;gap:10px;align-items:center;margin-left:auto"><span class="tr-value" id="tr-current">--</span><span class="tweak-status" id="tr-hold-state">CHECKING</span></div></div>`;
  html += `<div class="tweak-row"><div class="tweak-info"><div class="tweak-name">HOLD A FAST TIMER</div><div class="tweak-desc">SET starts a tiny hidden helper process that keeps the request active while AtomToolBox runs. Windows drops it automatically when the helper stops — close the app, press RESTORE DEFAULT, or reboot.</div></div><div style="display:flex;gap:6px;align-items:center;margin-left:auto;flex-wrap:wrap"><button class="app-install-btn" id="tr-set-05">SET 0.5 ms</button><button class="app-install-btn" id="tr-set-1">SET 1 ms</button><button class="app-install-btn" id="tr-restore">RESTORE DEFAULT</button><button class="app-install-btn" id="tr-refresh">REFRESH</button></div></div>`;
  html += `<div class="tr-guide"><div class="tr-guide-title">QUICK GUIDE</div>` +
    `<div class="tr-guide-line"><span class="tr-guide-k">WHAT IT IS</span>Windows fires expiring timers on a fixed tick (15.625 ms by default). A 0.5 ms tick makes waiting, input polling and frame pacing far more precise.</div>` +
    `<div class="tr-guide-line"><span class="tr-guide-k">WHEN TO TURN ON</span>Competitive gaming, high-refresh monitors, rhythm games, audio production, input-latency testing.</div>` +
    `<div class="tr-guide-line"><span class="tr-guide-k">WHEN TO LEAVE OFF</span>Laptop and battery use, office work — the default tick uses less power and runs cooler.</div>` +
    `<div class="tr-guide-line"><span class="tr-guide-k">0.5 ms vs 1 ms</span>0.5 ms is the fastest Windows supports (least latency, most power). 1 ms is a middle ground many browsers already ask for while open.</div>` +
    `<div class="tr-guide-line"><span class="tr-guide-k">GOOD TO KNOW</span>The value shown above is the LIVE system timer. Other apps can hold fast requests of their own, so SET matters most when the current value still reads 15.625 ms.</div>` +
    `</div>`;
  html += `</div></div>`;
  html += `<div class="tweak-console" style="margin-top:16px"><div class="tweak-console-header">&gt; EXECUTION LOG <button class="console-clear" id="btn-clear-console">CLEAR</button></div><div class="tweak-console-content" id="tweak-console-content">-- Ready --</div></div>`;
  content.innerHTML = html;

  const clearBtn = document.getElementById('btn-clear-console');
  if (clearBtn) clearBtn.addEventListener('click', clearConsole);

  content.querySelectorAll('.app-install-btn[data-script]').forEach(btn => {
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
        content.querySelectorAll('.app-install-btn[data-script]').forEach(b => {
          if (b !== btn && b.textContent === 'APPLIED') {
            b.textContent = 'APPLY';
          }
        });
        await ppsLoadPlans(true);
      } catch (e) {
        btn.textContent = 'FAILED';
        btn.classList.remove('installing');
        const msg = e.message || e || 'Unknown error';
        logToConsole(`[${new Date().toLocaleTimeString()}] ERROR: ${msg}`);
      }
    });
  });

  const importBtn = document.getElementById('btn-import-plan');
  if (importBtn) {
    importBtn.addEventListener('click', async () => {
      if (importBtn.classList.contains('installing')) return;
      importBtn.classList.add('installing');
      importBtn.textContent = 'IMPORTING...';
      try {
        const res = await ipcRenderer.invoke('power-plan-import');
        if (!res || res.canceled) {
          logToConsole(`[${new Date().toLocaleTimeString()}] Import canceled`);
        } else {
          logToConsole(`[${new Date().toLocaleTimeString()}] Imported ${res.file}${res.guid ? ' (' + res.guid + ') — selected in the studio below' : ''}`);
          if (res.guid) ppsSelected = res.guid;
          await ppsLoadPlans();
        }
      } catch (e) {
        logToConsole(`[${new Date().toLocaleTimeString()}] ERROR: ${e.message || e}`);
      }
      importBtn.textContent = 'IMPORT .POW';
      importBtn.classList.remove('installing');
    });
  }

  const refreshBtn = document.getElementById('btn-refresh-plans');
  if (refreshBtn) refreshBtn.addEventListener('click', () => ppsLoadPlans(true));

  ppsBindStudio();
  ppsLoadPlans();
  trBind();
}

// ---------- TIMER RESOLUTION (renderer side) ----------
// Holds a fast system timer (0.5 / 1 ms) with a tiny hidden helper process
// started by the main process. The helper runs while the app runs; Windows
// releases the request automatically when it stops (app closed, RESTORE or
// reboot) — nothing can be left raised permanently by accident.

let trBusy = false;

function trFmtMs(v) {
  if (typeof v !== 'number' || !isFinite(v)) return '--';
  return String(Math.round(v * 1000) / 1000);
}

function trRenderStatus(s) {
  const cur = document.getElementById('tr-current');
  const state = document.getElementById('tr-hold-state');
  const desc = document.getElementById('tr-desc');
  if (!cur || !state || !desc) return;
  if (!s || !s.ok) {
    cur.textContent = '--';
    state.textContent = 'UNAVAILABLE';
    state.className = 'tweak-status fail';
    desc.textContent = 'Could not read the system timer state' + (s && s.error ? ' (' + s.error + ')' : '') + '.';
    return;
  }
  cur.textContent = trFmtMs(s.currentMs) + ' ms';
  if (s.holder) {
    state.textContent = 'HELD · PID ' + s.holderPid;
    state.className = 'tweak-status ok';
  } else {
    state.textContent = 'DEFAULT (NO HELPER)';
    state.className = 'tweak-status';
  }
  const range = 'SUPPORTED RANGE ' + trFmtMs(s.fastestMs) + ' - ' + trFmtMs(s.slowestMs) + ' ms';
  desc.textContent = s.holder
    ? 'AtomToolBox helper holds ' + trFmtMs(s.holderMs) + ' ms right now (PID ' + s.holderPid + '). ' + range + '.'
    : 'No AtomToolBox helper running. ' + range + '. Other apps (games, browsers, overlays) can still be holding a faster tick of their own — the value on the left is always the live one.';
}

async function trRefresh(quiet) {
  let s = null;
  try { s = await ipcRenderer.invoke('timer-res-status'); } catch (e) { s = { ok: false, error: e.message || String(e) }; }
  trRenderStatus(s);
  if (!quiet) {
    const line = s && s.ok
      ? 'Live system timer: ' + trFmtMs(s.currentMs) + ' ms' + (s.holder ? ' — helper PID ' + s.holderPid + ' holding ' + trFmtMs(s.holderMs) + ' ms' : ' — no AtomToolBox helper')
      : 'Timer status ERROR: ' + ((s && s.error) || 'unknown');
    logToConsole('[' + new Date().toLocaleTimeString() + '] ' + line);
  }
  return s;
}

function trSetBusy(busy) {
  trBusy = busy;
  ['tr-set-05', 'tr-set-1', 'tr-restore', 'tr-refresh'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.disabled = busy;
  });
}

async function trApply(ms, btn) {
  if (trBusy) return;
  trSetBusy(true);
  const orig = btn ? btn.textContent : '';
  if (btn) btn.textContent = 'WORKING...';
  logToConsole('[' + new Date().toLocaleTimeString() + '] Holding the system timer at ' + ms + ' ms...');
  try {
    const r = await ipcRenderer.invoke('timer-res-apply', { ms });
    if (r && r.ok) {
      logToConsole('[' + new Date().toLocaleTimeString() + '] Timer request active: helper PID ' + r.holderPid + ' holding ' + trFmtMs(r.holderMs) + ' ms | live system timer ' + trFmtMs(r.currentMs) + ' ms.');
      showToast('Fast timer ON (' + trFmtMs(r.holderMs) + ' ms)', 'Runs while AtomToolBox is open. RESTORE DEFAULT turns it off.');
    } else {
      logToConsole('[' + new Date().toLocaleTimeString() + '] ERROR: ' + ((r && r.error) || 'could not start the timer helper'));
      showToast('Fast timer failed', (r && r.error) || 'Could not start the helper process.');
    }
  } catch (e) {
    logToConsole('[' + new Date().toLocaleTimeString() + '] ERROR: ' + (e.message || e));
  }
  await trRefresh(true);
  if (btn) btn.textContent = orig;
  trSetBusy(false);
}

async function trRestore() {
  if (trBusy) return;
  trSetBusy(true);
  const btn = document.getElementById('tr-restore');
  const orig = btn ? btn.textContent : '';
  if (btn) btn.textContent = 'RESTORING...';
  logToConsole('[' + new Date().toLocaleTimeString() + '] Stopping the timer helper...');
  try {
    const r = await ipcRenderer.invoke('timer-res-release');
    if (r && r.released) {
      logToConsole('[' + new Date().toLocaleTimeString() + '] Helper stopped. Live system timer: ' + trFmtMs(r.currentMs) + ' ms (other apps may still hold their own requests).');
      showToast('Default timer restored', 'The AtomToolBox helper was stopped.');
    } else {
      logToConsole('[' + new Date().toLocaleTimeString() + '] No AtomToolBox timer helper was running.');
    }
  } catch (e) {
    logToConsole('[' + new Date().toLocaleTimeString() + '] ERROR: ' + (e.message || e));
  }
  await trRefresh(true);
  if (btn) btn.textContent = orig;
  trSetBusy(false);
}

function trBind() {
  const b05 = document.getElementById('tr-set-05');
  const b1 = document.getElementById('tr-set-1');
  const br = document.getElementById('tr-restore');
  const bf = document.getElementById('tr-refresh');
  if (b05) b05.addEventListener('click', () => trApply(0.5, b05));
  if (b1) b1.addEventListener('click', () => trApply(1, b1));
  if (br) br.addEventListener('click', trRestore);
  if (bf) bf.addEventListener('click', () => trRefresh(false));
  trRefresh(true);
}

const PROTECTED_PLAN_GUIDS = [
  '381b4222-f694-41f0-9685-ff5bb260df2e',
  '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c',
  'a1841308-3541-4fab-bc81-f71556f20b4a',
  'e9a42b02-d5df-448d-aa00-03f14749eb61'
];

// ---------- POWER PLAN STUDIO (renderer side) ----------
// Create / import / activate / rename / tweak (16 everyday settings) / export
// / delete any installed plan. The full 140-setting editor is deliberately NOT
// here — it is part of Atom Optimizer (the ADVANCED group is locked in this
// free build); this page stays simple.

let ppsPlans = [];
let ppsSelected = null;
let ppsModel = null;
let ppsSettingsByKey = {};
let ppsBasicByKey = {}; // key -> basic item def (label/desc), used to refresh a row after apply

function ppsKey(sg, st) { return sg + '|' + st; }

// EVERYDAY SETTINGS: the only settings this page exposes — a short, hand-picked
// list of the settings normal users actually care about, each with a plain-word
// explanation. GUIDs here were verified against this machine's own powercfg
// output. Items missing from a plan are silently skipped, so the list adapts to
// the hardware (e.g. no battery rows on a desktop).
const PPS_BASIC_SECTIONS = [
  { title: 'PERFORMANCE', items: [
    { sg: '54533251-82be-4824-96c1-47b60b740d00', set: '893dee8e-2bef-41e0-89c6-b55d0929964c', label: 'LOWEST CPU SPEED (%)', desc: 'The slowest your CPU may run. Higher = snappier; lower = cooler and better battery time. Windows default: 5% on battery.' },
    { sg: '54533251-82be-4824-96c1-47b60b740d00', set: 'bc5038f7-23e0-4960-96da-33abaf5935ec', label: 'MAXIMUM CPU SPEED (%)', desc: 'The fastest your CPU may run. 100% = full speed; lower it to cut heat, fan noise and battery drain.' },
    { sg: '54533251-82be-4824-96c1-47b60b740d00', set: 'be337238-0d82-4146-a960-4f3749d470c7', label: 'CPU BOOST MODE', desc: 'Lets the CPU sprint above its base speed. Enabled = full performance, Aggressive = quicker bursts (more heat), Disabled = coolest and quietest.' },
    { sg: '54533251-82be-4824-96c1-47b60b740d00', set: '94d3a615-a899-4ac5-ae2b-e4d8f634367f', label: 'FAN / COOLING POLICY', desc: 'Active = fans speed up first (cooler, a bit louder). Passive = CPU slows down first (quieter, warmer).' },
  ]},
  { title: 'SCREEN & SLEEP', items: [
    { sg: '7516b95f-f776-4464-8c53-06167f40cc99', set: '3c0bc021-c8a8-4e07-a973-6b14cbcb2b7e', label: 'TURN OFF SCREEN AFTER', desc: 'Idle time before the screen switches off (0 = never). This is where most of the battery saving comes from.' },
    { sg: '7516b95f-f776-4464-8c53-06167f40cc99', set: '17aaa29b-8b43-4b94-aafe-35f64daaf1ee', label: 'DIM SCREEN AFTER', desc: 'Softly dims the screen shortly before it turns off completely (0 = off).' },
    { sg: '238c9fa8-0aad-41ed-83f4-97be242c8f20', set: '29f6c1db-86da-48c5-9fdb-f2b67b1f44da', label: 'SLEEP PC AFTER', desc: 'Idle time before the PC goes to sleep (0 = never). Sleep wakes in about a second and saves the most power.' },
    { sg: '238c9fa8-0aad-41ed-83f4-97be242c8f20', set: '9d7815a6-7ee4-497e-8888-515a05f02364', label: 'HIBERNATE AFTER', desc: 'Idle time before the PC saves everything to disk and powers off completely (0 = never). Slower to wake than sleep, but uses zero power.' },
    { sg: '238c9fa8-0aad-41ed-83f4-97be242c8f20', set: '94ac6d29-73ce-41a6-809f-6363ba21b47e', label: 'HYBRID SLEEP', desc: 'Sleep + hibernate combined: wakes instantly but survives a power loss. Recommended ON for desktops.' },
    { sg: '238c9fa8-0aad-41ed-83f4-97be242c8f20', set: 'bd3b718a-0680-4d9d-8ab2-e1d2b4ac806d', label: 'WAKE TIMERS', desc: 'Lets programs (updates, recordings, maintenance) wake the PC from sleep. Turn OFF if the PC wakes up by itself.' },
  ]},
  { title: 'DRIVES & DEVICES', items: [
    { sg: '0012ee47-9041-4b5d-9b77-535fba8b1442', set: '6738e2c4-e8a5-4a42-b16a-e040e769756e', label: 'TURN OFF HARD DISK AFTER', desc: 'Idle time before hard disks spin down (0 = never). Mostly affects classic HDDs; SSDs barely notice it.' },
    { sg: '2a737441-1930-4402-8d77-b2bebba308a3', set: '48e6b7a6-50f5-4782-a5d4-53bb8f07e226', label: 'USB POWER SAVING', desc: 'Lets Windows power down idle USB ports. ON saves a little power; turn OFF if a USB device randomly drops out.' },
    { sg: '501a4d13-42af-4429-9fd1-a8218c268e20', set: 'ee12f906-d277-404b-b6da-e5fa1a576df5', label: 'PCIE POWER SAVING', desc: 'Power management for PCIe devices (graphics card, NVMe drive). Off = lowest latency, a little more power.' },
    { sg: '19cbb8fa-5279-450e-9fac-8a3d5fedd0c1', set: '12bbebe6-58d6-4636-95bb-3217ef867c1a', label: 'WIFI POWER SAVING', desc: 'Sets the Wi-Fi adapter power/performance balance. More savings = slightly higher latency.' },
  ]},
  { title: 'BATTERY', items: [
    { sg: 'e73a048d-bf27-4f12-9731-8b2076e8891f', set: '8183ba9a-e910-48da-8769-14ae6dc1170a', label: 'LOW BATTERY WARNING (%)', desc: 'Charge level for the first low-battery warning. Windows default: 10%.' },
    { sg: 'e73a048d-bf27-4f12-9731-8b2076e8891f', set: '9a66d8d7-4ff7-4ef9-b5a2-5a326ca2a469', label: 'CRITICAL BATTERY LEVEL (%)', desc: 'Charge level for the critical action (sleep/shutdown). Keep it below the low level. Windows default: 5%.' },
  ]},
];

function ppsBasicRowHTML(it, st) {
  const k = ppsKey(it.sg, st.guid);
  const vals = st.values || [];
  let controls;
  if (vals.length >= 2) {
    const opts = sel => vals.map(v => `<option value="${v.index}"${v.index === sel ? ' selected' : ''}>${apcEsc(v.name)}</option>`).join('');
    controls = `<span class="tweak-status">PLUGGED IN</span><select class="applist-input" style="width:170px" data-pps-ac="${k}">${opts(st.ac)}</select>` +
               `<span class="tweak-status">ON BATTERY</span><select class="applist-input" style="width:170px" data-pps-dc="${k}">${opts(st.dc)}</select>` +
               `<button class="app-install-btn" data-pps-apply="${k}">APPLY</button>`;
  } else {
    controls = `<span class="tweak-status">PLUGGED IN</span><input class="applist-input" style="width:90px" inputmode="numeric" value="${st.ac != null ? st.ac : ''}" data-pps-ac="${k}">` +
               `<span class="tweak-status">ON BATTERY</span><input class="applist-input" style="width:90px" inputmode="numeric" value="${st.dc != null ? st.dc : ''}" data-pps-dc="${k}">` +
               `<button class="app-install-btn" data-pps-apply="${k}">APPLY</button>`;
  }
  const units = (st.units && st.units !== '%') ? ' · VALUES IN ' + apcEsc(String(st.units).toUpperCase()) : '';
  return `<div class="tweak-row" data-pps-row="${k}"><div class="tweak-info"><div class="tweak-name">${apcEsc(it.label)}</div><div class="tweak-desc">${apcEsc(it.desc)}${units}</div></div><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end;margin-left:auto">${controls}</div></div>`;
}

function ppsRefreshRow(sgGuid, st) {
  const box = document.getElementById('pps-detail');
  if (!box) return;
  const k = ppsKey(sgGuid, st.guid);
  const el = box.querySelector(`[data-pps-row="${k}"]`);
  const basicIt = ppsBasicByKey[k];
  if (!el || !basicIt) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = ppsBasicRowHTML(basicIt, st);
  el.replaceWith(tmp.firstElementChild);
}

function ppsRenderSettings() {
  const box = document.getElementById('pps-featured');
  const countEl = document.getElementById('pps-settings-count');
  if (!box || !ppsModel) return;
  ppsBasicByKey = {};
  let shown = 0;
  let out = '';
  for (const cat of PPS_BASIC_SECTIONS) {
    const rows = cat.items.map(it => {
      const k = ppsKey(it.sg, it.set);
      const st = ppsSettingsByKey[k];
      if (!st || st.hidden) return '';
      ppsBasicByKey[k] = it;
      shown++;
      return ppsBasicRowHTML(it, st);
    }).filter(Boolean);
    if (!rows.length) continue;
    out += `<div class="section-title" style="margin:16px 0 8px">${apcEsc(cat.title)}</div>` + rows.join('');
  }
  box.innerHTML = out || `<div class="applist-status">NO COMMON SETTINGS FOUND ON THIS PLAN.</div>`;
  if (countEl) countEl.textContent = `${shown} EVERYDAY SETTINGS — EVERY CHANGE IS READ-BACK VERIFIED`;
}

async function ppsLoadPlans(keepSettings) {
  const box = document.getElementById('pps-plan-list');
  if (!box) return;
  if (!ppsPlans.length) box.innerHTML = `<div class="applist-status">LOADING INSTALLED PLANS...</div>`;
  let res;
  try { res = await ipcRenderer.invoke('power-plan-list'); }
  catch (e) { box.innerHTML = `<div class="applist-status">FAILED: ${apcEsc(e.message || e)}</div>`; return; }
  if (!res || !res.ok) { box.innerHTML = `<div class="applist-status">FAILED TO LIST PLANS: ${apcEsc((res && res.error) || 'unknown error')}</div>`; return; }
  ppsPlans = res.plans || [];
  if (!ppsPlans.length) { box.innerHTML = `<div class="applist-status">NO POWER PLANS FOUND</div>`; return; }
  const planCountEl = document.getElementById('pps-plan-count');
  if (planCountEl) planCountEl.textContent = `(${ppsPlans.length} INSTALLED)`;
  ppsRenderCreateBase();
  box.innerHTML = ppsPlans.map(p => {
    const isProtected = PROTECTED_PLAN_GUIDS.includes(p.guid);
    const badge = p.active ? '<span class="tweak-status ok" style="margin-left:6px">ACTIVE</span>' : '';
    const prot = isProtected ? '<span class="tweak-status" style="margin-left:6px">BUILT-IN</span>' : '';
    const sel = p.guid === ppsSelected;
    return `<div class="tweak-row pps-plan-row${sel ? ' selected' : ''}" data-pps-plan="${p.guid}"><div class="tweak-info"><div class="tweak-name">${apcEsc(p.name)}${badge}${prot}</div><div class="tweak-desc">${p.guid}</div></div><div class="pps-row-actions"><button class="app-install-btn" data-pps-export="${p.guid}" title="Save this plan as a .pow file">EXPORT</button><span class="tweak-status pps-sel-tag">${sel ? 'SELECTED' : 'SELECT >'}</span></div></div>`;
  }).join('');
  // Keep the selection sensible: previous selection if still installed, else the active plan.
  if (!ppsSelected || !ppsPlans.some(p => p.guid === ppsSelected)) {
    const act = ppsPlans.find(p => p.active);
    ppsSelected = act ? act.guid : ppsPlans[0].guid;
  }
  if (!keepSettings) await ppsSelectPlan(ppsSelected);
  else ppsRenderHeader();
}

function ppsRenderHeader() {
  const p = ppsPlans.find(x => x.guid === ppsSelected);
  const detail = document.getElementById('pps-detail');
  if (!p || !detail) return;
  detail.style.display = '';
  const nameEl = document.getElementById('pps-sel-name');
  const guidEl = document.getElementById('pps-sel-guid');
  const nameIn = document.getElementById('pps-name-input');
  const descIn = document.getElementById('pps-desc-input');
  const actBtn = document.getElementById('pps-activate');
  const delBtn = document.getElementById('pps-delete');
  const protTag = document.getElementById('pps-protected');
  if (nameEl) nameEl.textContent = p.name;
  if (guidEl) guidEl.textContent = p.guid;
  if (nameIn) nameIn.value = p.name;
  if (descIn) {
    descIn.value = (ppsModel && ppsModel.description) ? ppsModel.description : '';
    descIn.placeholder = 'DESCRIPTION (OPTIONAL)';
  }
  if (actBtn) {
    actBtn.disabled = !!p.active;
    actBtn.textContent = p.active ? 'ACTIVE' : 'ACTIVATE';
    actBtn.style.opacity = p.active ? '0.5' : '';
    actBtn.classList.remove('installing');
  }
  const isProtected = PROTECTED_PLAN_GUIDS.includes(p.guid);
  if (delBtn) {
    delBtn.style.display = isProtected ? 'none' : '';
    delBtn.disabled = !!p.active;
    delBtn.style.opacity = p.active ? '0.5' : '';
    delBtn.title = p.active ? 'This plan is currently active — activate another plan first' : '';
    delBtn.dataset.confirm = '';
    delBtn.textContent = 'DELETE';
    delBtn.classList.remove('installing');
  }
  if (protTag) protTag.style.display = isProtected ? '' : 'none';
}

async function ppsSelectPlan(guid) {
  ppsSelected = guid;
  ppsModel = null;
  // Update list highlighting + SELECTED tags without a full re-list.
  const box = document.getElementById('pps-plan-list');
  if (box) {
    box.querySelectorAll('[data-pps-plan]').forEach(el => {
      const on = el.dataset.ppsPlan === guid;
      el.classList.toggle('selected', on);
      // Only the row's own SELECT tag — never the ACTIVE / BUILT-IN badges
      // that live inside the name cell (.tweak-status would match those first).
      const tag = el.querySelector('.pps-sel-tag');
      if (tag) tag.textContent = on ? 'SELECTED' : 'SELECT >';
    });
  }
  const detail = document.getElementById('pps-detail');
  if (detail) detail.style.display = '';
  ppsRenderHeader();
  const countEl = document.getElementById('pps-settings-count');
  const settingsBox = document.getElementById('pps-featured');
  if (settingsBox) settingsBox.innerHTML = `<div class="applist-status">READING THIS PLAN'S SETTINGS...</div>`;
  if (countEl) countEl.textContent = 'READING SETTINGS...';

  let res;
  try { res = await ipcRenderer.invoke('pp-settings', { guid }); }
  catch (e) { if (settingsBox) settingsBox.innerHTML = `<div class="applist-status">FAILED: ${apcEsc(e.message || e)}</div>`; return; }
  if (!res || !res.ok) { if (settingsBox) settingsBox.innerHTML = `<div class="applist-status">FAILED TO READ PLAN: ${apcEsc((res && res.error) || 'unknown error')}</div>`; return; }
  if (ppsSelected !== guid) return; // user selected another plan while this one was loading
  ppsModel = res;
  ppsSettingsByKey = {};
  for (const sg of res.subgroups) {
    for (const st of sg.settings) ppsSettingsByKey[ppsKey(sg.guid, st.guid)] = st;
  }
  ppsRenderHeader();
  ppsRenderSettings();
  logToConsole(`[${new Date().toLocaleTimeString()}] Plan loaded: ${res.name || guid} — 16 everyday settings shown (${res.settingsCount} available on this plan)${res.active ? ' — ACTIVE plan' : ' — stored values (take effect when activated)'}`);
}

async function ppsApplyFromEl(el) {
  const k = el.dataset.ppsApply;
  const st = ppsSettingsByKey[k];
  if (!st || !ppsModel || !ppsSelected) return;
  if (el.classList.contains('installing')) return;
  const sgGuid = k.split('|')[0];
  const box = document.getElementById('pps-detail');
  if (!box) return;
  const acEl = box.querySelector(`[data-pps-ac="${k}"]`);
  const dcEl = box.querySelector(`[data-pps-dc="${k}"]`);
  if (!acEl || !dcEl) return;
  let ac = parseInt(acEl.value, 10);
  let dc = parseInt(dcEl.value, 10);
  if (!Number.isFinite(ac)) ac = (st.ac != null) ? st.ac : 0;
  if (!Number.isFinite(dc)) dc = (st.dc != null) ? st.dc : ac;
  if (st.min != null && ac < st.min) ac = st.min;
  if (st.max != null && ac > st.max) ac = st.max;
  if (st.min != null && dc < st.min) dc = st.min;
  if (st.max != null && dc > st.max) dc = st.max;
  if (ac === st.ac && dc === st.dc) {
    logToConsole(`[${new Date().toLocaleTimeString()}] ${st.name}: value unchanged — nothing written`);
    return;
  }
  const before = { ac: st.ac, dc: st.dc };
  el.classList.add('installing');
  el.textContent = '...';
  logToConsole(`[${new Date().toLocaleTimeString()}] ${st.name}: setting AC=${ac} DC=${dc}...`);
  try {
    const r = await ipcRenderer.invoke('pp-setvalue', { guid: ppsSelected, subgroup: sgGuid, setting: st.guid, ac, dc, min: st.min, max: st.max, name: st.name });
    if (!r || !r.ok) throw new Error((r && r.error) || 'powercfg rejected the change');
    const appliedAc = (r.ac != null) ? r.ac : ac;
    const appliedDc = (r.dc != null) ? r.dc : dc;
    st.ac = appliedAc;
    st.dc = appliedDc;
    ppsRefreshRow(sgGuid, st);
    const scope = r.active ? '' : ' (stored — takes effect when this plan is activated)';
    if (r.verified) logToConsole(`[${new Date().toLocaleTimeString()}] Applied and verified: AC=${appliedAc} DC=${appliedDc}${scope}`);
    else logToConsole(`[${new Date().toLocaleTimeString()}] Applied; read-back AC=${r.ac} DC=${r.dc}${scope}`);
    // Undo datapoint: restores the previous AC/DC on this exact scheme.
    const scheme = ppsSelected;
    const restoreCmd = `powercfg /setacvalueindex ${scheme} ${sgGuid} ${st.guid} ${before.ac} && powercfg /setdcvalueindex ${scheme} ${sgGuid} ${st.guid} ${before.dc}` + (ppsModel.active ? ` && powercfg /setactive ${scheme}` : '');
    addHistoryEntry({
      id: 'ppstudio:' + scheme + ':' + k,
      name: `${st.name} — ${ppsModel.name || scheme}`,
      config: 'ppstudio',
      applied: true,
      script_on: null,
      script_off: null,
      command: restoreCmd,
      check: null
    });
  } catch (e) {
    el.textContent = 'FAILED';
    logToConsole(`[${new Date().toLocaleTimeString()}] ERROR: ${e.message || e}`);
    setTimeout(() => {
      const cur = box.querySelector(`[data-pps-apply="${k}"]`);
      if (cur) { cur.textContent = 'APPLY'; cur.classList.remove('installing'); }
    }, 1500);
  }
}

async function ppsActivate() {
  const p = ppsPlans.find(x => x.guid === ppsSelected);
  if (!p || p.active) return;
  const btn = document.getElementById('pps-activate');
  if (btn && btn.classList.contains('installing')) return;
  if (btn) { btn.classList.add('installing'); btn.textContent = 'ACTIVATING...'; }
  try {
    await ipcRenderer.invoke('power-plan-activate', { guid: ppsSelected });
    logToConsole(`[${new Date().toLocaleTimeString()}] Power plan activated: ${p.name}`);
    await ppsLoadPlans(true);
  } catch (e) {
    logToConsole(`[${new Date().toLocaleTimeString()}] ERROR: ${e.message || e}`);
    if (btn) { btn.textContent = 'ACTIVATE'; btn.classList.remove('installing'); }
  }
}

async function ppsSave() {
  if (!ppsSelected) return;
  const nameIn = document.getElementById('pps-name-input');
  const descIn = document.getElementById('pps-desc-input');
  const btn = document.getElementById('pps-save');
  const name = (nameIn ? nameIn.value : '').trim();
  if (!name) { logToConsole(`[${new Date().toLocaleTimeString()}] ERROR: plan name cannot be empty`); return; }
  if (btn && btn.classList.contains('installing')) return;
  if (btn) { btn.classList.add('installing'); btn.textContent = 'SAVING...'; }
  try {
    const r = await ipcRenderer.invoke('pp-rename', { guid: ppsSelected, name, description: descIn ? descIn.value : '' });
    if (!r || !r.ok) throw new Error((r && r.error) || 'rename failed verification');
    if (ppsModel) { ppsModel.name = r.name; ppsModel.description = r.description; }
    logToConsole(`[${new Date().toLocaleTimeString()}] ${r.verified ? 'Renamed and verified' : 'Renamed'}: "${r.name}"${descIn && descIn.value.trim() ? ' — description saved' : ''}`);
    await ppsLoadPlans(true);
  } catch (e) {
    logToConsole(`[${new Date().toLocaleTimeString()}] ERROR: ${e.message || e}`);
  }
  if (btn) { btn.textContent = 'SAVE'; btn.classList.remove('installing'); }
}

async function ppsDuplicate() {
  const p = ppsPlans.find(x => x.guid === ppsSelected);
  if (!p) return;
  const btn = document.getElementById('pps-duplicate');
  if (btn && btn.classList.contains('installing')) return;
  if (btn) { btn.classList.add('installing'); btn.textContent = 'DUPLICATING...'; }
  try {
    const dupName = (p.name + ' (copy)').substring(0, 120);
    const r = await ipcRenderer.invoke('pp-duplicate', { guid: ppsSelected, name: dupName });
    if (!r || !r.ok) throw new Error((r && r.error) || 'duplicate failed');
    logToConsole(`[${new Date().toLocaleTimeString()}] Duplicated: "${r.name}" (${r.guid}) — selected below`);
    ppsSelected = r.guid;
    ppsModel = null;
    await ppsLoadPlans();
  } catch (e) {
    logToConsole(`[${new Date().toLocaleTimeString()}] ERROR: ${e.message || e}`);
    if (btn) { btn.textContent = 'DUPLICATE'; btn.classList.remove('installing'); }
    return;
  }
  if (btn) { btn.textContent = 'DUPLICATE'; btn.classList.remove('installing'); }
}

async function ppsExport(guidArg, btnArg) {
  const guid = String(guidArg || ppsSelected || '');
  const p = ppsPlans.find(x => x.guid === guid);
  if (!p) return;
  const btn = btnArg || document.getElementById('pps-export');
  const resetLabel = btnArg ? 'EXPORT' : 'EXPORT .POW';
  if (btn && btn.classList.contains('installing')) return;
  if (btn) { btn.classList.add('installing'); btn.textContent = 'EXPORTING...'; }
  try {
    const r = await ipcRenderer.invoke('pp-export', { guid, suggestedName: p.name });
    if (r && r.canceled) logToConsole(`[${new Date().toLocaleTimeString()}] Export canceled`);
    else if (r && r.ok) logToConsole(`[${new Date().toLocaleTimeString()}] Exported "${p.name}" to ${r.file} (${r.size} bytes)`);
    else throw new Error((r && r.error) || 'export failed');
  } catch (e) {
    logToConsole(`[${new Date().toLocaleTimeString()}] ERROR: ${e.message || e}`);
  }
  if (btn) { btn.textContent = resetLabel; btn.classList.remove('installing'); }
}

// Fill the CREATE PLAN "BASED ON" picker with every installed plan.
function ppsRenderCreateBase() {
  const sel = document.getElementById('pps-create-base');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = ppsPlans.map(p => `<option value="${p.guid}">${apcEsc(p.name)}${p.active ? ' (ACTIVE)' : ''}</option>`).join('');
  const wanted = [prev, ppsSelected, (ppsPlans.find(p => p.active) || {}).guid, ppsPlans[0] && ppsPlans[0].guid]
    .find(g => g && ppsPlans.some(p => p.guid === g));
  if (wanted) sel.value = wanted;
}

// CREATE PLAN: a real new plan (powercfg /duplicatescheme of the chosen base +
// its own name), independent from the base from that moment on.
async function ppsCreate() {
  const nameEl = document.getElementById('pps-create-name');
  const baseEl = document.getElementById('pps-create-base');
  const btn = document.getElementById('pps-create-ok');
  if (!nameEl || !baseEl || !btn) return;
  if (btn.classList.contains('installing')) return;
  const name = nameEl.value.replace(/[\r\n\t]+/g, ' ').trim();
  const base = baseEl.value;
  if (!name) {
    logToConsole(`[${new Date().toLocaleTimeString()}] ERROR: enter a name for the new plan`);
    nameEl.focus();
    return;
  }
  if (!ppsPlans.some(p => p.guid === base)) {
    logToConsole(`[${new Date().toLocaleTimeString()}] ERROR: choose a base plan`);
    return;
  }
  btn.classList.add('installing');
  btn.textContent = 'CREATING...';
  try {
    const r = await ipcRenderer.invoke('pp-duplicate', { guid: base, name });
    if (!r || !r.ok) throw new Error((r && r.error) || 'create failed');
    logToConsole(`[${new Date().toLocaleTimeString()}] Created power plan "${r.name}" (${r.guid}) — selected below`);
    showToast('Power plan created', (r.name || name) + ' — activate it when it is ready.');
    ppsSelected = r.guid;
    ppsModel = null;
    const form = document.getElementById('pps-create-form');
    if (form) form.style.display = 'none';
    nameEl.value = '';
    await ppsLoadPlans();
  } catch (e) {
    logToConsole(`[${new Date().toLocaleTimeString()}] ERROR: ${e.message || e}`);
  }
  btn.textContent = 'CREATE PLAN';
  btn.classList.remove('installing');
}

async function ppsDelete() {
  const p = ppsPlans.find(x => x.guid === ppsSelected);
  if (!p) return;
  if (p.active) {
    logToConsole(`[${new Date().toLocaleTimeString()}] ERROR: "${p.name}" is the active plan — activate another plan first`);
    return;
  }
  const btn = document.getElementById('pps-delete');
  if (!btn) return;
  if (btn.classList.contains('installing')) return;
  if (btn.dataset.confirm !== '1') {
    btn.dataset.confirm = '1';
    btn.textContent = 'CONFIRM?';
    setTimeout(() => {
      if (btn.dataset.confirm === '1') { btn.dataset.confirm = ''; btn.textContent = 'DELETE'; }
    }, 3000);
    return;
  }
  btn.dataset.confirm = '';
  btn.classList.add('installing');
  btn.textContent = 'DELETING...';
  try {
    await ipcRenderer.invoke('power-plan-remove', { guid: ppsSelected });
    logToConsole(`[${new Date().toLocaleTimeString()}] Plan deleted: ${p.name}`);
    ppsSelected = null;
    ppsModel = null;
    await ppsLoadPlans();
  } catch (e) {
    logToConsole(`[${new Date().toLocaleTimeString()}] ERROR: ${e.message || e}`);
    btn.textContent = 'DELETE';
    btn.classList.remove('installing');
  }
}

function ppsBindStudio() {
  const detail = document.getElementById('pps-detail');
  const list = document.getElementById('pps-plan-list');
  if (list) {
    list.addEventListener('click', (e) => {
      const exp = e.target.closest('[data-pps-export]');
      if (exp) { ppsExport(exp.dataset.ppsExport, exp); return; }
      const row = e.target.closest('[data-pps-plan]');
      if (row) ppsSelectPlan(row.dataset.ppsPlan);
    });
  }

  // CREATE PLAN: inline form (name + base plan) -> real duplicate + rename.
  const createBtn = document.getElementById('btn-create-plan');
  if (createBtn) {
    createBtn.addEventListener('click', () => {
      const form = document.getElementById('pps-create-form');
      if (!form) return;
      const open = form.style.display !== 'none';
      form.style.display = open ? 'none' : '';
      if (!open) {
        ppsRenderCreateBase();
        const n = document.getElementById('pps-create-name');
        if (n) { n.value = ''; n.focus(); }
      }
    });
  }
  const createOk = document.getElementById('pps-create-ok');
  if (createOk) createOk.addEventListener('click', ppsCreate);
  const createCancel = document.getElementById('pps-create-cancel');
  if (createCancel) createCancel.addEventListener('click', () => {
    const form = document.getElementById('pps-create-form');
    if (form) form.style.display = 'none';
  });
  const createName = document.getElementById('pps-create-name');
  if (createName) createName.addEventListener('keydown', (e) => { if (e.key === 'Enter') ppsCreate(); });

  if (!detail) return;
  detail.addEventListener('click', (e) => {
    const ap = e.target.closest('button[data-pps-apply]');
    if (ap) { ppsApplyFromEl(ap); return; }
  });
  const actBtn = document.getElementById('pps-activate');
  if (actBtn) actBtn.addEventListener('click', ppsActivate);
  const dupBtn = document.getElementById('pps-duplicate');
  if (dupBtn) dupBtn.addEventListener('click', ppsDuplicate);
  const expBtn = document.getElementById('pps-export');
  if (expBtn) expBtn.addEventListener('click', () => ppsExport());
  const delBtn = document.getElementById('pps-delete');
  if (delBtn) delBtn.addEventListener('click', ppsDelete);
  const saveBtn = document.getElementById('pps-save');
  if (saveBtn) saveBtn.addEventListener('click', ppsSave);
  const nameIn = document.getElementById('pps-name-input');
  if (nameIn) nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') ppsSave(); });
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

// ---------- WINDOWS APP DEBLOAT ----------
// Select AppX/MSIX packages and remove them for every user, plus their
// provisioned copies. The list comes from the main process so the renderer
// never gets to choose arbitrary package names.

let debloatPageToken = 0;

function debloatEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function renderDebloat() {
  const token = ++debloatPageToken;
  let showAbsent = false;
  let removing = false;
  let scanSeq = 0;

  content.innerHTML = `
    <div class="section-title">WINDOWS APP DEBLOAT <span class="tweak-count" id="debloat-count">SCANNING...</span></div>
    <div class="debloat-notice">SELECT PREINSTALLED APPS AND REMOVE THEM FOR ALL USERS. PROVISIONED COPIES ARE ALSO REMOVED SO WINDOWS DOES NOT REINSTALL THEM FOR NEW USERS. REMOVAL CANNOT BE UNDONE FROM THIS APP.</div>
    <div class="debloat-toolbar">
      <div class="debloat-summary" id="debloat-summary">0 SELECTED</div>
      <div class="debloat-actions">
        <button class="settings-btn" id="debloat-select-all">SELECT ALL VISIBLE</button>
        <button class="settings-btn" id="debloat-clear">CLEAR</button>
        <button class="settings-btn" id="debloat-show-absent">SHOW NOT INSTALLED</button>
        <button class="settings-btn" id="debloat-refresh">REFRESH</button>
        <button class="debloat-remove-btn" id="debloat-remove" disabled>REMOVE SELECTED (0)</button>
      </div>
    </div>
    <div class="applist-search"><input type="text" class="applist-input" placeholder="FILTER APPS..." id="debloat-filter"></div>
    <div id="debloat-list"><div class="applist-status">SCANNING INSTALLED WINDOWS APPS...</div></div>
    <div class="debloat-status" id="debloat-status">READY.</div>
  `;

  const listEl = document.getElementById('debloat-list');
  const statusEl = document.getElementById('debloat-status');
  const filterEl = document.getElementById('debloat-filter');
  const removeBtn = document.getElementById('debloat-remove');
  const summaryEl = document.getElementById('debloat-summary');
  if (!listEl || !statusEl || !filterEl || !removeBtn) return;

  function updateSelectionUI() {
    const boxes = Array.from(listEl.querySelectorAll('.debloat-check:not(:disabled)'));
    const selected = boxes.filter(cb => cb.checked).length;
    if (summaryEl) summaryEl.textContent = `${selected} SELECTED`;
    removeBtn.disabled = selected === 0 || removing;
    removeBtn.textContent = removing ? 'REMOVING...' : `REMOVE SELECTED (${selected})`;
  }

  function applyVisibility() {
    const q = filterEl.value.trim().toLowerCase();
    let visible = 0;
    listEl.querySelectorAll('.debloat-row').forEach(row => {
      const matches = !q || String(row.dataset.search || '').includes(q);
      const absent = row.dataset.absent === 'true';
      const show = matches && (showAbsent || !absent);
      row.style.display = show ? '' : 'none';
      if (show) visible++;
    });
    listEl.querySelectorAll('.debloat-category').forEach(cat => {
      const any = Array.from(cat.querySelectorAll('.debloat-row'))
        .some(row => row.style.display !== 'none');
      cat.style.display = any ? '' : 'none';
    });
    const absentCount = Array.from(listEl.querySelectorAll('.debloat-row'))
      .filter(row => row.dataset.absent === 'true').length;
    const showAbsentBtn = document.getElementById('debloat-show-absent');
    if (showAbsentBtn) {
      showAbsentBtn.style.display = absentCount ? '' : 'none';
      showAbsentBtn.textContent = showAbsent ? 'HIDE NOT INSTALLED' : `SHOW NOT INSTALLED (${absentCount})`;
    }
    const countEl = document.getElementById('debloat-count');
    if (countEl) countEl.textContent = `${visible} SHOWN`;
  }

  function renderRows(apps) {
    const categories = [];
    for (const app of apps) {
      if (!categories.includes(app.category)) categories.push(app.category);
    }

    let html = '';
    for (const category of categories) {
      const rows = apps.filter(app => app.category === category);
      html += `<div class="debloat-category"><div class="app-category-title">${debloatEsc(category)} <span class="tweak-count">${rows.filter(app => app.canRemove).length} REMOVABLE</span></div>`;
      for (const app of rows) {
        const absent = !app.installed && !app.provisioned;
        const bits = [];
        if (app.installed) bits.push(`INSTALLED ${app.installed}`);
        if (app.provisioned) bits.push(`PROVISIONED ${app.provisioned}`);
        if (absent) bits.push('NOT INSTALLED');
        if (app.protectedCount) bits.push(`${app.protectedCount} PROTECTED`);
        const disabled = !app.canRemove;
        const badge = (!app.canRemove && app.installed)
          ? '<span class="debloat-badge protected">PROTECTED</span>'
          : (app.provisioned && !app.installed ? '<span class="debloat-badge">PROVISIONED ONLY</span>' : '');
        const search = `${app.name} ${app.category} ${app.description} ${(app.packageNames || []).join(' ')}`.toLowerCase();
        const title = `PACKAGE: ${(app.packageNames || []).join(', ')}`;
        html += `
          <label class="debloat-row${disabled ? ' disabled' : ''}" data-id="${debloatEsc(app.id)}" data-search="${debloatEsc(search)}" data-absent="${absent}" title="${debloatEsc(title)}">
            <input type="checkbox" class="debloat-check" data-id="${debloatEsc(app.id)}" ${disabled ? 'disabled' : ''}>
            <div class="debloat-info">
              <div class="debloat-name">${debloatEsc(app.name)}${badge}</div>
              <div class="debloat-desc">${debloatEsc(app.description)}</div>
              <div class="debloat-meta">${debloatEsc(bits.join(' | '))}</div>
              <div class="debloat-pkg">${debloatEsc((app.packageNames || []).join(' | '))}</div>
            </div>
          </label>`;
      }
      html += '</div>';
    }

    listEl.innerHTML = html || '<div class="applist-status">NO CATALOGED WINDOWS APPS WERE FOUND ON THIS PC.</div>';
    applyVisibility();
    updateSelectionUI();
  }

  async function refreshDebloat(message, force = false) {
    const seq = ++scanSeq;
    statusEl.className = 'debloat-status running';
    statusEl.textContent = message || 'SCANNING INSTALLED WINDOWS APPS...';
    listEl.innerHTML = '<div class="applist-status">SCANNING INSTALLED WINDOWS APPS...</div>';
    updateSelectionUI();

    try {
      const res = await ipcRenderer.invoke('debloat-scan', { force });
      if (token !== debloatPageToken || seq !== scanSeq) return;
      if (!res || !res.ok) throw new Error((res && res.error) || 'scan failed');
      const apps = Array.isArray(res.apps) ? res.apps : [];
      const removable = apps.filter(app => app.canRemove).length;
      const countEl = document.getElementById('debloat-count');
      if (countEl) countEl.textContent = `${removable} REMOVABLE / ${apps.length} CATALOG`;
      renderRows(apps);
      const scopeNote = res.scope === 'all-users' ? '' : ' [SCAN LIMITED TO CURRENT USER]';
      const provisionedNote = res.provisionedError
        ? ' [PROVISIONED PACKAGE SCAN FAILED: ' + String(res.provisionedError).substring(0, 160) + ']'
        : '';
      statusEl.className = res.admin === false ? 'debloat-status fail' : 'debloat-status ok';
      statusEl.textContent = res.admin === false
        ? 'ADMINISTRATOR TOKEN NOT DETECTED - RESTART THE APP AS ADMINISTRATOR BEFORE REMOVING APPS.'
        : `SCAN COMPLETE - ${removable} app group(s) can be removed on this PC. Removal applies to all users.${scopeNote}${provisionedNote}`;
    } catch (e) {
      if (token !== debloatPageToken || seq !== scanSeq) return;
      listEl.innerHTML = `<div class="applist-status">SCAN FAILED: ${debloatEsc(String(e.message || e).substring(0, 240))}</div>`;
      statusEl.className = 'debloat-status fail';
      statusEl.textContent = 'SCAN FAILED - ' + String(e.message || e).substring(0, 240);
      updateSelectionUI();
    }
  }

  document.getElementById('debloat-select-all').addEventListener('click', () => {
    listEl.querySelectorAll('.debloat-row').forEach(row => {
      if (row.style.display === 'none') return;
      const cb = row.querySelector('.debloat-check');
      if (cb && !cb.disabled) cb.checked = true;
    });
    updateSelectionUI();
  });

  document.getElementById('debloat-clear').addEventListener('click', () => {
    listEl.querySelectorAll('.debloat-check').forEach(cb => { cb.checked = false; });
    updateSelectionUI();
  });

  document.getElementById('debloat-show-absent').addEventListener('click', () => {
    showAbsent = !showAbsent;
    applyVisibility();
    updateSelectionUI();
  });

  document.getElementById('debloat-refresh').addEventListener('click', () => {
    refreshDebloat('REFRESHING INSTALLED WINDOWS APPS...', true);
  });

  filterEl.addEventListener('input', applyVisibility);
  listEl.addEventListener('change', (e) => {
    if (e.target && e.target.classList.contains('debloat-check')) updateSelectionUI();
  });

  removeBtn.addEventListener('click', async () => {
    if (removing) return;
    const ids = Array.from(listEl.querySelectorAll('.debloat-check:checked:not(:disabled)'))
      .map(cb => cb.dataset.id);
    if (!ids.length) return;
    const label = ids.length === 1 ? 'app group' : 'app groups';
    if (!window.confirm(`Remove ${ids.length} selected ${label} for ALL users?\n\nProvisioned copies will also be removed. This cannot be undone from AtomToolBox.`)) return;

    removing = true;
    updateSelectionUI();
    statusEl.className = 'debloat-status running';
    statusEl.textContent = 'REMOVING SELECTED APPS... THIS CAN TAKE SEVERAL MINUTES. DO NOT CLOSE THE APP.';

    try {
      const res = await ipcRenderer.invoke('debloat-remove', { ids });
      if (token !== debloatPageToken) return;
      if (!res || !res.ok) throw new Error((res && res.error) || 'removal failed');
      const results = Array.isArray(res.results) ? res.results : [];
      if (!results.length) throw new Error('the removal helper returned no per-app results');
      const bad = results.filter(r => !r.ok);
      const good = results.length - bad.length;
      const warnings = results.flatMap(r => Array.isArray(r.warnings) ? r.warnings : []).filter(Boolean);
      const detail = bad.slice(0, 3).map(r => `${r.name}: ${(r.errors && r.errors[0]) || 'failed'}`).join(' | ');
      const notes = [];
      if (warnings.length) notes.push('Warnings: ' + warnings.slice(0, 2).join(' | '));
      if (res.verificationError) notes.push('Verification: ' + String(res.verificationError).substring(0, 180));
      if (res.helperError) notes.push('Helper: ' + String(res.helperError).substring(0, 180));
      if (res.verificationLimited) notes.push('All-user verification was unavailable.');
      const noteText = notes.length ? ' ' + notes.join(' ') : '';
      const finalClass = bad.length ? 'debloat-status fail' : 'debloat-status ok';
      const finalText = bad.length
        ? `FINISHED WITH ISSUES - ${good} clean, ${bad.length} with errors. ${detail}${noteText}`
        : `REMOVAL COMPLETE${res.partial ? ' (VERIFIED BY RESCAN)' : ''} - ${good} ${good === 1 ? 'app group' : 'app groups'} removed for all users.${noteText}`;
      showToast(bad.length ? 'DEBLOAT FINISHED WITH ISSUES' : 'DEBLOAT COMPLETE', `${good} clean / ${bad.length} issues`);
      removing = false;
      await refreshDebloat(bad.length ? 'RESCANNING AFTER REMOVAL...' : 'RESCAN AFTER REMOVAL...', true);
      if (token === debloatPageToken) {
        statusEl.className = finalClass;
        statusEl.textContent = finalText;
        updateSelectionUI();
      }
    } catch (e) {
      if (token !== debloatPageToken) return;
      const errText = String(e.message || e).substring(0, 260);
      statusEl.className = 'debloat-status fail';
      statusEl.textContent = 'REMOVAL FAILED - ' + errText;
      showToast('REMOVAL FAILED', errText.substring(0, 140));
      // Even a rejected IPC call may have removed some packages before the
      // helper stopped. Re-scan so the page reflects the real machine state.
      try { await refreshDebloat('RESCANNING AFTER REMOVAL FAILURE...', true); } catch {}
      if (token === debloatPageToken) {
        statusEl.className = 'debloat-status fail';
        statusEl.textContent = 'REMOVAL FAILED - ' + errText;
      }
    } finally {
      removing = false;
      updateSelectionUI();
    }
  });

  await refreshDebloat();
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
            <div class="settings-row-desc">DEEP GRAY, OLED BLACK OR LIGHT — APPLIED INSTANTLY AND REMEMBERED</div>
          </div>
          <div style="display:flex;gap:6px;margin-left:16px;">
            <button class="settings-btn theme-opt" data-theme-opt="dark">DARK</button>
            <button class="settings-btn theme-opt" data-theme-opt="oled">OLED</button>
            <button class="settings-btn theme-opt" data-theme-opt="light">LIGHT</button>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-name">SMOOTH SCROLLING</div>
            <div class="settings-row-desc">EASED MOUSE-WHEEL SCROLLING WITH A SMALL CURVE — TURN OFF FOR INSTANT STEPS</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;margin-left:16px;">
            <div class="tweak-toggle${isSmoothScrollOn() ? ' active' : ''}" id="smooth-scroll-toggle"></div>
            <span class="tweak-status ${isSmoothScrollOn() ? 'ok' : ''}" id="smooth-scroll-status">${isSmoothScrollOn() ? 'ON' : 'OFF'}</span>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-row-info">
            <div class="settings-row-name">APP VERSION</div>
            <div class="settings-row-desc">Atom ToolBox v0.3.0</div>
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
          <div class="settings-row-info">
            <div class="settings-row-name">REGISTRY AUDIT EXPORT</div>
            <div class="settings-row-desc" id="audit-row-status">SCANS EVERY TWEAK AGAINST THE LIVE SYSTEM AND WRITES A STRUCTURED .TXT REPORT TO YOUR DOWNLOADS FOLDER</div>
          </div>
          <button class="settings-btn" id="btn-audit-export">EXPORT AUDIT LOG</button>
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
  const themeBtns = content.querySelectorAll('[data-theme-opt]');
  function paintThemeBtns() {
    const cur = document.documentElement.dataset.theme || 'dark';
    themeBtns.forEach(b => b.classList.toggle('active', b.dataset.themeOpt === cur));
  }
  themeBtns.forEach(b => b.addEventListener('click', () => {
    applyTheme(b.dataset.themeOpt);
    paintThemeBtns();
  }));
  paintThemeBtns();

  const scToggle = document.getElementById('smooth-scroll-toggle');
  const scStatus = document.getElementById('smooth-scroll-status');
  if (scToggle) {
    scToggle.addEventListener('click', () => {
      const on = !isSmoothScrollOn();
      try { localStorage.setItem('atom-smooth-scroll', on ? 'on' : 'off'); } catch {}
      scToggle.classList.toggle('active', on);
      if (scStatus) {
        scStatus.textContent = on ? 'ON' : 'OFF';
        scStatus.className = `tweak-status ${on ? 'ok' : ''}`;
      }
    });
  }

  const auditBtn = document.getElementById('btn-audit-export');
  if (auditBtn) {
    auditBtn.addEventListener('click', async () => {
      if (auditBtn.disabled) return;
      const statusEl = document.getElementById('audit-row-status');
      auditBtn.disabled = true;
      auditBtn.textContent = 'EXPORTING...';
      const onProg = (_, p) => {
        if (p && p.total) auditBtn.textContent = `EXPORTING ${Math.min(99, Math.round((p.done / p.total) * 100))}%`;
      };
      ipcRenderer.on('audit-progress', onProg);
      try {
        const res = await ipcRenderer.invoke('audit-export-registry', {});
        if (res && res.ok) {
          const s = res.stats || {};
          auditBtn.textContent = 'EXPORTED';
          if (statusEl) statusEl.textContent = `${s.total || 0} TWEAKS AUDITED - ${s.enabled || 0} ENABLED - SAVED TO ${res.file}`;
          showToast('AUDIT EXPORTED', `${s.total || 0} TWEAKS SCANNED - ${s.enabled || 0} VERIFIED ENABLED`);
        } else {
          auditBtn.textContent = 'FAILED';
          if (statusEl) statusEl.textContent = 'EXPORT FAILED - ' + ((res && res.error) || 'unknown error');
        }
      } catch (e) {
        auditBtn.textContent = 'FAILED';
        if (statusEl) statusEl.textContent = 'EXPORT FAILED - ' + (e.message || e);
      } finally {
        ipcRenderer.removeListener('audit-progress', onProg);
        setTimeout(() => { auditBtn.textContent = 'EXPORT AUDIT LOG'; auditBtn.disabled = false; }, 2500);
      }
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
  { id: 'copy_path', name: 'ADD "COPY AS PATH"', desc: 'Adds a working "Copy as path" to the file and folder right-click menu (HKCU, no admin needed).', type: 'script', script_on: 'contextmenu/copy_path_on.bat', script_off: 'contextmenu/copy_path_off.bat' },
  { id: 'cmd_here', name: 'ADD "OPEN CMD HERE"', desc: 'Adds "Open Command Prompt here" to folder and folder-background menus (runs in the clicked folder).', type: 'script', script_on: 'contextmenu/cmd_here_on.bat', script_off: 'contextmenu/cmd_here_off.bat' },
  { id: 'powershell_here', name: 'ADD "OPEN POWERSHELL HERE"', desc: 'Adds "Open PowerShell here" to folder and folder-background menus (opens in the clicked folder).', type: 'script', script_on: 'contextmenu/powershell_here_on.bat', script_off: 'contextmenu/powershell_here_off.bat' },
  { id: 'notepad', name: 'ADD "OPEN WITH NOTEPAD"', desc: 'Adds "Open with Notepad" to the right-click menu of every file — handy for editing config/script files.', type: 'script', script_on: 'contextmenu/notepad_on.bat', script_off: 'contextmenu/notepad_off.bat' },
  { id: 'take_ownership', name: 'ADD "TAKE OWNERSHIP"', desc: 'Adds a WORKING "Take Ownership" to file and folder menus (UAC prompt on click; rewrites the broken SID entry to the valid Administrators SID).', type: 'script', script_on: 'contextmenu/take_ownership_on.bat', script_off: 'contextmenu/take_ownership_off.bat' },
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
      if (e.type === 'script') {
        lines.push(`[registry helper] ${enabled ? e.script_on : e.script_off}`);
        return;
      }
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

  // Live state for script-backed entries: the real registry wins over
  // localStorage (the user may have removed an entry outside the app).
  const scriptEntries = contextMenuEntries.filter(e => e.type === 'script');
  if (scriptEntries.length) {
    try {
      const live = await ipcRenderer.invoke('cm-state');
      if (live && live.ok && Array.isArray(live.results)) {
        for (const r of live.results) {
          if (scriptEntries.some(e => e.id === r.verb)) cmStates[r.verb] = !!r.ok;
        }
        persistCm();
      }
    } catch (e) {
      logToConsole(`[${new Date().toLocaleTimeString()}] NOTE: could not read live context-menu state (${e.message || e})`);
    }
    if (!document.getElementById('cm-preview-content')) return; // navigated away during the await
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

    let cmd = null;
    let scriptPath = null;
    if (entry.type === 'script') {
      scriptPath = cmStates[id] ? entry.script_on : entry.script_off;
    } else if (cmStates[id]) {
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

    if (cmd || scriptPath) {
      try {
        await ipcRenderer.invoke('execute-tweak', { scriptPath, command: cmd });
        logToConsole(`[${new Date().toLocaleTimeString()}] ${entry.name}: ${cmStates[id] ? 'APPLIED' : 'REVERTED'}`);
        addHistoryEntry({
          id: entry.id,
          name: entry.name,
          config: 'contextmenu',
          applied: cmStates[id],
          script_on: entry.script_on || null,
          script_off: entry.script_off || null,
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

// ---------- STARTUP MANAGER ----------

let startupItems = [];
let startupScanSeq = 0;

function startupEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function startupStatsLine() {
  const en = startupItems.filter(i => i.enabled).length;
  return `(${startupItems.length} ENTRIES — ${en} ENABLED / ${startupItems.length - en} DISABLED)`;
}

function renderStartup() {
  let html = `<div class="section-title">STARTUP MANAGER <span class="tweak-count" id="startup-count">--</span></div>`;
  if (!state.isAdmin) {
    html += `<div class="admin-warn">[!] TOGGLING HKLM / ALL-USERS STARTUP ITEMS REQUIRES ADMIN — RUN THE APP AS ADMINISTRATOR.</div>`;
  }
  html += `<div class="applist-status">DISABLE STOPS AN ITEM FROM LAUNCHING AT SIGN-IN WITHOUT DELETING ANYTHING. REGISTRY ENTRIES USE WINDOWS' OWN APPROVED-STATE FLAG (SAME MECHANISM AS TASK MANAGER); STARTUP-FOLDER SHORTCUTS ARE RENAMED WITH A .DISABLED SUFFIX AND ENABLE RESTORES THE EXACT ORIGINAL NAME. CHANGES TAKE EFFECT AT NEXT SIGN-IN.</div>`;
  html += `<div style="display:flex;gap:8px;margin-bottom:12px;"><button class="settings-btn" id="btn-startup-refresh">REFRESH</button></div>`;
  html += `<div id="startup-rows"><div class="applist-status">SCANNING STARTUP SOURCES...</div></div>`;
  html += `<div class="tweak-console"><div class="tweak-console-header">&gt; STARTUP LOG <button class="console-clear" id="btn-clear-console">CLEAR</button></div><div class="tweak-console-content" id="tweak-console-content">-- Ready --</div></div>`;
  content.innerHTML = html;

  const clearBtn = document.getElementById('btn-clear-console');
  if (clearBtn) clearBtn.addEventListener('click', clearConsole);
  document.getElementById('btn-startup-refresh').addEventListener('click', loadStartupItems);

  document.getElementById('startup-rows').addEventListener('click', async (e) => {
    const toggle = e.target.closest('.tweak-toggle');
    if (!toggle || toggle.classList.contains('executing')) return;
    const id = toggle.dataset.startup;
    const item = startupItems.find(i => i.id === id);
    if (!item) return;
    const row = toggle.closest('.tweak-row');
    const statusEl = row ? row.querySelector('.tweak-status') : null;
    const action = item.enabled ? 'disable' : 'enable';
    toggle.classList.add('executing');
    if (statusEl) { statusEl.textContent = '...'; statusEl.className = 'tweak-status running'; }
    try {
      const res = await ipcRenderer.invoke('startup-set', { id, action });
      if (!res || !res.ok || !res.verified) throw new Error((res && res.error) || 'verification failed');
      item.enabled = (action === 'enable');
      toggle.classList.toggle('active', item.enabled);
      if (statusEl) {
        statusEl.textContent = item.enabled ? 'ON' : 'OFF';
        statusEl.className = `tweak-status ${item.enabled ? 'ok' : ''}`;
      }
      const cEl = document.getElementById('startup-count');
      if (cEl) cEl.textContent = startupStatsLine();
      addHistoryEntry({ name: item.name, config: 'startup', id: item.id, applied: action === 'disable', source: item.source });
    } catch (err) {
      if (statusEl) {
        statusEl.textContent = 'FAILED';
        statusEl.className = 'tweak-status fail';
        setTimeout(() => {
          statusEl.textContent = item.enabled ? 'ON' : 'OFF';
          statusEl.className = `tweak-status ${item.enabled ? 'ok' : ''}`;
        }, 2200);
      }
      showToast('STARTUP CHANGE FAILED', String(err.message || err).substring(0, 140));
    } finally {
      toggle.classList.remove('executing');
    }
  });

  loadStartupItems();
}

async function loadStartupItems() {
  const seq = ++startupScanSeq;
  const rows = document.getElementById('startup-rows');
  if (rows) rows.innerHTML = `<div class="applist-status">SCANNING STARTUP SOURCES...</div>`;
  try {
    const r = await ipcRenderer.invoke('startup-list');
    if (seq !== startupScanSeq) return;  // a newer scan/render superseded this one
    if (!r || !r.ok) throw new Error((r && r.error) || 'scan failed');
    startupItems = Array.isArray(r.items) ? r.items : [];
    renderStartupRows();
    const cEl = document.getElementById('startup-count');
    if (cEl) cEl.textContent = startupStatsLine();
    logToConsole(`> ${startupItems.length} startup entries found (${startupItems.filter(i => i.enabled).length} enabled).`);
    if (r.stats && r.stats.stale > 0) {
      logToConsole(`> NOTE: ${r.stats.stale} registry override(s) found without a matching Run entry — ignored (left untouched).`);
    }
  } catch (e) {
    if (seq !== startupScanSeq) return;
    const rows2 = document.getElementById('startup-rows');
    if (rows2) rows2.innerHTML = `<div class="applist-status">SCAN FAILED: ${startupEsc(e.message || e)}</div>`;
  }
}

function renderStartupRows() {
  const rows = document.getElementById('startup-rows');
  if (!rows) return;
  if (!startupItems.length) {
    rows.innerHTML = `<div class="applist-status">NO STARTUP ENTRIES FOUND.</div>`;
    return;
  }
  rows.innerHTML = '';
  const frag = document.createDocumentFragment();
  startupItems.forEach(item => {
    const div = document.createElement('div');
    div.className = 'tweak-row';
    div.innerHTML = `
      <div class="tweak-info">
        <div class="tweak-name">${startupEsc(item.name)}</div>
        <div class="tweak-desc">[${startupEsc(item.source)}] ${startupEsc(item.command || '')}</div>
      </div>
      <div class="tweak-toggle${item.enabled ? ' active' : ''}" data-startup="${startupEsc(item.id)}"></div>
      <span class="tweak-status ${item.enabled ? 'ok' : ''}">${item.enabled ? 'ON' : 'OFF'}</span>`;
    frag.appendChild(div);
  });
  rows.appendChild(frag);
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
      const actionText = h.config === 'startup' ? (h.applied ? 'DISABLED' : 'ENABLED') : (h.applied ? 'APPLIED' : 'REVERTED');
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

    // Startup Manager entries revert via the startup tool (opposite action)
    if (entry.config === 'startup') {
      try {
        const res = await ipcRenderer.invoke('startup-set', { id: entry.id, action: entry.applied ? 'enable' : 'disable' });
        if (!res || !res.ok || !res.verified) throw new Error((res && res.error) || 'verification failed');
        btn.textContent = 'REVERTED';
        btn.style.borderColor = '#33aa33';
        setTimeout(() => {
          btn.textContent = 'REVERT';
          btn.style.borderColor = '';
          btn.classList.remove('executing');
        }, 1500);
      } catch (e2) {
        btn.textContent = 'FAILED';
        btn.classList.remove('executing');
        btn.title = e2.message || e2;
      }
      return;
    }

    // Determine reverse action
    const reverseScript = entry.applied ? entry.script_off : entry.script_on;
    const reverseCommand = entry.applied ? (entry.command_off || entry.command) : (entry.command_on || entry.command);

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
      if (entry.config === 'startup') {
        try {
          const res = await ipcRenderer.invoke('startup-set', { id: entry.id, action: entry.applied ? 'enable' : 'disable' });
          if (!res || !res.ok) console.error('Revert all failed for', entry.name, res && res.error);
        } catch (e) { console.error('Revert all failed for', entry.name, e); }
        continue;
      }
      const reverseScript = entry.applied ? entry.script_off : entry.script_on;
      const reverseCommand = entry.applied ? (entry.command_off || entry.command) : (entry.command_on || entry.command);
      try {
        if (reverseScript) {
          await ipcRenderer.invoke('execute-tweak', { scriptPath: reverseScript, command: null });
        } else if (reverseCommand && entry.config !== 'contextmenu') {
          await ipcRenderer.invoke('execute-tweak', { scriptPath: null, command: reverseCommand });
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

// ==================== PHASE 2 PAGES ====================

function bindConsoleClear() {
  const clearBtn = document.getElementById('btn-clear-console');
  if (clearBtn) clearBtn.addEventListener('click', clearConsole);
}

function pageConsoleHTML() {
  return `<div class="tweak-console" style="margin-top:16px"><div class="tweak-console-header">&gt; EXECUTION LOG <button class="console-clear" id="btn-clear-console">CLEAR</button></div><div class="tweak-console-content" id="tweak-console-content">-- Ready --</div></div>`;
}

// ---------- DNS OPTIMIZER PAGE ----------
// NOTE: this implementation ships with the Atom Optimizer build. In the free
// AtomToolBox the route is locked (legacy ids fall back to the dashboard) and
// its IPC handlers are refused in main.js.

const DNS_PRESETS = [
  { id: 'cloudflare', name: 'CLOUDFLARE', desc: 'Privacy-first resolver with low latency worldwide.', servers: ['1.1.1.1', '1.0.0.1'] },
  { id: 'google', name: 'GOOGLE PUBLIC DNS', desc: 'Reliable global anycast network.', servers: ['8.8.8.8', '8.8.4.4'] },
  { id: 'quad9', name: 'QUAD9', desc: 'Blocks malicious domains using threat intelligence.', servers: ['9.9.9.9', '149.112.112.112'] },
  { id: 'opendns', name: 'OPENDNS', desc: 'Cisco resolver with optional content filtering.', servers: ['208.67.222.222', '208.67.220.220'] },
  { id: 'adguard', name: 'ADGUARD DNS', desc: 'Ads and trackers blocked at the DNS level.', servers: ['94.140.14.14', '94.140.15.15'] }
];

let dnsSelectedAdapter = null;

function renderDnsOptimizer() {
  let html = `<div class="section-title">DNS OPTIMIZER</div>`;
  if (!state.isAdmin) {
    html += `<div class="admin-warn">[!] CHANGING DNS REQUIRES ADMIN — RUN APP AS ADMINISTRATOR</div>`;
  }
  html += `<div class="applist-status">SELECT A NETWORK ADAPTER, THEN APPLY A DNS PRESET OR CUSTOM SERVERS. RESET RESTORES DHCP DNS.</div>`;
  html += `<div class="settings-grid"><div class="settings-card"><div class="settings-card-title">NETWORK ADAPTER</div>`;
  html += `<div class="applist-tabs" id="dns-adapter-tabs"><div class="applist-status">SCANNING ADAPTERS...</div></div>`;
  html += `<div class="applist-status" id="dns-current" style="padding-top:4px">--</div></div></div>`;
  html += `<div id="dns-preset-rows" style="margin-top:16px"></div>`;
  html += `<div class="settings-grid" style="margin-top:16px"><div class="settings-card"><div class="settings-card-title">CUSTOM &amp; MAINTENANCE</div>`;
  html += `<div class="settings-row"><div class="settings-row-info"><div class="settings-row-name">CUSTOM DNS SERVERS</div><div class="settings-row-desc">IPv4 or IPv6. Secondary is optional.</div></div><input class="applist-input" id="dns-custom-1" placeholder="1.1.1.1" style="width:140px;margin-right:6px"><input class="applist-input" id="dns-custom-2" placeholder="optional" style="width:140px;margin-right:6px"><button class="app-install-btn" id="btn-dns-custom">APPLY</button></div>`;
  html += `<div class="settings-row"><div class="settings-row-info"><div class="settings-row-name">RESTORE AUTOMATIC DNS</div><div class="settings-row-desc">Reverts the selected adapter to DHCP-provided DNS servers.</div></div><button class="app-install-btn" id="btn-dns-dhcp">RESET TO DHCP</button></div>`;
  html += `<div class="settings-row"><div class="settings-row-info"><div class="settings-row-name">FLUSH DNS CACHE</div><div class="settings-row-desc">Clears the resolver cache. Useful after DNS changes.</div></div><button class="app-install-btn" id="btn-dns-flush">FLUSH</button></div>`;
  html += `</div></div>`;
  html += pageConsoleHTML();
  content.innerHTML = html;
  bindConsoleClear();

  async function refreshAdapters() {
    const tabs = document.getElementById('dns-adapter-tabs');
    if (!tabs) return;
    tabs.innerHTML = `<div class="applist-status">SCANNING ADAPTERS...</div>`;
    let res;
    try { res = await ipcRenderer.invoke('dns-list-adapters'); } catch (e) { res = { ok: false, error: e.message || e }; }
    if (!res || !res.ok) {
      tabs.innerHTML = `<div class="applist-status">FAILED TO LIST ADAPTERS: ${(res && res.error) || 'unknown'}</div>`;
      return;
    }
    const adapters = res.adapters || [];
    if (!adapters.length) {
      tabs.innerHTML = `<div class="applist-status">NO ACTIVE ADAPTERS FOUND</div>`;
      return;
    }
    if (!dnsSelectedAdapter || !adapters.some(a => a.name === dnsSelectedAdapter)) dnsSelectedAdapter = adapters[0].name;
    tabs.innerHTML = adapters.map(a => `<button class="applist-tab ${a.name === dnsSelectedAdapter ? 'active' : ''}" data-name="${a.name}">${a.name}</button>`).join('');
    tabs.querySelectorAll('.applist-tab').forEach(tb => {
      tb.addEventListener('click', () => { dnsSelectedAdapter = tb.dataset.name; refreshAdapters(); });
    });
    const sel = adapters.find(a => a.name === dnsSelectedAdapter);
    const cur = document.getElementById('dns-current');
    if (cur && sel) cur.textContent = `${sel.desc || ''} — CURRENT DNS: ${sel.dns.length ? sel.dns.join(', ') : '(automatic / DHCP)'}`;
  }

  async function applyDns(servers, label) {
    if (!dnsSelectedAdapter) { logToConsole(`[${new Date().toLocaleTimeString()}] No adapter selected`); return; }
    logToConsole(`[${new Date().toLocaleTimeString()}] Applying ${label} to ${dnsSelectedAdapter}...`);
    try {
      await ipcRenderer.invoke('dns-apply', { adapter: dnsSelectedAdapter, servers });
      logToConsole(`[${new Date().toLocaleTimeString()}] ${label} applied.`);
    } catch (e) {
      logToConsole(`[${new Date().toLocaleTimeString()}] ERROR: ${e.message || e}`);
    }
    await refreshAdapters();
  }

  const presetBox = document.getElementById('dns-preset-rows');
  presetBox.innerHTML = DNS_PRESETS.map(p => `<div class="tweak-row"><div class="tweak-info"><div class="tweak-name">${p.name}</div><div class="tweak-desc">${p.desc} [${p.servers.join(', ')}]</div></div><button class="app-install-btn" data-preset="${p.id}">APPLY</button></div>`).join('');
  presetBox.querySelectorAll('button[data-preset]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const p = DNS_PRESETS.find(x => x.id === btn.dataset.preset);
      if (!p || btn.classList.contains('installing')) return;
      btn.classList.add('installing');
      btn.textContent = 'APPLYING...';
      await applyDns(p.servers, p.name);
      btn.textContent = 'APPLY';
      btn.classList.remove('installing');
    });
  });

  const customBtn = document.getElementById('btn-dns-custom');
  if (customBtn) customBtn.addEventListener('click', async () => {
    const s1 = (document.getElementById('dns-custom-1').value || '').trim();
    const s2 = (document.getElementById('dns-custom-2').value || '').trim();
    if (!s1) { logToConsole(`[${new Date().toLocaleTimeString()}] Enter a primary DNS address first`); return; }
    customBtn.classList.add('installing');
    customBtn.textContent = 'APPLYING...';
    await applyDns([s1, s2].filter(Boolean), 'CUSTOM DNS');
    customBtn.textContent = 'APPLY';
    customBtn.classList.remove('installing');
  });

  const dhcpBtn = document.getElementById('btn-dns-dhcp');
  if (dhcpBtn) dhcpBtn.addEventListener('click', async () => {
    if (!dnsSelectedAdapter || dhcpBtn.classList.contains('installing')) return;
    dhcpBtn.classList.add('installing');
    dhcpBtn.textContent = 'RESETTING...';
    try {
      await ipcRenderer.invoke('dns-reset-dhcp', { adapter: dnsSelectedAdapter });
      logToConsole(`[${new Date().toLocaleTimeString()}] DHCP DNS restored.`);
    } catch (e) {
      logToConsole(`[${new Date().toLocaleTimeString()}] ERROR: ${e.message || e}`);
    }
    dhcpBtn.textContent = 'RESET TO DHCP';
    dhcpBtn.classList.remove('installing');
    await refreshAdapters();
  });

  const flushBtn = document.getElementById('btn-dns-flush');
  if (flushBtn) flushBtn.addEventListener('click', async () => {
    if (flushBtn.classList.contains('installing')) return;
    flushBtn.classList.add('installing');
    flushBtn.textContent = 'FLUSHING...';
    try {
      await ipcRenderer.invoke('dns-flush');
      logToConsole(`[${new Date().toLocaleTimeString()}] DNS cache flushed.`);
    } catch (e) {
      logToConsole(`[${new Date().toLocaleTimeString()}] ERROR: ${e.message || e}`);
    }
    flushBtn.textContent = 'FLUSH';
    flushBtn.classList.remove('installing');
  });

  refreshAdapters();
}

// ---------- BACKGROUND MONITOR PAGE ----------

const BG_PROTECTED_UI = new Set(['system', 'idle', 'registry', 'memory compression', 'secure system', 'smss', 'csrss', 'wininit', 'winlogon', 'services', 'lsass', 'fontdrvhost', 'dwm', 'svchost', 'audiodg', 'wudfhost']);

function renderBackgroundMonitor() {
  let html = `<div class="section-title">BACKGROUND MONITOR</div>`;
  if (!state.isAdmin) {
    html += `<div class="admin-warn">[!] BLOCKING REQUIRES ADMIN — KILLING WORKS FOR YOUR OWN PROCESSES ONLY</div>`;
  }
  html += `<div class="applist-status">TOP PROCESSES BY MEMORY. KILL TERMINATES THE PROCESS; BLOCK PREVENTS FUTURE LAUNCHES (REVERSIBLE VIA UNBLOCK).</div>`;
  html += `<div class="tweak-row"><div class="tweak-info"><div class="tweak-name">AUTO REFRESH (5S)</div><div class="tweak-desc">Only refreshes while this page is visible. Default off for low-end PCs.</div></div><div class="tweak-toggle" id="bg-auto"></div><span class="tweak-status" id="bg-auto-status">OFF</span></div>`;
  html += `<div class="tweak-row"><div class="tweak-info"><div class="tweak-name">MANUAL REFRESH</div><div class="tweak-desc">Re-reads the process list and the block list.</div></div><button class="app-install-btn" id="btn-bg-refresh">REFRESH</button></div>`;
  html += `<div class="applist-count" id="bg-count">NOT SCANNED YET</div>`;
  html += `<div id="bg-proc-list"><div class="applist-status">PRESS REFRESH TO LIST PROCESSES.</div></div>`;
  html += `<div class="settings-grid" style="margin-top:16px"><div class="settings-card"><div class="settings-card-title">BLOCKED APPLICATIONS</div><div id="bg-blocked-list"><div class="applist-status">LOADING...</div></div></div></div>`;
  html += pageConsoleHTML();
  content.innerHTML = html;
  bindConsoleClear();

  const autoToggle = document.getElementById('bg-auto');
  const autoStatus = document.getElementById('bg-auto-status');

  async function bgRefreshProcs() {
    const box = document.getElementById('bg-proc-list');
    const count = document.getElementById('bg-count');
    if (!box) return;
    let res;
    try { res = await ipcRenderer.invoke('bg-list-processes'); } catch (e) { res = { ok: false, error: e.message || e }; }
    if (!res || !res.ok) {
      box.innerHTML = `<div class="applist-status">FAILED TO LIST PROCESSES: ${(res && res.error) || 'unknown'}</div>`;
      return;
    }
    const procs = res.procs || [];

    if (count) count.textContent = `${procs.length} PROCESSES (TOP BY MEMORY)`;
    box.innerHTML = procs.map(p => {
      const bare = String(p.name).toLowerCase().replace(/\.exe$/, '');
      const isProt = BG_PROTECTED_UI.has(bare);
      const mem = p.mem >= 1024 ? (p.mem / 1024).toFixed(2) + ' GB' : p.mem + ' MB';
      const actions = isProt
        ? '<span class="tweak-status" title="Protected system process">SYSTEM</span>'
        : `<button class="app-install-btn" data-kill-pid="${p.pid}" data-kill-name="${p.name}">KILL</button><button class="app-install-btn" data-block-name="${p.name}">BLOCK</button>`;
      return `<div class="tweak-row"><div class="tweak-info"><div class="tweak-name">${p.name}</div><div class="tweak-desc">PID ${p.pid} | MEM ${mem}</div></div><div style="display:flex;gap:6px;align-items:center">${actions}</div></div>`;
    }).join('');
  }

  async function bgRefreshBlocked() {
    const box = document.getElementById('bg-blocked-list');
    if (!box) return;
    let list;
    try { list = await ipcRenderer.invoke('bg-blocked-list'); } catch (e) { list = null; }
    if (!Array.isArray(list) || !list.length) {
      box.innerHTML = `<div class="applist-status">NO BLOCKED APPLICATIONS</div>`;
      return;
    }
    box.innerHTML = list.map(b => `<div class="tweak-row"><div class="tweak-info"><div class="tweak-name">${b.exe}</div><div class="tweak-desc">BLOCKED ${b.blockedAt ? new Date(b.blockedAt).toLocaleString() : ''}${b.hadDebugger ? ' | PREVIOUS DEBUGGER VALUE SAVED' : ''}</div></div><button class="app-install-btn" data-unblock="${b.exe}">UNBLOCK</button></div>`).join('');
    box.querySelectorAll('button[data-unblock]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (btn.classList.contains('installing')) return;
        btn.classList.add('installing');
        btn.textContent = 'UNBLOCKING...';
        try {
          await ipcRenderer.invoke('bg-unblock-process', { name: btn.dataset.unblock });
          logToConsole(`[${new Date().toLocaleTimeString()}] ${btn.dataset.unblock} unblocked`);
          await bgRefreshBlocked();
        } catch (e) {
          btn.textContent = 'FAILED';
          btn.classList.remove('installing');
          logToConsole(`[${new Date().toLocaleTimeString()}] ERROR: ${e.message || e}`);
        }
      });
    });
  }

  async function bgFullRefresh() {
    await bgRefreshProcs();
    await bgRefreshBlocked();
  }

  const refreshBtn = document.getElementById('btn-bg-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', bgFullRefresh);

  if (autoToggle) {
    autoToggle.addEventListener('click', () => {
      const on = autoToggle.classList.toggle('active');
      if (autoStatus) { autoStatus.textContent = on ? 'ON' : 'OFF'; autoStatus.className = `tweak-status ${on ? 'ok' : ''}`; }
      clearPoll();
      if (on) pollInterval = setInterval(() => { if (document.visibilityState === 'visible') bgFullRefresh(); }, 5000);
    });
  }

  const procList = document.getElementById('bg-proc-list');
  if (procList) {
    procList.addEventListener('click', async (e) => {
      const killBtn = e.target.closest('button[data-kill-pid]');
      if (killBtn) {
        if (killBtn.classList.contains('installing')) return;
        killBtn.classList.add('installing');
        killBtn.textContent = 'KILLING...';
        try {
          const r = await ipcRenderer.invoke('bg-kill-process', { pid: Number(killBtn.dataset.killPid), name: killBtn.dataset.killName });
          logToConsole(`[${new Date().toLocaleTimeString()}] ${killBtn.dataset.killName}: ${r === 'ALREADY_GONE' ? 'already exited' : 'terminated'}`);
          await bgRefreshProcs();
        } catch (err) {
          killBtn.textContent = 'FAILED';
          killBtn.classList.remove('installing');
          logToConsole(`[${new Date().toLocaleTimeString()}] ERROR: ${err.message || err}`);
        }
        return;
      }
      const blockBtn = e.target.closest('button[data-block-name]');
      if (blockBtn) {
        if (blockBtn.classList.contains('installing')) return;
        if (blockBtn.dataset.confirm !== '1') {
          blockBtn.dataset.confirm = '1';
          blockBtn.textContent = 'CONFIRM?';
          setTimeout(() => { if (blockBtn.dataset.confirm === '1') { blockBtn.dataset.confirm = ''; blockBtn.textContent = 'BLOCK'; } }, 3000);
          return;
        }
        blockBtn.dataset.confirm = '';
        blockBtn.classList.add('installing');
        blockBtn.textContent = 'BLOCKING...';
        try {
          await ipcRenderer.invoke('bg-block-process', { name: blockBtn.dataset.blockName });
          logToConsole(`[${new Date().toLocaleTimeString()}] ${blockBtn.dataset.blockName} blocked (reversible via UNBLOCK)`);
          await bgFullRefresh();
        } catch (err) {
          blockBtn.textContent = 'FAILED';
          blockBtn.classList.remove('installing');
          logToConsole(`[${new Date().toLocaleTimeString()}] ERROR: ${err.message || err}`);
        }
      }
    });
  }

  bgFullRefresh();
}

// ---------- ADVANCED POWER CONFIGURATOR ----------
// NOTE: Atom Optimizer build only (see DNS OPTIMIZER note above).

// Featured settings (rows auto-hide when a setting is absent on this machine/build).
const APC_FEATURED = [
  { title: 'CPU & PROCESSOR', items: [
    { sg: '54533251-82be-4824-96c1-47b60b740d00', set: '893dee8e-2bef-41e0-89c6-b55d0929964c' },
    { sg: '54533251-82be-4824-96c1-47b60b740d00', set: 'bc5038f7-23e0-4960-96da-33abaf5935ec' },
    { sg: '54533251-82be-4824-96c1-47b60b740d00', set: 'be337238-0d82-4146-a960-4f3749d470c7' },
    { sg: '54533251-82be-4824-96c1-47b60b740d00', set: '94d3a615-a899-4ac5-ae2b-e4d8f634367f' },
  ]},
  { title: 'PCIE & GPU', items: [
    { sg: '501a4d13-42af-4429-9fd1-a8218c268e20', set: 'ee12f906-d277-404b-b6da-e5fa1a576df5' },
  ]},
  { title: 'DISKS & STORAGE', items: [
    { sg: '0012ee47-9041-4b5d-9b77-535fba8b1442', set: '6738e2c4-e8a5-4a42-b16a-e040e769756e' },
    { sg: '0012ee47-9041-4b5d-9b77-535fba8b1442', set: '0b2d69d7-a2a1-449c-9680-f91c70521c60' },
    { sg: '0012ee47-9041-4b5d-9b77-535fba8b1442', set: 'dab60367-53fe-4fbc-825e-521d069d2456' },
  ]},
  { title: 'SYSTEM & USB', items: [
    { sg: '2a737441-1930-4402-8d77-b2bebba308a3', set: '48e6b7a6-50f5-4782-a5d4-53bb8f07e226' },
  ]},
  { title: 'IDLE RESILIENCY', items: [
    { sg: '2e601130-5351-4d9d-8e04-252966bad054', set: 'c42b79aa-aa3a-484b-a98f-2cf32aa90a28' },
    { sg: '2e601130-5351-4d9d-8e04-252966bad054', set: '3166bc41-7e98-4e03-b34e-ec0f5f2b218e' },
  ]},
  { title: 'INTERRUPT STEERING', items: [
    { sg: '48672f38-7a9a-4bb2-8bf8-3d85be19de4e', set: '2bfc24f9-5ea2-4801-8213-3dbae01aa39d' },
  ]},
];

function apcEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderAdvancedPower() {
  let html = `<div class="section-title">ADVANCED POWER CONFIGURATOR <span class="tweak-count" id="apc-total">LOADING...</span></div>`;
  if (!state.isAdmin) {
    html += `<div class="admin-warn">[!] CHANGING POWER SETTINGS REQUIRES ADMIN — RUN APP AS ADMINISTRATOR (READING WORKS WITHOUT ADMIN)</div>`;
  }
  html += `<div class="applist-status">FULL CONTROL OF THE ACTIVE POWER SCHEME, INCLUDING HIDDEN SETTINGS. EACH CONTROL WRITES BOTH AC AND DC. EVERY CHANGE IS RECORDED IN HISTORY WITH UNDO.</div>`;
  html += `<div class="tweak-row"><div class="tweak-info"><div class="tweak-name">HIDDEN SETTINGS — WINDOWS CONTROL PANEL VISIBILITY</div><div class="tweak-desc">UNLOCK makes normally hidden settings visible in Windows' own Advanced Power Options. RE-HIDE restores the default. This app reads and writes hidden settings regardless — this only changes Control Panel.</div></div><div style="display:flex;gap:6px;align-items:center"><button class="app-install-btn" id="apc-unlock">UNLOCK</button><button class="app-install-btn" id="apc-rehide">RE-HIDE</button><span class="tweak-status" id="apc-unlock-status"></span></div></div>`;
  html += `<div class="applist-search"><input type="text" class="applist-input" id="apc-filter" placeholder="FILTER SETTINGS..."></div>`;
  html += `<div id="apc-main"><div id="apc-featured"><div class="applist-status">READING ACTIVE POWER SCHEME...</div></div><div id="apc-all"></div></div>`;
  html += pageConsoleHTML();
  content.innerHTML = html;
  bindConsoleClear();

  const featuredBox = document.getElementById('apc-featured');
  const allBox = document.getElementById('apc-all');
  const mainBox = document.getElementById('apc-main');
  const totalEl = document.getElementById('apc-total');
  const filterEl = document.getElementById('apc-filter');
  const unlockStatus = document.getElementById('apc-unlock-status');

  let settingsByKey = {};
  let sgNames = {};
  let model = null;

  function key(sg, st) { return sg + '|' + st; }

  function valName(st, i) {
    if (i === null || i === undefined) return '--';
    const v = (st.values || []).find(x => x.index === i);
    return v ? v.name : String(i);
  }

  function controlHTML(sgGuid, st) {
    const k = key(sgGuid, st.guid);
    const vals = st.values || [];
    if (vals.length > 2) {
      const btns = vals.map(v => `<button class="applist-tab${(st.ac === v.index && st.dc === v.index) ? ' active' : ''}" data-apc-set="${k}" data-apc-val="${v.index}">${apcEsc(v.name)}</button>`).join('');
      return `<div class="applist-tabs" style="flex-wrap:wrap;justify-content:flex-end;margin:0">${btns}</div>`;
    }
    if (vals.length === 2 && vals.some(v => v.index === 0) && vals.some(v => v.index === 1)) {
      const on = st.ac === 1 && st.dc === 1;
      return `<div class="tweak-toggle${on ? ' active' : ''}" data-apc-toggle="${k}" title="Toggle ON/OFF"></div><span class="tweak-status">${apcEsc(valName(st, st.ac))} / ${apcEsc(valName(st, st.dc))}</span>`;
    }
    return `<input class="applist-input" style="width:110px" inputmode="numeric" value="${st.ac != null ? st.ac : ''}" data-apc-input="${k}"><button class="app-install-btn" data-apc-apply="${k}">APPLY</button>`;
  }

  function rowHTML(sgGuid, st) {
    const k = key(sgGuid, st.guid);
    const range = (st.min != null && st.max != null) ? ` | RANGE ${st.min}-${st.max}${st.units ? ' ' + st.units : ''}` : (st.units ? ` | ${st.units}` : '');
    const hiddenTag = st.hidden ? ' | HIDDEN' : '';
    const alias = st.alias ? ` (${st.alias})` : '';
    return `<div class="tweak-row" data-apc-row="${k}"><div class="tweak-info"><div class="tweak-name">${apcEsc(st.name)}</div><div class="tweak-desc">${apcEsc((sgNames[sgGuid] || '') + alias)} | AC: ${apcEsc(valName(st, st.ac))} | DC: ${apcEsc(valName(st, st.dc))}${apcEsc(range)}${hiddenTag}</div></div><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end;margin-left:auto">${controlHTML(sgGuid, st)}</div></div>`;
  }

  function refreshRow(sgGuid, st) {
    const el = mainBox.querySelector(`[data-apc-row="${key(sgGuid, st.guid)}"]`);
    if (!el) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = rowHTML(sgGuid, st);
    el.replaceWith(tmp.firstElementChild);
  }

  function renderFeatured() {
    let out = '';
    for (const cat of APC_FEATURED) {
      const rows = cat.items.map(it => {
        const st = settingsByKey[key(it.sg, it.set)];
        return st ? rowHTML(it.sg, st) : '';
      }).filter(Boolean);
      if (!rows.length) continue;
      out += `<div class="section-title" style="margin:16px 0 8px">${apcEsc(cat.title)}</div>` + rows.join('');
    }
    featuredBox.innerHTML = out;
  }

  function renderFilter(q) {
    if (!model) return;
    q = q.trim().toLowerCase();
    if (!q) { featuredBox.style.display = ''; allBox.innerHTML = ''; return; }
    featuredBox.style.display = 'none';
    const matches = [];
    for (const sg of model.subgroups) for (const st of sg.settings) {
      const hay = (st.name + ' ' + (st.alias || '') + ' ' + sg.name).toLowerCase();
      if (hay.includes(q)) matches.push({ sg, st });
    }
    if (!matches.length) {
      allBox.innerHTML = `<div class="applist-status">NO SETTINGS MATCH "${apcEsc(q.toUpperCase())}"</div>`;
      return;
    }
    const LIMIT = 100;
    const shown = matches.slice(0, LIMIT);
    allBox.innerHTML = `<div class="applist-count">${matches.length} MATCH${matches.length === 1 ? '' : 'ES'}${matches.length > LIMIT ? ' — SHOWING FIRST ' + LIMIT : ''}</div>` + shown.map(m => rowHTML(m.sg.guid, m.st)).join('');
  }

  async function load() {
    let res;
    try { res = await ipcRenderer.invoke('advpower-list'); }
    catch (e) { featuredBox.innerHTML = `<div class="applist-status">FAILED: ${apcEsc(e.message || e)}</div>`; return; }
    if (!res || !res.ok) { featuredBox.innerHTML = `<div class="applist-status">FAILED TO READ POWER SCHEME: ${apcEsc((res && res.error) || 'unknown error')}</div>`; return; }
    model = res;
    settingsByKey = {};
    sgNames = {};
    for (const sg of model.subgroups) {
      sgNames[sg.guid] = sg.name;
      for (const st of sg.settings) settingsByKey[key(sg.guid, st.guid)] = st;
    }
    if (totalEl) totalEl.textContent = res.settingsCount + ' SETTINGS';
    renderFeatured();
    featuredBox.style.display = '';
    allBox.innerHTML = '';
    logToConsole(`[${new Date().toLocaleTimeString()}] Power scheme loaded: ${res.settingsCount} settings in ${res.subgroups.length} groups (${res.hiddenCount} hidden)`);
  }

  async function applyFromEl(el, value) {
    const k = el.dataset.apcSet || el.dataset.apcToggle || el.dataset.apcApply;
    const st = settingsByKey[k];
    if (!st || !model) return;
    if (el.classList.contains('installing') || el.classList.contains('executing')) return;
    const sgGuid = k.split('|')[0];
    const isToggle = el.classList.contains('tweak-toggle');
    el.classList.add(isToggle ? 'executing' : 'installing');
    const prevText = el.tagName === 'BUTTON' ? el.textContent : null;
    if (prevText !== null) el.textContent = '...';
    const before = { ac: st.ac, dc: st.dc };
    logToConsole(`[${new Date().toLocaleTimeString()}] ${st.name}: setting to ${value} (AC + DC)...`);
    try {
      const r = await ipcRenderer.invoke('advpower-set', { subgroup: sgGuid, setting: st.guid, ac: value, dc: value, min: st.min, max: st.max, name: st.name });
      if (!r || !r.ok) throw new Error((r && r.error) || 'powercfg rejected the change');
      st.ac = (r.ac != null) ? r.ac : value;
      st.dc = (r.dc != null) ? r.dc : value;
      refreshRow(sgGuid, st);
      logToConsole(`[${new Date().toLocaleTimeString()}] ${st.name}: OK — verified AC=${st.ac} DC=${st.dc} (undo in HISTORY)`);
      const restoreAc = before.ac != null ? before.ac : 0;
      const restoreDc = before.dc != null ? before.dc : restoreAc;
      addHistoryEntry({
        id: 'advpower:' + sgGuid + ':' + st.guid,
        name: `${st.name} (${sgNames[sgGuid] || ''})`,
        config: 'advpower',
        applied: true,
        script_on: null,
        script_off: null,
        command: `powercfg /setacvalueindex SCHEME_CURRENT ${sgGuid} ${st.guid} ${restoreAc} && powercfg /setdcvalueindex SCHEME_CURRENT ${sgGuid} ${st.guid} ${restoreDc} && powercfg /setactive SCHEME_CURRENT`,
        check: null
      });
    } catch (err) {
      const msg = (err && err.message) || String(err);
      logToConsole(`[${new Date().toLocaleTimeString()}] ${st.name}: ERROR - ${msg}`);
      if (prevText !== null) el.textContent = msg.includes('ADMIN_REQUIRED') ? 'ADMIN' : 'FAILED';
      setTimeout(() => refreshRow(sgGuid, st), 2500);
    } finally {
      el.classList.remove('installing');
      el.classList.remove('executing');
    }
  }

  async function handleClick(e) {
    const seg = e.target.closest('button[data-apc-set]');
    if (seg) { await applyFromEl(seg, Number(seg.dataset.apcVal)); return; }
    const tog = e.target.closest('.tweak-toggle[data-apc-toggle]');
    if (tog) { await applyFromEl(tog, tog.classList.contains('active') ? 0 : 1); return; }
    const app = e.target.closest('button[data-apc-apply]');
    if (app) {
      const k = app.dataset.apcApply;
      const inp = mainBox.querySelector(`input[data-apc-input="${k}"]`);
      const st = settingsByKey[k];
      if (!inp || !st) return;
      let v = parseInt(String(inp.value).trim(), 10);
      if (!Number.isFinite(v)) { logToConsole(`[${new Date().toLocaleTimeString()}] ${st.name}: ERROR - enter a whole number`); return; }
      if (st.min != null && v < st.min) v = st.min;
      if (st.max != null && v > st.max) v = st.max;
      await applyFromEl(app, v);
      return;
    }
  }

  async function unlockRun(mode, btn) {
    if (btn.classList.contains('installing')) return;
    btn.classList.add('installing');
    const prev = btn.textContent;
    btn.textContent = '...';
    if (unlockStatus) { unlockStatus.textContent = ''; unlockStatus.className = 'tweak-status'; }
    logToConsole(`[${new Date().toLocaleTimeString()}] ${mode === 'hide' ? 'Re-hiding' : 'Unhiding'} power settings (Windows Control Panel visibility)...`);
    try {
      const r = await ipcRenderer.invoke('advpower-unlock', { mode });
      if (!r || !r.ok) throw new Error((r && r.error) || 'operation failed');
      const msg = mode === 'hide' ? ('RE-HIDDEN ' + r.count) : (r.count ? ('UNLOCKED ' + r.count) : 'ALREADY VISIBLE');
      if (unlockStatus) { unlockStatus.textContent = msg; unlockStatus.className = 'tweak-status ok'; }
      logToConsole(`[${new Date().toLocaleTimeString()}] ${mode === 'hide' ? 'Re-hide' : 'Unlock'} complete: ${r.count}/${r.total} settings.`);
      btn.textContent = 'DONE';
    } catch (err) {
      const msg = (err && err.message) || String(err);
      if (unlockStatus) { unlockStatus.textContent = 'FAILED'; unlockStatus.className = 'tweak-status fail'; }
      logToConsole(`[${new Date().toLocaleTimeString()}] ERROR: ${msg}`);
      btn.textContent = 'FAILED';
    }
    setTimeout(() => { btn.textContent = prev; btn.classList.remove('installing'); }, 3000);
  }

  mainBox.addEventListener('click', handleClick);
  filterEl.addEventListener('input', debounce(() => renderFilter(filterEl.value), 150));
  const unlockBtn = document.getElementById('apc-unlock');
  const rehideBtn = document.getElementById('apc-rehide');
  if (unlockBtn) unlockBtn.addEventListener('click', () => unlockRun('show', unlockBtn));
  if (rehideBtn) rehideBtn.addEventListener('click', () => unlockRun('hide', rehideBtn));

  load();
}

// ---------- DRIVER HUB PAGE (read-only) ----------
// NOTE: Atom Optimizer build only (see DNS OPTIMIZER note above).

const DRIVER_ERR_MEANINGS = {
  1: 'Device not configured correctly',
  3: 'Driver may be corrupted',
  10: 'Device cannot start',
  12: 'Not enough resources available',
  18: 'Reinstall the drivers',
  19: 'Registry entry corrupted',
  21: 'Windows is removing the device',
  22: 'Device is disabled',
  24: 'Device not present or not working',
  28: 'Drivers are not installed',
  31: 'Windows cannot load the drivers',
  43: 'Windows stopped the device (error reported)',
  45: 'Device is not connected'
};

let driverScanCache = null;

function renderDriverHub() {
  let html = `<div class="section-title">DRIVER HUB <span class="tweak-count">READ-ONLY</span></div>`;
  if (!state.isAdmin) {
    html += `<div class="admin-warn">[!] DRIVER ENUMERATION MAY REQUIRE ADMIN — RUN APP AS ADMINISTRATOR IF SCAN FAILS</div>`;
  }
  html += `<div class="applist-status">INSPECT INSTALLED DRIVER PACKAGES AND DEVICES WITH PROBLEMS. THIS PAGE NEVER MODIFIES DRIVERS.</div>`;
  html += `<div class="tweak-row"><div class="tweak-info"><div class="tweak-name">DRIVER SCAN</div><div class="tweak-desc">Enumerates driver packages (pnputil) and problem devices (PnP status).</div></div><button class="app-install-btn" id="btn-driver-scan">SCAN</button></div>`;
  html += `<div class="applist-tabs"><button class="applist-tab active" data-tab="drivers">DRIVER PACKAGES</button><button class="applist-tab" data-tab="problems">PROBLEM DEVICES</button></div>`;
  html += `<div class="applist-search"><input class="applist-input" id="driver-filter" placeholder="FILTER BY NAME / PROVIDER / CLASS..."></div>`;
  html += `<div class="applist-count" id="driver-count">NOT SCANNED YET</div>`;
  html += `<div id="driver-rows"><div class="applist-status">PRESS SCAN TO ENUMERATE DRIVERS.</div></div>`;
  html += pageConsoleHTML();
  content.innerHTML = html;
  bindConsoleClear();

  let activeTab = 'drivers';
  let filter = '';

  function renderDriverRows() {
    const box = document.getElementById('driver-rows');
    const countEl = document.getElementById('driver-count');
    if (!box || !driverScanCache) return;
    const f = filter.toLowerCase();
    if (activeTab === 'drivers') {
      const list = driverScanCache.drivers.filter(d =>
        !f || `${d.published} ${d.original} ${d.provider} ${d.class}`.toLowerCase().includes(f));
      if (countEl) countEl.textContent = `${list.length} DRIVER PACKAGES${filter ? ' (FILTERED)' : ''}`;
      box.innerHTML = list.length
        ? list.map(d => `<div class="applist-row"><div class="applist-info"><div class="applist-name">${d.published}</div><div class="applist-meta">${d.original} | ${d.provider} | CLASS ${d.class} | v${d.version}</div></div></div>`).join('')
        : `<div class="applist-status">NO DRIVERS MATCH THE FILTER</div>`;
    } else {
      const list = driverScanCache.problems.filter(p =>
        !f || `${p.Name} ${p.DeviceID} ${p.ConfigManagerErrorCode}`.toLowerCase().includes(f));
      if (countEl) countEl.textContent = `${list.length} PROBLEM DEVICES${filter ? ' (FILTERED)' : ''}`;
      box.innerHTML = list.length
        ? list.map(p => {
            const meaning = DRIVER_ERR_MEANINGS[p.ConfigManagerErrorCode] || 'Unknown error state';
            return `<div class="applist-row"><div class="applist-info"><div class="applist-name">${p.Name || 'UNKNOWN DEVICE'}</div><div class="applist-meta">CODE ${p.ConfigManagerErrorCode} — ${meaning}<br>${p.DeviceID}</div></div></div>`;
          }).join('')
        : `<div class="applist-status">NO PROBLEM DEVICES DETECTED</div>`;
    }
  }

  content.querySelectorAll('.applist-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      content.querySelectorAll('.applist-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeTab = tab.dataset.tab;
      renderDriverRows();
    });
  });

  const filterInput = document.getElementById('driver-filter');
  if (filterInput) filterInput.addEventListener('input', () => { filter = filterInput.value.trim(); renderDriverRows(); });

  const scanBtn = document.getElementById('btn-driver-scan');
  if (scanBtn) scanBtn.addEventListener('click', async () => {
    if (scanBtn.classList.contains('installing')) return;
    scanBtn.classList.add('installing');
    scanBtn.textContent = 'SCANNING...';
    logToConsole(`[${new Date().toLocaleTimeString()}] Enumerating drivers...`);
    let res;
    try { res = await ipcRenderer.invoke('driver-scan'); } catch (e) { res = { ok: false, error: e.message || e }; }
    if (!res || !res.ok) {
      logToConsole(`[${new Date().toLocaleTimeString()}] SCAN FAILED: ${(res && res.error) || 'unknown'}`);
      const box = document.getElementById('driver-rows');
      if (box) box.innerHTML = `<div class="applist-status">SCAN FAILED: ${(res && res.error) || 'unknown'} — TRY RUNNING AS ADMINISTRATOR</div>`;
    } else {
      driverScanCache = { drivers: res.drivers || [], problems: res.problems || [] };
      logToConsole(`[${new Date().toLocaleTimeString()}] Scan complete: ${driverScanCache.drivers.length} driver packages, ${driverScanCache.problems.length} problem devices`);
      renderDriverRows();
    }
    scanBtn.textContent = 'SCAN';
    scanBtn.classList.remove('installing');
  });
}

// ---------- BACKUP & RESTORE PAGE ----------

function parseWmiDate(s) {
  if (!s) return 'unknown';
  const m = String(s).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!m) return String(s);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])).toLocaleString();
}

function renderBackupRestore() {
  let html = `<div class="section-title">BACKUP &amp; RESTORE</div>`;
  if (!state.isAdmin) {
    html += `<div class="admin-warn">[!] CREATING RESTORE POINTS AND REGISTRY BACKUPS REQUIRES ADMIN — RUN APP AS ADMINISTRATOR</div>`;
  }
  html += `<div class="applist-status">CREATE SYSTEM RESTORE POINTS AND EXPORT TWEAK-RELATED REGISTRY BRANCHES BEFORE MAKING BIG CHANGES.</div>`;
  html += `<div class="settings-grid"><div class="settings-card"><div class="settings-card-title">SYSTEM RESTORE POINTS</div>`;
  html += `<div class="settings-row"><div class="settings-row-info"><div class="settings-row-name">CREATE RESTORE POINT</div><div class="settings-row-desc">Creates an "AtomToolBox" checkpoint (temporarily bypasses the 24h creation limit).</div></div><button class="app-install-btn" id="btn-rp-create">CREATE</button></div>`;
  html += `<div class="settings-row"><div class="settings-row-info"><div class="settings-row-name">EXISTING POINTS</div><div class="settings-row-desc">Most recent first. Open System Restore to roll back.</div></div><button class="app-install-btn" id="btn-rp-refresh">REFRESH</button><button class="app-install-btn" id="btn-rp-open">OPEN SYSTEM RESTORE</button></div>`;
  html += `<div id="rp-list"><div class="applist-status">PRESS REFRESH TO LIST RESTORE POINTS.</div></div></div>`;
  html += `<div class="settings-card"><div class="settings-card-title">REGISTRY BACKUP</div>`;
  html += `<div class="settings-row"><div class="settings-row-info"><div class="settings-row-name">CREATE BACKUP</div><div class="settings-row-desc">Exports tweak-related branches: policies, power schemes, multimedia, explorer, control panel.</div></div><button class="app-install-btn" id="btn-reg-backup">BACKUP NOW</button></div>`;
  html += `<div class="settings-row"><div class="settings-row-info"><div class="settings-row-name">BACKUP FOLDER</div><div class="settings-row-desc" id="reg-dir-label">--</div></div><button class="app-install-btn" id="btn-reg-refresh">REFRESH</button><button class="app-install-btn" id="btn-reg-open">OPEN FOLDER</button></div>`;
  html += `<div id="reg-list"><div class="applist-status">PRESS REFRESH TO LIST BACKUPS.</div></div></div></div>`;
  html += pageConsoleHTML();
  content.innerHTML = html;
  bindConsoleClear();

  let lastBackupDir = null;

  async function refreshRestorePoints() {
    const box = document.getElementById('rp-list');
    if (!box) return;
    box.innerHTML = `<div class="applist-status">LOADING RESTORE POINTS...</div>`;
    let res;
    try { res = await ipcRenderer.invoke('restorepoint-list'); } catch (e) { res = { ok: false, error: e.message || e }; }
    if (!res || !res.ok) {
      box.innerHTML = `<div class="applist-status">FAILED TO LIST RESTORE POINTS: ${(res && res.error) || 'unknown'}</div>`;
      return;
    }
    const points = (res.points || []).sort((a, b) => (b.SequenceNumber || 0) - (a.SequenceNumber || 0));
    box.innerHTML = points.length
      ? points.map(p => `<div class="applist-row"><div class="applist-info"><div class="applist-name">#${p.SequenceNumber} — ${p.Description || 'Restore point'}</div><div class="applist-meta">${parseWmiDate(p.CreationTime)}</div></div></div>`).join('')
      : `<div class="applist-status">NO RESTORE POINTS FOUND</div>`;
  }

  async function refreshBackups() {
    const box = document.getElementById('reg-list');
    if (!box) return;
    box.innerHTML = `<div class="applist-status">LOADING BACKUPS...</div>`;
    let res;
    try { res = await ipcRenderer.invoke('backup-list'); } catch (e) { res = null; }
    if (!res) {
      box.innerHTML = `<div class="applist-status">FAILED TO LIST BACKUPS</div>`;
      return;
    }
    lastBackupDir = res.dir || null;
    const label = document.getElementById('reg-dir-label');
    if (label) label.textContent = res.dir || '--';
    const backups = res.backups || [];
    box.innerHTML = backups.length
      ? backups.map(b => `<div class="applist-row"><div class="applist-info"><div class="applist-name">${b.name}</div><div class="applist-meta">${formatBytes(b.size)} | ${b.time ? new Date(b.time).toLocaleString() : ''}</div></div><button class="app-install-btn" data-restore="${b.name}">RESTORE</button></div>`).join('')
      : `<div class="applist-status">NO REGISTRY BACKUPS YET</div>`;
    box.querySelectorAll('button[data-restore]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (btn.classList.contains('installing')) return;
        if (btn.dataset.confirm !== '1') {
          btn.dataset.confirm = '1';
          btn.textContent = 'CONFIRM?';
          setTimeout(() => { if (btn.dataset.confirm === '1') { btn.dataset.confirm = ''; btn.textContent = 'RESTORE'; } }, 3000);
          return;
        }
        btn.dataset.confirm = '';
        btn.classList.add('installing');
        btn.textContent = 'RESTORING...';
        try {
          await ipcRenderer.invoke('backup-restore', { file: btn.dataset.restore });
          logToConsole(`[${new Date().toLocaleTimeString()}] Registry backup restored: ${btn.dataset.restore}`);
        } catch (e) {
          logToConsole(`[${new Date().toLocaleTimeString()}] ERROR: ${e.message || e}`);
        }
        btn.textContent = 'RESTORE';
        btn.classList.remove('installing');
      });
    });
  }

  const createBtn = document.getElementById('btn-rp-create');
  if (createBtn) createBtn.addEventListener('click', async () => {
    if (createBtn.classList.contains('installing')) return;
    createBtn.classList.add('installing');
    createBtn.textContent = 'CREATING...';
    try {
      await ipcRenderer.invoke('restorepoint-create');
      logToConsole(`[${new Date().toLocaleTimeString()}] Restore point created.`);
      await refreshRestorePoints();
    } catch (e) {
      logToConsole(`[${new Date().toLocaleTimeString()}] ERROR: ${e.message || e}`);
    }
    createBtn.textContent = 'CREATE';
    createBtn.classList.remove('installing');
  });

  const rpRefresh = document.getElementById('btn-rp-refresh');
  if (rpRefresh) rpRefresh.addEventListener('click', refreshRestorePoints);
  const rpOpen = document.getElementById('btn-rp-open');
  if (rpOpen) rpOpen.addEventListener('click', () => ipcRenderer.invoke('open-shortcut', { command: 'rstrui' }));

  const regBackupBtn = document.getElementById('btn-reg-backup');
  if (regBackupBtn) regBackupBtn.addEventListener('click', async () => {
    if (regBackupBtn.classList.contains('installing')) return;
    regBackupBtn.classList.add('installing');
    regBackupBtn.textContent = 'BACKING UP...';
    try {
      const res = await ipcRenderer.invoke('backup-registry');
      const ok = res && res.files ? res.files.filter(f => f.ok).length : 0;
      logToConsole(`[${new Date().toLocaleTimeString()}] Registry backup finished (${ok} branch(es) exported).`);
      await refreshBackups();
    } catch (e) {
      logToConsole(`[${new Date().toLocaleTimeString()}] ERROR: ${e.message || e}`);
    }
    regBackupBtn.textContent = 'BACKUP NOW';
    regBackupBtn.classList.remove('installing');
  });

  const regRefresh = document.getElementById('btn-reg-refresh');
  if (regRefresh) regRefresh.addEventListener('click', refreshBackups);
  const regOpen = document.getElementById('btn-reg-open');
  if (regOpen) regOpen.addEventListener('click', async () => {
    try {
      const res = lastBackupDir ? { dir: lastBackupDir } : await ipcRenderer.invoke('backup-list');
      if (res && res.dir) await ipcRenderer.invoke('open-path', res.dir);
    } catch (e) {
      logToConsole(`[${new Date().toLocaleTimeString()}] ERROR: ${e.message || e}`);
    }
  });

  refreshRestorePoints();
  refreshBackups();
}

// Restore saved theme (the <head> script already applied it pre-paint; this
// re-applies it to sync the logo + native window background, and normalizes
// any stale value back to the deep-gray default)
applyTheme(localStorage.getItem('atom-theme'));

document.getElementById('btn-minimize').addEventListener('click', () => ipcRenderer.invoke('window-minimize'));
document.getElementById('btn-maximize').addEventListener('click', () => ipcRenderer.invoke('window-maximize'));
document.getElementById('btn-close').addEventListener('click', () => ipcRenderer.invoke('window-close'));

navigateTo('dashboard');
