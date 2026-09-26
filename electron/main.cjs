// Desktop wrapper: serves the built web app from a private app:// origin (so module workers and WASM load),
// opens external links in the system browser, and saves downloads through the normal save dialog.
const { app, BrowserWindow, protocol, net, shell, Menu, ipcMain } = require('electron');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

const DIST = path.join(__dirname, '..', 'dist');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    title: 'BoardDock',
    backgroundColor: '#0b1016',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL('app://boarddock/index.html');
}

// Slicers in their usual install places (checked on disk, never assumed); anything else opens with the system's 3MF app.
function slicerPaths() {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  if (process.platform === 'darwin') return [['OrcaSlicer', '/Applications/OrcaSlicer.app'], ['PrusaSlicer', '/Applications/PrusaSlicer.app'], ['PrusaSlicer', '/Applications/Original Prusa Drivers/PrusaSlicer.app'], ['Bambu Studio', '/Applications/BambuStudio.app'], ['UltiMaker Cura', '/Applications/UltiMaker Cura.app'], ['Creality Print', '/Applications/Creality Print.app']];
  if (process.platform === 'win32') {
    const cura = (() => { try { return fs.readdirSync(pf).filter((d) => /^UltiMaker Cura/i.test(d)).map((d) => ['UltiMaker Cura', path.join(pf, d, 'UltiMaker-Cura.exe')]); } catch { return []; } })();
    return [['OrcaSlicer', path.join(pf, 'OrcaSlicer', 'orca-slicer.exe')], ['PrusaSlicer', path.join(pf, 'Prusa3D', 'PrusaSlicer', 'prusa-slicer.exe')], ['Bambu Studio', path.join(pf, 'Bambu Studio', 'bambu-studio.exe')], ...cura];
  }
  return [];
}
const installed = () => slicerPaths().filter(([, p]) => fs.existsSync(p));

ipcMain.handle('slicers', () => [...new Set(installed().map(([n]) => n))]);
ipcMain.handle('open-in-slicer', async (_e, name, file, bytes) => {
  try {
    const dir = path.join(app.getPath('temp'), 'BoardDock');
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, path.basename(String(file)).replace(/[^\w.+-]/g, '_'));
    fs.writeFileSync(out, Buffer.from(bytes));
    const hit = name ? installed().find(([n]) => n === name) : null;
    if (!hit) return await shell.openPath(out); // '' on success
    const child = process.platform === 'darwin' ? spawn('open', ['-a', hit[1], out], { detached: true, stdio: 'ignore' }) : spawn(hit[1], [out], { detached: true, stdio: 'ignore' });
    child.unref();
    return '';
  } catch (e) {
    return String(e && e.message ? e.message : e);
  }
});

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  if (process.platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
