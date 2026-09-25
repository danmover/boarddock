import { useEffect, useMemo, useState } from 'react';
import { activeModule, redo, store, undo, useApp, type Step } from './state';
import { generateProject } from './worker/client';
import { Viewer3D } from './ui/Viewer3D';
import { BoardEditor, type Tool } from './ui/BoardEditor';
import { PanelEditor } from './ui/PanelEditor';
import { BoardPanel, CheckPanel, ExportPanel, HolderPanel, ImportPanel, MountPanel, PlugsPanel } from './ui/panels';
import { Seg, download, safeName } from './ui/controls';
import { HeroArt, Mark } from './ui/art';
import { MATERIALS } from './model/library';
import { estimate, packPlates } from './cad/export';
import { openFiles } from './ui/importFlow';

const STEPS: { id: Step; label: string; icon: string }[] = [
  { id: 'import', label: 'Start', icon: 'M4 15v4h16v-4M12 4v11m0 0l-4-4m4 4l4-4' },
  { id: 'board', label: 'Board', icon: 'M4 6h16v12H4zM7.5 9.5h.01M16.5 9.5h.01M7.5 14.5h.01M16.5 14.5h.01M10 10h4v4h-4z' },
  { id: 'plugs', label: 'Plugs', icon: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 01-12 0zM12 17v4' },
  { id: 'holder', label: 'Holder', icon: 'M3 9l2 10h14l2-10M3 9h18M8 13l1 3M16 13l-1 3M12 13v3' },
  { id: 'mount', label: 'Panel', icon: 'M3 8h18M3 12h18M6 8v11M10 8v11M14 8v11M18 8v11M3 5h18' },
  { id: 'check', label: 'Check', icon: 'M4 18l5-6 4 3 7-9M15 6h5v5' },
  { id: 'export', label: 'Export', icon: 'M12 3v12m0 0l-4-4m4 4l4-4M4 17v4h16v-4' },
];

const I = {
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3',
  save: 'M5 3h11l3 3v15H5zM8 3v6h8V3M8 21v-7h8v7',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 8a4 4 0 100 8 4 4 0 000-8z',
  moon: 'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z',
};
const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;

export function App() {
  const project = useApp((s) => s.project);
  const step = useApp((s) => s.step);
  const view = useApp((s) => s.view);
  const result = useApp((s) => s.result);
  const building = useApp((s) => s.building);
  const error = useApp((s) => s.error);
  const showGhosts = useApp((s) => s.showGhosts);
  const theme = useApp((s) => s.theme);
  const canUndo = useApp((s) => s.past.length > 0);
  const canRedo = useApp((s) => s.future.length > 0);
  const [tool, setTool] = useState<Tool>('select');
  const [cam, setCam] = useState<{ dir: [number, number, number]; n: number } | undefined>();
  const look = (dir: [number, number, number]) => setCam((c) => ({ dir, n: (c?.n ?? 0) + 1 }));
  const [installed, setInstalled] = useState<'h' | 'v' | null>(null);
  const layout = project?.layout;
  useEffect(() => { setInstalled(layout === 'panel' ? 'h' : null); }, [layout]);
  const [dragging, setDragging] = useState(false);
  const [dropErr, setDropErr] = useState<string | null>(null);
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!e.dataTransfer.files.length) return;
    setDropErr(null);
    try { await openFiles(e.dataTransfer.files); } catch (err: any) { setDropErr(err.message ?? String(err)); }
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('boarddock.theme', theme); } catch { /* ignore */ }
  }, [theme]);

  // rebuild whenever the project changes (debounced, latest wins)
  useEffect(() => {
    if (!project) return;
    store.set({ building: true });
    const t = setTimeout(async () => {
      try {
        const r = await generateProject(project);
        if (r) store.set({ result: r, building: false, error: null });
      } catch (e: any) {
        store.set({ building: false, error: e.message ?? String(e) });
      }
    }, 200);
    return () => clearTimeout(t);
  }, [project]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && project) { e.preventDefault(); saveProject(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [project]);

  const saveProject = () => {
    const p = store.get().project;
    if (p) download(`${safeName(p.modules.map((m) => m.board.name).join('+'))}.boarddock.json`, JSON.stringify(p, null, 1), 'application/json');
  };

  const stats = useMemo(() => {
    if (!result || !project) return null;
    const dens = MATERIALS[activeModule(project).holder.material].density;
    const g = result.parts.reduce((s, p) => s + estimate(p, dens).grams * p.qty, 0);
    const n = result.parts.reduce((s, p) => s + p.qty, 0);
    const plates = packPlates(result.parts, project.printer.bed, project.printer.spacing).length;
    return { g, n, plates };
  }, [result, project?.printer.bed[0], project?.printer.bed[1]]);

  const panel = { import: <ImportPanel />, board: <BoardPanel />, plugs: <PlugsPanel />, holder: <HolderPanel />, mount: <MountPanel />, check: <CheckPanel />, export: <ExportPanel /> }[step];
  const warnCount = result?.report.warnings.length ?? 0;
  const badCount = result?.report.checks.filter((c) => c.status === 'bad').length ?? 0;

  return (
    <div className="app" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }} onDragLeave={(e) => { if (!e.relatedTarget) setDragging(false); }} onDrop={onDrop}>
      {dragging && <div className="dropveil"><div><b>Drop to import</b><span>{store.get().addMode ? 'adds another board' : project ? 'replaces the current board (tick "add as another board" on Start to add)' : 'KiCad · STEP · IDF · Eagle · Gerber zip · DXF · project'}</span></div></div>}
      {dropErr && <div className="toast err" onClick={() => setDropErr(null)}>{dropErr}</div>}
      <header className="topbar">
        <div className="brand"><Mark className="mark" /><span className="word">Board<b>Dock</b></span><small>v0.1 · screwless PCB mounts</small></div>
        {project && <span className="projchip" title={activeModule(project).board.source}>{project.modules.length > 1 ? `${project.modules.length} boards · ${project.modules.map((m) => m.board.name).join(' + ')}` : activeModule(project).board.name}</span>}
        <div className="spacer" />
        {project && (
          <>
            <div className="status" title={error ?? ''}>
              <span className={`dot ${error ? 'err' : building ? 'busy' : ''}`} />
              {error ? 'build failed' : building ? 'building…' : result ? `built · ${result.report.timeMs} ms` : ''}
            </div>
            <button className="iconbtn" disabled={!canUndo} onClick={undo} title="Undo (⌘Z)"><Icon d={I.undo} /></button>
            <button className="iconbtn" disabled={!canRedo} onClick={redo} title="Redo (⇧⌘Z)"><Icon d={I.redo} /></button>
            <button className="iconbtn" onClick={saveProject} title="Save project (⌘S)"><Icon d={I.save} /></button>
          </>
        )}
        <button className="iconbtn" onClick={() => store.set({ theme: theme === 'dark' ? 'light' : 'dark' })} title="Light / dark"><Icon d={theme === 'dark' ? I.sun : I.moon} /></button>
      </header>
      <div className="main">
        <nav className="rail">
          {STEPS.map((s, i) => (
            <button key={s.id} className={step === s.id ? 'on' : ''} disabled={!project && s.id !== 'import'} onClick={() => store.set({ step: s.id, ...(s.id === 'mount' && project?.layout === 'panel' ? { view: 'panel' as const } : view === 'panel' && s.id !== 'mount' ? { view: 'assembly' as const } : {}) })}>
              <span className="pad"><Icon d={s.icon} /><i>{s.id === 'check' && (badCount || warnCount) ? '!' : i + 1}</i></span>
              <span>{s.label}</span>
            </button>
          ))}
        </nav>
        <aside className="panel">{panel}</aside>
        <section className="stage">
          {project ? (
            <>
              <div className="tabs">
                <Seg value={view} options={[['assembly', '3D assembly'], ...(project.layout === 'panel' ? [['panel', 'Panel'] as ['panel', string]] : []), ['print', 'Print plates'], ['editor', 'Board editor']]} onChange={(v) => store.set({ view: v })} />
              </div>
              {view === 'editor' ? <BoardEditor tool={tool} setTool={setTool} /> : view === 'panel' && project.layout === 'panel' ? <PanelEditor /> : (
                <>
                  <Viewer3D result={result} mode={view === 'print' ? 'print' : 'assembly'} showGhosts={showGhosts} bed={project.printer.bed} spacing={project.printer.spacing} theme={theme} camera={cam} installed={view === 'assembly' ? installed : null} />
                  <div className="tools">
                    <span className="seg">
                      <button onClick={() => look([0.55, -0.75, 0.62])}>Iso</button>
                      <button onClick={() => look([0, -0.02, 1])}>Top</button>
                      <button onClick={() => look([0, -1, 0.25])}>Front</button>
                      <button onClick={() => look([-0.5, 0.6, -0.65])}>Under</button>
                    </span>
                    {view === 'assembly' && result?.report.panel && (
                      <span className="seg" title="The panel as it hangs on the wall, or lying flat">
                        <button className={installed ? 'on' : ''} onClick={() => setInstalled('h')}>On the wall</button>
                        <button className={!installed ? 'on' : ''} onClick={() => setInstalled(null)}>Lying flat</button>
                      </span>
                    )}
                    {view === 'assembly' && result?.report.clipFrame && !result.report.panel && (
                      <span className="seg" title="See it installed on a DIN rail">
                        <button className={!installed ? 'on' : ''} onClick={() => setInstalled(null)}>Holder</button>
                        <button className={installed === 'h' ? 'on' : ''} onClick={() => setInstalled('h')}>On rail ⟷</button>
                        <button className={installed === 'v' ? 'on' : ''} onClick={() => setInstalled('v')}>On rail ↕</button>
                      </span>
                    )}
                    {view === 'assembly' && <span className="seg"><button className={showGhosts ? 'on' : ''} onClick={() => store.set({ showGhosts: !showGhosts })}>Board & rail</button></span>}
                  </div>
                  {view === 'assembly' && result && (
                    <div className="legend floating">
                      {result.parts.filter((p, i, a) => a.findIndex((q) => q.color === p.color) === i).map((p) => <span key={p.id} style={{ color: p.color }}><i style={{ background: p.color }} /><span style={{ color: 'var(--muted)' }}>{p.id.includes('cap') ? 'Plug caps' : p.id.includes('clip') ? 'DIN clip' : p.id.includes('link') || p.id.includes('rivet') ? 'Joiners' : p.id === 'dock_shoe' ? 'Rail shoes' : p.id === 'dock_socket' ? 'Sockets' : p.id.endsWith('_rod') ? 'Release buttons' : 'Holders'}</span></span>)}
                      {showGhosts && <><span style={{ color: '#17804f' }}><i style={{ background: '#17804f' }} /><span style={{ color: 'var(--muted)' }}>Board</span></span><span style={{ color: '#e8a15a' }}><i style={{ background: '#e8a15a' }} /><span style={{ color: 'var(--muted)' }}>Plugs</span></span></>}
                    </div>
                  )}
                  {stats && (
                    <div className="stats floating">
                      <span><b>{stats.n}</b>parts</span>
                      <span><b>{stats.plates}</b>plate{stats.plates > 1 ? 's' : ''}</span>
                      <span><b>{stats.g.toFixed(0)}</b>g</span>
                      {(warnCount > 0 || badCount > 0) && <span style={{ color: badCount ? 'var(--bad)' : 'var(--warn)', cursor: 'pointer' }} onClick={() => store.set({ step: 'check' })}><b style={{ color: 'inherit' }}>{badCount + warnCount}</b>notes</span>}
                    </div>
                  )}
                  {error && <div className="legend floating" style={{ bottom: 64, color: 'var(--bad)' }}>{error}</div>}
                </>
              )}
            </>
          ) : (
            <div className="empty">
              <div className="hero">
                <HeroArt />
                <h1>Dock any PCB.<br /><span>No screws. No supports.</span></h1>
                <p>Drop a KiCad, Altium, Eagle or Gerber export, or pick a board. BoardDock builds a holder around every board (plug cradles, snap fingers, no screws), docks them onto DIN rails, horizontal or vertical, turned so every plug stays reachable, with a push-button release on top. FEA-checked and packed onto as few print plates as possible.</p>
                <div className="feats"><span>KiCad · STEP · IDF · Gerber</span><span>DIN rail docks · top release</span><span>auto-arranged for plug access</span><span>drag, turn, pair back to back</span><span>FEA checked</span><span>STL + 3MF plates</span></div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
