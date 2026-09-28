// "Add a board" from anywhere: templates, hubs and chargers, your own files, or measure one by hand. The new board
// joins the rack (into a free dock slot or spot when the rack is laid out) and you stay on the step you were on; the
// toast offers to go and check it. Several at once: "+" on a tile counts it up and one "Add" puts them all in (one
// rebuild, one undo step).
import { useEffect, useRef, useState } from 'react';
import type { Board } from '../model/types';
import { ACCEPT } from '../import';
import { activeModule, lastReplace, putBoards, store, toast, useApp } from '../state';
import { openFiles } from './importFlow';
import { rackCount } from '../model/diff';
import { bedNote, placementNote, settleOverlaps } from './panelOps';
import { DrawBoard } from './DrawBoard';
import { Library } from './Library';
import { Icon, I } from './icons';

/** "Raspberry Pi 4B", "2 × Raspberry Pi Pico and Relay board", "7 boards". */
export function countNames(bs: Board[]): string {
  const n = new Map<string, number>();
  for (const b of bs) n.set(b.name, (n.get(b.name) ?? 0) + 1);
  const parts = [...n].map(([k, c]) => (c > 1 ? `${c} × ${k}` : k));
  return parts.length > 3 ? `${bs.length} boards` : parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
}

/** Add boards without leaving the step, and say where they went. */
export function addBoards(bs: Board[]) {
  if (!bs.length) return;
  const before = store.get().project?.modules.length ?? 0;
  putBoards(bs, false, { stay: true });
  const p = store.get().project!;
  toast(`Added ${countNames(bs)} (${rackCount(p)}).${placementNote(p, p.modules.slice(before).map((m) => m.id))}${bedNote(p, bs)} ⌘Z undoes it.`, { label: bs.length > 1 ? 'Check them' : 'Check its board', run: () => store.set({ step: 'board', view: 'assembly' }) });
  // a board in a dock's free slot makes that dock reach further: slide its neighbours along if they now overlap
  if (p.layout === 'panel' && !p.panel.auto) settleOverlaps();
}

/** Put a library board in place of the board being edited, and say what it kept. */
export function replaceWith(b: Board) {
  const p = store.get().project;
  if (!p) return;
  const old = activeModule(p).board.name;
  putBoards([b], true);
  toast(`Replaced ${old} with ${store.get().project ? activeModule(store.get().project!).board.name : b.name}.${lastReplace} ⌘Z undoes it.`);
}

export function AddBoardSheet() {
  const open = useApp((s) => s.addSheet);
  const replacing = useApp((s) => s.replaceMode && !!s.project);
  const target = useApp((s) => (s.project ? activeModule(s.project).board.name : ''));
  const n = useApp((s) => s.project?.modules.length ?? 0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [draw, setDraw] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  // (replace mode is for this one pick: closing the sheet ends it)
  const close = () => { store.set({ addSheet: false, replaceMode: false }); opener.current?.focus?.(); };
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    setErr(null); setDraw(false);
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      // keep Tab inside the sheet while it is open
      if (e.key === 'Tab' && sheet.current) {
        const f = [...sheet.current.querySelectorAll<HTMLElement>('button, input:not([hidden]), select, [tabindex="0"]')].filter((x) => !x.hasAttribute('disabled') && x.offsetParent);
        if (!f.length) return;
        const i = f.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);
  if (!open) return null;
  const add = (bs: Board[]) => { if (replacing && bs.length) { store.set({ addSheet: false }); replaceWith(bs[0]); if (bs.length > 1) addBoards(bs.slice(1)); return; } close(); addBoards(bs); };
  const files = async (fl: FileList | File[]) => {
    setErr(null); setBusy(true);
    try { await openFiles(fl, { stay: true }); close(); } catch (e: any) { setErr(e.message ?? String(e)); } finally { setBusy(false); }
  };
  return (
    <div className="sheet-veil" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="sheet wide" role="dialog" aria-modal="true" aria-label={replacing ? `Replace ${target}` : 'Add a board'} ref={sheet}>
        <div className="sheet-head">
          {replacing
            ? <div><b>Replace {target}</b><small>The board you pick takes its place: its dock, its stack, its holder settings and the cables to plugs the new one also has. Click a picture, or drop its files.</small></div>
            : <div><b>Add a board</b><small>{n ? `It joins your ${n}-board rack${store.get().project?.built ? ' without moving anything that is built' : ''}. You stay on this step.` : 'Start a rack with it.'} Click a picture to add it, or “+” to pick several.</small></div>}
          <button className="iconbtn" title="Close (Esc)" onClick={close}><Icon d={I.x} /></button>
        </div>
        <div className="sheet-body">
          <div className="start-acts two">
            <div role="button" tabIndex={0} className={`sact drop ${over ? 'over' : ''}`} onClick={() => file.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.current?.click(); } }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); files(e.dataTransfer.files); }}>
              <span className="sact-ic"><Icon d={I.download} /></span>
              <b>{busy ? 'Reading…' : 'Drop its files'}</b>
              <small>KiCad, STEP, IDF, Eagle, Gerber zip, DXF</small>
              <input ref={file} type="file" multiple accept={ACCEPT} hidden onChange={(e) => e.target.files && files(e.target.files)} />
            </div>
            <button className={`sact ${draw ? 'on' : ''}`} onClick={() => setDraw((x) => !x)} aria-expanded={draw}>
              <span className="sact-ic"><Icon d={I.pencil} /></span>
              <b>Draw your own</b>
              <small>Shape, size, holes; parts from the toolbox</small>
            </button>
          </div>
          {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
          {draw && <div className="start-draw"><DrawBoard put={(b) => add([b])} /></div>}
          <Library onAdd={add} dense />
        </div>
      </div>
    </div>
  );
}
