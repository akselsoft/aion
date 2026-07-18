const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aionApi', {
  listFiles: (kind) => ipcRenderer.invoke('aion:listFiles', kind),
  listEngines: () => ipcRenderer.invoke('aion:listEngines'),
  readFile: (path) => ipcRenderer.invoke('aion:readFile', path),
  writeFile: (path, data) => ipcRenderer.invoke('aion:writeFile', { path, data }),
  runConfig: (path) => ipcRenderer.invoke('aion:runConfig', path),
  openJsonFile: (kind) => ipcRenderer.invoke('aion:openJsonFile', kind),
  openLanguageFile: () => ipcRenderer.invoke('aion:openLanguageFile'),
  runtime: 'electron'
});
