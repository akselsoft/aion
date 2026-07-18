const path = require('path');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const {
  classifyJsonFile,
  listEngines,
  listFiles,
  readLanguageFile,
  readJsonFile,
  relativePath,
  runConfig,
  safePath,
  writeJsonFile
} = require('../aion-service');

const ROOT = path.resolve(__dirname, '..', '..');
const DEV_URL = process.env.AION_UI_DEV_URL;

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 980,
    minHeight: 680,
    title: 'AION Console',
    backgroundColor: '#f5f3ee',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (DEV_URL) {
    win.loadURL(DEV_URL);
  } else {
    win.loadFile(path.join(ROOT, 'dist', 'index.html'));
  }
}

ipcMain.handle('aion:listFiles', (_event, kind) => listFiles(kind));
ipcMain.handle('aion:listEngines', () => listEngines());
ipcMain.handle('aion:readFile', (_event, filePath) => readJsonFile(filePath));
ipcMain.handle('aion:writeFile', (_event, payload) => writeJsonFile(payload.path, payload.data));
ipcMain.handle('aion:runConfig', (_event, filePath) => runConfig(filePath));
ipcMain.handle('aion:openJsonFile', async (_event, kind) => {
  const result = await dialog.showOpenDialog({
    title: kind === 'watch' ? 'Open Watch Map' : 'Open AION Config',
    defaultPath: ROOT,
    properties: ['openFile'],
    filters: [{ name: 'JSON files', extensions: ['json'] }]
  });

  if (result.canceled || !result.filePaths.length) return null;
  const full = safePath(result.filePaths[0]);
  const detectedKind = classifyJsonFile(full);
  if (kind && detectedKind && detectedKind !== kind) {
    throw new Error(`Selected file looks like ${detectedKind}, not ${kind}.`);
  }
  return readJsonFile(relativePath(full));
});
ipcMain.handle('aion:openLanguageFile', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open AION Language Labels',
    defaultPath: ROOT,
    properties: ['openFile'],
    filters: [{ name: 'JSON files', extensions: ['json'] }]
  });

  if (result.canceled || !result.filePaths.length) return null;
  return readLanguageFile(result.filePaths[0]);
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
