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

// A Bambu Lab printer's own start, end and layer-change code, read from the user's own Bambu Studio or OrcaSlicer
// (their machine profiles, which BoardDock doesn't ship). Only those folders, only a preset name, only those fields.
function bambuProfileDirs() {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  if (process.platform === 'darwin') return [['Bambu Studio', '/Applications/BambuStudio.app/Contents/Resources/profiles/BBL/machine'], ['OrcaSlicer', '/Applications/OrcaSlicer.app/Contents/Resources/profiles/BBL/machine']];
  if (process.platform === 'win32') return [['Bambu Studio', path.join(pf, 'Bambu Studio', 'resources', 'profiles', 'BBL', 'machine')], ['OrcaSlicer', path.join(pf, 'OrcaSlicer', 'resources', 'profiles', 'BBL', 'machine')]];
  return [['Bambu Studio', '/usr/share/bambu-studio/profiles/BBL/machine'], ['OrcaSlicer', '/usr/share/orca-slicer/profiles/BBL/machine']];
}
ipcMain.handle('bambu-profile', (_e, preset) => {
  const name = String(preset ?? '');
  if (!/^[\w .+-]{3,80}$/.test(name)) return { error: 'not a printer preset name' };
  const KEYS = ['machine_start_gcode', 'machine_end_gcode', 'layer_change_gcode'];
  const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const text = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? v.join('\n') : undefined);
  for (const [app, dir] of bambuProfileDirs()) {
    if (!fs.existsSync(dir)) continue;
    const got = {};
    for (const k of KEYS) {
      // newer versions keep each piece in its own "<preset> template <key>.json"; older ones inline, maybe inherited
      const t = read(path.join(dir, `${name} template ${k}.json`));
      if (t && text(t[k])) { got[k] = text(t[k]); continue; }
      let cur = read(path.join(dir, `${name}.json`));
      for (let i = 0; cur && i < 6; i++) {
        if (text(cur[k])) { got[k] = text(cur[k]); break; }
        if (Array.isArray(cur.include)) { const inc = cur.include.map((x) => read(path.join(dir, `${x}.json`))).find((x) => x && text(x[k])); if (inc) { got[k] = text(inc[k]); break; } }
        cur = typeof cur.inherits === 'string' && /^[\w .+-]+$/.test(cur.inherits) ? read(path.join(dir, `${cur.inherits}.json`)) : null;
      }
    }
    if (got.machine_start_gcode) return { start: got.machine_start_gcode, end: got.machine_end_gcode, layer: got.layer_change_gcode, from: `${app} on this computer` };
  }
  return { error: 'Bambu Studio or OrcaSlicer was not found, or has no profile for this printer' };
});
ipcMain.handle('open-in-slicer', async (_e, name, file, bytes) => {
  try {
    // only print files, only a sensible size: the page can't make this write and open anything else
    const base = path.basename(String(file)).replace(/[^\w.+-]/g, '_');
    if (!/\.(3mf|stl)$/i.test(base)) return 'only 3MF and STL files open in a slicer';
    if (!bytes || bytes.length > 200 * 1024 * 1024) return 'the file is empty or too large';
    const dir = path.join(app.getPath('temp'), 'BoardDock');
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, base);
    fs.writeFileSync(out, Buffer.from(bytes));
    const hit = name ? installed().find(([n]) => n === name) : null;
    if (!hit) return await shell.openPath(out); // '' on success
    return await new Promise((resolve) => {
      const child = process.platform === 'darwin' ? spawn('open', ['-a', hit[1], out], { detached: true, stdio: 'ignore' }) : spawn(hit[1], [out], { detached: true, stdio: 'ignore' });
      child.once('error', (e) => resolve(String(e && e.message ? e.message : e)));
      child.once('spawn', () => { child.unref(); resolve(''); });
    });
  } catch (e) {
    return String(e && e.message ? e.message : e);
  }
});

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    const rel = path.relative(DIST, file);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  if (process.platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
