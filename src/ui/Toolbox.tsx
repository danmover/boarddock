// The board editor's toolbox: every plug, header, hole and tall part as a picture of its own 3D model on a scrap of
// board. Click one to pick it up (it follows the pointer over the board, snapping to an edge if it goes on one), then
// click where it goes; or drag it onto the board. Search, or narrow to one kind.
import { useEffect, useMemo, useState } from 'react';
import { PALETTE, PALETTE_GROUPS, contribOf, demoBoard, partBoard, paletteFor, samePart, type PaletteItem } from '../model/palette';
import { PartIcon } from './PartIcon';
import type { Board, Comp } from '../model/types';
import { boardPicture } from '../worker/client';
import { picture } from './snapshot';
import { boardSig, tileUrl } from './pics';
import { bbox, compRect } from '../geom/poly';

const failed = new Set<string>();
export const PART_DRAG = 'application/x-boarddock-part';

/**
 * A toolbox entry's picture: its own 3D model on a scrap of board (demoBoard), rendered ahead of time while that is
 * still the model (tiles.json), else rendered here.
 */
export function PartPic({ item }: { item: PaletteItem }) {
  const shipped = tileUrl(`pal/${item.id}`), def = contribOf(item);
  // (a contributed type nobody has rendered a picture of yet gets a plain drawing made from its look, not a render of its own)
  const [live, setLive] = useState(() => (!shipped && !def) || failed.has(item.id));
  const b = useMemo(() => (live && !def ? demoBoard(item) : null), [live, item.id]);
  if (!b) return shipped && !failed.has(item.id) ? <img className="pic" src={shipped} alt="" draggable={false} decoding="async" loading="lazy" onError={() => { failed.add(item.id); setLive(true); }} /> : <PartIcon def={def!} />;
  return <ScrapPic b={b} />;
}

/**
 * A part of a board in its lists: the toolbox entry's picture when the part is just what that entry puts down, else
 * a picture of this part itself (its own size, pins and look), so a 1 x 18 header never shows as a 1 x 6. A box's
 * ports are openings in its housing, not parts: they show the socket they take.
 */
export function CompPic({ c, box }: { c: Comp; box: boolean }) {
  const it = paletteFor(c);
  const own = useMemo(() => (it && !box && !samePart(c, it) ? partBoard(c) : null), [c, it, box]);
  if (own) return <ScrapPic b={own} />;
  return it ? <PartPic item={it} /> : <i style={{ background: c.kind === 'module' ? '#3d5872' : c.kind === 'led' ? '#ffd166' : c.kind === 'hot' ? '#b8553a' : '#3d4957' }} />;
}

/** A small board's 3D picture (a part on its scrap), rendered once and kept; a top view of it meanwhile. */
function ScrapPic({ b }: { b: Board }) {
  const key = `scrap:${boardSig(b)}`;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    setUrl(null);
    picture(key, () => boardPicture(b), 168, 120, [0.42, -1, 0.9]).then((u) => on && setUrl(u)).catch(() => {});
    return () => { on = false; };
  }, [key]);
  if (url) return <img className="pic" src={url} alt="" draggable={false} />;
  return <ScrapSketch b={b} />;
}

/** Top view of a scrap of board with its part, while its picture renders. */
function ScrapSketch({ b }: { b: Board }) {
  const bb = bbox(b.outline), pad = 2, w = bb.x1 - bb.x0 + 2 * pad, h = bb.y1 - bb.y0 + 2 * pad;
  const P = (l: [number, number][]) => 'M' + l.map((q) => `${(q[0] - bb.x0 + pad).toFixed(1)},${(bb.y1 - q[1] + pad).toFixed(1)}`).join('L') + 'Z';
  return (
    <svg className="pic sketch" viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <path d={P(b.outline)} className="th-pcb" />
      {b.comps.map((c) => <path key={c.id} d={P(compRect(c))} className={c.conn ? 'th-conn' : 'th-part'} />)}
      {b.holes.map((q) => <circle key={q.id} cx={q.x - bb.x0 + pad} cy={bb.y1 - q.y + pad} r={q.d / 2} className="th-hole" />)}
    </svg>
  );
}

export function Toolbox({ armed, onArm, onClose }: { armed: string | null; onArm: (id: string | null) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<string>('all');
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const match = (x: PaletteItem) => words.every((w) => `${x.label} ${x.group} ${x.hint} ${x.size}`.toLowerCase().includes(w));
  const groups = PALETTE_GROUPS.filter((g) => PALETTE.some((x) => x.group === g));
  const shown = PALETTE.filter((x) => (group === 'all' || x.group === group) && match(x));
  return (
    <aside className="toolbox" aria-label="Toolbox">
      <div className="tbx-head">
        <b>Toolbox</b>
        <button className="btn small ghost icon" onClick={onClose} title="Hide the toolbox (T)" aria-label="Hide the toolbox">‹</button>
      </div>
      <input className="tbx-search" type="search" placeholder="USB-C, header, M3, relay…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a part" />
      <div className="tbx-chips" role="tablist">
        <button role="tab" aria-selected={group === 'all'} className={group === 'all' ? 'on' : ''} onClick={() => setGroup('all')}>All</button>
        {groups.map((g) => <button key={g} role="tab" aria-selected={group === g} className={group === g ? 'on' : ''} onClick={() => setGroup(g)}>{g.replace(' and ', ' & ').replace('Parts that stand tall', 'Tall parts').replace('Video, network & audio', 'Video, net, audio')}</button>)}
      </div>
      <div className="tbx-body">
        {(group === 'all' ? groups : [group]).map((g) => {
          const its = shown.filter((x) => x.group === g);
          if (!its.length) return null;
          return (
            <section key={g}>
              {group === 'all' && <h5>{g}</h5>}
              <div className="tbx-grid">
                {its.map((x) => (
                  <button key={x.id} className={`tbx-tile ${armed === x.id ? 'on' : ''}`} title={`${x.label}: ${x.hint}`} draggable
                    onDragStart={(e) => { e.dataTransfer.setData(PART_DRAG, x.id); e.dataTransfer.effectAllowed = 'copy'; }}
                    onClick={() => onArm(armed === x.id ? null : x.id)}>
                    <PartPic item={x} />
                    <span className="nm">{x.label}</span>
                    <small className="mono">{x.size}{x.size.startsWith('Ø') ? ' mm' : ''}</small>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
        {!shown.length && <p className="hint">Nothing called “{q}”. A Keep-out box stands in for anything tall; size it in the inspector.</p>}
      </div>
      <p className="tbx-foot">Click one, then where it goes (Shift keeps placing), or drag it onto the board. Plugs snap to the nearest edge.</p>
    </aside>
  );
}
