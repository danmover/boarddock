// The few desktop-only things the web app can ask for: which slicers are installed, and opening a plate in one.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('boarddockDesktop', {
  slicers: () => ipcRenderer.invoke('slicers'),
  openInSlicer: (app, name, bytes) => ipcRenderer.invoke('open-in-slicer', app, name, bytes),
});
