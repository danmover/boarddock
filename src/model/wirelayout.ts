// Where the Wiring view puts each board's card. Two ways: as the boards stand on the rails (a row per rail, wrapped
// so the drawing takes the shape of the room it has on screen), or as the power and data flow (chargers and hosts on
// the left, then hubs, then probes and adapters, then the boards they serve), each column ordered so the fewest
// cables cross. Pure: sizes in, positions out.
import type { Project } from './types';
import { cableFlow } from './links';

export type Size = { w: number; h: number };
export type Pos = Map<string, [number, number]>;
/** The pixels the drawing has on screen: the canvas less the side list, the toolbar and a margin. */
export type Room = { w: number; h: number };

/** A card: its width, its title, a plug's row and a pin's row. */
export const CARD = { W: 236, HEAD: 40, ROW: 24, PROW: 19 };
/** A card's size with this many plugs, and pins shown under its open headers. */
export const cardSize = (plugs: number, pins = 0): Size => ({ w: CARD.W, h: CARD.HEAD + plugs * CARD.ROW + pins * CARD.PROW + (plugs ? 0 : CARD.ROW) + 10 });
/** The room in a 1400 × 900 window with the side list open: what a layout assumes when the canvas can't be measured. */
export const ROOM: Room = { w: 640, h: 674 };
/** How far the view zooms to fit a drawing's bounds [x0, y0, x1, y1] in the room: 20 % to 115 %. */
export const fitZoom = (b: readonly number[], room: Room): number => Math.max(0.2, Math.min(1.15, room.w / (b[2] - b[0] + 40), room.h / (b[3] - b[1] + 40)));
/** The bounds [x0, y0, x1, y1] of the cards laid out. */
export function boundsOf(pos: Pos, size: Map<string, Size>): [number, number, number, number] {
  const ids = [...pos.keys()].filter((id) => size.has(id));
  if (!ids.length) return [0, 0, 600, 400];
  return [Math.min(...ids.map((id) => pos.get(id)![0])), Math.min(...ids.map((id) => pos.get(id)![1])), Math.max(...ids.map((id) => pos.get(id)![0] + size.get(id)!.w)), Math.max(...ids.map((id) => pos.get(id)![1] + size.get(id)!.h))];
}

const GAPX = 90, GAPY = 26;

/**
 * Cards in columns by flow, ordered and spaced to keep cables short and uncrossed. A column too tall for the room goes
 * on in another beside it, when that shows the whole drawing bigger (by more than 3 %).
 */
export function flowLayout(p: Project, size: Map<string, Size>, room: Room = ROOM): Pos {
  if (!(room.w > 0 && room.h > 0)) room = ROOM;
  // (your computer and your router have cards too, though they are not on the rack)
  const ids = [...p.modules.map((m) => m.id).filter((id) => size.has(id)), ...[...size.keys()].filter((id) => !p.modules.some((m) => m.id === id))];
  if (!ids.length) return new Map();
  const edges = (p.links ?? []).map((l) => cableFlow(p, l)).map((f) => [f.from.module, f.to.module] as [string, string]).filter(([a, b]) => a !== b && size.has(a) && size.has(b));
  // columns: the longest chain of cables leading into each card (capped, so a loop cannot run away)
  const layer = new Map(ids.map((id) => [id, 0]));
  for (let k = 0; k < ids.length; k++) {
    let moved = false;
    for (const [a, b] of edges) if (layer.get(b)! < Math.min(layer.get(a)! + 1, ids.length)) { layer.set(b, layer.get(a)! + 1); moved = true; }
    if (!moved) break;
  }
  // a card with no cables at all goes in a column of its own at the end (your computer or router with the hosts)
  const linked = new Set(edges.flat());
  const top = Math.max(0, ...[...layer.values()]);
  for (const id of ids) if (!linked.has(id)) layer.set(id, p.modules.some((m) => m.id === id) ? top + 1 : 0);
  const cols: string[][] = [];
  for (const id of ids) (cols[layer.get(id)!] ??= []).push(id);
  const columns = cols.filter(Boolean);
  // order within columns: the mean position of each card's neighbours, a few sweeps each way
  const nbr = new Map(ids.map((id) => [id, [] as string[]]));
  for (const [a, b] of edges) { nbr.get(a)!.push(b); nbr.get(b)!.push(a); }
  const rank = new Map<string, number>();
  const setRanks = () => columns.forEach((c) => c.forEach((id, i) => rank.set(id, i)));
  setRanks();
  for (let sweep = 0; sweep < 8; sweep++) {
    const order = sweep % 2 ? [...columns].reverse() : columns;
    for (const c of order) {
      const bary = (id: string) => { const n = nbr.get(id)!.filter((x) => layer.get(x) !== layer.get(id)); return n.length ? n.reduce((s, x) => s + rank.get(x)!, 0) / n.length : rank.get(id)!; };
      c.sort((x, y) => bary(x) - bary(y));
      c.forEach((id, i) => rank.set(id, i));
    }
  }
  // (your computer or router without a cable: under the hosts in its column)
  for (const c of columns) c.sort((x, y) => Number(!linked.has(x)) - Number(!linked.has(y)));
  // heights: stacked (past `cap`, on in the next column), then each card pulled towards the middle of its neighbours
  // without overlapping, or reaching lower than the tallest column
  const place = (cap: number): Pos => {
    const subs: string[][] = [];
    for (const c of columns) {
      let cur: string[] = [], h = 0;
      for (const id of c) { const ch = size.get(id)!.h; if (cur.length && h + ch > cap + 0.5) { subs.push(cur); cur = []; h = 0; } cur.push(id); h += ch + GAPY; }
      subs.push(cur);
    }
    const pos: Pos = new Map();
    let x = 20;
    for (const c of subs) { let y = 20; for (const id of c) { pos.set(id, [x, y]); y += size.get(id)!.h + GAPY; } x += Math.max(...c.map((id) => size.get(id)!.w)) + GAPX; }
    const mid = (id: string) => pos.get(id)![1] + size.get(id)!.h / 2;
    const stack = (c: string[]) => c.reduce((s, id) => s + size.get(id)!.h + GAPY, -GAPY);
    const bottom = 20 + Math.max(cap, ...subs.map(stack));
    for (let it = 0; it < 6 && linked.size; it++) {
      subs.forEach((c) => {
        const want = c.map((id) => { const n = nbr.get(id)!.filter((q) => layer.get(q) !== layer.get(id)); return n.length ? n.reduce((s, q) => s + mid(q), 0) / n.length - size.get(id)!.h / 2 : linked.has(id) ? pos.get(id)![1] : 0; });
        let y = 20;
        c.forEach((id, i) => { const yy = Math.max(y, Math.min(want[i], bottom - stack(c.slice(i)))); pos.set(id, [pos.get(id)![0], yy]); y = yy + size.get(id)!.h + GAPY; });
      });
      // (up to the top again, by the cards with cables: one without any would hold them all down)
      const minY = Math.min(...[...pos].filter(([id]) => linked.has(id)).map(([, q]) => q[1]));
      for (const [id, q] of pos) pos.set(id, [q[0], q[1] - minY + 20]);
    }
    // a column of cards without cables, stacked from the top
    for (const c of subs) if (!c.some((id) => linked.has(id))) c.reduce((y, id) => { pos.set(id, [pos.get(id)![0], y]); return y + size.get(id)!.h + GAPY; }, 20);
    return pos;
  };
  // every height a column may take before it goes on in the next: all of the tallest, a half of it, a third...
  const tall = Math.max(...columns.map((c) => c.reduce((s, id) => s + size.get(id)!.h + GAPY, -GAPY)));
  const card = Math.max(...ids.map((id) => size.get(id)!.h));
  const tries: { pos: Pos; k: number }[] = [];
  for (let n = 1; n === 1 || tall / n >= card; n++) { const pos = place(tall / n); tries.push({ pos, k: fitZoom(boundsOf(pos, size), room) }); }
  const best = Math.max(...tries.map((t) => t.k));
  return tries.find((t) => t.k >= best * 0.97)!.pos;
}

/** The rows of cards as the boards stand on the rails: rail by rail, along each, stacked boards after their base. */
export function railRows(p: Project, panel: { rails: { id: string }[]; mounts: { rail: string; at: number | null; slots: { module: string | null }[] }[] } | undefined): string[][] {
  const rows: string[][] = [];
  const placed = new Set<string>();
  if (panel) for (const r of panel.rails) {
    const ids = panel.mounts.filter((m) => m.rail === r.id).sort((a, b) => (a.at ?? 0) - (b.at ?? 0)).flatMap((m) => m.slots.map((s) => s.module)).filter(Boolean) as string[];
    const row: string[] = [];
    // each board, then whatever is stacked on it (and on that)
    const put = (id: string) => { if (placed.has(id)) return; row.push(id); placed.add(id); for (const r2 of p.modules.filter((x) => x.on === id)) put(r2.id); };
    for (const id of ids) put(id);
    if (row.length) rows.push(row);
  }
  return rows;
}

const GX = 60, GY = 46, GROUP = 40; // between cards in a line, between lines, and more between rails

/**
 * Cards as the boards stand on the rails: rail by rail, in order along each; what lives off the rails (a plug pack,
 * your computer, your router) beside the rail it is cabled to; then boards not on a rail yet, and the rest. A long
 * rail wraps onto more lines, and short rails share a line, whichever shows the whole drawing biggest in the room;
 * of those within 3 % of it, each rail on its own line(s) and the fewest wraps.
 */
export function rackLayout(p: Project, rows: string[][], size: Map<string, Size>, room: Room = ROOM): Pos {
  if (!(room.w > 0 && room.h > 0)) room = ROOM;
  const rails = rows.map((r) => r.filter((id) => size.has(id))).filter((r) => r.length);
  const railOf = new Map(rails.flatMap((r, i) => r.map((id) => [id, i] as [string, number])));
  const rest = [...size.keys()].filter((id) => !railOf.has(id));
  const mod = new Map(p.modules.map((m) => [m.id, m]));
  const boards = rest.filter((id) => mod.has(id) && mod.get(id)!.board.kind !== 'box');
  // off the rails: beside the rail most of what it is cabled to stands on
  const near = (id: string) => {
    const n = (p.links ?? []).flatMap((l) => (l.a.module === id ? [l.b.module] : l.b.module === id ? [l.a.module] : [])).filter((x) => railOf.has(x)).map((x) => railOf.get(x)!);
    return n.length ? [...new Set(n)].sort((a, b) => n.filter((x) => x === b).length - n.filter((x) => x === a).length || a - b)[0] : -1;
  };
  const beside = rails.map(() => [] as string[]), left: string[] = [];
  for (const id of rest.filter((x) => !boards.includes(x))) { const r = near(id); (r < 0 ? left : beside[r]).push(id); }
  // (`rail`: a rail's cards, or the boards not on one yet, start a line of their own)
  const groups: { ids: string[]; rail: boolean }[] = [];
  rails.forEach((r, i) => { groups.push({ ids: r, rail: true }); if (beside[i].length) groups.push({ ids: beside[i], rail: false }); });
  if (boards.length) groups.push({ ids: boards, rail: true });
  if (left.length) groups.push({ ids: left, rail: false });
  if (!groups.length) return new Map();
  const n = groups.reduce((s, g) => s + g.ids.length, 0);
  const tries: { pos: Pos; k: number }[] = [];
  for (const share of [false, true]) for (let c = n; c >= 1; c--) {
    const pos = shelves(groups, c, share, size);
    tries.push({ pos, k: fitZoom(boundsOf(pos, size), room) });
  }
  const top = Math.max(...tries.map((t) => t.k));
  return tries.find((t) => t.k >= top * 0.97)!.pos;
}

/**
 * Groups of cards, each wrapped onto lines of at most `c` cards (evenly), one group under another; what is off the
 * rails goes beside the group before it while that fits in `c`, and with `share`, so do rails.
 */
function shelves(groups: { ids: string[]; rail: boolean }[], c: number, share: boolean, size: Map<string, Size>): Pos {
  const pos: Pos = new Map();
  let x = 20, y = 20, used = 0, tall = 0;
  for (const { ids, rail } of groups) {
    const lines = Math.ceil(ids.length / c), per = Math.ceil(ids.length / lines);
    // (what is off the rails, alone on a line under its rail, closes that line: a rail sharing it would look like its neighbour)
    const alone = !rail && (!used || used + per > c);
    if (used && ((rail && !share) || used + per > c)) { y += tall + GY + GROUP; x = 20; used = 0; tall = 0; }
    let ly = y, wide = 0;
    for (let i = 0; i < ids.length; i += per) {
      let lx = x, h = 0;
      for (const id of ids.slice(i, i + per)) { const s = size.get(id)!; pos.set(id, [lx, ly]); lx += s.w + GX; h = Math.max(h, s.h); }
      wide = Math.max(wide, lx - GX - x);
      ly += h + GY;
    }
    tall = Math.max(tall, ly - GY - y);
    x += wide + GX + GROUP;
    used = alone ? Math.max(used + per, c) : used + per;
  }
  return pos;
}

export type Rect = { x: number; y: number; w: number; h: number };
const hit = (a: Rect, b: Rect, gap = 0) => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;

/** Where a card of size `s` dropped at `at` goes: there if it lies on no other card, else the nearest spot `gap` clear of them all. */
export function freeSpot(at: [number, number], s: Size, others: Rect[], gap = 24): [number, number] {
  const free = (x: number, y: number, g: number) => !others.some((o) => hit({ x, y, ...s }, o, g));
  if (free(at[0], at[1], 0)) return at;
  // (the nearest free spot is square with the drop point, or lines up with the edges of the cards it clears)
  const xs = [at[0], ...others.flatMap((o) => [o.x + o.w + gap, o.x - gap - s.w])];
  const ys = [at[1], ...others.flatMap((o) => [o.y + o.h + gap, o.y - gap - s.h])];
  let best = at, d = Infinity;
  for (const x of xs) for (const y of ys) { const e = Math.hypot(x - at[0], y - at[1]); if (e < d && free(x, y, gap - 0.01)) { best = [x, y]; d = e; } }
  return best;
}

export type Pt = { x: number; y: number };
/** A point along a cubic Bézier curve from p0 to p3. */
export const bezier = ([p0, p1, p2, p3]: Pt[], t: number): Pt => {
  const u = 1 - t;
  return { x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x, y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y };
};

/**
 * Where each cable's badge (its number and length, w × h) goes: on the cable, as near its middle as it lies clear of
 * every card and of the badges placed before it; else just above or below the cable; else over only the edges of the
 * cards (where their plugs' dots are: between two cards side by side); else at its middle, below any badge already
 * there. `curves`: each cable's Bézier control points.
 */
export function badgeSpots(curves: Pt[][], cards: Rect[], w = 80, h = 22): { at: Pt; on: Pt }[] {
  const out: { at: Pt; on: Pt }[] = [];
  const clear = (q: Pt, edge: number) => {
    const r = { x: q.x - w / 2, y: q.y - h / 2, w, h };
    return !cards.some((c) => hit(r, { ...c, x: c.x + edge, w: c.w - 2 * edge }, 4)) && !out.some((o) => hit(r, { x: o.at.x - w / 2, y: o.at.y - h / 2, w, h }, 2));
  };
  for (const c of curves) {
    const along = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82].map((t) => bezier(c, t));
    let spot: { at: Pt; on: Pt } | undefined;
    for (const edge of [0, 14]) for (const dy of [0, -26, 26, -52, 52]) {
      const on = spot ? undefined : along.find((q) => clear({ x: q.x, y: q.y + dy }, edge));
      if (on) spot = { at: { x: on.x, y: on.y + dy }, on };
    }
    if (!spot) {
      const on = along[0], q = { ...on };
      for (let k = 0; k < 12 && out.some((o) => Math.abs(o.at.x - q.x) < w && Math.abs(o.at.y - q.y) < h + 2); k++) q.y += h + 2;
      spot = { at: q, on };
    }
    out.push(spot);
  }
  return out;
}
