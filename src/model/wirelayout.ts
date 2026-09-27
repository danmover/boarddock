// Where the Wiring view puts each board's card. Two ways: as the boards stand on the rails (a row per rail), or as
// the power and data flow (chargers and hosts on the left, then hubs, then probes and adapters, then the boards
// they serve), each column ordered so the fewest cables cross. Pure: sizes in, positions out.
import type { Project } from './types';
import { cableFlow } from './links';

export type Size = { w: number; h: number };
export type Pos = Map<string, [number, number]>;

const GAPX = 90, GAPY = 26;

/** Cards in columns by flow, ordered and spaced to keep cables short and uncrossed. */
export function flowLayout(p: Project, size: Map<string, Size>): Pos {
  const ids = p.modules.map((m) => m.id).filter((id) => size.has(id));
  const edges = (p.links ?? []).map((l) => cableFlow(p, l)).map((f) => [f.from.module, f.to.module] as [string, string]).filter(([a, b]) => a !== b && size.has(a) && size.has(b));
  // columns: the longest chain of cables leading into each card (capped, so a loop cannot run away)
  const layer = new Map(ids.map((id) => [id, 0]));
  for (let k = 0; k < ids.length; k++) {
    let moved = false;
    for (const [a, b] of edges) if (layer.get(b)! < Math.min(layer.get(a)! + 1, ids.length)) { layer.set(b, layer.get(a)! + 1); moved = true; }
    if (!moved) break;
  }
  // a card with no cables at all goes in a column of its own at the end
  const linked = new Set(edges.flat());
  const top = Math.max(0, ...[...layer.values()]);
  for (const id of ids) if (!linked.has(id)) layer.set(id, top + 1);
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
  // heights: stacked, then each card pulled towards the middle of its neighbours without overlapping
  const pos: Pos = new Map();
  let x = 20;
  const colX: number[] = [];
  for (const c of columns) { colX.push(x); x += Math.max(...c.map((id) => size.get(id)!.w)) + GAPX; }
  columns.forEach((c, k) => { let y = 20; for (const id of c) { pos.set(id, [colX[k], y]); y += size.get(id)!.h + GAPY; } });
  const mid = (id: string) => pos.get(id)![1] + size.get(id)!.h / 2;
  for (let it = 0; it < 6; it++) {
    columns.forEach((c) => {
      const want = c.map((id) => { const n = nbr.get(id)!.filter((q) => layer.get(q) !== layer.get(id)); return n.length ? n.reduce((s, q) => s + mid(q), 0) / n.length - size.get(id)!.h / 2 : pos.get(id)![1]; });
      let y = 20;
      c.forEach((id, i) => { const yy = Math.max(y, want[i]); pos.set(id, [pos.get(id)![0], yy]); y = yy + size.get(id)!.h + GAPY; });
    });
    const minY = Math.min(...[...pos.values()].map((q) => q[1]));
    for (const [id, q] of pos) pos.set(id, [q[0], q[1] - minY + 20]);
  }
  return pos;
}

/** Cards in rows as the boards stand on the rails (rail by rail, in order along each), then the rest. */
export function rackLayout(p: Project, rows: string[][], size: Map<string, Size>): Pos {
  const placed = new Set(rows.flat());
  const rest = p.modules.map((m) => m.id).filter((id) => size.has(id) && !placed.has(id));
  const boards = rest.filter((id) => p.modules.find((m) => m.id === id)?.board.kind !== 'box'), boxes = rest.filter((id) => !boards.includes(id));
  const all = [...rows.map((r) => r.filter((id) => size.has(id)))];
  for (let i = 0; i < boards.length; i += 4) all.push(boards.slice(i, i + 4));
  if (boxes.length) all.push(boxes);
  const pos: Pos = new Map();
  let y = 20;
  for (const row of all.filter((r) => r.length)) {
    let x = 20, h = 0;
    for (const id of row) { const s = size.get(id)!; pos.set(id, [x, y]); x += s.w + 60; h = Math.max(h, s.h); }
    y += h + 46;
  }
  return pos;
}
