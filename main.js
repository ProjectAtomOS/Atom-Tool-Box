const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');

// Must match build.appId in package.json — the NSIS installer stamps this same
// AUMID on the Start Menu / desktop shortcuts so a pinned taskbar icon groups
// with the running app instead of creating a second, duplicate icon.
if (process.platform === 'win32') app.setAppUserModelId('com.projectatom.toolbox');

// BASE_DIR: physical directory on disk (not virtual app.asar)
// In dev: project root. In packaged: app.asar.unpacked/ where unpacked files live.
const BASE_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked')
  : __dirname;

// Resolve scripts directory: dev = __dirname/src/scripts, packaged = unpacked real path
const SCRIPTS_DIR = (() => {
  const devPath = path.join(__dirname, 'src', 'scripts');
  if (!app.isPackaged && fs.existsSync(devPath)) {
    console.log('[SCRIPTS_DIR] dev:', devPath);
    return devPath;
  }
  const pkgPath = path.join(BASE_DIR, 'src', 'scripts');
  console.log('[SCRIPTS_DIR] packaged:', pkgPath, 'exists:', fs.existsSync(pkgPath));
  if (fs.existsSync(pkgPath)) {
    console.log('[SCRIPTS_DIR] using:', pkgPath);
    return pkgPath;
  }
  console.log('[SCRIPTS_DIR] FALLBACK:', devPath);
  return devPath;
})();

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 960, minHeight: 600,
    frame: false, backgroundColor: THEME_BG[loadThemeFile()], icon: path.join(__dirname, 'assets', 'icons', 'app.png'),
    title: '', show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: true,
      spellcheck: false,
      enableRemoteModule: false
    }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

// Single-instance lock: a second launch would duplicate the whole Electron
// stack in RAM for no benefit — focus the existing window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app.whenReady().then(() => { loadGpuCache(); createWindow(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}

// ---------- Lightweight system info (no heavy systeminformation library) ----------

let _cpuLast = null;
let _cpuLastTime = 0;
let _cpuLoadCache = { load: 0, time: 0 };

function sampleCpuTimes() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    const t = cpu.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

function cpuLoadBetween(prev, cur) {
  const idleDelta = cur.idle - prev.idle;
  const totalDelta = cur.total - prev.total;
  if (totalDelta <= 0) return 0;
  return Math.min(Math.round(((totalDelta - idleDelta) / totalDelta) * 100), 100);
}

// Pure os.cpus() deltas — spawns no process. The first call of a session takes
// a 150ms second sample so the dashboard shows a real value immediately.
function getCpuLoad() {
  return new Promise((resolve) => {
    const now = Date.now();
    if (now - _cpuLoadCache.time < 30000) {
      resolve(_cpuLoadCache.load);
      return;
    }
    const cur = sampleCpuTimes();
    if (_cpuLast && now - _cpuLastTime > 100) {
      const rounded = cpuLoadBetween(_cpuLast, cur);
      _cpuLoadCache = { load: rounded, time: now };
      _cpuLast = cur;
      _cpuLastTime = now;
      resolve(rounded);
      return;
    }
    _cpuLast = cur;
    _cpuLastTime = now;
    setTimeout(() => {
      const cur2 = sampleCpuTimes();
      const rounded = cpuLoadBetween(cur, cur2);
      _cpuLoadCache = { load: rounded, time: Date.now() };
      _cpuLast = cur2;
      _cpuLastTime = Date.now();
      resolve(rounded);
    }, 150);
  });
}

// Native disk usage via fs.statfs (Node 18.15+, Electron 28) — no PowerShell spawn.
function getDiskInfo() {
  try {
    const st = fs.statfsSync('C:\\');
    const size = st.blocks * st.bsize;
    const free = st.bavail * st.bsize;
    const used = size > 0 ? Math.round(((size - free) / size) * 100) : 0;
    return { size, used };
  } catch {
    return { size: 0, used: 0 };
  }
}

async function getGpuModel() {
  return new Promise((resolve) => {
    const ps = `Get-CimInstance Win32_VideoController | Select-Object -First 1 Name | ConvertTo-Json -Compress`;
    const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true });
    let out = '';
    proc.stdout.on('data', d => out += d);
    const timer = setTimeout(() => {
      try { proc.kill(); } catch {}
      resolve('N/A');
    }, 10000);
    proc.on('close', () => {
      clearTimeout(timer);
      try {
        const data = JSON.parse(out);
        resolve(data.Name || 'N/A');
      } catch {
        resolve('N/A');
      }
    });
    proc.on('error', () => {
      clearTimeout(timer);
      resolve('N/A');
    });
  });
}

const infoCache = { disk: null, os: null, gpu: null, diskTime: 0 };

// GPU model almost never changes — persist it so the first dashboard load of
// later sessions skips the PowerShell query entirely.
function gpuCachePath() {
  return path.join(app.getPath('userData'), 'gpu-cache.json');
}

function loadGpuCache() {
  try {
    const d = JSON.parse(fs.readFileSync(gpuCachePath(), 'utf8'));
    if (d && d.gpu && d.gpu !== 'N/A') infoCache.gpu = d.gpu;
  } catch {}
}

function saveGpuCache(gpu) {
  try {
    if (!gpu || gpu === 'N/A') return;
    fs.writeFileSync(gpuCachePath(), JSON.stringify({ gpu }), 'utf8');
  } catch {}
}

ipcMain.handle('get-system-info', async () => {
  const [cpuLoad, memTotal, memFree, uptime] = await Promise.all([
    getCpuLoad(),
    Promise.resolve(os.totalmem()),
    Promise.resolve(os.freemem()),
    Promise.resolve(os.uptime())
  ]);

  if (!infoCache.os) {
    infoCache.os = {
      platform: process.platform,
      distro: os.type(),
      release: os.release(),
      kernel: os.release(),
      arch: os.arch(),
      hostname: os.hostname(),
      build: os.release()
    };
  }

  infoCache.disk = getDiskInfo();

  if (!infoCache.gpu) {
    const gpu = await getGpuModel();
    infoCache.gpu = gpu;
    saveGpuCache(gpu);
  }

  return {
    cpuLoad,
    memUsed: Math.round(((memTotal - memFree) / memTotal) * 100),
    memTotal,
    memAvailable: memFree,
    diskUsed: infoCache.disk?.used || 0,
    diskTotal: infoCache.disk?.size || 0,
    gpuModel: infoCache.gpu || 'N/A',
    os: infoCache.os,
    uptime
  };
});

let _adminCache = null;
function isAdmin() {
  if (_adminCache !== null) return _adminCache;
  try {
    const { execSync } = require('child_process');
    execSync('net session', { stdio: 'ignore' });
    _adminCache = true;
    return true;
  } catch { _adminCache = false; return false; }
}

ipcMain.handle('check-admin', () => isAdmin());

function needsAdminCheck(str) {
  const lower = str.toLowerCase();
  return [
    'hklm\\', 'root\\default',
    'sc config', 'sc stop', 'sc start', 'sc delete',
    'netsh',
    'powercfg /setacvalueindex', 'powercfg -setacvalueindex',
    'powercfg /setdcvalueindex', 'powercfg -setdcvalueindex',
    'powercfg /setactive', 'powercfg -setactive',
    'powercfg /change', 'powercfg -change',
    'powercfg /h ', 'powercfg -h ',
    'powercfg /import', 'powercfg -duplicatescheme', 'powercfg /delete',
    'powercfg /attributes', 'powercfg -attributes',
    'bcdedit', 'wmic', 'wevtutil',
    'checkpoint-computer', 'enable-computerrestore',
    'set-ciminstance', 'new-ciminstance', 'remove-ciminstance',
    'net stop wuauserv', 'net start wuauserv',
    'c:\\windows\\temp', 'c:\\$recycle.bin', 'c:\\windows\\prefetch', 'c:\\windows\\minidump', 'c:\\windows\\softwaredistribution'
  ].some(k => lower.includes(k));
}

// Spawn a process and stream output to the UI log. Returns a promise.
// verbatim=true passes args to Windows exactly as given (required when the
// single argument is itself a full command line for cmd /c — otherwise Node
// escapes the embedded quotes and cmd silently misparses the command).
function runSpawn(executable, args, log, timeout = 30000, strict = false, verbatim = false) {
  return new Promise((resolve, reject) => {
    const proc = spawn(executable, args, { cwd: BASE_DIR, windowsHide: true, windowsVerbatimArguments: verbatim });
    let stdout = '';
    let stderr = '';
    let done = false;

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      if (log) text.split('\n').filter(l => l.trim()).forEach(l => log(l.trim()));
    });
    proc.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      if (log) text.split('\n').filter(l => l.trim()).forEach(l => log('ERROR: ' + l.trim()));
    });

    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        try { proc.kill(); } catch {}
        reject('timeout');
      }
    }, timeout);

    proc.on('close', (code) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        if (code === 0 || code === null) {
          resolve(stdout);
        } else {
          const msg = stderr || stdout || '';
          if (msg.includes('denied') || msg.includes('administrator') || msg.includes('requires elevation') || msg.includes('740') || msg.includes('error 5') || msg.includes('access is denied')) {
            reject('ADMIN_REQUIRED: This tweak requires administrator privileges. Run the app as administrator.');
          } else if (strict) {
            reject(msg.trim() || `Command exited with code ${code}`);
          } else {
            // Non-admin errors resolve — OFF scripts are best-effort cleanup
            const note = msg.trim() || ('exit code ' + code);
            if (log) log('NOTE: script reported a non-fatal error (' + note.substring(0, 140) + ')');
            console.log('[runSpawn] non-admin error resolved:', msg.substring(0, 200));
            resolve(stdout);
          }
        }
      }
    });

    proc.on('error', (err) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject(err.message || 'Unknown spawn error');
      }
    });
  });
}

ipcMain.handle('execute-tweak', async (event, { scriptPath, command }) => {
  const sender = event.sender;
  function log(msg) { sender.send('tweak-log', { message: msg }); }

  if (scriptPath) {
    const fullPath = path.join(SCRIPTS_DIR, scriptPath);
    console.log('[execute-tweak] scriptPath:', fullPath, 'exists:', fs.existsSync(fullPath));
    if (fs.existsSync(fullPath)) {
      const scriptContent = fs.readFileSync(fullPath, 'utf8');
      // Check admin requirement from the raw script content
      const anyNeedsAdmin = needsAdminCheck(scriptContent);
      if (anyNeedsAdmin && !isAdmin()) {
        throw new Error('ADMIN_REQUIRED: This tweak requires administrator privileges. Run the app as administrator.');
      }
      log(`> Running: ${scriptPath}`);
      try {
        // Copy batch to temp dir to avoid spaces/&/special chars in the project path breaking cmd
        const tmpBat = path.join(os.tmpdir(), `atom_${Date.now()}.bat`);
        let scriptContent = fs.readFileSync(fullPath, 'utf8');
        // Replace %CD% with BASE_DIR so scripts that reference their own directory still work
        scriptContent = scriptContent.replace(/%CD%/g, BASE_DIR);
        fs.writeFileSync(tmpBat, scriptContent);
        await runSpawn('cmd', ['/c', tmpBat], log, 30000);
        try { fs.unlinkSync(tmpBat); } catch {}
        return 'EXECUTED';
      } catch (err) {
        const msg = typeof err === 'string' ? err : (err.message || 'Unknown error');
        if (msg.includes('ADMIN_REQUIRED')) throw new Error(msg);
        throw new Error(`Command failed: ${msg.substring(0, 200)}`);
      }
    }
  }

  if (command) {
    if (!isAdmin() && needsAdminCheck(command)) {
      throw new Error('ADMIN_REQUIRED: This tweak requires administrator privileges. Run the app as administrator.');
    }
    log(`> Running: ${command.substring(0, 120)}${command.length > 120 ? '...' : ''}`);
    try {
      await runSpawn('cmd', ['/c', command], log, 30000, false, true);
      return 'EXECUTED';
    } catch (err) {
      const msg = typeof err === 'string' ? err : (err.message || 'Unknown error');
      if (msg.includes('ADMIN_REQUIRED')) throw new Error(msg);
      throw new Error(`Command failed: ${msg.substring(0, 200)}`);
    }
  }

  throw new Error('No script or command provided');
});

// ---------- check-tweak: spawn PowerShell directly, bypass cmd.exe overhead ----------

// Run one check command exactly as stored in the config; exit code 0 = enabled.
function runSingleCheck(command) {
  return new Promise((resolve) => {
    if (!command) { resolve({ enabled: false, error: 'no command' }); return; }
    const trimmed = command.trim();
    const psMatch = trimmed.match(/^powershell\s+(?:-NoProfile\s+)?-Command\s+(.+)$/i);

    let executable, args;
    if (psMatch) {
      let script = psMatch[1];
      if (script.startsWith('"') && script.endsWith('"')) {
        script = script.slice(1, -1);
      }
      executable = 'powershell';
      args = ['-NoProfile', '-NonInteractive', '-Command', script];
    } else {
      executable = 'cmd';
      args = ['/c', trimmed];
    }

    console.log('[check-tweak] spawning:', executable, args[0], args[1]);

    const proc = spawn(executable, args, { windowsHide: true });
    let done = false;
    let out = '';
    let errOut = '';

    proc.stdout.on('data', (data) => { out += data.toString(); });
    proc.stderr.on('data', (data) => { errOut += data.toString(); });

    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        try { proc.kill(); } catch {}
        resolve({ enabled: false, error: 'timeout', stderr: errOut || 'process timed out' });
      }
    }, 30000);

    proc.on('close', (code) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve({ enabled: code === 0, exitCode: code, stderr: errOut });
      }
    });
    proc.on('error', (err) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve({ enabled: false, error: err.message });
      }
    });
  });
}

ipcMain.handle('check-tweak', async (event, { command }) => runSingleCheck(command));

// ---- Batch checking: evaluate many checks inside ONE PowerShell process ----
// A check qualifies when it is `powershell ... -Command "<body>"` whose control
// flow is built only from `exit 0` (enabled) / `exit 1` (disabled). The wrapper
// rewrites those exits into writes to a shared result table, so no `exit`
// statement can kill the batch host. Anything unusual falls back to the
// original one-process-per-check path.
function classifyCheck(command) {
  const c = String(command || '').trim();
  if (!c) return { kind: 'single' };
  if (/^exit\s+1\s*$/i.test(c)) return { kind: 'always-false' };
  const psMatch = c.match(/^powershell\s+(?:-NoProfile\s+)?-Command\s+(.+)$/i);
  if (!psMatch) return { kind: 'single' };
  let body = psMatch[1].trim();
  if (body.startsWith('"') && body.endsWith('"')) body = body.slice(1, -1);
  if (/\bfunction\b|\bparam\s*\(|\btrap\b/i.test(body)) return { kind: 'single' };
  if (/['"]\s*exit\b/i.test(body)) return { kind: 'single' };
  const exits = body.match(/\bexit\s+\d+/gi) || [];
  if (!exits.length) return { kind: 'single' };
  if (exits.some(e => !/^exit\s+[01]$/i.test(e))) return { kind: 'single' };
  const has0 = /\bexit\s+0\b/i.test(body);
  const has1 = /\bexit\s+1\b/i.test(body);
  if (!has1) return { kind: 'single' };       // exit 0 only — leave legacy semantics alone
  if (!has0) return { kind: 'always-false' }; // exit 1 only — always disabled
  return { kind: 'script', body };
}

function buildBatchScript(entries) {
  const lines = ["$ErrorActionPreference = 'SilentlyContinue'", '$script:RR = @{}'];
  entries.forEach((_, i) => lines.push(`$script:RR[${i}] = $false`));
  entries.forEach((e, i) => {
    const body = e.body
      .replace(/\bexit\s+0\b/gi, `$script:RR[${i}] = $true; return`)
      .replace(/\bexit\s+1\b/gi, `$script:RR[${i}] = $false; return`);
    lines.push(`try { & { ${body} } } catch {}`);
  });
  lines.push('$out = @{}');
  entries.forEach((_, i) => lines.push(`$out['${i}'] = [bool]$script:RR[${i}]`));
  lines.push('$out | ConvertTo-Json -Compress');
  return lines.join('\r\n');
}

async function batchCheckItems(items) {
  const results = {};
  const batch = [];
  const singles = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it.id !== 'string' || typeof it.check !== 'string') continue;
    const cls = classifyCheck(it.check);
    if (cls.kind === 'always-false') { results[it.id] = false; continue; }
    if (cls.kind === 'script') { batch.push({ id: it.id, orig: it.check, body: cls.body }); continue; }
    singles.push(it);
  }
  console.log(`[check-tweaks-batch] ${(items || []).length} requested → ${batch.length} batched, ${singles.length} single, ${Object.keys(results).length} auto`);
  if (batch.length) {
    const r = await psRun(buildBatchScript(batch), 120000);
    let parsed = psJson((r.raw || '').trim());
    if (!parsed) {
      const lastLine = (r.raw || '').trim().split(/\r?\n/).filter(Boolean).pop();
      if (lastLine) parsed = psJson(lastLine);
    }
    if (parsed && typeof parsed === 'object') {
      batch.forEach((b, i) => { results[b.id] = parsed[String(i)] === true || parsed[String(i)] === 1; });
    } else {
      console.log('[check-tweaks-batch] batch failed, falling back to single checks:', (r.error || 'unparseable output'));
      singles.push(...batch.map(b => ({ id: b.id, check: b.orig })));
    }
  }
  for (const s of singles) {
    try {
      const r = await runSingleCheck(s.check);
      results[s.id] = !!r.enabled;
    } catch {
      results[s.id] = false;
    }
  }
  return { results };
}

ipcMain.handle('check-tweaks-batch', async (event, { items }) => batchCheckItems(items));

const installProcs = new Map();

function findCurl() {
  const candidates = [
    path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'curl.exe'),
    path.join(process.env.SystemRoot || 'C:\\Windows', 'SysWOW64', 'curl.exe'),
    'curl.exe'
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

// Download + install using curl.exe (built into Win10 1803+) — much more reliable than Invoke-WebRequest
ipcMain.handle('install-app', async (event, { id, url, filename, type }) => {
  if (installProcs.has(id)) throw new Error('Already installing');
  if (!url) throw new Error('No download URL for this app');

  const curlPath = findCurl();
  if (!curlPath) {
    throw new Error('curl.exe not found. Windows 10 version 1803 or later is required.');
  }

  const tmpFile = path.join(os.tmpdir(), `atom_${id}_${filename}`);
  const sender = event.sender;

  return new Promise((resolve, reject) => {
    // Build install spawn config — use direct spawn with args array, NEVER cmd /c strings
    let instExe, instArgs;
    switch (type) {
      case 'msi':
        instExe = 'msiexec.exe';
        instArgs = ['/i', tmpFile, '/norestart'];
        break;
      case 'portable':
        instExe = 'powershell.exe';
        instArgs = ['-NoProfile', '-Command', `New-Item -ItemType Directory -Path "$env:LOCALAPPDATA\Programs\${id}" -Force | Out-Null; Copy-Item "${tmpFile}" "$env:LOCALAPPDATA\Programs\${id}\" -Force; Write-Host "Saved to $env:LOCALAPPDATA\Programs\${id}"`];
        break;
      default:
        // EXE installers — spawn directly, Windows shows the UAC prompt naturally
        instExe = tmpFile;
        instArgs = [];
    }

    // Step 1: Download using curl.exe with progress parsing
    console.log('[install-app] downloading:', id, url, 'curl:', curlPath);
    sender.send('download-progress', { id, progress: 0, stage: 'DOWNLOADING' });

    const curlArgs = ['-L', '--max-redirs', '10', '-o', tmpFile, url];
    console.log('[install-app] spawn:', curlPath, curlArgs);
    const dlProc = spawn(curlPath, curlArgs, { windowsHide: true });
    installProcs.set(id, dlProc);
    let dlOutput = '';
    let lastPct = 0;

    dlProc.stderr.on('data', (data) => {
      const text = data.toString();
      dlOutput += text;
      console.log('[install-app] curl stderr:', text.substring(0, 200));
    });

    dlProc.stdout.on('data', (data) => {
      dlOutput += data.toString();
      console.log('[install-app] curl stdout:', data.toString().substring(0, 200));
    });

    dlProc.on('error', (err) => {
      console.log('[install-app] curl spawn error:', err.message);
      installProcs.delete(id);
      try { fs.unlinkSync(tmpFile); } catch {}
      sender.send('app-install-done', { id, code: -1, success: false, output: 'curl spawn error: ' + err.message });
      reject('curl spawn error: ' + err.message);
    });

    const dlTimer = setTimeout(() => {
      if (installProcs.has(id)) {
        try { dlProc.kill(); } catch {}
        installProcs.delete(id);
        try { fs.unlinkSync(tmpFile); } catch {}
        sender.send('app-install-done', { id, code: -1, success: false, output: 'Download timed out after 5 minutes' });
        reject('Download timed out');
      }
    }, 300000);

    dlProc.on('close', (dlCode) => {
      clearTimeout(dlTimer);
      installProcs.delete(id);
      console.log('[install-app] curl exit:', dlCode, 'output:', dlOutput.substring(0, 300));

      if (dlCode !== 0) {
        try { fs.unlinkSync(tmpFile); } catch {}
        sender.send('app-install-done', { id, code: dlCode, success: false, output: dlOutput || `Download failed (code ${dlCode})` });
        reject(`Download failed: ${dlOutput || 'curl exited with ' + dlCode}`);
        return;
      }

      // Verify file exists
      if (!fs.existsSync(tmpFile)) {
        sender.send('app-install-done', { id, code: -1, success: false, output: 'Downloaded file not found' });
        reject('Downloaded file not found');
        return;
      }

      const fileSize = fs.statSync(tmpFile).size;
      console.log('[install-app] file size:', fileSize);
      if (fileSize < 1000) {
        const content = fs.readFileSync(tmpFile, 'utf8').substring(0, 500);
        console.log('[install-app] file too small, content:', content);
        sender.send('app-install-done', { id, code: -1, success: false, output: 'Downloaded file is too small: ' + content });
        reject('Downloaded file is too small');
        return;
      }

      // Step 2: Install
      console.log('[install-app] installing:', id, instExe, instArgs);
      sender.send('download-progress', { id, progress: 100, stage: 'INSTALLING' });

      const instProc = spawn(instExe, instArgs, { windowsHide: false });
      installProcs.set(id, instProc);
      let instOutput = '';

      instProc.stdout.on('data', (data) => { instOutput += data.toString(); });
      instProc.stderr.on('data', (data) => { instOutput += data.toString(); });

      instProc.on('error', (err) => {
        console.log('[install-app] install spawn error:', err.message);
        installProcs.delete(id);
        try { fs.unlinkSync(tmpFile); } catch {}
        sender.send('app-install-done', { id, code: -1, success: false, output: 'Install spawn error: ' + err.message });
        reject('Install spawn error: ' + err.message);
      });

      const instTimer = setTimeout(() => {
        if (installProcs.has(id)) {
          try { instProc.kill(); } catch {}
          installProcs.delete(id);
          try { fs.unlinkSync(tmpFile); } catch {}
          sender.send('app-install-done', { id, code: -1, success: false, output: instOutput + '\n[INSTALL TIMEOUT]' });
          reject('Installation timed out after 5 minutes');
        }
      }, 300000);

      instProc.on('close', (instCode) => {
        clearTimeout(instTimer);
        installProcs.delete(id);
        setTimeout(() => { try { fs.unlinkSync(tmpFile); } catch {} }, 3000);

        const ok = (instCode === 0 || instCode === 3010 || instCode === 1605);
        console.log('[install-app] id:', id, 'exit:', instCode, 'ok:', ok);
        sender.send('app-install-done', { id, code: instCode, success: ok, output: instOutput || 'Installation completed' });
        if (ok) {
          _appsCache.data = null;
          resolve(instOutput);
        } else {
          reject(`Installation exited with code ${instCode}`);
        }
      });

      instProc.on('error', (err) => {
        clearTimeout(instTimer);
        installProcs.delete(id);
        try { fs.unlinkSync(tmpFile); } catch {}
        sender.send('app-install-done', { id, code: -1, success: false, output: err.message });
        reject(err.message);
      });
    });

    dlProc.on('error', (err) => {
      clearTimeout(dlTimer);
      installProcs.delete(id);
      try { fs.unlinkSync(tmpFile); } catch {}
      sender.send('app-install-done', { id, code: -1, success: false, output: 'curl error: ' + err.message });
      reject('curl error: ' + err.message);
    });
  });
});

ipcMain.handle('cancel-install', async (_, { id }) => {
  const proc = installProcs.get(id);
  if (proc) { try { proc.kill(); } catch {} installProcs.delete(id); return 'CANCELLED'; }
  return 'NOT_FOUND';
});

ipcMain.handle('open-external', async (_, url) => {
  const u = String(url || '');
  if (!/^https?:\/\//i.test(u)) throw new Error('Only http(s) links can be opened');
  const { shell } = require('electron');
  return shell.openExternal(u);
});

// Open Windows settings / tools via cmd (fire-and-forget, no zombie processes)
ipcMain.handle('open-shortcut', async (_, { command }) => {
  // Use "start" so cmd exits immediately — avoids lingering cmd.exe for GUI apps.
  // Verbatim args keep the raw command line intact (commands with spaces/quotes
  // like `control /name Microsoft.Personalization` would otherwise be mangled
  // by Node's argv quoting and silently fail to launch).
  const proc = spawn('cmd', ['/c', 'start', '', command], { windowsHide: true, windowsVerbatimArguments: true });
  proc.on('error', (err) => console.log('[open-shortcut] error:', err.message));
  return 'OPENED';
});

// Session cache: repeat visits to INSTALLED APPS reuse the last scan for 2
// minutes instead of re-running the PowerShell enumeration. Invalidated on
// install/uninstall. Pass { force: true } to bypass.
let _appsCache = { time: 0, data: null };
const APPS_CACHE_TTL = 120000;

ipcMain.handle('get-installed-apps', async (event, opts) => {
  if (_appsCache.data && !(opts && opts.force) && Date.now() - _appsCache.time < APPS_CACHE_TTL) {
    return _appsCache.data;
  }
  return new Promise((resolve) => {
    const tmpPs = path.join(os.tmpdir(), `atom_apps_${Date.now()}.ps1`);
    const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$props = 'DisplayName','Publisher','DisplayVersion','UninstallString','EstimatedSize'
$paths = @(
  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
)
$items = foreach ($p in $paths) {
  Get-ChildItem $p -ErrorAction SilentlyContinue | Get-ItemProperty -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | Select-Object $props
}
$win32 = $items | Sort-Object DisplayName | ForEach-Object {
  [PSCustomObject]@{
    name = $_.DisplayName
    publisher = $_.Publisher
    version = $_.DisplayVersion
    uninstall = $_.UninstallString
    size = $_.EstimatedSize
    isWindowsApp = $false
    packageName = $null
  }
}

# Also get Windows Apps (UWP/MSIX)
$uwp = Get-AppxPackage -AllUsers | Where-Object { $_.Name -notmatch 'Microsoft.Windows.|Microsoft.VCLibs|Microsoft.UI.Xaml|Microsoft.NET|Windows.' } | Sort-Object Name | ForEach-Object {
  $dn = $_.Name
  $display = (Get-AppxPackageManifest -Package $_.PackageFullName).Package.Properties.DisplayName
  if ($display -match '^ms-') { $display = $dn }
  [PSCustomObject]@{
    name = $display
    publisher = $_.Publisher
    version = $_.Version
    uninstall = $null
    size = 0
    isWindowsApp = $true
    packageName = $dn
  }
}

$result = @($win32) + @($uwp)
$result | ConvertTo-Json -Compress
`;
    fs.writeFileSync(tmpPs, psScript, 'utf8');

    const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmpPs], { windowsHide: true });
    let out = '';
    let err = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => err += d);

    const timer = setTimeout(() => {
      try { proc.kill(); } catch {}
      try { fs.unlinkSync(tmpPs); } catch {}
      resolve([]);
    }, 30000);

    proc.on('close', code => {
      clearTimeout(timer);
      try { fs.unlinkSync(tmpPs); } catch {}
      try {
        let raw = JSON.parse(out.trim());
        if (Array.isArray(raw) && raw.length === 1 && Array.isArray(raw[0])) raw = raw[0];
        const arr = Array.isArray(raw) ? raw : (raw ? [raw] : []);
        const seen = new Set();
        const unique = [];
        for (const item of arr) {
          if (!item || !item.name) continue;
          const key = item.name + '|' + (item.version || '');
          if (seen.has(key)) continue;
          seen.add(key);
          unique.push({
            name: item.name,
            publisher: item.publisher || '',
            version: item.version || '',
            uninstall: item.uninstall || '',
            size: item.size || 0,
            isWindowsApp: !!item.isWindowsApp,
            packageName: item.packageName || null
          });
        }
        _appsCache = { time: Date.now(), data: unique };
        resolve(unique);
      } catch (e) {
        console.log('[get-installed-apps] parse error:', e.message);
        resolve([]);
      }
    });

    proc.on('error', () => {
      clearTimeout(timer);
      try { fs.unlinkSync(tmpPs); } catch {}
      resolve([]);
    });
  });
});

ipcMain.handle('run-cleaner', async (event, { command }) => {
  const sender = event.sender;
  function log(msg) { sender.send('tweak-log', { message: msg }); }
  if (!command) throw new Error('No cleaner command provided');
  log(`> Running cleaner: ${command.substring(0, 120)}${command.length > 120 ? '...' : ''}`);
  try {
    const lower = command.toLowerCase();
    const needsAdmin = ['c:\\windows\\temp', 'c:\\$recycle.bin', 'wevtutil', 'stop-service wuauserv', 'start-service wuauserv', 'c:\\windows\\prefetch', 'c:\\windows\\minidump'].some(k => lower.includes(k));
    if (needsAdmin && !isAdmin()) {
      throw new Error('ADMIN_REQUIRED: This cleaner operation requires administrator privileges. Run the app as administrator.');
    }

    let executable, args;
    if (/^powershell/i.test(command.trim())) {
      // Write PowerShell command to temp file — avoids cmd quoting hell
      const psMatch = command.trim().match(/^powershell\s+(?:-NoProfile\s+)?-Command\s+(.+)$/is);
      if (psMatch) {
        let script = psMatch[1];
        // Strip outer quotes if present
        if ((script.startsWith('"') && script.endsWith('"')) || (script.startsWith("'") && script.endsWith("'"))) {
          script = script.slice(1, -1);
        }
        const tmpPs = path.join(os.tmpdir(), `atom_cleaner_${Date.now()}.ps1`);
        fs.writeFileSync(tmpPs, script, 'utf8');
        executable = 'powershell';
        args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpPs];
        // Clean up temp file after run
        const origRunSpawn = runSpawn;
        const result = await origRunSpawn(executable, args, log, 120000, true);
        try { fs.unlinkSync(tmpPs); } catch {}
        return 'CLEANED';
      }
    }

    // Fallback: run via cmd /c
    await runSpawn('cmd', ['/c', command], log, 120000, true, true);
    return 'CLEANED';
  } catch (err) {
    const msg = typeof err === 'string' ? err : (err.message || 'Unknown error');
    if (msg.includes('ADMIN_REQUIRED')) throw new Error(msg);
    throw new Error(`Cleaner failed: ${msg.substring(0, 300)}`);
  }
});

function parseUninstallString(str) {
  str = str.trim();
  if (str.startsWith('"')) {
    const endQuote = str.indexOf('"', 1);
    if (endQuote > 0) {
      const exe = str.slice(1, endQuote);
      const args = str.slice(endQuote + 1).trim().split(/\s+/).filter(Boolean);
      return [exe, args];
    }
  }
  const spaceIdx = str.indexOf(' ');
  if (spaceIdx > 0) {
    return [str.slice(0, spaceIdx), str.slice(spaceIdx + 1).trim().split(/\s+/).filter(Boolean)];
  }
  return [str, []];
}

ipcMain.handle('uninstall-app', async (event, { name, uninstall, isWindowsApp, packageName }) => {
  return new Promise((resolve, reject) => {
    // Windows App (UWP/MSIX) — use PowerShell Remove-AppxPackage
    if (isWindowsApp && packageName) {
      const psScript = `
$ErrorActionPreference = 'Stop'
$pkg = Get-AppxPackage -Name "${packageName}" -AllUsers
if (-not $pkg) { Write-Host "NOT_FOUND"; exit 0 }
$pkg | Remove-AppxPackage -AllUsers -ErrorAction Stop
Write-Host "REMOVED"
`;
      const tmpPs = path.join(os.tmpdir(), `atom_uninstall_${Date.now()}.ps1`);
      fs.writeFileSync(tmpPs, psScript, 'utf8');

      const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmpPs], { windowsHide: true });
      let out = '';
      proc.stdout.on('data', d => out += d);
      proc.stderr.on('data', d => out += d);

      const timer = setTimeout(() => { try { proc.kill(); } catch {} try { fs.unlinkSync(tmpPs); } catch {} reject('Timeout'); }, 30000);

      proc.on('close', (code) => {
        clearTimeout(timer);
        try { fs.unlinkSync(tmpPs); } catch {}
        if (code === 0 || out.includes('REMOVED') || out.includes('NOT_FOUND')) {
          _appsCache.data = null;
          resolve('UNINSTALLED');
        } else {
          reject(out.trim() || `Exit code ${code}`);
        }
      });
      proc.on('error', (err) => { clearTimeout(timer); try { fs.unlinkSync(tmpPs); } catch {} reject(err.message); });
      return;
    }

    if (!uninstall) {
      reject('No uninstall string found for this app');
      return;
    }
    const u = uninstall.trim();

    let executable, args;

    // MSI GUID only
    if (/^\{[A-F0-9-]{36}\}$/i.test(u)) {
      executable = 'msiexec.exe';
      args = ['/x', u, '/passive', '/norestart'];
    }
    // MSI with msiexec.exe prefix
    else if (/msiexec\.exe/i.test(u)) {
      const [, parsedArgs] = u.match(/msiexec\.exe(.*)/i) || [];
      executable = 'msiexec.exe';
      const normalizedArgs = parsedArgs ? parsedArgs.trim().split(/\s+/).filter(Boolean) : [];
      const finalArgs = normalizedArgs.map(a =>
        /^\/[iI]\{/.test(a) ? a.replace(/^\/[iI]/, '/x') : a
      );
      if (!finalArgs.some(a => /^\/[xX]/.test(a))) {
        const guidMatch = u.match(/(\{[A-F0-9-]{36}\})/i);
        if (guidMatch) finalArgs.unshift('/x', guidMatch[1]);
      }
      args = finalArgs;
      if (!args.some(a => /^\/(qn|qb|qr|passive)/i.test(a))) args.push('/passive');
      if (!args.some(a => /^\/norestart/i.test(a))) args.push('/norestart');
    }
    // Everything else
    else {
      [executable, args] = parseUninstallString(u);
    }

    console.log('[uninstall-app] spawning:', executable, args);

    const proc = spawn(executable, args, { windowsHide: true });
    let out = '';
    let errOut = '';

    proc.stdout.on('data', (data) => { out += data.toString(); });
    proc.stderr.on('data', (data) => { errOut += data.toString(); });

    const timer = setTimeout(() => {
      try { proc.kill(); } catch {}
      reject('Uninstaller timed out (60s)');
    }, 60000);

    proc.on('close', (code) => {
      clearTimeout(timer);
      console.log('[uninstall-app] exit code:', code);
      const okCodes = [0, 3010, 1605, 1602];
      if (okCodes.includes(code)) {
        _appsCache.data = null;
        resolve('UNINSTALLED');
      } else {
        const msg = (errOut || out || '').trim();
        reject(msg || `Uninstaller exited with code ${code}`);
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject('Failed to start uninstaller: ' + err.message);
    });
  });
});

// ==================== PHASE 2 FEATURES ====================
// DNS Optimizer, Background Monitor (Kill & Block), Driver Hub (read-only),
// Backup & Restore central, Power plan import/remove.

// Run an inline PowerShell script file. Never rejects — resolves { ok, raw, error }.
function psRun(script, timeout = 30000) {
  return new Promise((resolve) => {
    const tmpPs = path.join(os.tmpdir(), `atom_ps_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.ps1`);
    try { fs.writeFileSync(tmpPs, '\uFEFF' + script, 'utf8'); } catch (e) { resolve({ ok: false, error: e.message }); return; }
    const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmpPs], { cwd: BASE_DIR, windowsHide: true });
    let out = '', err = '', done = false;
    let timer = null;
    const finish = (result) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      try { fs.unlinkSync(tmpPs); } catch {}
      resolve(result);
    };
    timer = setTimeout(() => {
      try { proc.kill(); } catch {}
      finish({ ok: false, error: 'timeout', raw: out.trim(), stderr: err.trim() });
    }, timeout);
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) finish({ ok: true, raw: out.trim(), stderr: err.trim() });
      else finish({ ok: false, error: (err.trim() || ('exit code ' + code)), raw: out.trim(), stderr: err.trim() });
    });
    proc.on('error', (e) => finish({ ok: false, error: e.message }));
  });
}

function psJson(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function psJsonList(raw) {
  let v = psJson(raw);
  if (v && !Array.isArray(v)) v = [v];
  return Array.isArray(v) ? v.filter(Boolean) : [];
}

function requireAdmin(what) {
  if (!isAdmin()) throw new Error('ADMIN_REQUIRED: ' + what + ' requires administrator privileges. Run the app as administrator.');
}

function senderLog(event) {
  return (m) => { try { event.sender.send('tweak-log', { message: String(m) }); } catch {} };
}

// ---------- ATOM OPTIMIZER GATE ----------
// The four ADVANCED tools are intentionally unavailable in the free
// AtomToolBox build: their routes are locked and their IPC surface refuses
// every call. The tools themselves live in Atom Optimizer.
const OPTIMIZER_URL = 'https://www.atom-os.com/optimizer';
function optimizerOnly(feature) {
  throw new Error(feature + ' is available only in Atom Optimizer — ' + OPTIMIZER_URL);
}

// ---------- DNS OPTIMIZER ----------

const DNS_IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const DNS_IPV6_RE = /^[0-9a-fA-F:]{2,45}$/;
function validDnsAddr(addr) { return DNS_IPV4_RE.test(addr) || DNS_IPV6_RE.test(addr); }
function safeAdapterName(n) { return typeof n === 'string' && n.length >= 1 && n.length <= 128 && !/["<>|&]/.test(n); }

ipcMain.handle('dns-list-adapters', async () => {
  optimizerOnly('DNS Optimizer');
  const r = await psRun(`
$ErrorActionPreference = 'SilentlyContinue'
$adapters = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Sort-Object Name
$out = foreach ($a in $adapters) {
  $dns4 = @((Get-DnsClientServerAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv4).ServerAddresses)
  [PSCustomObject]@{ name = $a.Name; desc = $a.InterfaceDescription; index = $a.ifIndex; dns = $dns4 }
}
@($out) | ConvertTo-Json -Compress -Depth 4
`, 30000);
  if (!r.ok) return { ok: false, error: r.error, adapters: [] };
  const adapters = psJsonList(r.raw).filter(a => a && a.name).map(a => ({
    name: a.name,
    desc: a.desc || '',
    dns: Array.isArray(a.dns) ? a.dns.filter(Boolean) : []
  }));
  return { ok: true, adapters };
});

ipcMain.handle('dns-apply', async (event, { adapter, servers }) => {
  optimizerOnly('DNS Optimizer');
  requireAdmin('Changing DNS servers');
  if (!safeAdapterName(adapter)) throw new Error('Invalid network adapter name');
  const list = (Array.isArray(servers) ? servers : []).map(s => String(s).trim()).filter(validDnsAddr);
  if (!list.length) throw new Error('No valid DNS server addresses provided');
  const log = senderLog(event);
  const nameArg = 'name="' + adapter + '"';
  const isV6 = list[0].includes(':');
  log(`> Setting DNS on "${adapter}": ${list.join(', ')}`);
  if (isV6) {
    await runSpawn('netsh', ['interface', 'ipv6', 'set', 'dnsservers', nameArg, 'static', list[0], 'primary'], log, 15000, true);
    if (list[1]) await runSpawn('netsh', ['interface', 'ipv6', 'add', 'dnsservers', nameArg, list[1], 'index=2'], log, 15000, true);
  } else {
    await runSpawn('netsh', ['interface', 'ip', 'set', 'dns', nameArg, 'static', list[0], 'primary'], log, 15000, true);
    if (list[1]) await runSpawn('netsh', ['interface', 'ip', 'add', 'dns', nameArg, list[1], 'index=2'], log, 15000, true);
  }
  try { await runSpawn('ipconfig', ['/flushdns'], log, 15000, false); } catch {}
  log('> DNS applied and resolver cache flushed.');
  return 'DNS_APPLIED';
});

ipcMain.handle('dns-reset-dhcp', async (event, { adapter }) => {
  optimizerOnly('DNS Optimizer');
  requireAdmin('Resetting DNS to DHCP');
  if (!safeAdapterName(adapter)) throw new Error('Invalid network adapter name');
  const log = senderLog(event);
  const nameArg = 'name="' + adapter + '"';
  log(`> Restoring automatic (DHCP) DNS on "${adapter}"...`);
  await runSpawn('netsh', ['interface', 'ip', 'set', 'dns', nameArg, 'dhcp'], log, 15000, true);
  try { await runSpawn('netsh', ['interface', 'ipv6', 'set', 'dnsservers', nameArg, 'dhcp'], log, 15000, false); } catch {}
  try { await runSpawn('ipconfig', ['/flushdns'], log, 15000, false); } catch {}
  log('> Automatic DNS restored.');
  return 'DNS_DHCP';
});

ipcMain.handle('dns-flush', async (event) => {
  optimizerOnly('DNS Optimizer');
  const log = senderLog(event);
  log('> Flushing DNS resolver cache...');
  try { await runSpawn('ipconfig', ['/flushdns'], log, 15000, false); } catch {}
  return 'FLUSHED';
});

// ---------- BACKGROUND MONITOR ----------

const BG_PROTECTED = new Set(['system', 'idle', 'registry', 'memory compression', 'secure system', 'smss', 'csrss', 'wininit', 'winlogon', 'services', 'lsass', 'fontdrvhost', 'dwm', 'svchost', 'audiodg', 'wudfhost']);
const bgStorePath = () => path.join(app.getPath('userData'), 'atom-blocked.json');
function loadBgStore() { try { return JSON.parse(fs.readFileSync(bgStorePath(), 'utf8')) || {}; } catch { return {}; } }
function saveBgStore(store) { try { fs.writeFileSync(bgStorePath(), JSON.stringify(store, null, 2), 'utf8'); } catch {} }

// Fast native process snapshot via tasklist — no PowerShell spawn. tasklist
// reports memory only; the CPU% column was dropped to keep 5s polling cheap.
function tasklistProcesses() {
  return new Promise((resolve) => {
    const proc = spawn('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true });
    let out = '';
    let done = false;
    const finish = (result) => { if (done) return; done = true; clearTimeout(timer); resolve(result); };
    const timer = setTimeout(() => { try { proc.kill(); } catch {} finish({ ok: false, error: 'timeout' }); }, 15000);
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.on('error', (e) => finish({ ok: false, error: e.message }));
    proc.on('close', () => {
      try {
        const procs = [];
        for (const line of out.split(/\r?\n/)) {
          const m = line.match(/^"([^"]+)","(\d+)","[^"]*","[^"]*","([^"]*)"\s*$/);
          if (!m) continue;
          const kb = parseInt(m[3].replace(/[^\d]/g, ''), 10);
          if (!Number.isFinite(kb)) continue;
          procs.push({ name: m[1], pid: parseInt(m[2], 10), mem: Math.round((kb / 1024) * 10) / 10 });
        }
        procs.sort((a, b) => b.mem - a.mem);
        finish({ ok: true, procs: procs.slice(0, 70), total: procs.length });
      } catch (e) {
        finish({ ok: false, error: e.message });
      }
    });
  });
}

// Look up a process name by PID via tasklist (returns '' when the PID is gone).
function tasklistName(pid) {
  return new Promise((resolve) => {
    const proc = spawn('tasklist', ['/fi', `PID eq ${pid}`, '/fo', 'csv', '/nh'], { windowsHide: true });
    let out = '';
    let done = false;
    const finish = (name) => { if (done) return; done = true; clearTimeout(timer); resolve(name); };
    const timer = setTimeout(() => { try { proc.kill(); } catch {} finish(''); }, 15000);
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.on('error', () => finish(''));
    proc.on('close', () => {
      const m = out.match(/^"([^"]+)","(\d+)"/m);
      finish(m ? m[1].toLowerCase() : '');
    });
  });
}

ipcMain.handle('bg-list-processes', async () => {
  const r = await tasklistProcesses();
  if (!r.ok) return { ok: false, error: r.error, procs: [], cores: os.cpus().length };
  return { ok: true, cores: os.cpus().length, procs: r.procs, total: r.total };
});

ipcMain.handle('bg-kill-process', async (event, { pid, name }) => {
  const id = Number(pid);
  if (!Number.isInteger(id) || id <= 4) throw new Error('Invalid process id');
  const exe = String(name || '').trim().toLowerCase();
  if (!/^[a-z0-9 _.\-]{1,64}\.exe$/.test(exe)) throw new Error('Invalid process name');
  const bare = exe.replace(/\.exe$/, '');
  if (BG_PROTECTED.has(bare)) throw new Error('Refused: "' + bare + '" is a protected system process');
  const log = senderLog(event);
  const actual = await tasklistName(id);
  if (actual === '') return 'ALREADY_GONE';
  if (actual !== bare) throw new Error('Process list is stale (name/pid mismatch) — refresh and try again');
  log(`> Killing ${exe} (PID ${id})...`);
  await runSpawn('taskkill', ['/PID', String(id), '/F'], log, 15000, true);
  log(`> ${exe} terminated.`);
  return 'KILLED';
});

ipcMain.handle('bg-block-process', async (event, { name }) => {
  requireAdmin('Blocking applications');
  const exe = String(name || '').trim().toLowerCase();
  if (!/^[a-z0-9 _.\-]{1,64}\.exe$/.test(exe)) throw new Error('Invalid executable name');
  const bare = exe.replace(/\.exe$/, '');
  if (BG_PROTECTED.has(bare)) throw new Error('Refused: "' + bare + '" is a protected system process');
  const store = loadBgStore();
  if (store[exe]) return 'ALREADY_BLOCKED';
  const log = senderLog(event);
  const ifeoKey = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Image File Execution Options';
  const keyPath = ifeoKey + '\\' + exe;
  const prev = await psRun(`$v = (Get-ItemProperty -Path '${ifeoKey}\\${exe}' -Name 'Debugger' -ErrorAction SilentlyContinue).Debugger; if ($v) { $v } else { '' }`, 20000);
  const prevDebugger = (prev.raw || '').trim();
  log(`> Blocking "${exe}" via Image File Execution Options...`);
  await runSpawn('reg', ['add', keyPath, '/v', 'Debugger', '/t', 'REG_SZ', '/d', '%windir%\\System32\\where.exe', '/f'], log, 15000, true);
  try { await runSpawn('taskkill', ['/F', '/IM', exe], log, 15000, false); } catch {}
  store[exe] = { prevDebugger, blockedAt: new Date().toISOString() };
  saveBgStore(store);
  log(`> "${exe}" is now blocked. Use UNBLOCK to revert.`);
  return 'BLOCKED';
});

ipcMain.handle('bg-unblock-process', async (event, { name }) => {
  requireAdmin('Unblocking applications');
  const exe = String(name || '').trim().toLowerCase();
  const store = loadBgStore();
  const entry = store[exe];
  if (!entry) throw new Error('Not in the AtomToolBox block list');
  const log = senderLog(event);
  const keyPath = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Image File Execution Options\\' + exe;
  if (entry.prevDebugger) {
    log(`> Restoring previous IFEO Debugger value for "${exe}"...`);
    await runSpawn('reg', ['add', keyPath, '/v', 'Debugger', '/t', 'REG_SZ', '/d', entry.prevDebugger, '/f'], log, 15000, true);
  } else {
    log(`> Removing IFEO block for "${exe}"...`);
    await runSpawn('reg', ['delete', keyPath, '/v', 'Debugger', '/f'], log, 15000, false);
  }
  delete store[exe];
  saveBgStore(store);
  log(`> "${exe}" unblocked.`);
  return 'UNBLOCKED';
});

ipcMain.handle('bg-blocked-list', async () => {
  const store = loadBgStore();
  return Object.keys(store).map(exe => ({ exe, blockedAt: store[exe].blockedAt || null, hadDebugger: !!(store[exe].prevDebugger) }));
});

// ---------- DRIVER HUB (read-only inspection) ----------

ipcMain.handle('driver-scan', async () => {
  optimizerOnly('Driver Hub');
  const r = await psRun(`
$ErrorActionPreference = 'SilentlyContinue'
$raw = (pnputil /enum-drivers | Out-String)
$entries = @()
$cur = $null
foreach ($line in ($raw -split '\\n')) {
  $line = $line.TrimEnd()
  if ($line -match '^Published Name\\s*:\\s*(.+)$') {
    if ($cur) { $entries += $cur }
    $cur = [PSCustomObject]@{ published = $Matches[1].Trim(); original = ''; provider = ''; class = ''; version = '' }
  } elseif ($cur -and $line -match '^Original Name\\s*:\\s*(.+)$') { $cur.original = $Matches[1].Trim() }
  elseif ($cur -and $line -match '^Provider Name\\s*:\\s*(.+)$') { $cur.provider = $Matches[1].Trim() }
  elseif ($cur -and $line -match '^Class Name\\s*:\\s*(.+)$') { $cur.class = $Matches[1].Trim() }
  elseif ($cur -and $line -match '^Driver Version\\s*:\\s*(.+)$') { $cur.version = $Matches[1].Trim() }
}
if ($cur) { $entries += $cur }
$problems = @(Get-CimInstance Win32_PnPEntity | Where-Object { $_.ConfigManagerErrorCode -ne 0 } | Select-Object Name, DeviceID, ConfigManagerErrorCode)
[PSCustomObject]@{ drivers = @($entries); problems = $problems } | ConvertTo-Json -Compress -Depth 4
`, 60000);
  if (!r.ok) return { ok: false, error: r.error, drivers: [], problems: [] };
  const data = psJson(r.raw) || {};
  return {
    ok: true,
    drivers: Array.isArray(data.drivers) ? data.drivers : (data.drivers ? [data.drivers] : []),
    problems: Array.isArray(data.problems) ? data.problems : (data.problems ? [data.problems] : [])
  };
});

// ---------- BACKUP & RESTORE ----------

ipcMain.handle('restorepoint-create', async (event) => {
  requireAdmin('Creating restore points');
  const log = senderLog(event);
  log('> Creating system restore point "AtomToolBox"...');
  const r = await psRun(`
$ErrorActionPreference = 'Continue'
$sr = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\SystemRestore'
$freq = (Get-ItemProperty -Path $sr -Name 'SystemRestorePointCreationFrequency' -ErrorAction SilentlyContinue).SystemRestorePointCreationFrequency
Set-ItemProperty -Path $sr -Name 'SystemRestorePointCreationFrequency' -Value 0 -Type DWord -Force
Enable-ComputerRestore -Drive ($env:SystemDrive + '\\') -ErrorAction SilentlyContinue
$ok = $true
try { Checkpoint-Computer -Description 'AtomToolBox' -RestorePointType 'MODIFY_SETTINGS' -ErrorAction Stop } catch { Write-Output ('CHECKPOINT_ERROR: ' + $_.Exception.Message); $ok = $false }
if ($null -eq $freq) { Remove-ItemProperty -Path $sr -Name 'SystemRestorePointCreationFrequency' -ErrorAction SilentlyContinue } else { Set-ItemProperty -Path $sr -Name 'SystemRestorePointCreationFrequency' -Value $freq -Type DWord -Force }
if (-not $ok) { exit 1 }
Write-Output 'CREATED'
`, 180000);
  if (!r.ok) throw new Error('Restore point failed: ' + (r.raw || r.error || 'unknown'));
  log('> Restore point created successfully.');
  return 'CREATED';
});

ipcMain.handle('restorepoint-list', async () => {
  const r = await psRun(`@(Get-ComputerRestorePoint -ErrorAction SilentlyContinue) | Select-Object SequenceNumber, Description, CreationTime | ConvertTo-Json -Compress`, 40000);
  if (!r.ok) return { ok: false, error: r.error, points: [] };
  return { ok: true, points: psJsonList(r.raw) };
});

const REG_BACKUP_BRANCHES = [
  ['HKLM\\SOFTWARE\\Policies', 'HKLM_SOFTWARE_Policies'],
  ['HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power', 'HKLM_Power_Schemes'],
  ['HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia', 'HKLM_Multimedia'],
  ['HKCU\\Software\\Policies', 'HKCU_Software_Policies'],
  ['HKCU\\Control Panel', 'HKCU_Control_Panel'],
  ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', 'HKCU_Explorer_Advanced']
];

function backupDir() {
  const dir = path.join(app.getPath('userData'), 'backups');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

ipcMain.handle('backup-registry', async (event) => {
  requireAdmin('Registry backup');
  const log = senderLog(event);
  const dir = backupDir();
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const files = [];
  for (const [key, label] of REG_BACKUP_BRANCHES) {
    const file = path.join(dir, `${label}_${ts}.reg`);
    try {
      await runSpawn('reg', ['export', key, file, '/y'], log, 60000, true);
      files.push({ name: path.basename(file), ok: true });
    } catch (e) {
      files.push({ name: path.basename(file), ok: false, error: String(e).substring(0, 120) });
    }
  }
  log(`> Registry backup finished: ${files.filter(f => f.ok).length}/${files.length} branches saved.`);
  return { dir, files };
});

ipcMain.handle('backup-list', async () => {
  const dir = backupDir();
  let backups = [];
  try {
    backups = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.reg')).map(f => {
      let size = 0, time = 0;
      try { const st = fs.statSync(path.join(dir, f)); size = st.size; time = st.mtimeMs; } catch {}
      return { name: f, size, time };
    }).sort((a, b) => b.time - a.time);
  } catch {}
  return { dir, backups };
});

ipcMain.handle('backup-restore', async (event, { file }) => {
  requireAdmin('Restoring registry backups');
  const name = path.basename(String(file || ''));
  if (!/^[A-Za-z0-9_.\-]+\.reg$/i.test(name)) throw new Error('Invalid backup file name');
  const full = path.join(backupDir(), name);
  if (!fs.existsSync(full)) throw new Error('Backup file not found');
  const log = senderLog(event);
  log(`> Importing registry backup: ${name}...`);
  await runSpawn('reg', ['import', full], log, 120000, true);
  log('> Registry backup restored.');
  return 'RESTORED';
});

ipcMain.handle('open-path', async (_, p) => {
  if (typeof p !== 'string' || !p) throw new Error('Invalid path');
  const { shell } = require('electron');
  return shell.openPath(p);
});

// ---------- REGISTRY AUDIT EXPORT ----------

const AUDIT_CONFIG_DIR = (() => {
  const devPath = path.join(__dirname, 'src', 'config');
  if (!app.isPackaged && fs.existsSync(devPath)) return devPath;
  const pkgPath = path.join(BASE_DIR, 'src', 'config');
  if (fs.existsSync(pkgPath)) return pkgPath;
  return devPath;
})();

const AUDIT_SECTIONS = [
  ['windows', 'WINDOWS & VISUAL OPTIMIZATIONS'],
  ['personalize', 'PERSONALIZE & APPEARANCE'],
  ['gaming', 'GAMING OPTIMIZATIONS'],
  ['gpu', 'GPU CONFIGURATIONS'],
  ['power', 'POWER & USB MANAGEMENT'],
  ['network', 'NETWORK & LATENCY'],
  ['privacy', 'PRIVACY SETTINGS'],
  ['winupdate', 'WINDOWS UPDATE CONTROL'],
  ['brave', 'BRAVE BROWSER DEBLOAT'],
  ['others', 'OTHERS (BATCH ENGINE ONLY - NOT SHOWN IN THE UI)']
];

// Pull every `reg add "PATH" /v NAME /t TYPE /d DATA` out of a command string
// or a .bat body. Pure regex, no spawns, no guessing; anything that is not a
// reg-add simply gets no direct registry mapping in the report.
function extractRegPairs(text) {
  const pairs = [];
  if (!text) return pairs;
  const re = /reg(?:\.exe)?\s+add\s+"([^"]+)"\s+\/v\s+("[^"]*"|\S+)\s+\/t\s+(\S+)\s+\/d\s+("[^"]*"|[^\s/]+)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    pairs.push({
      path: m[1],
      value: m[2].replace(/^"|"$/g, ''),
      type: m[3].toUpperCase(),
      data: m[4].replace(/^"|"$/g, '')
    });
  }
  return pairs;
}

function regPairKey(p) {
  return p.path.toLowerCase() + '|' + p.value.toLowerCase();
}

function regPathToPs(p) {
  return p.replace(/^(HKLM|HKCU|HKCR|HKU|HKCC)[\\/]/i, (m, h) => h.toUpperCase() + ':\\');
}

// Presence probe: one PowerShell pass per chunk answers "does this value
// exist in the live registry?" for many (key, value) pairs at once.
// Returns a boolean[] aligned with the input order.
async function auditProbeRegistry(pairs) {
  const flags = [];
  const CHUNK = 60;
  for (let i = 0; i < pairs.length; i += CHUNK) {
    const chunk = pairs.slice(i, i + CHUNK);
    const payload = JSON.stringify(chunk.map((p, j) => ({ k: String(j), p: regPathToPs(p.path), n: p.value }))).replace(/'/g, "''");
    const script = "$ErrorActionPreference = 'SilentlyContinue'; $pairs = ConvertFrom-Json '" + payload + "'; $res = @(); foreach ($p in $pairs) { $e = $false; try { $k = Get-Item -LiteralPath $p.p -ErrorAction Stop; if ($k.GetValueNames() -contains $p.n) { $e = $true } } catch { $e = $false }; $res += [pscustomobject]@{ k = $p.k; e = $e } }; $res | ConvertTo-Json -Compress";
    const r = await psRun(script, 60000);
    let parsed = psJson((r.raw || '').trim());
    if (!parsed && r.raw) {
      const last = r.raw.trim().split(/\r?\n/).filter(Boolean).pop();
      if (last) parsed = psJson(last);
    }
    const list = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
    chunk.forEach((p, j) => { flags.push(list.some(x => String(x.k) === String(j) && x.e === true)); });
  }
  return flags;
}

function pad2(n) { return String(n).padStart(2, '0'); }

function auditLabel(label, value) {
  return '  ' + (label + ' ').padEnd(30, '.') + ' ' + String(value).padStart(4);
}

function buildAuditReport(env) {
  const line = '='.repeat(80);
  const sub = '-'.repeat(80);
  const c = env.counts;
  const L = [];
  L.push(line);
  L.push('  ATOM TOOLBOX - APPLIED TWEAKS AUDIT');
  L.push('  Generated  : ' + env.timestamp);
  L.push('  Computer   : ' + env.computer + '   Windows ' + env.osRelease + ' (' + env.arch + ')');
  L.push('  User       : ' + env.user + '   Elevated: ' + (env.elevated ? 'YES' : 'NO'));
  L.push('  Engine     : ' + env.checks + ' live state checks in ' + env.batches + ' batched PowerShell passes');
  L.push('               ' + env.uniquePairs + ' registry values probed for presence in ' + env.probePasses + ' passes');
  L.push(line);
  L.push('');
  L.push('LEGEND');
  L.push('  [VERIFIED_ENABLED]  live check passed - system matches the applied state');
  L.push('  [DISABLED_DEFAULT]  check failed - value absent, mismatched, or Windows default in effect');
  L.push('  [VALUE_MISSING]     check failed and none of this tweak\'s registry values exist');
  L.push('  [UNVERIFIED]        no automated verification exists for this tweak yet');
  L.push('');
  L.push(sub);
  L.push('  SUMMARY');
  L.push(sub);
  L.push(auditLabel('Total tweaks audited', c.total) + '   across ' + env.sections.length + ' sections');
  L.push(auditLabel('VERIFIED_ENABLED', c.enabled));
  L.push(auditLabel('DISABLED_DEFAULT', c.disabled));
  L.push(auditLabel('VALUE_MISSING', c.missing));
  L.push(auditLabel('UNVERIFIED', c.unverified));
  L.push(auditLabel('Registry-mapped tweaks', c.mapped) + '   (' + env.uniquePairs + ' unique values probed)');
  L.push('  Note: apps (51) and power plans (20) are not audited - no registry state is defined for them.');
  L.push('');
  L.push(sub);
  L.push('  SECTIONS');
  L.push(sub);
  for (const sec of env.sections) {
    L.push('  ' + (sec.title + ' ').padEnd(52, '.') + ' ' + String(sec.rows.length).padStart(3) + ' tweaks, ' + String(sec.enabled || 0).padStart(3) + ' enabled');
  }
  for (const sec of env.sections) {
    L.push('');
    L.push(line);
    L.push('  ' + sec.title + '   (' + sec.rows.length + ' tweaks - ' + (sec.enabled || 0) + ' enabled)');
    L.push(line);
    L.push('');
    for (const r of sec.rows) {
      L.push('  [' + r.status + '] ' + r.name + '   (' + r.id + ')');
      for (const g of r.regs) {
        const typeStr = g.type + (g.data !== '' ? ' = ' + g.data : '');
        L.push('      REG  ' + g.path + ' -> ' + (g.value || '(default)') + '  (' + typeStr + ')  [' + (g.present ? 'PRESENT' : 'MISSING') + ']');
      }
      if (r.check) L.push('      CHK  ' + (r.check.length > 220 ? r.check.slice(0, 220) + ' ...' : r.check));
      L.push('');
    }
  }
  L.push(line);
  L.push('  END OF AUDIT - ' + c.total + ' tweaks reviewed on ' + env.computer);
  L.push(line);
  return L.join('\r\n');
}

ipcMain.handle('audit-export-registry', async (event, opts) => {
  const t0 = Date.now();
  const noDialog = !!(opts && opts.noDialog);

  // 1) Load every audit section from the real config files
  const sections = [];
  for (const [cfg, title] of AUDIT_SECTIONS) {
    let list = [];
    try {
      const raw = fs.readFileSync(path.join(AUDIT_CONFIG_DIR, cfg + '.json'), 'utf8').replace(/^\uFEFF/, '');
      list = JSON.parse(raw);
    } catch { list = []; }
    sections.push({ cfg, title, tweaks: Array.isArray(list) ? list : [], rows: [], enabled: 0 });
  }

  // 2) Collect checks + registry pairs up front (progress needs the totals)
  const checkItems = [];
  for (const sec of sections) for (const t of sec.tweaks) if (t && t.id && t.check) checkItems.push({ sec, t, key: sec.cfg + ':' + t.id });

  const uniquePairs = new Map();
  for (const sec of sections) {
    for (const t of sec.tweaks) {
      if (!t || !t.id) continue;
      const texts = [t.command || ''];
      if (t.script_on) {
        try {
          const f = path.join(SCRIPTS_DIR, t.script_on);
          if (fs.existsSync(f)) texts.push(fs.readFileSync(f, 'utf8'));
        } catch {}
      }
      const seen = new Set();
      t.auditPairs = [];
      for (const p of extractRegPairs(texts.join('\n'))) {
        const k = regPairKey(p);
        if (seen.has(k)) continue;
        seen.add(k);
        t.auditPairs.push(k);
        if (!uniquePairs.has(k)) uniquePairs.set(k, p);
      }
    }
  }
  const pairList = [...uniquePairs.values()];
  const totalWork = (checkItems.length + pairList.length) || 1;
  let workDone = 0;
  const sendProgress = () => { try { event.sender.send('audit-progress', { done: workDone, total: totalWork }); } catch {} };
  sendProgress();

  // 3) Run all live checks through the shared batch engine
  const checkRes = {};
  const CHECKS_PER_CALL = 25;
  for (let i = 0; i < checkItems.length; i += CHECKS_PER_CALL) {
    const sub = checkItems.slice(i, i + CHECKS_PER_CALL).map(c => ({ id: c.key, check: c.t.check }));
    try {
      const r = await batchCheckItems(sub);
      Object.assign(checkRes, (r && r.results) || {});
    } catch {}
    workDone += sub.length;
    sendProgress();
  }

  // 4) Probe registry value presence for every unique extracted pair
  let presence = [];
  try { presence = await auditProbeRegistry(pairList); } catch { presence = pairList.map(() => false); }
  const presentByKey = new Map(pairList.map((p, j) => [regPairKey(p), presence[j]]));
  workDone = totalWork;
  sendProgress();

  // 5) Classify every tweak
  const counts = { total: 0, enabled: 0, disabled: 0, missing: 0, unverified: 0, mapped: 0 };
  for (const sec of sections) {
    for (const t of sec.tweaks) {
      if (!t || !t.id) continue;
      counts.total++;
      const rawCheck = String(t.check || '');
      const res = checkRes[sec.cfg + ':' + t.id];
      const regs = (t.auditPairs || []).map(k => {
        const p = uniquePairs.get(k);
        return { path: p.path, value: p.value, type: p.type, data: p.data, present: presentByKey.get(k) === true };
      });
      let status;
      if (!rawCheck || classifyCheck(rawCheck).kind === 'always-false') status = 'UNVERIFIED';
      else if (res === true) status = 'VERIFIED_ENABLED';
      else if (regs.length && regs.every(g => !g.present)) status = 'VALUE_MISSING';
      else status = 'DISABLED_DEFAULT';
      if (status === 'VERIFIED_ENABLED') { counts.enabled++; sec.enabled++; }
      else if (status === 'VALUE_MISSING') counts.missing++;
      else if (status === 'UNVERIFIED') counts.unverified++;
      else counts.disabled++;
      if (regs.length) counts.mapped++;
      sec.rows.push({ id: t.id, name: t.name || t.id, status, regs, check: rawCheck });
    }
    const rank = { VERIFIED_ENABLED: 0, VALUE_MISSING: 1, UNVERIFIED: 2, DISABLED_DEFAULT: 3 };
    sec.rows.sort((a, b) => (rank[a.status] - rank[b.status]) || a.name.localeCompare(b.name));
  }

  // 6) Build + write the report
  const now = new Date();
  const env = {
    timestamp: now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate()) + ' ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds()),
    computer: os.hostname(),
    osRelease: os.release(),
    arch: process.arch,
    user: (() => { try { return os.userInfo().username; } catch { return 'unknown'; } })(),
    elevated: isAdmin(),
    checks: checkItems.length,
    batches: Math.max(1, Math.ceil(checkItems.length / CHECKS_PER_CALL)),
    uniquePairs: pairList.length,
    probePasses: pairList.length ? Math.ceil(pairList.length / 60) : 0,
    counts: counts,
    sections: sections
  };
  const report = buildAuditReport(env);

  const stamp = env.timestamp.replace(/[: ]/g, '-');
  let dir = '';
  try { dir = app.getPath('downloads'); } catch {}
  if (!dir || !fs.existsSync(dir)) { try { dir = app.getPath('desktop'); } catch {} }
  if (!dir || !fs.existsSync(dir)) dir = app.getPath('userData');
  const file = path.join(dir, 'AtomToolBox-Audit_' + stamp + '.txt');
  fs.writeFileSync(file, '\uFEFF' + report, 'utf8');

  // 7) Success notification with "open the file" choices (non-blocking)
  if (!noDialog) {
    try {
      const { dialog, shell } = require('electron');
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Audit exported',
        message: 'Registry audit saved: ' + counts.enabled + ' enabled / ' + counts.total + ' audited',
        detail: file,
        buttons: ['OPEN FILE', 'SHOW IN FOLDER', 'CLOSE'],
        defaultId: 0,
        cancelId: 2,
        noLink: true
      }).then((choice) => {
        if (!choice) return;
        if (choice.response === 0) shell.openPath(file);
        else if (choice.response === 1) shell.showItemInFolder(file);
      }).catch(() => {});
    } catch {}
  }

  return {
    ok: true,
    file,
    stats: { total: counts.total, enabled: counts.enabled, disabled: counts.disabled, missing: counts.missing, unverified: counts.unverified, mapped: counts.mapped, pairs: pairList.length, ms: Date.now() - t0 }
  };
});

// ---------- POWER PLAN MANAGEMENT ----------

const POWER_PROTECTED = new Set([
  '381b4222-f694-41f0-9685-ff5bb260df2e', // Balanced
  '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c', // High performance
  'a1841308-3541-4fab-bc81-f71556f20b4a', // Power saver
  'e9a42b02-d5df-448d-aa00-03f14749eb61'  // Ultimate Performance (if present)
]);
const POWER_GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

ipcMain.handle('power-plan-list', async () => {
  const r = await psRun('powercfg /list | Out-String', 20000);
  if (!r.ok) return { ok: false, error: r.error, plans: [] };
  const plans = [];
  for (const line of r.raw.split(/\r?\n/)) {
    // Greedy name capture: plan names may themselves contain parentheses
    // (e.g. "High performance (copy)"), so match up to the LAST ')' on the
    // line — otherwise the name is truncated and the ACTIVE '*' is missed.
    const m = line.match(/Power Scheme GUID:\s*([0-9a-fA-F-]{36})\s*\((.+)\)\s*(\*)?/);
    if (m) plans.push({ guid: m[1].toLowerCase(), name: m[2].trim(), active: !!m[3] });
  }
  return { ok: true, plans };
});

ipcMain.handle('power-plan-activate', async (event, { guid }) => {
  requireAdmin('Activating power plans');
  const g = String(guid || '').trim().toLowerCase();
  if (!POWER_GUID_RE.test(g)) throw new Error('Invalid power plan GUID');
  const log = senderLog(event);
  log(`> Activating power plan ${g}...`);
  await runSpawn('powercfg', ['/setactive', g], log, 15000, true);
  log('> Power plan activated.');
  return 'ACTIVATED';
});

ipcMain.handle('power-plan-import', async (event) => {
  requireAdmin('Importing power plans');
  const { dialog } = require('electron');
  let file = null;
  // QA hook: allow the automated test harness to bypass the native file dialog.
  if (process.env.ATOM_QA_IMPORT_PATH) {
    file = process.env.ATOM_QA_IMPORT_PATH;
  } else {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Power Plan (.pow)',
      filters: [{ name: 'Power Plan', extensions: ['pow'] }],
      properties: ['openFile']
    });
    if (res.canceled || !res.filePaths || !res.filePaths.length) return { canceled: true };
    file = res.filePaths[0];
  }
  if (!file || !fs.existsSync(file)) return { canceled: false, error: 'file not found: ' + file };
  const log = senderLog(event);
  log(`> Importing power plan: ${path.basename(file)}...`);
  const out = await runSpawn('powercfg', ['/import', file], log, 30000, true);
  const m = (out || '').match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  log('> Import complete.');
  return { canceled: false, file: path.basename(file), guid: m ? m[0].toLowerCase() : null };
});

ipcMain.handle('power-plan-remove', async (event, { guid }) => {
  requireAdmin('Removing power plans');
  const g = String(guid || '').trim().toLowerCase();
  if (!POWER_GUID_RE.test(g)) throw new Error('Invalid power plan GUID');
  if (POWER_PROTECTED.has(g)) throw new Error('Refused: built-in Windows power plans cannot be removed');
  const act = await psRun('powercfg /getactivescheme | Out-String', 15000);
  const am = ((act.raw || '').match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/) || [])[0];
  if (am && am.toLowerCase() === g) throw new Error('Refused: this plan is currently active — activate another plan first');
  const log = senderLog(event);
  log(`> Removing power plan ${g}...`);
  await runSpawn('powercfg', ['/delete', g], log, 20000, true);
  log('> Power plan removed.');
  return 'DELETED';
});

// ==================== ADVANCED POWER CONFIGURATOR ====================
// Granular read/write of every setting in the ACTIVE power scheme, including
// hidden ones. Read path: one PowerShell spawn per page open. Write path: one
// spawn per change (set AC + DC + setactive + re-query). No polling.

const APC_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const APC_UNLOCK_FILE = () => path.join(app.getPath('userData'), 'atom-unhidden-power.json');

// Both dumps in one spawn: /q (visible only — hidden settings appear header-only)
// and /qh (everything). The difference identifies hidden settings.
const APC_LIST_SCRIPT = `
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
Write-Output '===ATOM_Q==='
Write-Output (powercfg /q SCHEME_CURRENT | Out-String)
Write-Output '===ATOM_QH==='
Write-Output (powercfg /qh SCHEME_CURRENT | Out-String)
`;

function apcSplitDumps(raw) {
  const s = String(raw || '');
  const qhIdx = s.indexOf('===ATOM_QH===');
  if (qhIdx === -1) return { vis: '', all: s };
  const qIdx = s.indexOf('===ATOM_Q===');
  const vis = qIdx !== -1 ? s.slice(qIdx + '===ATOM_Q==='.length, qhIdx) : '';
  const all = s.slice(qhIdx + '===ATOM_QH==='.length);
  return { vis, all };
}

function apcToInt(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  const n = /^0x/i.test(s) ? parseInt(s.slice(2), 16) : parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

// Parse `powercfg /q`-style output. Anchors on GUID-plus-parens and indentation
// depth (labels may be localized); every missing field degrades to null.
function apcParse(text) {
  const subgroups = [];
  let sg = null, st = null, pendingIdx = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const ind = line.length - line.trimStart().length;

    const guidM = trimmed.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*\(\s*(.+?)\s*\)\s*$/i);
    if (guidM) {
      if (ind === 0) continue; // "Power Scheme GUID" header line
      if (ind <= 3) { sg = { guid: guidM[1].toLowerCase(), name: guidM[2], settings: [] }; subgroups.push(sg); st = null; pendingIdx = null; continue; }
      if (ind <= 6 && sg) { st = { guid: guidM[1].toLowerCase(), name: guidM[2], alias: null, ac: null, dc: null, min: null, max: null, inc: null, units: null, values: [], _hex: [], _pairs: [], _pairIdx: null }; sg.settings.push(st); pendingIdx = null; continue; }
      continue;
    }

    let m;
    if (st && !st.alias && (m = trimmed.match(/GUID Alias:\s*(\S+)/i))) { st.alias = m[1]; continue; }
    if (st && (m = trimmed.match(/Possible Setting Index:\s*(\d+)/i))) { pendingIdx = apcToInt(m[1]); continue; }
    if (st && pendingIdx !== null && (m = trimmed.match(/Possible Setting Friendly Name:\s*(.+?)\s*$/i))) { st.values.push({ index: pendingIdx, name: m[1] }); pendingIdx = null; continue; }
    if (st && (m = trimmed.match(/Current AC[^:]*:\s*(0x[0-9a-f]+|\d+)/i))) { const v = apcToInt(m[1]); if (v !== null) st.ac = v; continue; }
    if (st && (m = trimmed.match(/Current DC[^:]*:\s*(0x[0-9a-f]+|\d+)/i))) { const v = apcToInt(m[1]); if (v !== null) st.dc = v; continue; }
    if (st && (m = trimmed.match(/Minimum Possible Setting:\s*(0x[0-9a-f]+|\d+)/i))) { st.min = apcToInt(m[1]); continue; }
    if (st && (m = trimmed.match(/Maximum Possible Setting:\s*(0x[0-9a-f]+|\d+)/i))) { st.max = apcToInt(m[1]); continue; }
    if (st && (m = trimmed.match(/Possible Settings increment:\s*(0x[0-9a-f]+|\d+)/i))) { st.inc = apcToInt(m[1]); continue; }
    if (st && (m = trimmed.match(/Possible Settings units:\s*(.+?)\s*$/i))) { st.units = m[1]; continue; }

    // Structural, label-independent fallbacks (for localized Windows builds):
    // collect raw hex values and index->name colon pairs; real labels above win.
    if (st) {
      const hm = trimmed.match(/0x([0-9a-fA-F]+)\s*$/);
      if (hm) { const v = apcToInt(hm[0]); if (v !== null) st._hex.push(v); }
      const im = trimmed.match(/:\s*(\d{1,5})\s*$/);
      const nm = trimmed.match(/:\s*(.+?)\s*$/);
      if (im) { st._pairIdx = apcToInt(im[1]); }
      else if (nm && st._pairIdx !== null) { st._pairs.push({ index: st._pairIdx, name: nm[1] }); st._pairIdx = null; }
    }
  }
  // Apply structural fallbacks + strip internal fields.
  // Visible blocks end with [.., AC, DC] hex values; hidden blocks carry none.
  for (const g of subgroups) for (const s of g.settings) {
    if (s.ac === null && s._hex.length >= 2) { s.ac = s._hex[s._hex.length - 2]; s.dc = s._hex[s._hex.length - 1]; }
    if (!s.values.length && s._pairs.length) s.values = s._pairs;
    if (s.min === null && s.max === null && s._hex.length >= 4) { s.min = s._hex[0]; s.max = s._hex[1]; }
    delete s._hex; delete s._pairs; delete s._pairIdx;
  }
  return { subgroups };
}

// One spawn per change: set AC + DC on the active scheme, re-activate, then
// re-query THIS setting so the UI reports what Windows actually holds.
function apcSetScript(sub, set, ac, dc) {
  return `
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$line = powercfg /getactivescheme | Out-String
$scheme = ''
$gm = [regex]::Match($line, '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')
if ($gm.Success) { $scheme = $gm.Value }
if (-not $scheme) { Write-Output 'ATOM_RESULT=FAIL;AC=;DC='; exit 1 }
$ok = $true
powercfg /setacvalueindex $scheme ${sub} ${set} ${ac}
if ($LASTEXITCODE -ne 0) { $ok = $false }
powercfg /setdcvalueindex $scheme ${sub} ${set} ${dc}
if ($LASTEXITCODE -ne 0) { $ok = $false }
powercfg /setactive $scheme | Out-Null
$out = powercfg /qh $scheme ${sub} ${set} | Out-String
$acr = ''
$dcr = ''
$m = [regex]::Match($out, 'AC[^\\r\\n]*?0x([0-9a-fA-F]+)')
if ($m.Success) { $acr = [Convert]::ToInt32($m.Groups[1].Value, 16) }
$m = [regex]::Match($out, 'DC[^\\r\\n]*?0x([0-9a-fA-F]+)')
if ($m.Success) { $dcr = [Convert]::ToInt32($m.Groups[1].Value, 16) }
$hx = [regex]::Matches($out, '0x([0-9a-fA-F]+)')
if ($acr -eq '' -and $dcr -eq '' -and $hx.Count -ge 2) { $acr = [Convert]::ToInt32($hx[$hx.Count - 2].Groups[1].Value, 16); $dcr = [Convert]::ToInt32($hx[$hx.Count - 1].Groups[1].Value, 16) }
Write-Output ('ATOM_RESULT=' + $(if ($ok) { 'OK' } else { 'FAIL' }) + ';AC=' + $acr + ';DC=' + $dcr)
`;
}

ipcMain.handle('advpower-list', async () => {
  optimizerOnly('Advanced Power');
  const r = await psRun(APC_LIST_SCRIPT, 90000);
  const { vis, all } = apcSplitDumps(r.raw);
  const qhModel = apcParse(all);
  if (!qhModel.subgroups.length) return { ok: false, error: (r.error || 'no power data parsed') };
  const visible = new Set();
  const qModel = apcParse(vis);
  for (const sg of qModel.subgroups) for (const st of sg.settings) if (st.ac !== null) visible.add(st.guid);
  // Only trust the hidden flag when the visible dump actually yielded values;
  // otherwise (odd build/locale) report everything as visible rather than mislabeling.
  const visOk = visible.size > 0;
  let hiddenCount = 0, settingsCount = 0;
  for (const sg of qhModel.subgroups) for (const st of sg.settings) {
    settingsCount++;
    st.hidden = visOk ? !visible.has(st.guid) : false;
    if (st.hidden) hiddenCount++;
  }
  return { ok: true, subgroups: qhModel.subgroups, settingsCount, hiddenCount };
});

ipcMain.handle('advpower-set', async (event, { subgroup, setting, ac, dc, min, max, name }) => {
  optimizerOnly('Advanced Power');
  requireAdmin('Changing advanced power settings');
  const sub = String(subgroup || '').trim().toLowerCase();
  const set = String(setting || '').trim().toLowerCase();
  if (!APC_KEY_RE.test(sub) || !APC_KEY_RE.test(set)) throw new Error('Invalid power setting identifiers');
  const acVal = Number(ac);
  const dcVal = (dc === undefined || dc === null) ? acVal : Number(dc);
  const bad = v => !Number.isInteger(v) || v < 0 || v > 0xFFFFFFFF;
  if (bad(acVal) || bad(dcVal)) throw new Error('Invalid value');
  if (Number.isFinite(min) && acVal < min) throw new Error('Value below minimum (' + min + ')');
  if (Number.isFinite(max) && acVal > max) throw new Error('Value above maximum (' + max + ')');
  const log = senderLog(event);
  log('> Setting ' + (name || sub.slice(0, 8)) + ' to ' + acVal + ' (AC + DC)...');
  const r = await psRun(apcSetScript(sub, set, acVal, dcVal), 90000);
  const m = (r.raw || '').match(/ATOM_RESULT=(OK|FAIL);AC=(\d+|-)?;DC=(\d+|-)?/);
  const ok = !!m && m[1] === 'OK';
  const newAc = m && m[2] && m[2] !== '-' ? parseInt(m[2], 10) : null;
  const newDc = m && m[3] && m[3] !== '-' ? parseInt(m[3], 10) : null;
  if (!ok) {
    log('> ERROR: powercfg rejected the change');
    return { ok: false, error: r.error || 'powercfg rejected the change', ac: newAc, dc: newDc };
  }
  log('> Applied and verified: AC=' + newAc + ' DC=' + newDc);
  return { ok: true, ac: newAc, dc: newDc };
});

// Derive the hidden-setting pair list by diffing the visible-only and full dumps.
async function apcHiddenPairs() {
  const r = await psRun(APC_LIST_SCRIPT, 90000);
  if (!r.raw) return { error: r.error || 'read failed', pairs: [] };
  const { vis, all } = apcSplitDumps(r.raw);
  const qhModel = apcParse(all);
  const qModel = apcParse(vis);
  if (!qhModel.subgroups.length || !qModel.subgroups.length) return { error: 'power query failed', pairs: [] };
  const visible = new Set();
  for (const sg of qModel.subgroups) for (const st of sg.settings) if (st.ac !== null) visible.add(st.guid);
  if (!visible.size) return { error: 'could not read the visibility state from powercfg output', pairs: [] };
  const pairs = [];
  for (const sg of qhModel.subgroups) for (const st of sg.settings) {
    if (!visible.has(st.guid)) pairs.push({ sub: sg.guid, set: st.guid, name: st.name });
  }
  return { pairs };
}

function apcAttrScript(pairs, hide) {
  const sign = hide ? "'+ATTRIB_HIDE'" : "'-ATTRIB_HIDE'";
  const lines = pairs.map((p, i) => `powercfg -attributes ${p.sub} ${p.set} ${sign}; if ($LASTEXITCODE -eq 0) { $n++ } else { $failed += ' ${i}' }`);
  return `
$n = 0
$failed = ''
${lines.join('\n')}
Write-Output ('ATOM_UNLOCK=' + $n + ';FAILED=' + $failed)
`;
}

ipcMain.handle('advpower-unlock', async (event, { mode }) => {
  optimizerOnly('Advanced Power');
  const hide = mode === 'hide';
  requireAdmin(hide ? 'Re-hiding power settings' : 'Showing hidden power settings');
  const log = senderLog(event);
  let pairs;
  if (hide) {
    try { pairs = (JSON.parse(fs.readFileSync(APC_UNLOCK_FILE(), 'utf8')).pairs || []); } catch { pairs = []; }
    if (!pairs.length) return { ok: false, error: 'No unlock record found — nothing to restore' };
  } else {
    const d = await apcHiddenPairs();
    if (d.error) return { ok: false, error: d.error };
    pairs = d.pairs;
    if (!pairs.length) return { ok: true, count: 0, total: 0, note: 'All settings are already visible in Control Panel' };
  }
  pairs = pairs.filter(p => p && APC_KEY_RE.test(String(p.sub || '')) && APC_KEY_RE.test(String(p.set || '')));
  if (!pairs.length) return { ok: false, error: 'No valid settings to process' };
  log('> ' + (hide ? 'Re-hiding' : 'Showing') + ' ' + pairs.length + ' settings in Windows Control Panel...');
  const r = await psRun(apcAttrScript(pairs, hide), 300000);
  const m = (r.raw || '').match(/ATOM_UNLOCK=(\d+);FAILED=([^;\r\n]*)/);
  if (!m) return { ok: false, error: r.error || 'no result from powercfg', count: 0, total: pairs.length };
  const count = parseInt(m[1], 10);
  const failedIdx = m[2].trim() ? m[2].trim().split(/\s+/).map(Number) : [];
  const failedPairs = pairs.filter((p, i) => failedIdx.indexOf(i) !== -1);
  if (hide) {
    if (failedPairs.length) {
      try { fs.writeFileSync(APC_UNLOCK_FILE(), JSON.stringify({ time: Date.now(), pairs: failedPairs }), 'utf8'); } catch {}
    } else {
      try { fs.unlinkSync(APC_UNLOCK_FILE()); } catch {}
    }
  } else if (count > 0) {
    try { fs.writeFileSync(APC_UNLOCK_FILE(), JSON.stringify({ time: Date.now(), pairs }), 'utf8'); } catch {}
  }
  if (!count && failedIdx.length === pairs.length) {
    return { ok: false, error: 'powercfg rejected the attribute change', count, total: pairs.length };
  }
  log('> ' + count + '/' + pairs.length + ' settings ' + (hide ? 're-hidden' : 'made visible') + '.');
  return { ok: true, count, total: pairs.length };
});

// ==================== POWER PLAN STUDIO ====================
// Full management of ANY installed scheme (not just the active one): read every
// advanced setting of a chosen scheme (visible + hidden), write AC/DC values on
// it, rename (+ description), duplicate and export .pow. Every write is
// verified with a powercfg read-back before it is reported as applied.

function ppsListScript(guid) {
  return `
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
Write-Output '===ATOM_Q==='
Write-Output (powercfg /q ${guid} | Out-String)
Write-Output '===ATOM_QH==='
Write-Output (powercfg /qh ${guid} | Out-String)
`;
}

// Name / active flag (powercfg /list) + description (registry; indirect
// resource strings like "@dll,-1000" are reported as null = built-in).
function ppsInfoScript(guid) {
  return `
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$g = '${guid}'
$list = powercfg /list | Out-String
$name = $null
$active = $false
foreach ($line in ($list -split "\\r?\\n")) {
  if ($line.ToLower().Contains($g)) {
    $m = [regex]::Match($line, '\\((.+?)\\)\\s*(\\*)?\\s*$')
    if ($m.Success) { $name = $m.Groups[1].Value.Trim() }
    if ($line.Contains('*')) { $active = $true }
  }
}
$desc = $null
try {
  $d = (Get-ItemProperty -Path ('HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power\\User\\PowerSchemes\\' + $g) -Name 'Description' -ErrorAction Stop).Description
  if ($d -and -not ([string]$d).StartsWith('@')) { $desc = [string]$d }
} catch { }
@{ ok = ($null -ne $name); name = $name; description = $desc; active = $active } | ConvertTo-Json -Compress
`;
}

// Set AC + DC on an EXPLICIT scheme. Re-activates the scheme only when it is
// the active one (so live systems pick the change up immediately); other
// schemes just store the new indexes until the user activates them.
function ppsSetScript(guid, sub, set, ac, dc) {
  return `
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$scheme = '${guid}'
$activeLine = powercfg /getactivescheme | Out-String
$isActive = $activeLine.ToLower().Contains('${guid}')
$ok = $true
powercfg /setacvalueindex $scheme ${sub} ${set} ${ac} | Out-Null
if ($LASTEXITCODE -ne 0) { $ok = $false }
powercfg /setdcvalueindex $scheme ${sub} ${set} ${dc} | Out-Null
if ($LASTEXITCODE -ne 0) { $ok = $false }
if ($isActive) { powercfg /setactive $scheme | Out-Null }
$out = powercfg /qh $scheme ${sub} ${set} | Out-String
$acr = $null
$dcr = $null
$m = [regex]::Match($out, 'AC[^\\r\\n]*?0x([0-9a-fA-F]+)')
if ($m.Success) { $acr = [Convert]::ToInt64($m.Groups[1].Value, 16) }
$m = [regex]::Match($out, 'DC[^\\r\\n]*?0x([0-9a-fA-F]+)')
if ($m.Success) { $dcr = [Convert]::ToInt64($m.Groups[1].Value, 16) }
if ($null -eq $acr -and $null -eq $dcr) {
  $hx = [regex]::Matches($out, '0x([0-9a-fA-F]+)')
  if ($hx.Count -ge 2) {
    $acr = [Convert]::ToInt64($hx[$hx.Count - 2].Groups[1].Value, 16)
    $dcr = [Convert]::ToInt64($hx[$hx.Count - 1].Groups[1].Value, 16)
  }
}
@{ ok = $ok; active = $isActive; ac = $acr; dc = $dcr } | ConvertTo-Json -Compress
`;
}

ipcMain.handle('pp-settings', async (event, { guid }) => {
  const g = String(guid || '').trim().toLowerCase();
  if (!POWER_GUID_RE.test(g)) return { ok: false, error: 'Invalid power plan GUID' };
  const r = await psRun(ppsListScript(g), 90000);
  const { vis, all } = apcSplitDumps(r.raw);
  const qhModel = apcParse(all);
  if (!qhModel.subgroups.length) return { ok: false, error: r.error || 'no power data parsed' };
  const visible = new Set();
  const qModel = apcParse(vis);
  for (const sg of qModel.subgroups) for (const st of sg.settings) if (st.ac !== null) visible.add(st.guid);
  const visOk = visible.size > 0;
  let hiddenCount = 0, settingsCount = 0;
  for (const sg of qhModel.subgroups) for (const st of sg.settings) {
    settingsCount++;
    st.hidden = visOk ? !visible.has(st.guid) : false;
    if (st.hidden) hiddenCount++;
  }
  const info = await psRun(ppsInfoScript(g), 20000);
  const j = psJson(info.raw) || {};
  return { ok: true, guid: g, subgroups: qhModel.subgroups, settingsCount, hiddenCount, name: j.name || null, description: j.description || null, active: !!j.active };
});

ipcMain.handle('pp-setvalue', async (event, { guid, subgroup, setting, ac, dc, min, max, name }) => {
  requireAdmin('Changing power plan settings');
  const g = String(guid || '').trim().toLowerCase();
  const sub = String(subgroup || '').trim().toLowerCase();
  const set = String(setting || '').trim().toLowerCase();
  if (!POWER_GUID_RE.test(g)) throw new Error('Invalid power plan GUID');
  if (!APC_KEY_RE.test(sub) || !APC_KEY_RE.test(set)) throw new Error('Invalid power setting identifiers');
  const acVal = Number(ac);
  const dcVal = (dc === undefined || dc === null) ? acVal : Number(dc);
  const bad = v => !Number.isInteger(v) || v < 0 || v > 0xFFFFFFFF;
  if (bad(acVal) || bad(dcVal)) throw new Error('Invalid value');
  if (Number.isFinite(min) && acVal < min) throw new Error('Value below minimum (' + min + ')');
  if (Number.isFinite(max) && acVal > max) throw new Error('Value above maximum (' + max + ')');
  const log = senderLog(event);
  log('> ' + (name || 'Setting') + ': setting to AC=' + acVal + ' DC=' + dcVal + '...');
  const r = await psRun(ppsSetScript(g, sub, set, acVal, dcVal), 90000);
  const j = psJson(r.raw);
  if (!j || !j.ok) {
    log('> ERROR: powercfg rejected the change');
    return { ok: false, error: r.error || 'powercfg rejected the change', ac: j ? j.ac : null, dc: j ? j.dc : null };
  }
  const verified = (j.ac === acVal && j.dc === dcVal);
  log(verified ? ('> Applied and verified: AC=' + j.ac + ' DC=' + j.dc) : ('> Applied; read-back AC=' + j.ac + ' DC=' + j.dc));
  return { ok: true, verified, ac: j.ac, dc: j.dc, active: !!j.active };
});

ipcMain.handle('pp-rename', async (event, { guid, name, description }) => {
  requireAdmin('Renaming power plans');
  const g = String(guid || '').trim().toLowerCase();
  if (!POWER_GUID_RE.test(g)) throw new Error('Invalid power plan GUID');
  const nm = String(name || '').replace(/[\r\n\t]+/g, ' ').trim();
  if (!nm || nm.length > 120) throw new Error('Plan name must be 1-120 characters');
  const ds = String(description || '').replace(/[\r\n\t]+/g, ' ').trim();
  if (ds.length > 400) throw new Error('Description too long (max 400 characters)');
  const log = senderLog(event);
  log('> Renaming plan ' + g + ' to "' + nm + '"...');
  await runSpawn('powercfg', ['/changename', g, nm, ds], log, 20000, true);
  const info = await psRun(ppsInfoScript(g), 20000);
  const j = psJson(info.raw) || {};
  const nameOk = (j.name === nm);
  if (nameOk) log('> Verified: plan renamed (read-back check passed).');
  else log('> ERROR: rename could not be verified');
  return { ok: nameOk, verified: nameOk, name: j.name || nm, description: j.description || null, active: !!j.active };
});

ipcMain.handle('pp-duplicate', async (event, { guid, name, description }) => {
  requireAdmin('Duplicating power plans');
  const g = String(guid || '').trim().toLowerCase();
  if (!POWER_GUID_RE.test(g)) throw new Error('Invalid power plan GUID');
  const log = senderLog(event);
  const beforeRaw = await psRun('powercfg /list | Out-String', 20000);
  const before = new Set(((beforeRaw.raw || '').toLowerCase().match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || []));
  log('> Duplicating plan ' + g + '...');
  const out = await runSpawn('powercfg', ['/duplicatescheme', g], log, 30000, true);
  const afterRaw = await psRun('powercfg /list | Out-String', 20000);
  const afterList = ((afterRaw.raw || '').toLowerCase().match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || []);
  let newGuid = null;
  for (const cand of afterList) { if (!before.has(cand)) { newGuid = cand; break; } }
  if (!newGuid) {
    const m = String(out || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (m) newGuid = m[0].toLowerCase();
  }
  if (!newGuid) { log('> ERROR: could not determine the GUID of the duplicate'); return { ok: false, error: 'could not determine the GUID of the duplicate' }; }
  const nm = String(name || '').replace(/[\r\n\t]+/g, ' ').trim().substring(0, 120);
  if (nm) {
    const ds = String(description || '').replace(/[\r\n\t]+/g, ' ').trim();
    await runSpawn('powercfg', ['/changename', newGuid, nm, ds], log, 20000, true);
  }
  const info = await psRun(ppsInfoScript(newGuid), 20000);
  const j = psJson(info.raw) || {};
  log('> Duplicate created: ' + (j.name || '?') + ' (' + newGuid + ')');
  return { ok: true, guid: newGuid, name: j.name || nm || null };
});

ipcMain.handle('pp-export', async (event, { guid, suggestedName }) => {
  const g = String(guid || '').trim().toLowerCase();
  if (!POWER_GUID_RE.test(g)) throw new Error('Invalid power plan GUID');
  const { dialog } = require('electron');
  const safe = String(suggestedName || 'power-plan').replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().substring(0, 80) || 'power-plan';
  let file = null;
  // QA hook: allow the automated test harness to bypass the native save dialog.
  if (process.env.ATOM_QA_EXPORT_PATH) {
    file = process.env.ATOM_QA_EXPORT_PATH;
  } else {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Power Plan (.pow)',
      defaultPath: safe + '.pow',
      filters: [{ name: 'Power Plan', extensions: ['pow'] }]
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    file = res.filePath;
  }
  const log = senderLog(event);
  try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
  log('> Exporting plan to ' + path.basename(file) + '...');
  await runSpawn('powercfg', ['/export', file, g], log, 30000, true);
  let size = 0;
  try { size = fs.statSync(file).size; } catch {}
  const ok = size > 0;
  if (ok) log('> Export verified: ' + path.basename(file) + ' (' + size + ' bytes).');
  else log('> ERROR: export produced no file');
  return { ok, canceled: false, file, size };
});

// ---------- TIMER RESOLUTION (POWER PLANS page) ----------
// Windows serves the finest system-timer request held by ANY process. The
// helper script below is such a process: while it runs the whole system gets
// the fast tick (0.5 or 1 ms). The app spawns it as a hidden child process
// (no console flash, no window); it lives exactly as long as this app and the
// OS releases the request automatically the moment it stops — so closing the
// app, pressing RESTORE, or rebooting can never leave the timer raised.
const TIMER_RES_TOOL = path.join(SCRIPTS_DIR, 'powerplans', 'timer_res.ps1');

async function timerResStatus() {
  const r = await psFile(TIMER_RES_TOOL, ['-Action', 'status'], 20000);
  const j = psJson(r.raw);
  if (!j) return { ok: false, error: r.error || 'timer status failed', currentMs: null, fastestMs: null, slowestMs: null, holder: false, holderMs: null, holderPid: null };
  return {
    ok: true,
    currentMs: j.currentMs,
    fastestMs: j.fastestMs,
    slowestMs: j.slowestMs,
    holder: !!j.holder,
    holderMs: j.holderMs,
    holderPid: j.holderPid
  };
}

ipcMain.handle('timer-res-status', async () => timerResStatus());

ipcMain.handle('timer-res-apply', async (event, { ms } = {}) => {
  const log = senderLog(event);
  const target = Math.max(0.5, Math.min(15.625, Number(ms) || 0.5));
  const units = Math.round(target * 10000);
  const before = await timerResStatus();
  if (before.ok && before.holder && Math.abs((before.holderMs || 0) - target) < 0.001) {
    log('> Timer helper already holds ' + target + ' ms (PID ' + before.holderPid + ').');
    return { ok: true, already: true, ...before };
  }
  if (before.ok && before.holder) {
    log('> Switching timer resolution ' + before.holderMs + ' -> ' + target + ' ms (restarting helper)...');
    await psFile(TIMER_RES_TOOL, ['-Action', 'release'], 20000);
  } else {
    log('> Starting timer helper (target ' + target + ' ms)...');
  }
  const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', TIMER_RES_TOOL, '-Action', 'hold', '-Units', String(units)], { cwd: BASE_DIR, windowsHide: true, stdio: 'ignore' });
  child.on('error', () => {});
  if (typeof child.unref === 'function') child.unref();
  // A cold Add-Type compile can take a few seconds — poll for the state file.
  let after = before;
  for (let i = 0; i < 24; i++) {
    await new Promise(res => setTimeout(res, 500));
    after = await timerResStatus();
    if (after.ok && after.holder) break;
  }
  if (after.ok && after.holder) {
    log('> Timer verified: helper PID ' + after.holderPid + ' holding ' + after.holderMs + ' ms | live system timer ' + after.currentMs + ' ms.');
    return { ok: true, ...after, targetMs: target };
  }
  log('> ERROR: timer helper did not start.');
  try { await psFile(TIMER_RES_TOOL, ['-Action', 'release'], 20000); } catch {}
  return { ok: false, error: 'helper did not start', currentMs: after && after.currentMs, holder: false, targetMs: target };
});

ipcMain.handle('timer-res-release', async (event) => {
  const log = senderLog(event);
  log('> Stopping timer helper...');
  const r = await psFile(TIMER_RES_TOOL, ['-Action', 'release'], 20000);
  const j = psJson(r.raw) || {};
  await new Promise(res => setTimeout(res, 400));
  const after = await timerResStatus();
  if (j.released) log('> Helper stopped. Live system timer: ' + (after.currentMs != null ? after.currentMs + ' ms' : 'unknown') + ' (default restored unless another app holds its own request).');
  else log('> No timer helper was running.');
  return {
    ok: !!after.ok,
    released: !!j.released,
    currentMs: after.currentMs,
    fastestMs: after.fastestMs,
    slowestMs: after.slowestMs,
    holder: !!after.holder,
    holderMs: after.holderMs,
    holderPid: after.holderPid
  };
});

// ---------- STARTUP MANAGER ----------

const STARTUP_TOOL = path.join(SCRIPTS_DIR, 'startup', 'startup_tool.ps1');
const MENU_TOOL = path.join(SCRIPTS_DIR, 'contextmenu', 'menu_tool.ps1');

// Run a helper .ps1 file with arguments. Never rejects — resolves { ok, raw, error }.
function psFile(scriptPath, args, timeout = 30000) {
  return new Promise((resolve) => {
    const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args], { cwd: BASE_DIR, windowsHide: true });
    let out = '', err = '', done = false;
    let timer = null;
    const finish = (result) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    timer = setTimeout(() => {
      try { proc.kill(); } catch {}
      finish({ ok: false, error: 'timeout', raw: out.trim() });
    }, timeout);
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) finish({ ok: true, raw: out.trim(), stderr: err.trim() });
      else finish({ ok: false, error: (err.trim() || ('exit code ' + code)), raw: out.trim() });
    });
    proc.on('error', e => finish({ ok: false, error: e.message }));
  });
}

ipcMain.handle('startup-list', async () => {
  if (!fs.existsSync(STARTUP_TOOL)) return { ok: false, error: 'startup tool not found' };
  const r = await psFile(STARTUP_TOOL, ['-Action', 'list'], 30000);
  const data = psJson(r.raw);
  if (!data || data.ok !== true) return { ok: false, error: (data && data.error) || r.error || 'scan failed' };
  let items = data.items;
  if (items && !Array.isArray(items)) items = [items];
  return { ok: true, items: items || [], stats: data.stats || null };
});

ipcMain.handle('startup-set', async (event, { id, action }) => {
  if (!fs.existsSync(STARTUP_TOOL)) throw new Error('startup tool not found');
  const sid = String(id || '');
  const act = action === 'enable' ? 'enable' : (action === 'disable' ? 'disable' : null);
  if (!act) throw new Error('Invalid startup action');
  if (!/^(run-hkcu|run-hklm|run-hkcu32|run-hklm32|folder-user|folder-common)\|.+$/.test(sid)) throw new Error('Invalid startup item id');
  if (/^(run-hklm|run-hklm32|folder-common)\|/.test(sid)) requireAdmin('Changing all-users startup items');
  const log = senderLog(event);
  log('> Startup ' + act + ': ' + sid);
  const r = await psFile(STARTUP_TOOL, ['-Action', 'set', '-Id', sid, '-State', act], 30000);
  const data = psJson(r.raw);
  if (!data) { log('> ERROR: no result from startup tool'); return { ok: false, error: r.error || 'no result' }; }
  if (data.ok && data.verified) {
    log('> Verified: "' + data.name + '" is now ' + (data.state === 'disabled' ? 'DISABLED' : 'ENABLED') + ' (read-back check passed).');
  } else {
    log('> ERROR: ' + (data.error || 'verification failed'));
  }
  return data;
});

// ---------- CONTEXT MENU (add entries) ----------

// Live registry state for the script-backed "add" entries. The helper reports
// per-verb presence; a verb being absent is a normal OFF state, not an error.
ipcMain.handle('cm-state', async () => {
  if (!fs.existsSync(MENU_TOOL)) return { ok: false, error: 'menu tool not found' };
  const r = await psFile(MENU_TOOL, ['-Verb', 'all', '-Action', 'check'], 40000);
  const data = psJson(r.raw);
  if (!data || !Array.isArray(data.results)) return { ok: false, error: (data && data.error) || r.error || 'check failed' };
  return { ok: true, results: data.results };
});

ipcMain.handle('window-minimize', () => mainWindow.minimize());
ipcMain.handle('window-maximize', () => {
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.handle('window-close', () => mainWindow.close());

// Match the native window background to the active UI theme (avoids a
// mismatched first frame / resize flash). Theme names only — no raw colors.
// The choice is persisted to userData so the very first window frame is correct.
const THEME_BG = { dark: '#161616', oled: '#000000', light: '#f4f5f7' };
const themeFile = () => path.join(app.getPath('userData'), 'atom-theme.json');
function loadThemeFile() {
  try {
    const t = JSON.parse(fs.readFileSync(themeFile(), 'utf8')).theme;
    return (t === 'oled' || t === 'light') ? t : 'dark';
  } catch { return 'dark'; }
}
ipcMain.handle('set-theme', (event, theme) => {
  const t = (theme === 'oled' || theme === 'light') ? theme : 'dark';
  try { fs.writeFileSync(themeFile(), JSON.stringify({ theme: t }), 'utf8'); } catch {}
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(THEME_BG[t]);
  return true;
});
