// "Add a board" from anywhere: templates, hubs and chargers, your own files, or measure one by hand. The new board
// joins the rack (into a free dock slot or spot when the rack is laid out) and you stay on the step you were on; the
// toast offers to go and check it. Several at once: "+" on a tile counts it up and one "Add" puts them all in (one
// rebuild, one undo step).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Board } from '../model/types';
import { TEMPLATES } from '../model/templates';
import { ACCEPT } from '../import';
import { putBoards, store, toast, useApp } from '../state';
import { openFiles } from './importFlow';
import { bedNote, placementNote } from './panelOps';
import { BoardThumb, ManualBoard } from './panels';
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
  putBoards(bs, false, { stay: true });
  const p = store.get().project!;
  toast(`Added ${countNames(bs)} (${p.modules.length} boards).${placementNote(p)}${bedNote(p, bs)} ⌘Z undoes it.`, { label: bs.length > 1 ? 'Check them' : 'Check its board', run: () => store.set({ step: 'board', view: 'assembly' }) });
}

export function AddBoardSheet() {
  const open = useApp((s) => s.addSheet);
  const n = useApp((s) => s.project?.modules.length ?? 0);
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [pick, setPick] = useState<Record<string, number>>({});
  const file = useRef<HTMLInputElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const close = () => { store.set({ addSheet: false }); opener.current?.focus?.(); };
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    setQ(''); setErr(null); setPick({});
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
  const match = (name: string) => !q.trim() || q.toLowerCase().split(/\s+/).every((w) => name.toLowerCase().includes(w));
  const boards = useMemo(() => TEMPLATES.filter((t) => !t.accessory && match(t.name)), [q]);
  const extras = useMemo(() => TEMPLATES.filter((t) => t.accessory && match(t.name)), [q]);
  if (!open) return null;
  const picked = Object.values(pick).reduce((a, x) => a + x, 0);
  const bump = (id: string, d: number) => setPick((x) => { const v = Math.max(0, (x[id] ?? 0) + d); const y = { ...x, [id]: v }; if (!v) delete y[id]; return y; });
  const add = (bs: Board[]) => { close(); addBoards(bs); };
  const addPicked = () => add(TEMPLATES.flatMap((t) => Array.from({ length: pick[t.id] ?? 0 }, () => t.make())));
  const files = async (fl: FileList | File[]) => {
    setErr(null); setBusy(true);
    try { await openFiles(fl, { stay: true }); close(); } catch (e: any) { setErr(e.message ?? String(e)); } finally { setBusy(false); }
  };
  const tile = (t: (typeof TEMPLATES)[number]) => {
    const [nm, sz] = t.name.split(' ('), c = pick[t.id] ?? 0;
    return (
      <div key={t.id} className={`tilewrap ${c ? 'on' : ''}`}>
        <button className="tile" onClick={() => (picked ? bump(t.id, 1) : add([t.make()]))} title={picked ? 'Pick one more' : 'Add it now'}>
          <BoardThumb id={t.id} /><span>{nm}</span>{sz && <small>{sz.replace(')', '')}</small>}
        </button>
        <div className="tileqty">
          {c > 0 && <button className="qbtn" onClick={() => bump(t.id, -1)} aria-label={`One ${nm} fewer`}>−</button>}
          {c > 0 && <b>{c}</b>}
          <button className="qbtn" onClick={() => bump(t.id, 1)} aria-label={`Pick ${c ? 'another' : 'a'} ${nm}`} title="Pick several, then add them all at once">+</button>
        </div>
      </div>
    );
  };
  const only = [...boards, ...extras].length === 1 ? [...boards, ...extras][0] : null;
  return (
    <div className="sheet-veil" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Add a board" ref={sheet}>
        <div className="sheet-head">
          <div><b>Add a board</b><small>{n ? `It joins your ${n}-board rack${store.get().project?.built ? ' without moving anything that is built' : ''}. You stay on this step.` : 'Start a rack with it.'} Click a tile to add it, or “+” to pick several.</small></div>
          <button className="iconbtn" title="Close (Esc)" onClick={close}><Icon d={I.x} /></button>
        </div>
        <div className="sheet-body">
          <div role="button" tabIndex={0} className={`drop small ${over ? 'over' : ''}`} onClick={() => file.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.current?.click(); } }}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); files(e.dataTransfer.files); }}>
            <Icon d={I.download} />
            <div><b>{busy ? 'Reading…' : 'Your own board: drop or pick its files'}</b><p>KiCad, STEP, IDF, Eagle, Gerber zip, DXF</p></div>
            <input ref={file} type="file" multiple accept={ACCEPT} hidden onChange={(e) => e.target.files && files(e.target.files)} />
          </div>
          {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
          <input autoFocus className="sheet-search" type="text" placeholder="Search boards, hubs, chargers…" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { if (picked) addPicked(); else if (only) add([only.make()]); } }} aria-label="Search boards" />
          {only && !picked && <p className="hint" style={{ margin: '6px 0 0' }}>Enter adds {only.name.split(' (')[0]}.</p>}
          {boards.length > 0 && <><h4>Boards</h4><div className="tiles">{boards.map(tile)}</div></>}
          {extras.length > 0 && <><h4>Hubs, chargers and add-ons</h4><div className="tiles">{extras.map(tile)}</div></>}
          {!boards.length && !extras.length && <p className="hint">Nothing called “{q}” yet. Drop its files above, or measure it below.</p>}
          <ManualBoard put={(b) => add([b])} />
        </div>
        {picked > 0 && (
          <div className="sheet-foot">
            <span>{countNames(TEMPLATES.flatMap((t) => Array.from({ length: pick[t.id] ?? 0 }, () => ({ name: t.name.split(' (')[0] } as Board))))}</span>
            <button className="btn small ghost" onClick={() => setPick({})}>Clear</button>
            <button className="btn small primary" onClick={addPicked}><Icon d={I.plus} /> Add {picked} board{picked > 1 ? 's' : ''}</button>
          </div>
        )}
      </div>
    </div>
  );
}
