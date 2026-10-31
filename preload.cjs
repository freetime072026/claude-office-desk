const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('office', {
  run: (action, payload) => ipcRenderer.invoke('desk', action, payload),
  attach: (id, file) => ipcRenderer.invoke('desk', 'attach-image', { id, path: webUtils.getPathForFile(file) }),
  onState: callback => ipcRenderer.on('state', (_event, state) => callback(state)),
  onTerminal: callback => ipcRenderer.on('terminal', (_event, chunk) => callback(chunk))
});
