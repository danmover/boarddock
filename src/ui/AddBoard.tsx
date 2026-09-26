// "Add a board" from anywhere: templates, hubs and chargers, your own files, or measure one by hand. The new board
// joins the rack (into a free dock slot or spot when the rack is laid out) and you stay on the step you were on; the
// toast offers to go and check it.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Board } from '../model/types';
import { TEMPLATES } from '../model/templates';
import { ACCEPT } from '../import';
import { putBoards, store, toast, useApp } from '../state';
import { openFiles } from './importFlow';
import { placementNote } from './panelOps';
import { BoardThumb, ManualBoard } from './panels';
import { Icon, I } from './icons';

export function AddBoardSheet() {
  const open = useApp((s) => s.addSheet);
  const n = useApp((s) => s.project?.modules.length ?? 0);
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const close = () => store.set({ addSheet: false });
  useEffect(() => {
    if (!open) return;
    setQ(''); setErr(null);
    setTimeout(() => search.current?.focus(), 30);
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);
  const match = (name: string) => !q.trim() || q.toLowerCase().split(/\s+/).every((w) => name.toLowerCase().includes(w));
  const boards = useMemo(() => TEMPLATES.filter((t) => !t.accessory && match(t.name)), [q]);
  const extras = useMemo(() => TEMPLATES.filter((t) => t.accessory && match(t.name)), [q]);
  if (!open) return null;
  const add = (b: Board) => {
    putBoards([b], false, { stay: true });
    close();
    const p = store.get().project!;
    toast(`Added ${b.name} (${p.modules.length} boards).${placementNote(p)} ⌘Z undoes it.`, { label: 'Check its board', run: () => store.set({ step: 'board', view: 'assembly' }) });
  };
  const files = async (fl: FileList | File[]) => {
    setErr(null); setBusy(true);
    try { await openFiles(fl, { stay: true }); close(); } catch (e: any) { setErr(e.message ?? String(e)); } finally { setBusy(false); }
  };
  const tile = (t: (typeof TEMPLATES)[number]) => { const [nm, sz] = t.name.split(' ('); return <button key={t.id} className="tile" onClick={() => add(t.make())}><BoardThumb id={t.id} /><span>{nm}</span>{sz && <small>{sz.replace(')', '')}</small>}</button>; };
  return (
    <div className="sheet-veil" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="sheet" role="dialog" aria-label="Add a board">
        <div className="sheet-head">
          <div><b>Add a board</b><small>{n ? `It joins your ${n}-board rack${store.get().project?.built ? ' without moving anything that is built' : ''}. You stay on this step.` : 'Start a rack with it.'}</small></div>
          <button className="iconbtn" title="Close (Esc)" onClick={close}><Icon d={I.x} /></button>
        </div>
        <div className="sheet-body">
          <div className={`drop small ${over ? 'over' : ''}`} onClick={() => file.current?.click()} onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); files(e.dataTransfer.files); }}>
            <Icon d={I.download} />
            <div><b>{busy ? 'Reading…' : 'Your own board: drop or pick its files'}</b><p>KiCad, STEP, IDF, Eagle, Gerber zip, DXF</p></div>
            <input ref={file} type="file" multiple accept={ACCEPT} hidden onChange={(e) => e.target.files && files(e.target.files)} />
          </div>
          {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
          <input ref={search} className="sheet-search" type="text" placeholder="Search boards, hubs, chargers…" value={q} onChange={(e) => setQ(e.target.value)} />
          {boards.length > 0 && <><h4>Boards</h4><div className="tiles">{boards.map(tile)}</div></>}
          {extras.length > 0 && <><h4>Hubs, chargers and add-ons</h4><div className="tiles">{extras.map(tile)}</div></>}
          {!boards.length && !extras.length && <p className="hint">Nothing called “{q}” yet. Drop its files above, or measure it below.</p>}
          <ManualBoard put={add} />
        </div>
      </div>
    </div>
  );
}
