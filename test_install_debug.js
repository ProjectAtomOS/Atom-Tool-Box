const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

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

async function testInstall(id, url, filename, type) {
  console.log('=== TESTING', id, '===');

  const curlPath = findCurl();
  console.log('curlPath:', curlPath);
  if (!curlPath) {
    console.log('ERROR: curl not found');
    return;
  }

  const tmpFile = path.join(os.tmpdir(), `atom_${id}_${filename}`);
  console.log('tmpFile:', tmpFile);

  return new Promise((resolve) => {
    const curlArgs = ['-L', '--max-redirs', '10', '-o', tmpFile, url];
    console.log('Spawning:', curlPath, curlArgs);

    const dlProc = spawn(curlPath, curlArgs, { windowsHide: true });
    let dlOutput = '';

    dlProc.on('error', (err) => {
      console.log('DL SPAWN ERROR:', err.message);
      resolve({ success: false, error: err.message });
    });

    dlProc.stderr.on('data', (data) => {
      dlOutput += data.toString();
    });

    dlProc.stdout.on('data', (data) => {
      dlOutput += data.toString();
    });

    dlProc.on('close', (dlCode) => {
      console.log('DL exit:', dlCode);
      console.log('DL output:', dlOutput.substring(0, 300));

      if (dlCode !== 0) {
        resolve({ success: false, stage: 'download', code: dlCode, output: dlOutput });
        return;
      }

      if (!fs.existsSync(tmpFile)) {
        resolve({ success: false, stage: 'download', error: 'File not found' });
        return;
      }

      const size = fs.statSync(tmpFile).size;
      console.log('File size:', size);

      if (size < 1000) {
        const content = fs.readFileSync(tmpFile, 'utf8').substring(0, 500);
        console.log('File too small:', content);
        resolve({ success: false, stage: 'download', error: 'Too small', content });
        return;
      }

      console.log('Download OK, size:', size);

      // Install
      let installCmd;
      switch (type) {
        case 'msi': installCmd = `msiexec /i "${tmpFile}" /norestart`; break;
        case 'portable': installCmd = `echo portable`; break;
        default: installCmd = `"${tmpFile}"`; break;
      }
      console.log('Install cmd:', installCmd);

      const instProc = spawn('cmd', ['/c', installCmd], { windowsHide: true });
      let instOutput = '';

      instProc.on('error', (err) => {
        console.log('INSTALL SPAWN ERROR:', err.message);
        resolve({ success: false, stage: 'install', error: err.message });
      });

      instProc.stdout.on('data', d => instOutput += d);
      instProc.stderr.on('data', d => instOutput += d);

      instProc.on('close', (instCode) => {
        console.log('Install exit:', instCode);
        console.log('Install output:', instOutput.substring(0, 300));
        setTimeout(() => { try { fs.unlinkSync(tmpFile); } catch {} }, 3000);
        resolve({ success: instCode === 0 || instCode === 3010, code: instCode, output: instOutput });
      });
    });
  });
}

(async () => {
  const r = await testInstall('sevenzip', 'https://www.7-zip.org/a/7z2408-x64.exe', '7zip.exe', 'exe_inno');
  console.log('\nRESULT:', r);
})();
