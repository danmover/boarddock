// Start: the page in the middle of the window while you are on the Start step. Three ways in (drop your board's
// files, draw one yourself, open a saved rack) and the library of every board and accessory with a picture of each.
// With a rack open it says what the rack is and how far along it is, and whatever you add joins it.
import { useRef, useState } from 'react';
import type { Board } from '../model/types';
import { ACCEPT } from '../import';
import { activeModule, myPrinter, putBoards, rememberPrinter, store, toast, useApp } from '../state';
import { PRINTERS } from '../model/library';
import { summarizeChecks } from '../model/checkSummary';
import { droppedFiles, openFiles } from './importFlow';
import { addBoards } from './AddBoard';
import { Library } from './Library';
import { DrawBoard } from './DrawBoard';
import { Icon, I } from './icons';
import { rackName } from '../model/diff';
import { countKinds } from './panels';
import { HeroArt } from './art';
import { ChecklistButton } from './Checklist';

export function StartStage() {
  const p = useApp((s) => s.project);
  const res = useApp((s) => s.result);
  const [draw, setDraw] = useState(false);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const files = useRef<HTMLInputElement>(null), proj = useRef<HTMLInputElement>(null);
  // into a new rack, into this one, or in place of the board being edited (Start's switch)
  const add = (bs: Board[]) => {
    const st = store.get();
    if (!bs.length) return;
    if (!st.project) { putBoards(bs, false); return; }
    if (st.replaceMode && bs.length === 1) { const old = activeModule(st.project).board.name; putBoards(bs, true); toast(`Replaced ${old} with ${bs[0].name}. ⌘Z undoes it.`); return; }
    addBoards(bs);
  };
  const open = async (fl: FileList | File[]) => {
    setErr(null); setBusy(true);
    try { await openFiles(fl, { stay: !!store.get().project }); } catch (e: any) { setErr(e.message ?? String(e)); } finally { setBusy(false); }
  };
  const nLinks = p?.links?.length ?? 0, rails = res?.report.panel?.rails.length ?? 0;
  const sum = summarizeChecks(p ?? null, res?.report), bad = sum.failing.length, warn = sum.nLook;
  return (
    <div className="start">
      <div className="start-in">
        {p ? (
          <header className="start-head">
            <div>
              <small>Your rack</small>
              <h2>{rackName(p)}</h2>
              <p>{p.modules.length} board{p.modules.length > 1 ? 's' : ''}{p.layout === 'panel' && rails ? ` on ${rails} rail${rails > 1 ? 's' : ''}` : ''}{nLinks ? `, ${nLinks} cable${nLinks > 1 ? 's' : ''}` : ''}: {countKinds(p)}. {p.built ? 'Built: what you add goes into a free dock slot or spot, and nothing else moves.' : 'Add more below, or carry on where you left off.'}</p>
            </div>
            <div className="start-head-acts">
              <button className="btn small" onClick={() => store.set({ view: 'assembly' })}><Icon d={I.cube} /> See it in 3D</button>
              <button className="btn small" onClick={() => store.set({ step: 'board', view: 'editor' })}><Icon d={I.board} /> Its boards</button>
              <ChecklistButton />
              {bad + warn > 0 && <button className="btn small ghost" onClick={() => store.set({ step: 'check' })}>{bad ? `${bad} failing` : `${warn} to look at`}</button>}
            </div>
          </header>
        ) : (
          <header className="start-hero">
            <HeroArt />
            <h1>Dock any PCB. <span>No screws. No supports.</span></h1>
            <p>Bring your boards in: from their design files, from the library below, or drawn by hand. BoardDock builds a light holder round each one, docks them on DIN rails with every plug reachable, routes and sizes every cable, and walks you through putting it together.</p>
            <MyPrinter />
          </header>
        )}

        <div className="start-acts">
          <div role="button" tabIndex={0} className={`sact drop ${over ? 'over' : ''}`} onClick={() => files.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); files.current?.click(); } }}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); const fl = Array.from(e.dataTransfer.files); droppedFiles(e.dataTransfer).then(open, () => open(fl)); }}>
            <span className="sact-ic"><Icon d={I.download} /></span>
            <b>{busy ? 'Reading…' : 'Drop your board’s files'}</b>
            <small>KiCad · STEP · IPC-2581 · ODB++ · GenCAD · IDF · Eagle · Gerber + drill + pick & place (a zip or folder is fine) · DXF</small>
            <input ref={files} type="file" multiple accept={ACCEPT} hidden onChange={(e) => e.target.files && open(e.target.files)} />
          </div>
          <button className={`sact ${draw ? 'on' : ''}`} onClick={() => setDraw((x) => !x)} aria-expanded={draw}>
            <span className="sact-ic"><Icon d={I.pencil} /></span>
            <b>Draw your own</b>
            <small>A board (shape, size and holes, a photo of it if you like), or a box such as a USB hub, with its ports</small>
          </button>
          <button className="sact" onClick={() => proj.current?.click()}>
            <span className="sact-ic"><Icon d={I.folder} /></span>
            <b>Open a saved rack</b>
            <small>A .boarddock.json you saved (⌘S)</small>
            <input ref={proj} type="file" accept=".json" hidden onChange={(e) => e.target.files && open(e.target.files)} />
          </button>
        </div>
        {busy && <div className="progress" style={{ margin: '4px 0 10px' }}><div /></div>}
        {err && <div className="err" style={{ margin: '0 0 10px' }}>{err}</div>}
        {draw && <div className="start-draw"><div className="start-draw-head"><b>Draw your own board or box</b><button className="btn small ghost icon" onClick={() => setDraw(false)} aria-label="Close">×</button></div><DrawBoard put={(b) => add([b])} /></div>}

        <Library onAdd={add} />

        <details className="start-help">
          <summary>Exporting from your design tool</summary>
          <ul className="fmt">
            <li><b>KiCad</b>: drop the <code>.kicad_pcb</code>. Outline, holes, courtyards, 3D model names and the nets on header pins are read.</li>
            <li><b>Altium Designer</b>: File › Export › <b>STEP 3D</b> (best: real part heights). Or File › Fabrication Outputs › IPC-2581 or ODB++, or zip the fab outputs: Gerbers with the outline layer, NC Drill, Pick and Place.</li>
            <li><b>Eagle / Fusion Electronics</b>: drop the <code>.brd</code>, or export STEP.</li>
            <li><b>EasyEDA / JLCPCB</b>: Export › Gerber zip and Export › Pick and Place (CPL): drop both. Or Export › 3D › STEP.</li>
            <li><b>Allegro, OrCAD PCB Editor, PADS, Xpedition</b>: export <b>IPC-2581</b> (an <code>.xml</code>; in Allegro File › Export › IPC 2581), <b>ODB++</b> (the <code>.tgz</code>, a zip, or the job folder) or <b>GenCAD</b> (<code>.cad</code>). These give the outline, holes, and every part with its package size. IDF (<code>.emn</code> + <code>.emp</code>) and STEP work too.</li>
            <li><b>An Allegro <code>.brd</code></b> cannot be read (its format is not published). Free way round: KiCad 10 or newer imports it (File › Import › Non-KiCad Board File); save and drop the <code>.kicad_pcb</code> here. Or ask the board’s designer for one of the files above.</li>
            <li><b>DipTrace, Proteus and others</b>: IDF, STEP, IPC-2581 or ODB++ if offered, else Gerber + drill + centroid.</li>
            <li><b>A zip of everything</b> is fine: BoardDock reads the file that tells it most and says which one it used.</li>
          </ul>
          <p className="hint">Files never leave your computer: everything runs here.</p>
        </details>
      </div>
    </div>
  );
}

/** Which printer you print on, asked up front: the plates, the parts too big for its bed and the times are for it. */
function MyPrinter() {
  const [name, setName] = useState(() => myPrinter() ?? PRINTERS[0].name);
  return (
    <label className="start-printer">
      <span>Your printer</span>
      <select value={name} onChange={(e) => { setName(e.target.value); rememberPrinter(e.target.value); }}>
        {PRINTERS.map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
      </select>
      <small>Plates, parts that need splitting and print times are for it. Change it any time in Export.</small>
    </label>
  );
}
