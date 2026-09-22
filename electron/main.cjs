const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const http = require('node:http');

const appRoot = app.getAppPath();
const resourcesPath = process.resourcesPath;

process.env.NODE_ENV = 'production';
process.env.APP_ROOT = appRoot;

if (app.isPackaged) {
  process.env.APP_RESOURCES_PATH = resourcesPath;
  process.env.KOKORO_MODEL_DIR = path.join(resourcesPath, 'kokoro-runtime', 'model');
  process.env.KOKORO_ESPEAK_PATH = path.join(resourcesPath, 'kokoro-runtime', 'espeak-ng');
}

let mainWindow;

function waitForServer(url, attempts = 60) {
  return new Promise((resolve, reject) => {
    const check = (remaining) => {
      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) {
          resolve();
          return;
        }
        retry(remaining);
      });

      request.on('error', () => retry(remaining));
      request.setTimeout(1000, () => {
        request.destroy();
        retry(remaining);
      });
    };

    const retry = (remaining) => {
      if (remaining <= 0) {
        reject(new Error('The local application server did not start.'));
        return;
      }
      setTimeout(() => check(remaining - 1), 250);
    };

    check(attempts);
  });
}

async function startServer() {
  require(path.join(appRoot, 'dist', 'server.cjs'));
  await waitForServer('http://127.0.0.1:3000/api/health');
}

async function createWindow() {
  await startServer();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 960,
    minHeight: 700,
    title: 'Text to Speech Studio',
    backgroundColor: '#020617',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  await mainWindow.loadURL('http://127.0.0.1:3000');
}

app.whenReady().then(async () => {
  try {
    await createWindow();
  } catch (error) {
    console.error('Failed to start Text to Speech Studio:', error);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((error) => {
        console.error('Failed to recreate window:', error);
        app.quit();
      });
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
