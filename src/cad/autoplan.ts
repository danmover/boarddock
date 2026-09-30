// The layout planner behind Auto-arrange, without geometry: where every plug ends up for each way a dock can sit, a
// cheap cost of a whole layout (cable lengths, crossings, rail used, and what the options ask for), and a seeded search
// over the order of docks, their turns and which are paired. Kernel-free, like dockplan.ts, so the UI can use it.
// Rack frame: u along the rails, v across them, so a plug's place is the same whichever way the rails run.
import type { Board, EdgeName, Module, Project, RailMount, Turn } from '../model/types';
import { bbox, extentAlong, rad } from '../geom/poly';
import { dir, pt, rotZ } from '../geom/mat';
import { columnSeat, dockFrame, dockSite, earSite, slotFrame, slotMatrix } from './dockplan';
import { computeLevels } from './levels';
import { baseOf, columnOf, ridersOf, stackLayers } from '../model/holes';
import { baseRef } from '../model/links';

/** A plug as the planner sees it: where its cable leaves it, mount centred at 0, and which way it points (0, 0: out of the front). */
export interface PlugPt { u: number; v: number; du: number; dv: number }

/** One way a dock (or a flat box) can sit: every plug of every board on it, and the space it takes. */
export interface SeatGeo {
  plugs: Map<string, PlugPt>; // "module/ref" (the base ref: a dual socket's second port is the same place)
  ext: [number, number, number, number]; // u0, u1, v0, v1 of the holders, the shoe and the plugs' tips
}

const SHOE = { u: 12, v: 22 }; // the shoe and its lever, about the mount's centre (rail frame)

const dirOf = (a: number): [number, number] => [Math.cos(rad(a)), Math.sin(rad(a))];

/**
 * Add a board's plugs and outline, seen through the matrix M (holder frame -> rail frame), offset by (dx, dy) in its
 * frame; `zb`: the height of the board's underside over the holder's bed (the plugs' axes stand that high, and standing
 * in a dock that height is across the rail or along it).
 */
function addBoard(g: SeatGeo, m: Module, b: Board, M: number[], dx: number, dy: number, zb: number, grow: number) {
  const zt = zb + b.thickness;
  const P = (x: number, y: number, z: number) => pt(M, [x + dx, y + dy, z]);
  const cover = (q: number[]) => { g.ext[0] = Math.min(g.ext[0], q[0]); g.ext[1] = Math.max(g.ext[1], q[0]); g.ext[2] = Math.min(g.ext[2], q[1]); g.ext[3] = Math.max(g.ext[3], q[1]); };
  const bb = bbox(b.outline);
  for (const [x, y] of [[bb.x0 - grow, bb.y0 - grow], [bb.x1 + grow, bb.y0 - grow], [bb.x1 + grow, bb.y1 + grow], [bb.x0 - grow, bb.y1 + grow]]) { cover(P(x, y, zb)); cover(P(x, y, zt + 3)); }
  for (const c of b.comps) {
    const cn = c.conn;
    if (!cn || c.hidden) continue;
    let q: number[], d: number[];
    if (cn.entry === 'edge') {
      const a = dirOf(cn.angle), mouth = extentAlong(c, cn.angle) + cn.plug.len + 0.6;
      q = P(c.x + a[0] * mouth, c.y + a[1] * mouth, c.side === 'top' ? zt + cn.zc : zb - cn.zc);
      d = dir(M, [a[0], a[1], 0]);
    } else {
      q = P(c.x, c.y, (c.side === 'top' ? zt + c.h : zb - c.h) + cn.plug.len + 0.6);
      d = dir(M, [0, 0, c.side === 'top' ? 1 : -1]);
    }
    cover(q);
    g.plugs.set(`${m.id}/${baseRef(c.ref)}`, { u: q[0], v: q[1], du: d[0], dv: d[1] });
  }
}

/**
 * Where everything of a board sits in a dock slot, standing (`lie` unset) or lying flat: the holder, the boards stacked
 * on it (their plugs too) and its column, each on its long edge.
 */
export function seatGeo(p: Project, m: Module, slot: number, edge: EdgeName, turn: Turn, lie: 'flat' | undefined, railDir: 'h' | 'v'): SeatGeo {
  const g: SeatGeo = { plugs: new Map(), ext: [-SHOE.u, SHOE.u, -SHOE.v, SHOE.v] };
  const H = m.holder, gw = H.gap + H.wall;
  const site = lie === 'flat' ? earSite(m.board, H, edge) : dockSite(m.board, H, edge);
  const M = slotMatrix(turn, slot, slotFrame(edge, site.tc, site.L0, lie));
  const lv = computeLevels(m.board, H, lie === 'flat' ? 0 : (site as { minZb?: number }).minZb ?? 0);
  addBoard(g, m, m.board, M, 0, 0, lv.zb, gw);
  // boards stacked on it ride on its holder, offset in its frame, each higher than the one below
  const off = new Map<string, [number, number, number]>();
  let top = lv.zt;
  for (const L of stackLayers(p, m)) {
    for (const bo of L.bolted) { off.set(bo.mod.id, [L.dx + bo.dx, L.dy + bo.dy, top + bo.dz]); top += bo.dz + bo.mod.board.thickness; }
    if (L.mod !== m) { off.set(L.mod.id, [L.dx, L.dy, top + 8]); top += 8 + L.mod.board.thickness; }
  }
  if (!lie) {
    const col = new Set(columnOf(p, m).map((x) => x.id));
    for (const r of ridersOf(p, m)) if (!col.has(r.id)) { const [dx, dy, z] = off.get(r.id) ?? [0, 0, top]; addBoard(g, r, r.board, M, dx, dy, z, r.holder.gap + r.holder.wall); }
    // a column's holders stand on the landing of the one below, sharing its socket: same place across and along the rail
    const members = columnOf(p, m);
    members.forEach((x, k) => {
      const e = columnSeat(x, railDir, slot, k < members.length - 1, [turn]).edge, s = dockSite(x.board, x.holder, e);
      addBoard(g, x, x.board, slotMatrix(turn, slot, dockFrame(e, s.tc, s.L0)), 0, 0, computeLevels(x.board, x.holder, s.minZb).zb, x.holder.gap + x.holder.wall);
    });
  }
  return g;
}

/** A box lying flat on its DIN clip, its board frame turned `turn` degrees: plugs and space, the clip at the box's middle. */
export function flatGeo(m: Module, turn: number, sign = 1): SeatGeo {
  const g: SeatGeo = { plugs: new Map(), ext: [Infinity, -Infinity, Infinity, -Infinity] };
  const bb = bbox(m.board.outline), cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2, R = rotZ(sign * turn);
  const centred = (x: number, y: number) => pt(R, [x - cx, y - cy, 0]);
  const cover = (q: number[]) => { g.ext[0] = Math.min(g.ext[0], q[0]); g.ext[1] = Math.max(g.ext[1], q[0]); g.ext[2] = Math.min(g.ext[2], q[1]); g.ext[3] = Math.max(g.ext[3], q[1]); };
  for (const [x, y] of [[bb.x0, bb.y0], [bb.x1, bb.y0], [bb.x1, bb.y1], [bb.x0, bb.y1]]) cover(centred(x, y));
  for (const c of m.board.comps) {
    const cn = c.conn;
    if (!cn || c.hidden) continue;
    let q: number[], d: number[];
    if (cn.entry === 'edge') {
      const a = dirOf(cn.angle), mouth = extentAlong(c, cn.angle) + cn.plug.len + 0.6;
      q = centred(c.x + a[0] * mouth, c.y + a[1] * mouth);
      d = dir(R, [a[0], a[1], 0]);
    } else { q = centred(c.x, c.y); d = [0, 0, 1]; }
    cover(q);
    g.plugs.set(`${m.id}/${baseRef(c.ref)}`, { u: q[0], v: q[1], du: d[0], dv: d[1] });
  }
  return g;
}

export { baseOf };
export type { RailMount };
