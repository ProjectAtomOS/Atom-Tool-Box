'use strict';
// Minimal Chrome DevTools Protocol client for AtomToolBox QA harnesses.
// Raw WebSocket implementation (no external deps) + Electron app launcher.

const http = require('http');
const net = require('net');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const LOG_DIR = path.join(ROOT, 'qa', 'logs');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function ensureDirs() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Make sure the log/tmp directories exist as soon as the module is loaded.
ensureDirs();

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error('bad json from ' + url)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(2500, () => { req.destroy(new Error('timeout ' + url)); });
  });
}

class WS {
  constructor(url) {
    const m = url.match(/^ws:\/\/([^:/]+):(\d+)(\/.*)$/);
    if (!m) throw new Error('bad ws url: ' + url);
    this.host = m[1];
    this.port = parseInt(m[2], 10);
    this.wsPath = m[3];
    this.sock = null;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.onmessage = null;
    this.onclose = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64');
      const sock = net.connect(this.port, this.host);
      this.sock = sock;
      let handshaked = false;
      sock.on('connect', () => {
        sock.write(
          'GET ' + this.wsPath + ' HTTP/1.1\r\n' +
          'Host: ' + this.host + ':' + this.port + '\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          'Sec-WebSocket-Key: ' + key + '\r\n' +
          'Sec-WebSocket-Version: 13\r\n\r\n'
        );
      });
      sock.on('data', (d) => {
        this.buf = Buffer.concat([this.buf, d]);
        if (!handshaked) {
          const idx = this.buf.indexOf('\r\n\r\n');
          if (idx === -1) return;
          const head = this.buf.slice(0, idx).toString();
          if (!/ 101 /.test(head)) { reject(new Error('ws handshake failed: ' + head.split('\r\n')[0])); return; }
          handshaked = true;
          this.buf = this.buf.slice(idx + 4);
          resolve();
        }
        this._drain();
      });
      sock.on('error', (e) => { if (!handshaked) reject(e); else if (this.onclose) this.onclose(e); });
      sock.on('close', () => { if (this.onclose) this.onclose(); });
    });
  }

  _drain() {
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = !!(b0 & 0x80);
      const op = b0 & 0x0f;
      const masked = !!(b1 & 0x80);
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      let mask = null;
      if (masked) { if (this.buf.length < off + 4) return; mask = this.buf.slice(off, off + 4); off += 4; }
      if (this.buf.length < off + len) return;
      let payload = Buffer.from(this.buf.slice(off, off + len));
      if (mask) { for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]; }
      this.buf = this.buf.slice(off + len);
      if (op === 0x8) { try { this.sock.end(); } catch {} if (this.onclose) this.onclose(); return; }
      if (op === 0x9) { this._frame(0xA, payload); continue; }
      if (op === 0x0) { this.frags.push(payload); if (fin) { const full = Buffer.concat(this.frags); this.frags = []; this._msg(full); } continue; }
      if (op === 0x1 || op === 0x2) {
        if (fin) this._msg(payload); else this.frags = [payload];
        continue;
      }
    }
  }

  _msg(buf) { if (this.onmessage) { try { this.onmessage(buf.toString('utf8')); } catch {} } }

  send(str) { this._frame(0x1, Buffer.from(str, 'utf8')); }

  _frame(op, payload) {
    const mask = crypto.randomBytes(4);
    const len = payload.length;
    let header;
    if (len < 126) { header = Buffer.alloc(2); header[1] = 0x80 | len; }
    else if (len < 65536) { header = Buffer.alloc(4); header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2); }
    header[0] = 0x80 | op;
    const masked = Buffer.from(payload);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
    this.sock.write(Buffer.concat([header, mask, masked]));
  }

  close() {
    try { this._frame(0x8, Buffer.alloc(0)); } catch {}
    try { this.sock.destroy(); } catch {}
  }
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WS(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.eventHandlers = [];
  }

  async connect() {
    await this.ws.connect();
    this.ws.onmessage = (text) => {
      let msg;
      try { msg = JSON.parse(text); } catch { return; }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.eventHandlers) { try { h(msg); } catch {} }
      }
    };
  }

  send(method, params, timeoutMs = 90000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('cdp timeout: ' + method));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(t); resolve(v); },
        reject: (e) => { clearTimeout(t); reject(e); }
      });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }

  on(fn) { this.eventHandlers.push(fn); }

  async eval(expr, { awaitPromise = true, timeoutMs = 90000 } = {}) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true }, timeoutMs);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('eval exception: ' + ((d.exception && d.exception.description) || d.text || 'unknown'));
    }
    return r.result ? r.result.value : undefined;
  }

  close() { this.ws.close(); }
}

async function findPage(port, tries = 90) {
  for (let i = 0; i < tries; i++) {
    try {
      const list = await getJson('http://127.0.0.1:' + port + '/json/list');
      const page = (list || []).find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {}
    await sleep(500);
  }
  throw new Error('no CDP page target on port ' + port);
}

// Kill stale Electron instances, spawn the app with DevTools on `port`,
// connect, enable Runtime/Log capture and return { cdp, errors, kill }.
async function launchApp(port, extraEnv = {}) {
  ensureDirs();
  try { execSync('taskkill /IM electron.exe /F', { stdio: 'ignore' }); } catch {}
  await sleep(800);
  const logFile = fs.openSync(path.join(LOG_DIR, 'electron-' + port + '.log'), 'a');
  const child = spawn(process.execPath, [
    path.join(ROOT, 'node_modules', 'electron', 'cli.js'),
    '.',
    '--remote-debugging-port=' + port
  ], {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', logFile, logFile]
  });
  child.on('error', () => {});
  const page = await findPage(port);
  const cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.connect();
  const errors = [];
  cdp.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params && msg.params.exceptionDetails;
      errors.push('EXCEPTION: ' + ((d && d.exception && d.exception.description) || (d && d.text) || 'unknown'));
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const p = msg.params || {};
      if (p.type === 'error') {
        const text = (p.args || []).map(a => (a && (a.value !== undefined ? String(a.value) : a.description)) || '').join(' ');
        if (text) errors.push('CONSOLE: ' + text);
      }
    }
  });
  await cdp.send('Runtime.enable');
  try { await cdp.send('Log.enable'); } catch {}
  // Wait until the app DOM is actually up (nav buttons present).
  await waitFor(cdp, `!!document.querySelector('.nav-item')`, 40000, 'app DOM');
  return {
    child,
    cdp,
    errors,
    kill: () => {
      try { cdp.close(); } catch {}
      try { child.kill(); } catch {}
    }
  };
}

async function waitFor(cdp, exprBool, timeoutMs = 30000, label = 'condition', intervalMs = 250) {
  const start = Date.now();
  for (;;) {
    let ok = false;
    try { ok = !!(await cdp.eval('!!(' + exprBool + ')')); } catch {}
    if (ok) return true;
    if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for ' + label);
    await sleep(intervalMs);
  }
}

async function clickNav(cdp, view) {
  await waitFor(cdp, `!!document.querySelector('.nav-item[data-view="${view}"]')`, 20000, 'nav item ' + view);
  await cdp.eval(`document.querySelector('.nav-item[data-view="${view}"]').click(); true`);
  await sleep(350);
}

function regQuery(key, value) {
  // Read one HKCU value via the .NET registry API in PowerShell; returns { exists, value }.
  const esc = s => String(s).replace(/'/g, "''");
  const script = `
try {
  $k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('${esc(key)}')
  if (-not $k) { '{"exists":false}' }
  else {
    $v = $k.GetValue('${esc(value)}', $null)
    $k.Close()
    if ($null -eq $v) { '{"exists":false}' }
    else { @{ exists = $true; value = [string]$v } | ConvertTo-Json -Compress }
  }
} catch { @{ exists = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress }
`;
  const r = psRun(script);
  const line = (r.out || '').trim().split(/\r?\n/).filter(Boolean).pop() || '{"exists":false}';
  try { return JSON.parse(line); } catch { return { exists: false, error: 'parse: ' + line.slice(0, 120) }; }
}

function regQueryBinary(key, value) {
  // Read one HKCU REG_BINARY value; returns { exists, b64 }.
  const esc = s => String(s).replace(/'/g, "''");
  const script = `
try {
  $k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('${esc(key)}')
  if (-not $k) { '{"exists":false}' }
  else {
    $v = $k.GetValue('${esc(value)}', $null)
    $k.Close()
    if ($null -eq $v) { '{"exists":false}' }
    else { @{ exists = $true; b64 = [Convert]::ToBase64String([byte[]]$v) } | ConvertTo-Json -Compress }
  }
} catch { @{ exists = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress }
`;
  const r = psRun(script);
  const line = (r.out || '').trim().split(/\r?\n/).filter(Boolean).pop() || '{"exists":false}';
  try { return JSON.parse(line); } catch { return { exists: false, error: 'parse: ' + line.slice(0, 120) }; }
}

function regSetDword(key, value, data) {
  const esc = s => String(s).replace(/'/g, "''");
  const script = `
$k = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('${esc(key)}')
$k.SetValue('${esc(value)}', [int]${Number(data)}, [Microsoft.Win32.RegistryValueKind]::DWord)
$k.Close()
'OK'
`;
  return /OK/.test(psRun(script).out);
}

function regDeleteValue(key, value) {
  const esc = s => String(s).replace(/'/g, "''");
  const script = `
$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('${esc(key)}', $true)
if ($k) { $k.DeleteValue('${esc(value)}', $false); $k.Close() }
'OK'
`;
  return /OK/.test(psRun(script).out);
}

function hex32(s) {
  const n = parseInt(String(s).trim(), 10);
  if (!Number.isFinite(n)) return 'INVALID(' + s + ')';
  return (n >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

function run(cmdLine, timeoutMs = 60000) {
  try {
    const out = execSync(cmdLine, { encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
    return { ok: true, out: String(out) };
  } catch (e) {
    return { ok: false, out: String((e.stdout || '') + (e.stderr || '') || e.message || e), code: e.status };
  }
}

function psRun(script, timeoutMs = 60000) {
  const file = path.join(LOG_DIR, 'tmp-' + Date.now() + '-' + Math.floor(Math.random() * 100000) + '.ps1');
  fs.writeFileSync(file, script, 'utf8');
  try {
    const out = execSync('powershell -NoProfile -ExecutionPolicy Bypass -File "' + file + '"', { encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
    return { ok: true, out: String(out) };
  } catch (e) {
    return { ok: false, out: String((e.stdout || '') + (e.stderr || '') || e.message || e), code: e.status };
  } finally {
    try { fs.unlinkSync(file); } catch {}
  }
}

function result(name, pass, detail) {
  return { name, pass: !!pass, detail: detail === undefined ? '' : String(detail) };
}

async function finish(name, results, extra) {
  ensureDirs();
  const ok = results.every(r => r.pass);
  const report = {
    harness: name,
    time: new Date().toISOString(),
    pass: ok,
    passed: results.filter(r => r.pass).length,
    total: results.length,
    results,
    extra: extra || null
  };
  fs.writeFileSync(path.join(LOG_DIR, name + '.json'), JSON.stringify(report, null, 2));
  console.log('\n===== ' + name + ' =====');
  for (const r of results) {
    console.log((r.pass ? '[PASS] ' : '[FAIL] ') + r.name + (r.detail ? '  -- ' + r.detail : ''));
  }
  console.log((ok ? 'ALL PASSED' : 'FAILURES PRESENT') + ' (' + report.passed + '/' + report.total + ')');
  return report;
}

module.exports = { ROOT, LOG_DIR, sleep, ensureDirs, getJson, CDP, launchApp, waitFor, clickNav, regQuery, regQueryBinary, regSetDword, regDeleteValue, hex32, run, psRun, result, finish };
