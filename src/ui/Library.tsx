// The board library: every board BoardDock knows and every accessory (hubs, chargers, powerboards, probes), on
// shelves, with a 3D picture of each, and the boards you saved (My boards). Click a tile to add it now; "+" picks
// several and one Add puts them all in (one rebuild, one undo step). Used on Start and in the Add a board sheet.
import { useEffect, useMemo, useState } from 'react';
import type { Board } from '../model/types';
import { LIBRARY_SHELVES, TEMPLATES, shelfOf, type Shelf } from '../model/templates';
import { copyOf, forgetBoard, myBoards, restoreBoard, type SavedBoard } from '../model/myboards';
import { communityBoard } from '../model/community';
import { CommunityThumb, useCommunityBoards } from './CommunityThumb';
import { boardPicture } from '../worker/client';
import { boardSig, useKeptPicture } from './pics';
import { BoardThumb } from './panels';
import { Icon, I } from './icons';
import { bbox } from '../geom/poly';
import { toast } from '../state';

function SavedThumb({ s }: { s: SavedBoard }) {
  const url = useKeptPicture(`mine:${s.id}:${boardSig(s.board)}`, () => boardPicture(s.board), 280, 180, [0.5, -1, 0.8], 0);
  const bb = bbox(s.board.outline);
  return url ? <img className="thumb pic" src={url} alt="" draggable={false} /> : <div className="thumb pic ph mono">{Math.round(bb.x1 - bb.x0)} × {Math.round(bb.y1 - bb.y0)}</div>;
}

const kindOf = (b: Board) => (b.role === 'probe' ? 'debug probe' : b.role === 'adapter' ? 'USB-serial adapter' : b.kind === 'box' ? 'box' : 'board');

export function Library({ onAdd, dense }: { onAdd: (bs: Board[]) => void; dense?: boolean }) {
  const [q, setQ] = useState('');
  const [shelf, setShelf] = useState<Shelf | 'all' | 'mine' | 'community'>('all');
  const [pick, setPick] = useState<Record<string, number>>({});
  const [mine, setMine] = useState<SavedBoard[]>(myBoards);
  const com = useCommunityBoards(); // boards from boards/ in the repo: the list is fetched when this opens, a board's data when it is added
  useEffect(() => { const f = () => setMine(myBoards()); window.addEventListener('focus', f); return () => window.removeEventListener('focus', f); }, []);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const match = (s: string) => words.every((w) => s.toLowerCase().includes(w));
  const temps = useMemo(() => TEMPLATES.filter((t) => (shelf === 'all' || shelfOf(t) === shelf) && match(`${t.name} ${shelfOf(t)}`)), [q, shelf]);
  const saved = mine.filter((s) => (shelf === 'all' || shelf === 'mine') && match(`${s.name} ${kindOf(s.board)}`));
  const comShown = com.filter((e) => (shelf === 'all' || shelf === 'community') && match(`${e.name} ${e.maker ?? ''} community`));
  const picked = Object.values(pick).reduce((a, x) => a + x, 0);
  const bump = (id: string, d: number) => setPick((x) => { const v = Math.max(0, (x[id] ?? 0) + d); const y = { ...x, [id]: v }; if (!v) delete y[id]; return y; });
  // a count being typed: it may be empty on the way, and only settles (0 takes the board off) when the box loses focus
  const [typing, setTyping] = useState<{ id: string; text: string } | null>(null);
  const setCount = (id: string, n: number) => setPick((x) => { const y = { ...x, [id]: Math.max(0, Math.min(99, Math.floor(n))) }; if (!y[id]) delete y[id]; return y; });
  const make = (id: string): Board | null => { if (id.startsWith('mine:')) { const s = mine.find((x) => `mine:${x.id}` === id); return s ? copyOf(s) : null; } return TEMPLATES.find((t) => t.id === id)?.make() ?? null; };
  const isCom = (id: string) => id.startsWith('community:');
  const loadCom = (id: string) => { const e = com.find((x) => `community:${x.id}` === id); return e ? communityBoard(e) : Promise.resolve(null); };
  // community boards are fetched when added, so adding them is asynchronous; the rest goes in at once
  const addIds = (ids: string[]) => {
    if (!ids.some(isCom)) { onAdd(ids.map(make).filter(Boolean) as Board[]); return; }
    Promise.all(ids.map((id) => (isCom(id) ? loadCom(id) : Promise.resolve(make(id))))).then((bs) => onAdd(bs.filter(Boolean) as Board[]), () => toast('That community board could not be loaded. Are you offline?'));
  };
  const addPicked = () => { const ids = Object.entries(pick).flatMap(([id, n]) => Array.from({ length: n }, () => id)); setPick({}); addIds(ids); };
  const count = (s: Shelf) => TEMPLATES.filter((t) => shelfOf(t) === s).length;
  const tile = (id: string, name: string, sub: string, pic: React.ReactNode, extra?: React.ReactNode) => {
    const c = pick[id] ?? 0;
    return (
      <div key={id} className={`ltile ${c ? 'on' : ''}`}>
        <button className="ltile-main" onClick={() => { if (picked) bump(id, 1); else addIds([id]); }} title={picked ? 'Pick one more' : `Add ${name} now`}>
          {pic}
          <span className="nm">{name}</span>
          <small className="mono">{sub}</small>
        </button>
        <div className="ltile-qty">
          {c > 0 && <button className="qbtn" onClick={() => bump(id, -1)} aria-label={`One ${name} fewer`}>−</button>}
          {c > 0 && <input className="qnum" type="number" inputMode="numeric" min={0} max={99} value={typing?.id === id ? typing.text : c} aria-label={`How many ${name}`} title="Type how many"
            onFocus={(e) => e.target.select()} onChange={(e) => { setTyping({ id, text: e.target.value }); const n = +e.target.value; if (e.target.value !== '' && n >= 1) setCount(id, n); }}
            onBlur={(e) => { setTyping(null); if (!(+e.target.value >= 1)) setCount(id, 0); }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />}
          <button className="qbtn" onClick={() => bump(id, 1)} aria-label={`Pick ${c ? 'another' : 'a'} ${name}`} title="Pick several, then add them all at once">+</button>
        </div>
        {extra}
      </div>
    );
  };
  return (
    <div className={`library ${dense ? 'dense' : ''}`}>
      <div className="lib-bar">
        <div className="lib-search"><Icon d={I.search} /><input type="search" placeholder="Search: Pi 5, ESP32, hub, powerboard, J-Link…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the library" /></div>
        <div className="lib-shelves" role="tablist" aria-label="Shelves">
          <button role="tab" aria-selected={shelf === 'all'} className={shelf === 'all' ? 'on' : ''} onClick={() => setShelf('all')}>Everything <small>{TEMPLATES.length + mine.length + com.length}</small></button>
          {mine.length > 0 && <button role="tab" aria-selected={shelf === 'mine'} className={shelf === 'mine' ? 'on' : ''} onClick={() => setShelf('mine')}>My boards <small>{mine.length}</small></button>}
          {LIBRARY_SHELVES.filter((s) => count(s)).map((s) => <button key={s} role="tab" aria-selected={shelf === s} className={shelf === s ? 'on' : ''} onClick={() => setShelf(s)}>{s} <small>{count(s)}</small></button>)}
          {com.length > 0 && <button role="tab" aria-selected={shelf === 'community'} className={shelf === 'community' ? 'on' : ''} onClick={() => setShelf('community')}>Community <small>{com.length}</small></button>}
        </div>
      </div>
      {!picked && <p className="hint lib-tip">Tap a board to add it now, or tap <b>+</b> on each board you have (or type how many), then <b>Add</b>.</p>}
      {saved.length > 0 && (
        <section>
          <h4>My boards</h4>
          <div className="lgrid">
            {saved.map((s) => tile(`mine:${s.id}`, s.name, `${kindOf(s.board)} · ${s.board.comps.filter((c) => c.conn).length} plugs`, <SavedThumb s={s} />,
              <button className="ltile-x" title="Remove it from My boards" aria-label={`Forget ${s.name}`} onClick={() => { const f = forgetBoard(s.id); setMine(myBoards()); if (f) toast(`${s.name} is off My boards.`, { label: 'Undo', run: () => { restoreBoard(f); setMine(myBoards()); } }); }}>×</button>))}
          </div>
        </section>
      )}
      {shelf !== 'mine' && (shelf === 'all' ? LIBRARY_SHELVES : [shelf]).map((s) => {
        const ts = temps.filter((t) => shelfOf(t) === s);
        if (!ts.length) return null;
        return (
          <section key={s}>
            <h4>{s}</h4>
            <div className="lgrid">{ts.map((t) => { const [n, sz] = t.name.split(' ('); return tile(t.id, n, sz ? sz.replace(')', '') : '', <BoardThumb id={t.id} />); })}</div>
          </section>
        );
      })}
      {comShown.length > 0 && (
        <section>
          <h4>Community boards</h4>
          <p className="hint">Added by people who use BoardDock (the files are in <code>boards/</code> in the repository). Check the outline, holes and plugs against your own board.</p>
          <div className="lgrid">
            {comShown.map((e) => tile(`community:${e.id}`, e.name, [`${e.size[0]} × ${e.size[1]}`, `${e.plugs} plug${e.plugs === 1 ? '' : 's'}`, e.maker && `by ${e.maker}`].filter(Boolean).join(' · '), <CommunityThumb e={e} />, <span className="ltile-com">community</span>))}
          </div>
        </section>
      )}
      {!temps.length && !saved.length && !comShown.length && <p className="hint">Nothing called “{q}” yet. Drop its files, or draw it yourself.</p>}
      {picked > 0 && (
        <div className="lib-foot">
          <span>{picked} picked</span>
          <button className="btn small ghost" onClick={() => setPick({})}>Clear</button>
          <button className="btn small primary" onClick={addPicked}><Icon d={I.plus} /> Add {picked} board{picked > 1 ? 's' : ''}</button>
        </div>
      )}
    </div>
  );
}
