// The few desktop-only things the web app can ask for: which slicers are installed, opening a plate in one, and a
// Bambu Lab printer's own start code from the user's Bambu Studio or OrcaSlicer.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('boarddockDesktop', {
  slicers: () => ipcRenderer.invoke('slicers'),
  openInSlicer: (app, name, bytes) => ipcRenderer.invoke('open-in-slicer', app, name, bytes),
  bambuProfile: (preset) => ipcRenderer.invoke('bambu-profile', preset),
});
