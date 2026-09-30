import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { activeModule, closeProject, redo, select, setActive, store, toast, toastPast, undo, useApp, type Layer, type SelItem, type Step } from './state';
import { generateProject } from './worker/client';
import { AddBoardSheet } from './ui/AddBoard';
import { ChecklistSheet } from './ui/Checklist';
import { Viewer3D } from './ui/Viewer3D';
import { BuildStatus } from './ui/BuildStatus';
import { delta } from './model/built';
import type { GenResult } from './model/types';
import { BoardEditor, type Tool } from './ui/BoardEditor';
import { StartStage } from './ui/Start';
import { PanelEditor } from './ui/PanelEditor';
import { MountQuick } from './ui/MountQuick';
import { BoardPanel, CheckPanel, ExportPanel, HolderPanel, ImportPanel, MountPanel, NewVersionButton, PlugsPanel } from './ui/panels';
import { download, safeName } from './ui/controls';
import { Mark } from './ui/art';
import { MATERIALS } from './model/library';
import { estimate, packPlates } from './cad/export';
import { openFiles } from './ui/importFlow';
import { connectIfNone } from './ui/linkOps';
import { describe, removeItems } from './ui/pickOps';
import { Icon, I } from './ui/icons';
import { WiringView } from './ui/WiringView';
import { rackCount, rackName } from './model/diff';
import { summarizeChecks } from './model/checkSummary';
import { FocusTools } from './ui/ViewTools';
import { CommandPalette, PaletteButton } from './ui/CommandPalette';
import { VIEW_DIRS } from './ui/commands';
import { CableKey } from './ui/CableKey';

const STEPS: { id: Step; label: string; title: string; text: string }[] = [
  { id: 'import', label: 'Start', title: 'Bring a board in', text: 'Drop a KiCad, Altium, Eagle or Gerber export, or start from a known board.' },
  { id: 'board', label: 'Board', title: 'Check the board', text: 'What was read, what each hole is for, and tools to clean up the import.' },
  { id: 'plugs', label: 'Plugs', title: 'Protect the plugs', text: 'Cradles, caps and guards so a knock on a cable goes into the holder, not the solder joints.' },
  { id: 'holder', label: 'Holder', title: 'Shape the holder', text: 'A light frame or a full tray, the features you want, and the fit.' },
  { id: 'mount', label: 'Rails', title: 'Rails, docks and stacks', text: 'Which board goes where: automatic, or dragged by hand. Turn docks so every plug stays reachable.' },
  { id: 'check', label: 'Check', title: 'Check the design', text: 'Forces, strain and printability, with the finite-element model of the clips.' },
  { id: 'export', label: 'Export', title: 'Print it', text: 'Parts packed onto as few plates as possible, already in print orientation.' },
];

const LAYERS: [Layer, string, string][] = [['holders', 'Holders', '#e9e6df'], ['docks', 'Docks', '#4c8dff'], ['caps', 'Plug caps', '#f2c94c'], ['boards', 'Boards', '#1f8a57'], ['plugs', 'Plugs', '#e0a060'], ['cables', 'Cables', '#d0443a'], ['labels', 'Cable numbers', '#f4f1e8'], ['rails', 'Rails and stands', '#94a3b8']];

export function App() {
  const project = useApp((s) => s.project);
  const step = useApp((s) => s.step);
  const view = useApp((s) => s.view);
  const result = useApp((s) => s.result);
  const printParts = useApp((s) => s.printParts);
  const building = useApp((s) => s.building);
  const rendering = useApp((s) => s.rendering);
  const error = useApp((s) => s.error);
  const theme = useApp((s) => s.theme);
  const sel = useApp((s) => s.sel);
  const layers = useApp((s) => s.layers);
  const toastMsg = useApp((s) => s.toast);
  const toastAction = useApp((s) => s.toastAction);
  const canUndo = useApp((s) => s.past.length > 0);
  const pastLen = useApp((s) => s.past.length);
  const canRedo = useApp((s) => s.future.length > 0);
  const [tool, setTool] = useState<Tool>('select');
  const [cam, setCam] = useState<{ dir: [number, number, number]; n: number } | undefined>();
  const look = (dir: [number, number, number]) => setCam((c) => ({ dir, n: (c?.n ?? 0) + 1 }));
  const [showLayers, setShowLayers] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [overhangs, setOverhangs] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
    navRef.current?.querySelector('.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [step]);
  const [dropErr, setDropErr] = useState<string | null>(null);
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!e.dataTransfer.files.length) return;
    setDropErr(null);
    try { await openFiles(e.dataTransfer.files); } catch (err: any) { setDropErr(err.message ?? String(err)); }
  };

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  // rebuild whenever the project changes (debounced, latest wins; unchanged holders come from the worker's cache), but
  // not for what the build never reads: the rack's name, where the Wiring view's cards sit, marking it built
  const buildKey = useMemo(() => (project ? JSON.stringify({ ...project, name: undefined, wiring: undefined, built: undefined, ticks: undefined, oneNetLength: undefined, locks: undefined, receipts: undefined }) : ''), [project]);
  const latestProject = useRef(project);
  latestProject.current = project;
  // the last few builds, by what they were built from: going back to a layout you had (Stand up, Lie flat, and back) or
  // undoing shows it at once instead of building it again
  const built = useRef(new Map<string, GenResult>());
  useEffect(() => {
    const project = latestProject.current;
    if (!project) return;
    const hit = built.current.get(buildKey);
    if (hit) {
      built.current.delete(buildKey);
      built.current.set(buildKey, hit);
      store.set({ result: hit, building: false, error: null, buildNote: null });
      return;
    }
    store.set({ building: true });
    const t = setTimeout(async () => {
      try {
        const r = await generateProject(project, (note) => store.set({ buildNote: note }));
        if (r) {
          built.current.set(buildKey, r);
          while (built.current.size > 3) built.current.delete(built.current.keys().next().value!);
          store.set({ result: r, building: false, error: null, buildNote: null });
        }
      } catch (e: any) {
        store.set({ building: false, error: e.message ?? String(e), buildNote: null });
      }
    }, 120);
    return () => clearTimeout(t);
  }, [buildKey]);

  const picks = sel.filter((s) => s.kind === 'module' || s.kind === 'mount' || s.kind === 'rail' || s.kind === 'feature' || s.kind === 'link' || s.kind === 'railstand');
  const [keys, setKeys] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (store.get().addSheet) return; // the Add a board window has the keyboard (Delete would take out what is picked behind it)
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if (cmd && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      if (cmd && e.key.toLowerCase() === 's' && project) { e.preventDefault(); saveProject(); }
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) setKeys((k) => !k);
      if (!cmd && e.key.toLowerCase() === 'a' && project) { e.preventDefault(); store.set({ addSheet: true }); }
      if (e.key === 'Escape') setKeys(false);
      // 1-7: the steps (not while the rails view uses the keys for its docks, nor in the board editor)
      if (!cmd && !e.altKey && project && /^[1-7]$/.test(e.key) && store.get().view !== 'panel') { goStep(STEPS[+e.key - 1].id); return; }
      const v = store.get().view;
      if (v === 'assembly') {
        const p3 = store.get().sel.filter((s) => s.kind === 'module' || s.kind === 'mount' || s.kind === 'rail' || s.kind === 'feature' || s.kind === 'link' || s.kind === 'railstand');
        if ((e.key === 'Delete' || e.key === 'Backspace') && p3.length) { e.preventDefault(); removeItems(p3); }
        if (e.key === 'Escape') select([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [project]);

  const saveProject = () => {
    const p = store.get().project;
    if (!p) return;
    const file = `${safeName(rackName(p))}.boarddock.json`;
    download(file, JSON.stringify(p, null, 1), 'application/json');
    toast(`Saved ${file}.${p.name?.trim() ? '' : ' Name the rack on Start to save it under its own name.'}`);
  };

  const toggleTheme = () => { const t = theme === 'dark' ? 'light' : 'dark'; store.set({ theme: t }); try { localStorage.setItem('boarddock.theme', t); } catch { /* private mode */ } };
  const newRack = () => { if (confirm('Start a new rack? This one stays only in the project file you saved (⌘S saves it now).')) closeProject(); };

  const stats = useMemo(() => {
    if (!result || !project) return null;
    const dens = MATERIALS[activeModule(project).holder.material].density;
    let g = 0, min = 0;
    for (const p of result.parts) { const e = estimate(p, dens); g += e.grams * p.qty; min += e.minutes * p.qty; }
    const n = result.parts.reduce((s, p) => s + p.qty, 0);
    const plates = packPlates(result.parts, project.printer.bed, project.printer.spacing).length;
    return { g, n, plates, min };
  }, [result, project?.printer.bed[0], project?.printer.bed[1]]);

  // the print view's parts: one object per change, so the 3D view doesn't rebuild on every render of the app
  const shown = useMemo(() => (printParts && result ? { ...result, parts: printParts } : result), [printParts, result]);

  // a built rack with things added since: what is new, for the 3D view's "Only what's new" steps
  const onlyNew = useMemo(() => {
    const b = project?.built, d = b && result && view === 'assembly' ? delta(project!, result) : null;
    return d?.any ? { parts: d.parts, cables: new Set(d.cables.map((c) => c.id)), boards: new Set(project!.modules.filter((m) => !b!.boards.includes(m.id)).map((m) => m.id)) } : null;
  }, [project?.built, result, view]);

  const panel = { import: <ImportPanel />, board: <BoardPanel />, plugs: <PlugsPanel />, holder: <HolderPanel />, mount: <MountPanel />, check: <CheckPanel />, export: <ExportPanel /> }[step];
  // one count everywhere (Start, the step bar, the stats and Check): failing checks, and what to look at
  const checkSum = useMemo(() => summarizeChecks(project, result?.report), [project, result]);
  const warnCount = checkSum.nLook, badCount = checkSum.failing.length;
  const si = STEPS.findIndex((s) => s.id === step);
  const S = STEPS[si];
  // Start shows the library, Board the board editor; the other steps the rack (in 3D, unless you picked another view)
  const goStep = (id: Step) => store.set({ step: id, ...(id === 'import' ? { view: 'library' as const } : id === 'board' ? { view: 'editor' as const } : ['library', 'editor'].includes(store.get().view) ? { view: 'assembly' as const } : {}) });
  const views: [typeof view, string][] = project ? [...(step === 'import' ? [['library', 'Add boards'] as [typeof view, string]] : []), ['assembly', '3D'], ...(project.layout === 'panel' ? [['panel', 'Rails'] as [typeof view, string]] : []), ['wiring', 'Wiring'], ['print', 'Plates'], ['editor', 'Board']] : [];

  return (
    <div className={`app${project ? '' : ' empty'}`} onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }} onDragLeave={(e) => { if (!e.relatedTarget) setDragging(false); }} onDrop={onDrop}>
      {dragging && <div className="dropveil"><div><b>Drop to import</b><span>{project ? (store.get().replaceMode ? 'replaces the board being edited' : 'adds to this project: one board per file (a Gerber set or zip is one board)') : 'KiCad · STEP · IDF · Eagle · Gerber zip · DXF · project'}</span></div></div>}
      {(dropErr || toastMsg) && (
        <div key={dropErr ?? toastMsg ?? ''} className={`toast ${dropErr ? 'err' : 'floating'}`} role="status">
          <span className="toast-ic">{dropErr ? '!' : <Icon d={I.check} />}</span>
          <span className="toast-msg">{(dropErr ?? toastMsg ?? '').replace(/\s*⌘Z (undoes|brings) (it|them)( back)?\.?/, '')}</span>
          {!dropErr && toastAction && <button className="btn small" onClick={() => { toastAction.run(); store.set({ toast: null, toastAction: null }); }}>{toastAction.label}</button>}
          {!dropErr && /⌘Z (undoes|brings)/.test(toastMsg ?? '') && pastLen === toastPast && <button className="btn small soft" onClick={() => { undo(); store.set({ toast: null }); }}>Undo</button>}
          <button className="toast-x" title="Close" onClick={() => { setDropErr(null); store.set({ toast: null }); }}>×</button>
          {!dropErr && <i className="toast-time" style={{ animationDuration: `${Math.min(9000, 3200 + (toastMsg ?? '').length * 30)}ms` }} />}
        </div>
      )}
      {keys && <Shortcuts onClose={() => setKeys(false)} />}
      <AddBoardSheet />
      <CommandPalette ctx={{ steps: STEPS, goStep, saveProject, newRack, look, toggleTheme, showKeys: () => setKeys(true) }} />
      <ChecklistSheet />
      <header className="topbar">
        <div className="brand"><Mark className="mark" /><span className="word">Board<b>Dock</b></span></div>
        {project && <span className="projname" title={project.name ? rackCount(project) : 'Name this rack on the Start step'}>{project.name?.trim() || (project.modules.length > 1 ? rackCount(project) : activeModule(project).board.name)}</span>}
        {project && <button className="btn small soft addboard" onClick={() => store.set({ addSheet: true })} title="Add a board (A)" aria-label="Add a board"><Icon d={I.plus} /><span>Board</span></button>}
        <nav className="stepper" ref={navRef}>
          {STEPS.map((s, i) => (
            <button key={s.id} className={`${step === s.id ? 'on' : i < si ? 'done' : ''} ${s.id === 'check' && badCount > 0 ? 'flag bad' : ''}`} disabled={!project && s.id !== 'import'} onClick={() => goStep(s.id)} title={s.title}>
              <span className="n">{i < si && step !== s.id ? <Icon d={I.check} /> : s.id === 'check' && badCount > 0 && step !== s.id ? '!' : i + 1}</span>
              <span className="l">{s.label}</span>
            </button>
          ))}
        </nav>
        <div className="acts">
          {project && (
            <>
              <div className="status" title={error ?? (result ? `Built in ${result.report.timeMs} ms` : '')}>
                <span className={`dot ${error ? 'err' : building || rendering ? 'busy' : result ? 'ok' : ''}`} />
                <span className="st">{error ? 'Build failed' : building ? 'Building…' : rendering ? 'Rendering…' : result ? 'Up to date' : ''}</span>
              </div>
              <button className="iconbtn" disabled={!canUndo} onClick={undo} title="Undo (⌘Z)"><Icon d={I.undo} /></button>
              <button className="iconbtn" disabled={!canRedo} onClick={redo} title="Redo (⇧⌘Z)"><Icon d={I.redo} /></button>
              <button className="iconbtn" onClick={saveProject} title="Save project (⌘S)"><Icon d={I.save} /></button>
              <button className="iconbtn" onClick={newRack} title="New rack"><Icon d={I.newdoc} /></button>
              {/* on a phone Redo, Save and New rack have no room in the bar: they live in this menu */}
              <details className="phonemenu" onClick={(e) => { if ((e.target as HTMLElement).tagName === 'BUTTON') (e.currentTarget as HTMLDetailsElement).open = false; }}>
                <summary className="iconbtn" title="More" aria-label="More">⋯</summary>
                <div className="phonemenu-list floating">
                  <button disabled={!canRedo} onClick={redo}><Icon d={I.redo} /> Redo</button>
                  <button onClick={saveProject}><Icon d={I.save} /> Save the project file</button>
                  <button onClick={() => { if (confirm('Start a new rack? This one stays only in the project file you saved.')) closeProject(); }}><Icon d={I.newdoc} /> New rack</button>
                  <button onClick={() => { const t = theme === 'dark' ? 'light' : 'dark'; store.set({ theme: t }); try { localStorage.setItem('boarddock.theme', t); } catch { /* private mode */ } }}><Icon d={theme === 'dark' ? I.sun : I.moon} /> {theme === 'dark' ? 'Light' : 'Dark'} theme</button>
                </div>
              </details>
            </>
          )}
          <PaletteButton />
          <button className="iconbtn" onClick={toggleTheme} title="Light / dark"><Icon d={theme === 'dark' ? I.sun : I.moon} /></button>
        </div>
      </header>
      <div className="main">
        <aside className="side">
          <div className="head">
            <small>Step {si + 1} of {STEPS.length} · {S.label}</small>
            <div className="stepbar"><i style={{ width: `${((si + 1) / STEPS.length) * 100}%` }} /></div>
            <h1>{S.id === 'import' && project ? 'Your rack' : S.title}</h1>
            <p>{S.id === 'import' && project ? 'Add boards to it, or pick up where you left off.' : S.text}</p>
          </div>
          <div className="body" ref={bodyRef}><div className="body-in" key={step}>{panel}</div></div>
          {project && (
            <div className="foot">
              {si > 0 && <button className="btn back" onClick={() => goStep(STEPS[si - 1].id)}><Icon d={I.left} /> {STEPS[si - 1].label}</button>}
              {si < STEPS.length - 1 ? <button className="btn primary" onClick={() => { if (step === 'plugs') connectIfNone(); goStep(STEPS[si + 1].id); }}>Next: {STEPS[si + 1].label} <Icon d={I.right} /></button> : (
                <>
                  <button className="btn ghost" onClick={() => goStep('import')} title="Back to Start to add a board"><Icon d={I.plus} /> Board</button>
                  <button className="btn primary" onClick={() => window.dispatchEvent(new Event('boarddock:download'))}><Icon d={I.download} /> Download .zip</button>
                </>
              )}
            </div>
          )}
        </aside>
        <section className="stage">
          {project ? (
            <>
              <div className="tabs"><div className="seg">{views.map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => store.set({ view: k })}>{l}</button>)}</div></div>
              {view === 'library' ? <StartStage /> : view === 'editor' ? <BoardEditor tool={tool} setTool={setTool} /> : view === 'wiring' ? <WiringView /> : view === 'panel' && project.layout === 'panel' ? <PanelEditor /> : (
                <>
                  <Viewer3D result={view === 'print' ? shown : result} mode={view === 'print' ? 'print' : 'assembly'} bed={project.printer.bed} spacing={project.printer.spacing} theme={theme} camera={cam} overhangs={view === 'print' && overhangs} only={onlyNew}
                    layers={layers} sel={sel} onPick={(it, add) => (it ? select([it], add ? 'toggle' : 'set') : !add && select([]))} label={(it) => describe(store.get().project!, it)} />
                  <div className="tools">
                    <div className="tgroup floating">
                      <button onClick={() => look([...VIEW_DIRS.iso])} title="Isometric"><Icon d={I.cube} /></button>
                      <button onClick={() => look([...VIEW_DIRS.top])} title="From above">Top</button>
                      <button onClick={() => look([...VIEW_DIRS.front])} title="From the front">Front</button>
                      <button onClick={() => look([...VIEW_DIRS.side])} title="From the side">Side</button>
                      <button onClick={() => look([...VIEW_DIRS.under])} title="From below">Under</button>
                    </div>
                    {view === 'assembly' && <div className="tgroup floating"><button className={showLayers ? 'on' : ''} onClick={() => setShowLayers(!showLayers)} title="Show or hide kinds of parts"><Icon d={I.layers} /> Layers</button></div>}
                    {view === 'assembly' && <FocusTools />}
                    {view === 'print' && <div className="tgroup floating" title="Red: faces that would need support. Amber: bridges (fine when short)."><button className={overhangs ? 'on' : ''} onClick={() => setOverhangs(!overhangs)}>Overhangs</button></div>}
                  </div>
                  {view === 'assembly' && showLayers && (
                    <div className="layers floating">
                      {LAYERS.map(([k, n, col]) => (
                        <label key={k}><input type="checkbox" checked={layers[k]} onChange={(e) => store.set({ layers: { ...layers, [k]: e.target.checked } })} /><i style={{ background: col }} />{n}</label>
                      ))}
                    </div>
                  )}
                  {view === 'assembly' && <CableKey />}
                  {view === 'assembly' && picks.length > 0 && <SelPanel items={picks} />}
                  {stats && (
                    <div className="stats floating" style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 6 }}>
                      <span><b>{stats.n}</b>parts</span>
                      <span><b>{stats.plates}</b>plate{stats.plates > 1 ? 's' : ''}</span>
                      <span><b>{stats.g.toFixed(0)}</b>g</span>
                      <span title="Rough estimate, slicer numbers are the real ones"><b>{fmtTime(stats.min)}</b></span>
                      {(warnCount > 0 || badCount > 0) && <span className="warn" onClick={() => store.set({ step: 'check' })}><b>{badCount || warnCount}</b>{badCount ? 'failing' : 'to look at'}</span>}
                    </div>
                  )}
                  {error && <div className="floating err" style={{ position: 'absolute', left: '50%', top: 60, transform: 'translateX(-50%)', zIndex: 7 }}>{error}</div>}
                  {building && <div className="buildbar" title="Building" />}
                  <BuildStatus />
                </>
              )}
            </>
          ) : (
            <StartStage />
          )}
        </section>
      </div>
    </div>
  );
}

function fmtTime(m: number) { const t = Math.round(m); return t < 60 ? `${t} min` : `${Math.floor(t / 60)} h ${String(t % 60).padStart(2, '0')}`; }

/** What is picked in the 3D view, with the actions that apply to it. */
function SelPanel({ items }: { items: SelItem[] }) {
  const p = useApp((s) => s.project)!;
  const ds = items.map((it) => ({ it, d: describe(p, it) }));
  const removable = ds.filter((x) => x.d.removable);
  const one = items.length === 1 ? items[0] : null;
  const edit1 = () => {
    if (!one) return;
    const mid = one.kind === 'module' ? one.id : one.module;
    const mi = p.modules.findIndex((m) => m.id === mid);
    if (mi >= 0 && mi !== p.active) setActive(mi);
    if (one.kind === 'mount' || one.kind === 'rail' || one.kind === 'railstand') store.set({ step: 'mount' });
    else if (one.kind === 'link') store.set({ step: 'plugs' });
    else if (one.kind === 'module') store.set({ step: 'holder' });
    else if (one.fkind === 'pin') store.set({ step: 'board' });
    else if (one.fkind === 'cradle' || one.fkind === 'cap' || one.fkind === 'guard' || one.fkind === 'tie' || one.fkind === 'plug') {
      const comps = p.modules[mi]?.board.comps.filter((c) => one.refs?.includes(c.ref)) ?? [];
      store.set({ step: 'plugs' });
      select(comps.map((c) => ({ kind: 'comp' as const, id: c.id })));
    } else store.set({ step: 'holder' });
  };
  return (
    <div className="selpanel floating" style={{ position: 'absolute', left: '50%', bottom: 64, transform: 'translateX(-50%)', zIndex: 6, width: 'min(640px, calc(100% - 24px))' }}>
      <div className="top">
        <b>{one ? ds[0].d.title : `${items.length} selected`}</b>
        <span className="grow hint" style={{ margin: 0 }}>{one ? ds[0].d.sub : 'Shift-click adds or removes · Del removes · Esc clears'}</span>
        <div className="acts">
          {one && <button className="btn small" onClick={edit1}>Edit <Icon d={I.right} /></button>}
          {one?.kind === 'module' && p.modules.find((m) => m.id === one.id)?.board.kind !== 'box' && <NewVersionButton moduleId={one.id} small />}
          {one?.kind === 'module' && p.modules.length > 1 && <button className="btn small" onClick={() => { const mi = p.modules.findIndex((m) => m.id === one.id); if (mi >= 0 && mi !== p.active) setActive(mi); store.set({ addSheet: true, replaceMode: true }); }} title="Pick another board from the library (or its files) to take this one's place: its dock, stack, holder settings and the cables to plugs it also has stay">Replace with…</button>}
          {removable.length > 0 && <button className="btn small danger" onClick={() => removeItems(removable.map((x) => x.it))}><Icon d={I.trash} /> {one ? ds[0].d.removable : `Remove ${removable.length}`}</button>}
          <button className="btn small ghost icon" onClick={() => select([])} title="Clear (Esc)"><Icon d={I.x} /></button>
        </div>
      </div>
      {one && ds[0].d.note && <p className="hint selnote">{ds[0].d.note}</p>}
      {one && <MountQuick item={one} />}
      {!one && (
        <div className="picks">
          {ds.map(({ it, d }) => (
            <span key={it.id} className="pick"><i style={{ background: d.color }} />{d.title}<small>{d.sub}</small><button onClick={() => select([it], 'toggle')} title="Take out of the selection">×</button></span>
          ))}
        </div>
      )}
    </div>
  );
}

const KEYS: [string, string][] = [
  ['⌘Z / ⇧⌘Z', 'undo / redo'], ['⌘S', 'save the project file'], ['Click, Shift-click', 'select in 3D, add to the selection'],
  ['Delete', 'remove the selection'], ['Esc', 'clear the selection'], ['Double-click', 'fly to a part'],
  ['R / ⇧R', 'turn the selected docks (Rails view)'], ['F', 'swap front and back boards (Rails view)'], ['Arrows, ⇧Arrows', 'move docks 1 / 10 mm (Rails view)'],
  ['A', 'add a board, from any step'], ['⌘A', 'select every dock (Rails view)'], ['1 – 7', 'go to that step'], ['⌘K', 'the command palette: every main action, searchable'], ['?', 'show or hide this list'],
];
// the board editor's own keys (they work while nothing is selected there)
const EDITOR_KEYS: [string, string][] = [
  ['V', 'select and move'], ['H', 'pan (or hold Space)'], ['M', 'measure'], ['T', 'show or hide the toolbox'],
  ['Arrows, ⇧Arrows', 'nudge the selection 0.1 / 1 mm'], ['Alt-drag', 'move freely, without snapping'], ['R / ⇧R', 'turn the selected parts'], ['⌘D', 'duplicate the selection'], ['⌘A', 'select every hole and part'],
];
function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <div className="keysveil" onClick={onClose}>
      <div className="keys floating" onClick={(e) => e.stopPropagation()}>
        <div className="keys-head"><b>Keyboard shortcuts</b><button className="toast-x" onClick={onClose}>×</button></div>
        <div className="keys-grid">{KEYS.map(([k, t]) => <Fragment key={k}><kbd>{k}</kbd><span>{t}</span></Fragment>)}</div>
        <div className="keys-head" style={{ marginTop: 12 }}><b>Board editor</b></div>
        <div className="keys-grid">{EDITOR_KEYS.map(([k, t]) => <Fragment key={k}><kbd>{k}</kbd><span>{t}</span></Fragment>)}</div>
      </div>
    </div>
  );
}
