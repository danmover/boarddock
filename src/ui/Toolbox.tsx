// The board editor's toolbox: every plug, header, hole and tall part as a picture of it on a scrap of board. Click
// one to pick it up (it follows the pointer over the board, snapping to an edge if it goes on one), then click where
// it goes; or drag it onto the board. Search, or narrow to one kind.
import { useEffect, useMemo, useState } from 'react';
import { PALETTE, PALETTE_GROUPS, demoBoard, type PaletteItem } from '../model/palette';
import { boardPicture } from '../worker/client';
import { picture } from './snapshot';
import { bbox, compRect } from '../geom/poly';

/** Version of the toolbox pictures in public/tiles/pal (scripts/render-tiles.mjs makes them). */
const PAL_V = 2;
const failed = new Set<string>();
export const PART_DRAG = 'application/x-boarddock-part';

/** A part's picture: rendered ahead of time, else rendered here once (and kept), a top-view sketch meanwhile. */
export function PartPic({ item }: { item: PaletteItem }) {
  const [live, setLive] = useState(() => failed.has(item.id));
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!live) return;
    let on = true;
    picture(`pal:${item.id}:v${PAL_V}`, () => boardPicture(demoBoard(item)), 168, 120, [0.42, -1, 0.9]).then((u) => on && setUrl(u)).catch(() => {});
    return () => { on = false; };
  }, [live, item.id]);
  if (!live) return <img className="pic" src={new URL(`tiles/pal/${item.id}.webp?v=${PAL_V}`, document.baseURI).href} alt="" draggable={false} decoding="async" loading="lazy" onError={() => { failed.add(item.id); setLive(true); }} />;
  if (url) return <img className="pic" src={url} alt="" draggable={false} />;
  return <PartSketch item={item} />;
}

/** Top view of the demo board, while its picture renders. */
function PartSketch({ item }: { item: PaletteItem }) {
  const b = useMemo(() => demoBoard(item), [item.id]);
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
