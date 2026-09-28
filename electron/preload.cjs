// The few desktop-only things the web app can ask for: which slicers are installed, opening a plate in one, and a
// Bambu Lab printer's own start code from the user's Bambu Studio or OrcaSlicer, and an Allegro board through their KiCad.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('boarddockDesktop', {
  slicers: () => ipcRenderer.invoke('slicers'),
  openInSlicer: (app, name, bytes) => ipcRenderer.invoke('open-in-slicer', app, name, bytes),
  bambuProfile: (preset) => ipcRenderer.invoke('bambu-profile', preset),
  // a Cadence Allegro board read through the user's own KiCad 10 (its kicad-cli): the KiCad board it saves, or why not
  kicadImport: (name, bytes) => ipcRenderer.invoke('kicad-import', name, bytes),
});
