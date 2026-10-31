const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('office', {
  run: (action, payload) => ipcRenderer.invoke('desk', action, payload),
  // Tệp từ đĩa gửi đường dẫn; ảnh dán hoặc kéo từ trình duyệt không có đường dẫn nên gửi dữ liệu (main kiểm định dạng).
  attach: async (id, file) => { const path = webUtils.getPathForFile(file); return path ? ipcRenderer.invoke('desk', 'attach-image', { id, path }) : ipcRenderer.invoke('desk', 'attach-image-data', { id, name: file.name, data: new Uint8Array(await file.arrayBuffer()) }); },
  onState: callback => ipcRenderer.on('state', (_event, state) => callback(state)),
  onTerminal: callback => ipcRenderer.on('terminal', (_event, chunk) => callback(chunk))
});
