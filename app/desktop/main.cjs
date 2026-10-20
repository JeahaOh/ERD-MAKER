const { app, BrowserWindow, dialog, Menu, session } = require('electron');
const path = require('node:path');

// The desktop renderer is the exact static build also served by a web server.
// It receives no Node API, preload bridge, or privileged IPC channel.
const entryPoint = path.join(__dirname, '..', '..', 'dist', 'index.html');
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'ERD Maker',
    width: 1520,
    height: 980,
    minWidth: 1000,
    minHeight: 660,
    backgroundColor: '#F9F9F9',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = undefined; });

  mainWindow.loadFile(entryPoint).catch((error) => {
    dialog.showErrorBox('ERD Maker를 열 수 없습니다', `먼저 npm run build를 실행해 주세요.\n\n${error.message}`);
    app.quit();
  });
}

app.whenReady().then(() => {
  // Models are local files. Renderer networking and permission prompts are unnecessary.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (_details, callback) => callback({ cancel: true }),
  );

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: '편집', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '보기', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
