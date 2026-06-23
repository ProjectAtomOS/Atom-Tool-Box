const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');

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
    frame: false, backgroundColor: '#0a0a0a', icon: path.join(__dirname, 'assets', 'icons', 'app.png'),
    title: '', show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
      spellcheck: false,
      enableRemoteModule: false
    }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ---------- Lightweight system info (no heavy systeminformation library) ----------

let _cpuLast = null;
let _cpuLastTime = 0;
let _cpuLoadCache = { load: 0, time: 0 };

function getCpuLoad() {
  return new Promise((resolve) => {
    const now = Date.now();
    if (now - _cpuLoadCache.time < 30000) {
      resolve(_cpuLoadCache.load);
      return;
    }
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;
    for (const cpu of cpus) {
      const t = cpu.times;
      idle += t.idle;
      total += t.user + t.nice + t.sys + t.idle + t.irq;
    }
    if (_cpuLast && now - _cpuLastTime > 100) {
      const idleDelta = idle - _cpuLast.idle;
      const totalDelta = total - _cpuLast.total;
      const load = totalDelta > 0 ? ((totalDelta - idleDelta) / totalDelta) * 100 : 0;
      const rounded = Math.min(Math.round(load), 100);
      _cpuLoadCache = { load: rounded, time: now };
      resolve(rounded);
    } else {
      resolve(_cpuLoadCache.load);
    }
    _cpuLast = { idle, total };
    _cpuLastTime = now;
  });
}

async function getDiskInfo() {
  return new Promise((resolve) => {
    const ps = `Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'" | Select-Object Size,FreeSpace | ConvertTo-Json -Compress`;
    const proc = spawn('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true });
    let out = '';
    proc.stdout.on('data', d => out += d);
    const timer = setTimeout(() => {
      try { proc.kill(); } catch {}
      resolve({ size: 0, used: 0 });
    }, 10000);
    proc.on('close', () => {
      clearTimeout(timer);
      try {
        const data = JSON.parse(out);
        const size = data.Size || 0;
        const free = data.FreeSpace || 0;
        const used = size > 0 ? Math.round(((size - free) / size) * 100) : 0;
        resolve({ size, used });
      } catch {
        resolve({ size: 0, used: 0 });
      }
    });
    proc.on('error', () => {
      clearTimeout(timer);
      resolve({ size: 0, used: 0 });
    });
  });
}

async function getGpuModel() {
  return new Promise((resolve) => {
    const ps = `Get-CimInstance Win32_VideoController | Select-Object -First 1 Name | ConvertTo-Json -Compress`;
    const proc = spawn('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true });
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

ipcMain.handle('get-system-info', async () => {
  const now = Date.now();
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

  if (!infoCache.disk || now - infoCache.diskTime > 300000) {
    const disk = await getDiskInfo();
    infoCache.disk = disk;
    infoCache.diskTime = now;
  }

  if (!infoCache.gpu) {
    const gpu = await getGpuModel();
    infoCache.gpu = gpu;
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
  return ['hklm\\', 'sc config', 'sc stop', 'sc start', 'sc delete', 'netsh', 'powercfg /setactive', 'powercfg /import', 'powercfg -duplicatescheme', 'powercfg /delete', 'bcdedit', 'wmic', 'wevtutil', 'net stop wuauserv', 'net start wuauserv', 'c:\\windows\\temp', 'c:\\$recycle.bin', 'c:\\windows\\prefetch', 'c:\\windows\\minidump', 'c:\\windows\\softwaredistribution'].some(k => lower.includes(k));
}

// Spawn a process and stream output to the UI log. Returns a promise.
function runSpawn(executable, args, log, timeout = 30000, strict = false) {
  return new Promise((resolve, reject) => {
    const proc = spawn(executable, args, { cwd: BASE_DIR, windowsHide: true });
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
      await runSpawn('cmd', ['/c', command], log, 30000);
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

ipcMain.handle('check-tweak', async (event, { command }) => {
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
      args = ['-NoProfile', '-Command', script];
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
        console.log('[check-tweak] TIMEOUT after 30s');
        try { proc.kill(); } catch {}
        resolve({ enabled: false, error: 'timeout', stderr: errOut || 'process timed out' });
      }
    }, 30000);

    proc.on('close', (code) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        console.log('[check-tweak] exit code:', code, 'stderr:', errOut.substring(0, 200));
        resolve({ enabled: code === 0, exitCode: code, stderr: errOut });
      }
    });
    proc.on('error', (err) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        console.log('[check-tweak] spawn error:', err.message);
        resolve({ enabled: false, error: err.message });
      }
    });
  });
});

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
  const { shell } = require('electron');
  return shell.openExternal(url);
});

// Open Windows settings / tools via cmd (fire-and-forget, no zombie processes)
ipcMain.handle('open-shortcut', async (_, { command }) => {
  // Use "start" so cmd exits immediately — avoids lingering cmd.exe for GUI apps
  const proc = spawn('cmd', ['/c', 'start', '', command], { windowsHide: true });
  proc.on('error', (err) => console.log('[open-shortcut] error:', err.message));
  return 'OPENED';
});

ipcMain.handle('get-installed-apps', async () => {
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

    const proc = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpPs], { windowsHide: true });
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
    await runSpawn('cmd', ['/c', command], log, 120000, true);
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

      const proc = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpPs], { windowsHide: true });
      let out = '';
      proc.stdout.on('data', d => out += d);
      proc.stderr.on('data', d => out += d);

      const timer = setTimeout(() => { try { proc.kill(); } catch {} try { fs.unlinkSync(tmpPs); } catch {} reject('Timeout'); }, 30000);

      proc.on('close', (code) => {
        clearTimeout(timer);
        try { fs.unlinkSync(tmpPs); } catch {}
        if (code === 0 || out.includes('REMOVED') || out.includes('NOT_FOUND')) {
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

ipcMain.handle('window-minimize', () => mainWindow.minimize());
ipcMain.handle('window-maximize', () => {
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.handle('window-close', () => mainWindow.close());
