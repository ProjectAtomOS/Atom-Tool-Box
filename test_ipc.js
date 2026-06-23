const { ipcMain } = require('electron');

// Simulate the install-app call
async function testInstall() {
  const event = {
    sender: {
      send: (channel, data) => console.log('[SEND]', channel, JSON.stringify(data).substring(0, 200))
    }
  };

  // Get the handler
  const handlers = ipcMain._handlers || new Map();
  const handler = handlers.get('install-app');

  if (!handler) {
    console.log('Handler not found, trying internal...');
    // Try to call it directly
    try {
      // We need to simulate the actual call
      const result = await ipcMain.emit('install-app', event, {
        id: 'sevenzip',
        url: 'https://www.7-zip.org/a/7z2408-x64.exe',
        filename: '7zip.exe',
        type: 'exe_inno'
      });
      console.log('Result:', result);
    } catch (e) {
      console.log('Error:', e.message);
    }
    return;
  }

  try {
    const result = await handler(event, {
      id: 'sevenzip',
      url: 'https://www.7-zip.org/a/7z2408-x64.exe',
      filename: '7zip.exe',
      type: 'exe_inno'
    });
    console.log('Success:', result);
  } catch (e) {
    console.log('Error:', e.message);
  }
}

testInstall();
