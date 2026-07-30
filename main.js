const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

/* Which environment this window shows.
 *   FitTrack.exe            -> live
 *   FitTrack.exe --env=dev  -> dev   (npm run start:dev) */
function envFromArgs(argv) {
  const hit = argv.find((a) => a.startsWith('--env='));
  const value = hit ? hit.slice('--env='.length) : 'live';
  return value === 'dev' ? 'dev' : 'live';
}

let currentEnv = envFromArgs(process.argv);
let mainWindow;

/* If config.js names a deployed URL, prefer it: the desktop app then picks up
 * new versions the moment they are published, with no reinstall. Otherwise use
 * the copy bundled into the installer. */
function readAppUrl() {
  try {
    const src = fs.readFileSync(path.join(__dirname, 'config.js'), 'utf8');
    const m = src.match(/APP_URL\s*:\s*'([^']*)'/);
    return m && m[1] ? m[1].replace(/\/+$/, '') : null;
  } catch (e) {
    return null;
  }
}

function loadEnv(win, env) {
  currentEnv = env;
  const base = readAppUrl();

  if (base) {
    win.loadURL(`${base}${env === 'dev' ? '/dev/' : '/'}?env=${env}`);
  } else {
    win.loadFile(path.join(__dirname, 'index.html'), { query: { env } });
  }

  win.setTitle(env === 'dev' ? 'FitTrack — Dev' : 'FitTrack');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 860,
    minWidth: 400,
    minHeight: 650,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'FitTrack',
    icon: path.join(__dirname, 'public', 'icons', 'icon-512.png'),
    autoHideMenuBar: true,
    backgroundColor: '#080812',
    show: false,
  });

  loadEnv(mainWindow, currentEnv);

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // The menu bar stays hidden, but its accelerators still fire — enough to flip
  // environments without restarting the app.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'FitTrack',
      submenu: [
        { label: 'Switch to Live', accelerator: 'CmdOrCtrl+Shift+L', click: () => loadEnv(mainWindow, 'live') },
        { label: 'Switch to Dev',  accelerator: 'CmdOrCtrl+Shift+D', click: () => loadEnv(mainWindow, 'dev') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
  ]));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
