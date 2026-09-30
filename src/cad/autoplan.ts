// The layout planner behind Auto-arrange, without geometry: where every plug ends up for each way a dock can sit, one
// cheap score for a whole layout (cable lengths and crossings, the rail and floor it takes, and whatever the options
// ask for), and a seeded search over the order of docks, their turns and where the rows break. Kernel-free, like
// dockplan.ts, so the UI can use it. Rack frame: u along the rails, v across them, so a plug's place is the same
// whichever way the rails run. Every option of Auto-arrange is a weight or a constraint here, never a separate path.
import type { ArrangeOpts, Board, Comp, EdgeName, Link, Module, Project, RailMount, Slot, Turn } from '../model/types';
import { bbox, extentAlong, rad } from '../geom/poly';
import { dir, pt, rotZ } from '../geom/mat';
import { bestDock, columnSeat, dockFrame, dockSite, earSite, EDGES, slotFrame, slotMatrix, TURNS, withRiders } from './dockplan';
import { computeLevels } from './levels';
import { baseOf, columnOf, isSmall, ridersOf, stackLayers } from '../model/holes';
import { baseRef, cableToBuy, isAccessory, isDebugPort } from '../model/links';
import { isCharger, isHub, isPlugPack } from '../model/powerdata';
import { isProbe, ribbonOf } from '../model/probes';

// ---------------------------------------------------------------- geometry

/** A plug as the planner sees it: where its cable leaves it, mount centred at 0, and which way it points (0, 0: out of the front). */
export interface PlugPt { u: number; v: number; du: number; dv: number; z?: number }
/** Something you touch (an SD slot, a button, a USB port used for flashing) and the way it faces (`wall`: into the wall). */
export interface Touch extends PlugPt { wall: boolean }

/** One way a dock (or a flat box) can sit: every plug of every board on it, and the space it takes. */
export interface SeatGeo {
  plugs: Map<string, PlugPt>; // "module/ref" (the base ref: a dual socket's second port is the same place)
  touch: Touch[];
  ext: [number, number, number, number]; // u0, u1, v0, v1 of the holders, the shoe and the plugs' tips
}

const SHOE = { u: 12, v: 22 }; // the shoe and its lever, about the mount's centre (rail frame)
const FLAT_PAD = 12, FLAT_PAD_V = 6; // the strap loops, guards and cable bends of a box stand a little out of it
const dirOf = (a: number): [number, number] => [Math.cos(rad(a)), Math.sin(rad(a))];

type Wanted = (m: Module, c: Comp) => boolean;

/**
 * Add a board's plugs and outline, seen through the matrix M (holder frame -> rail frame), offset by (dx, dy) in its
 * frame; `zb`: the height of the board's underside over the holder's bed (the plugs' axes stand that high, and standing
 * in a dock that height is across the rail or along it).
 */
function addBoard(g: SeatGeo, m: Module, b: Board, M: number[], dx: number, dy: number, zb: number, grow: number, wanted?: Wanted) {
  const zt = zb + b.thickness;
  const P = (x: number, y: number, z: number) => pt(M, [x + dx, y + dy, z]);
  const cover = (q: number[]) => { g.ext[0] = Math.min(g.ext[0], q[0]); g.ext[1] = Math.max(g.ext[1], q[0]); g.ext[2] = Math.min(g.ext[2], q[1]); g.ext[3] = Math.max(g.ext[3], q[1]); };
  const bb = bbox(b.outline);
  for (const [x, y] of [[bb.x0 - grow, bb.y0 - grow], [bb.x1 + grow, bb.y0 - grow], [bb.x1 + grow, bb.y1 + grow], [bb.x0 - grow, bb.y1 + grow]]) { cover(P(x, y, zb)); cover(P(x, y, zt + 3)); }
  for (const c of b.comps) {
    if (c.hidden) continue;
    const cn = c.conn;
    if (!cn) {
      // a button faces out of the component side
      if (c.kind === 'switch' && wanted?.(m, c)) {
        const q = P(c.x, c.y, c.side === 'top' ? zt + c.h : zb - c.h), d = dir(M, [0, 0, c.side === 'top' ? 1 : -1]);
        g.touch.push({ u: q[0], v: q[1], du: d[0], dv: d[1], wall: d[2] < -0.7 });
      }
      continue;
    }
    let q: number[], d: number[];
    if (cn.entry === 'edge') {
      const a = dirOf(cn.angle), mouth = extentAlong(c, cn.angle) + cn.plug.len + 0.6;
      q = P(c.x + a[0] * mouth, c.y + a[1] * mouth, c.side === 'top' ? zt + cn.zc : zb - cn.zc);
      d = dir(M, [a[0], a[1], 0]);
    } else {
      q = P(c.x, c.y, (c.side === 'top' ? zt + c.h : zb - c.h) + cn.plug.len + 0.6);
      d = dir(M, [0, 0, c.side === 'top' ? 1 : -1]);
    }
    // (a plug in a port on the top face has a body drawn only on a box's ports and a debug header: the rest just end their cable there)
    if (cn.entry === 'edge' || b.kind === 'box' || isDebugPort(c)) cover(q);
    g.plugs.set(`${m.id}/${baseRef(c.ref)}`, { u: q[0], v: q[1], du: d[0], dv: d[1], z: q[2] });
    if (wanted?.(m, c)) g.touch.push({ u: q[0], v: q[1], du: d[0], dv: d[1], wall: d[2] < -0.7 });
  }
}

/**
 * Where everything of a board sits in a dock slot, standing (`lie` unset) or lying flat: the holder, the boards stacked
 * on it (their plugs too) and its column, each on its long edge.
 */
export function seatGeo(p: Project, m: Module, slot: number, edge: EdgeName, turn: Turn, lie: 'flat' | undefined, railDir: 'h' | 'v', wanted?: Wanted, shoe = true): SeatGeo {
  // (`shoe`: the space includes the dock's own shoe and lever; without, only what the board itself takes)
  const g: SeatGeo = { plugs: new Map(), touch: [], ext: shoe ? [-SHOE.u, SHOE.u, -SHOE.v, SHOE.v] : [Infinity, -Infinity, Infinity, -Infinity] };
  const H = m.holder, gw = H.gap + H.wall;
  const site = lie === 'flat' ? earSite(m.board, H, edge) : dockSite(m.board, H, edge);
  const M = slotMatrix(turn, slot, slotFrame(edge, site.tc, site.L0, lie));
  const lv = computeLevels(m.board, H, lie === 'flat' ? 0 : (site as { minZb?: number }).minZb ?? 0);
  addBoard(g, m, m.board, M, 0, 0, lv.zb, gw, wanted);
  // boards stacked on it ride on its holder, offset in its frame, each higher than the one below
  const off = new Map<string, [number, number, number]>();
  let top = lv.zt;
  for (const L of stackLayers(p, m)) {
    for (const bo of L.bolted) { off.set(bo.mod.id, [L.dx + bo.dx, L.dy + bo.dy, top + bo.dz]); top += bo.dz + bo.mod.board.thickness; }
    if (L.mod !== m) { off.set(L.mod.id, [L.dx, L.dy, top + 8]); top += 8 + L.mod.board.thickness; }
  }
  if (!lie) {
    const col = new Set(columnOf(p, m).map((x) => x.id));
    for (const r of ridersOf(p, m)) if (!col.has(r.id)) { const [dx, dy, z] = off.get(r.id) ?? [0, 0, top]; addBoard(g, r, r.board, M, dx, dy, z, r.holder.gap + r.holder.wall, wanted); }
    // a column's holders stand on the landing of the one below, sharing its socket: same place across and along the rail
    const members = columnOf(p, m);
    members.forEach((x, k) => {
      const e = columnSeat(x, railDir, slot, k < members.length - 1, [turn]).edge, s = dockSite(x.board, x.holder, e);
      addBoard(g, x, x.board, slotMatrix(turn, slot, dockFrame(e, s.tc, s.L0)), 0, 0, computeLevels(x.board, x.holder, s.minZb).zb, x.holder.gap + x.holder.wall, wanted);
    });
  }
  return g;
}

/** A box lying flat on its DIN clip, its board frame turned `turn` degrees: plugs and space, centred on the mount. */
export function flatGeo(m: Module, turn: number, wanted?: Wanted): SeatGeo {
  const g: SeatGeo = { plugs: new Map(), touch: [], ext: [Infinity, -Infinity, Infinity, -Infinity] };
  const bb = bbox(m.board.outline), cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2, R = rotZ(turn);
  const centred = (x: number, y: number) => pt(R, [x - cx, y - cy, 0]);
  const cover = (q: number[]) => { g.ext[0] = Math.min(g.ext[0], q[0]); g.ext[1] = Math.max(g.ext[1], q[0]); g.ext[2] = Math.min(g.ext[2], q[1]); g.ext[3] = Math.max(g.ext[3], q[1]); };
  for (const [x, y] of [[bb.x0 - FLAT_PAD, bb.y0 - FLAT_PAD], [bb.x1 + FLAT_PAD, bb.y0 - FLAT_PAD], [bb.x1 + FLAT_PAD, bb.y1 + FLAT_PAD], [bb.x0 - FLAT_PAD, bb.y1 + FLAT_PAD]]) cover(centred(x, y));
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
    g.plugs.set(`${m.id}/${baseRef(c.ref)}`, { u: q[0], v: q[1], du: d[0], dv: d[1], z: m.board.thickness + 6 + (cn.entry === 'top' ? cn.plug.len + 0.6 : 0) });
    if (wanted?.(m, c)) g.touch.push({ u: q[0], v: q[1], du: d[0], dv: d[1], wall: false });
  }
  g.ext[2] -= FLAT_PAD_V; g.ext[3] += FLAT_PAD_V;
  return g;
}

// ---------------------------------------------------------------- weights

/** What the score weighs, in mm of cable to be spared: each option sets some of these (see `weightsFor`). */
export interface Weights {
  cable: number; long: number; cross: number; under: number; rail: number; foot: number; row: number; dock: number;
  access: number; tol: number; // a plug that is harder to reach costs `access` per point, and no dock loses more than `tol` points
  mains: number; side: number; group: number; heat: number; heatRow: number; reach: number; host: number; stock: number;
  spare: number; // free slots to keep on each row
  mainsAt: NonNullable<ArrangeOpts['mains']>;
}

const GOALS: Record<NonNullable<ArrangeOpts['goal']>, Partial<Weights>> = {
  balanced: {},
  compact: { cable: 0.5, long: 0.2, cross: 30, under: 20, rail: 0.5, foot: 0.008, row: 60, dock: 25 },
  cables: { cable: 1.6, long: 1, cross: 120, under: 80, rail: 0.05, foot: 0, row: 5, dock: 3, tol: 3.5, access: 20 },
  reach: { access: 60, tol: 0.8, reach: 40, cable: 0.8, long: 0.3, cross: 50, under: 30 },
};

export function weightsFor(o: ArrangeOpts = {}): Weights {
  const w: Weights = { cable: 1, long: 0.5, cross: 60, under: 40, rail: 0.15, foot: 0.002, row: 30, dock: 8, access: 25, tol: 2, mains: 2, side: 0.3, group: 0, heat: 0, heatRow: 0, reach: 15, host: 1.5, stock: 0, spare: o.spare ?? 0, mainsAt: o.mains ?? 'auto' };
  Object.assign(w, GOALS[o.goal ?? 'balanced']);
  if (o.mains === 'off') w.mains = 0;
  if (o.group) w.group = 250;
  if (o.heat) { w.heat = 5; w.heatRow = 200; }
  if (o.hosts === false) w.host = 1;
  if (o.stock) w.stock = 0.25;
  if (o.fewParts) { w.dock *= 6; w.row *= 3; }
  return w;
}

// ---------------------------------------------------------------- the model of a layout

interface PlaceOpt {
  turn: Turn; slots: Slot[]; loss: number;
  u0: number; u1: number; v0: number; v1: number;
  pts: { e: number; u: number; v: number; du: number; dv: number; z?: number }[]; // the linked plugs
  touch: Touch[];
}
interface Def { kind: 'dock' | 'flat'; mods: string[]; opts: PlaceOpt[]; hot: boolean; mains: boolean; lv: boolean; group: string; probe: boolean; members?: [number, number] } // members: a pair's two boards, as defs of their own
interface State { units: number[][]; brk: boolean[]; sel: number[] }
/** What a layout comes to, by the planner's own measures (for the tests and `lastPlan`). */
export interface Detail { rows: number[]; order: number[]; lens: number[]; reach: number; hot: number; hotRow: number; mains: number; alike: number; docks: number; railLen: number; blocked: number }

export interface PlanStats { cost: number; classic: number; evals: number; ms: number; defs: number; candidates: number; detail: Detail }
export let lastPlan: PlanStats | null = null;

const MARGIN = 8, PAD = 3; // (panelgen's margin at a rail's ends, and a little slack on every width against the real holders' extra bulk)
const KEEP_APART = 45; // (mm between two boards whose cable ran into something)
const LANE = 7; // (a cable and the space it keeps from the next)
const BLOCK = 30, RUNS_INTO = 170; // a cable needs this much room out of its plug; a holder nearer than that in its way costs about a clash

const mulberry = (a: number) => () => {
  a = (a + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const kindOfName = (s: string) => s.replace(/\s*(#\d+|\(\d+\))$/, '').trim();
const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

class Model {
  defs: Def[] = [];
  eps: { link: number; key: string }[] = []; // link ends: e = 2 * link + side
  lw: number[] = []; // per link: how much its length weighs
  lnear: boolean[] = []; // a ribbon or jumper wires: they go straight over the docks, not by a street
  lstock: number[] = []; // per link: the longest it may be before it needs another cable (a ribbon's own length)
  reserve = 0;
  avoid: [string, string][] = []; // boards whose cable ran into something when built: keep them apart
  evals = 0;
  pairsOf = new Map<number, number[]>(); // a def of one board -> the defs of the pairs it can join
  EU: Float64Array; EV: Float64Array; EZ: Float64Array; EDU: Float64Array; EDV: Float64Array; ER: Int16Array; EI: Int16Array; EP: Uint8Array;
  constructor(public W: Weights, public P: Project['panel'], public links: Link[]) {
    const n = links.length * 2;
    this.EU = new Float64Array(n); this.EV = new Float64Array(n); this.EZ = new Float64Array(n); this.EDU = new Float64Array(n); this.EDV = new Float64Array(n); this.ER = new Int16Array(n); this.EI = new Int16Array(n); this.EP = new Uint8Array(n);
  }

  /** The cost of a layout: docks packed into rows the way the generator does, then the plugs where they land. */
  evaluate(s: State, detail?: Detail): number {
    this.evals++;
    const { defs, W, P } = this, cap = P.maxRail - MARGIN - this.reserve;
    const order: number[] = [], first: boolean[] = [], uidx: number[] = [];
    s.units.forEach((u, ui) => u.forEach((d, j) => { order.push(d); first.push(j === 0); uidx.push(ui); }));
    const n = order.length, U = new Float64Array(n), Rw = new Int16Array(n);
    const rowU1: number[] = [], rowV0: number[] = [], rowV1: number[] = [];
    let row = 0, cursor = MARGIN, inRow = 0;
    for (let k = 0; k < n; k++) {
      const o = defs[order[k]].opts[s.sel[order[k]]], w = o.u1 - o.u0 + PAD;
      if (inRow && ((first[k] && s.brk[uidx[k]]) || cursor + w > cap)) { row++; cursor = MARGIN; inRow = 0; }
      U[k] = cursor - o.u0; cursor = U[k] + o.u1 + PAD + P.gap; Rw[k] = row; inRow++;
      rowU1[row] = Math.max(rowU1[row] ?? -Infinity, U[k] + o.u1); rowV0[row] = Math.min(rowV0[row] ?? Infinity, o.v0); rowV1[row] = Math.max(rowV1[row] ?? -Infinity, o.v1);
    }
    const rows = row + 1, V = new Float64Array(rows);
    for (let r = 1; r < rows; r++) V[r] = V[r - 1] + rowV0[r - 1] - P.rowGap - rowV1[r];
    let railLen = 0, width = 0;
    for (let r = 0; r < rows; r++) { const L = rowU1[r] + MARGIN; railLen += L; width = Math.max(width, L); }
    let cost = W.rail * railLen + W.foot * width * (V[0] + rowV1[0] - (V[rows - 1] + rowV0[rows - 1])) + W.row * rows + W.dock * n;
    this.EP.fill(0);
    for (let k = 0; k < n; k++) {
      const o = defs[order[k]].opts[s.sel[order[k]]];
      cost += W.access * o.loss;
      for (const q of o.pts) { const e = q.e; this.EU[e] = U[k] + q.u; this.EV[e] = V[Rw[k]] + q.v; this.EZ[e] = q.z ?? 40; this.EDU[e] = q.du; this.EDV[e] = q.dv; this.ER[e] = Rw[k]; this.EI[e] = k; this.EP[e] = 1; }
    }
    // streets, as the router has them: between the rails' middles, and 45 mm beyond the outer two
    const streets: number[] = [V[rows - 1] - 45];
    for (let r = rows - 1; r > 0; r--) streets.push((V[r] + V[r - 1]) / 2);
    streets.push(V[0] + 45);
    const nl = this.links.length, load = new Int16Array(streets.length), zc = P.stands !== false ? -5 : 11; // (the streets run under the rails on table stands, else just over their lips)
    let sum = 0, longest = 0;
    for (let l = 0; l < nl; l++) {
      const a = 2 * l, b = a + 1;
      if (!this.EP[a] || !this.EP[b]) continue;
      const du = Math.abs(this.EU[a] - this.EU[b]), va = this.EV[a], vb = this.EV[b];
      let len: number, under = 0;
      // (a ribbon or jumper wires go over the docks, round the body of the dock they leave: about 85 per cent of the way there by the three axes and a hand's width more, and much more once another dock is between; measured on real builds)
      if (this.lnear[l]) { const m = du + Math.abs(va - vb) + Math.abs(this.EZ[a] - this.EZ[b]); len = 105 + 0.85 * Math.min(m, 100) + 1.5 * Math.max(0, m - 100); }
      else {
        let best = Infinity, bs = 0, bi = 0;
        streets.forEach((st, i) => { const c = Math.abs(va - st) + Math.abs(vb - st); if (c < best) { best = c; bs = st; bi = i; } });
        // (down from each plug to the street under the rails, and up again)
        len = du + best + (this.EZ[a] - zc) + (this.EZ[b] - zc);
        // (every cable goes by a street, a cable between two plugs on one rail too: measured on real builds, 26 mm out on average, none out by a bias)
        {
          load[bi]++;
          for (let r = 0; r < rows; r++) {
            if (r === this.ER[a] || r === this.ER[b]) continue;
            const y = V[r];
            if ((y > Math.min(va, bs) + 5 && y < Math.max(va, bs) - 5) || (y > Math.min(vb, bs) + 5 && y < Math.max(vb, bs) - 5)) under++;
          }
        }
      }
      // a plug pointing away from where its cable goes has to loop back
      for (const [x, y] of this.lnear[l] ? [] : [[a, b], [b, a]]) {
        const dx = this.EDU[x], dy = this.EDV[x], dl = Math.hypot(dx, dy);
        if (dl < 0.5) continue;
        const tx = this.EU[y] - this.EU[x], ty = this.EV[y] - this.EV[x], dot = (dx * tx + dy * ty) / (dl * (Math.hypot(tx, ty) || 1));
        if (dot < -0.3) len += -dot * 28;
      }
      sum += this.lw[l] * len; longest = Math.max(longest, len);
      if (detail) detail.lens[l] = len;
      cost += W.under * under;
      // (a ribbon or jumper wires that reach no further than they come: their length is not ours to choose, so leave a margin for what the estimate misses)
      if (this.lnear[l]) { if (len > 0.9 * this.lstock[l]) cost += 500 + 5 * (len - 0.9 * this.lstock[l]); }
      else if (len > this.lstock[l]) cost += 150 + (len - this.lstock[l]);
      if (W.stock) cost += W.stock * cableToBuy(len * 1.05) * 1000;
    }
    cost += W.cable * sum + W.long * longest;
    // between two rails a street is as wide as the row gap: only so many cables lie side by side in it
    const lanes = Math.max(1, Math.floor((P.rowGap - 1) / LANE));
    for (let i = 1; i < streets.length - 1; i++) if (load[i] > lanes) { cost += RUNS_INTO * (load[i] - lanes); if (detail) detail.blocked += load[i] - lanes; }
    // a cable leaves its plug the way the plug points: a neighbour's holder close in that way is where it runs into
    const RX0 = new Float64Array(n), RX1 = new Float64Array(n), RY0 = new Float64Array(n), RY1 = new Float64Array(n);
    for (let k = 0; k < n; k++) { const o = defs[order[k]].opts[s.sel[order[k]]]; RX0[k] = U[k] + o.u0; RX1[k] = U[k] + o.u1; RY0[k] = V[Rw[k]] + o.v0; RY1[k] = V[Rw[k]] + o.v1; }
    for (let e = 0; e < 2 * nl; e++) {
      if (!this.EP[e] || this.lnear[e >> 1]) continue;
      const dx = this.EDU[e], dy = this.EDV[e], dl = Math.hypot(dx, dy);
      if (dl < 0.5) continue;
      const ux = dx / dl, uy = dy / dl, ox = this.EU[e], oy = this.EV[e];
      for (let k = 0; k < n; k++) {
        if (k === this.EI[e]) continue;
        let t0 = 0, t1 = BLOCK;
        if (Math.abs(ux) < 1e-9) { if (ox < RX0[k] || ox > RX1[k]) continue; } else { const a = (RX0[k] - ox) / ux, b = (RX1[k] - ox) / ux; t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b)); }
        if (Math.abs(uy) < 1e-9) { if (oy < RY0[k] || oy > RY1[k]) continue; } else { const a = (RY0[k] - oy) / uy, b = (RY1[k] - oy) / uy; t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b)); }
        if (t0 <= t1) { cost += RUNS_INTO * (1 - t0 / BLOCK); if (detail) detail.blocked++; }
      }
    }
    // crossings of straight plug-to-plug lines
    let cross = 0;
    for (let l = 0; l < nl; l++) {
      const a = 2 * l, b = a + 1;
      if (!this.EP[a] || !this.EP[b]) continue;
      for (let m = l + 1; m < nl; m++) {
        const c = 2 * m, d = c + 1;
        if (!this.EP[c] || !this.EP[d]) continue;
        const ka = this.eps[a].key, kb = this.eps[b].key, kc = this.eps[c].key, kd = this.eps[d].key;
        if (ka === kc || ka === kd || kb === kc || kb === kd) continue;
        const { EU, EV } = this;
        if (orient(EU[a], EV[a], EU[b], EV[b], EU[c], EV[c]) * orient(EU[a], EV[a], EU[b], EV[b], EU[d], EV[d]) >= 0) continue;
        if (orient(EU[c], EV[c], EU[d], EV[d], EU[a], EV[a]) * orient(EU[c], EV[c], EU[d], EV[d], EU[b], EV[b]) < 0) cross++;
      }
    }
    cost += W.cross * cross;
    cost += this.extras(s, order, U, Rw, V, rows, rowU1, detail);
    if (detail) { detail.rows = Array.from(Rw); detail.order = order; detail.docks = n; detail.railLen = railLen; }
    return cost;
  }

  /** The terms that look at whole boards, not plugs: mains, likes, heat, and what you touch. */
  extras(s: State, order: number[], U: Float64Array, Rw: Int16Array, V: Float64Array, rows: number, rowU1: number[], detail?: Detail): number {
    const { defs, W } = this, n = order.length;
    let cost = 0;
    const o = (k: number) => defs[order[k]].opts[s.sel[order[k]]];
    const x0 = (k: number) => U[k] + o(k).u0, x1 = (k: number) => U[k] + o(k).u1, y0 = (k: number) => V[Rw[k]] + o(k).v0, y1 = (k: number) => V[Rw[k]] + o(k).v1;
    const gapBetween = (i: number, j: number) => Math.hypot(Math.max(0, x0(i) - x1(j), x0(j) - x1(i)), Math.max(0, y0(i) - y1(j), y0(j) - y1(i)));
    if (W.mains || W.mainsAt !== 'off') {
      for (let i = 0; i < n; i++) {
        if (!defs[order[i]].mains) continue;
        for (let j = 0; j < n; j++) if (j !== i && defs[order[j]].lv) { const g = gapBetween(i, j); if (g < 50) { cost += W.mains * (50 - g); if (detail) detail.mains++; } }
        if (W.mainsAt === 'left') cost += W.side * (x0(i) - MARGIN);
        else if (W.mainsAt === 'right') cost += W.side * (rowU1[Rw[i]] - x1(i));
        else if (W.mainsAt === 'bottom') cost += 150 * (rows - 1 - Rw[i]);
        else if (W.mainsAt === 'auto' && i > 0 && i < n - 1 && Rw[i - 1] === Rw[i] && Rw[i + 1] === Rw[i] && defs[order[i - 1]].lv && defs[order[i + 1]].lv) cost += 60; // between boards, not at an end
      }
    }
    if (this.avoid.length) {
      const at = new Map<string, number>();
      for (let k = 0; k < n; k++) for (const id of defs[order[k]].mods) at.set(id, k);
      for (const [a, b] of this.avoid) {
        const i = at.get(a), j = at.get(b);
        if (i == null || j == null) continue;
        const g = i === j ? 0 : gapBetween(i, j);
        if (g < KEEP_APART) cost += RUNS_INTO * 1.5 * (1 - g / KEEP_APART);
      }
    }
    if (W.heat || detail) {
      for (let i = 0; i < n; i++) {
        if (!defs[order[i]].hot) continue;
        cost += (W.heatRow * 2 * Rw[i]) / Math.max(1, rows - 1);
        if (detail) detail.hotRow += Rw[i];
        for (let j = i + 1; j < n; j++) if (defs[order[j]].hot) { const g = gapBetween(i, j); if (g < 60) { cost += W.heat * (60 - g); if (detail) detail.hot++; } }
      }
    }
    if (W.group || detail) {
      const seen = new Map<string, number[]>();
      for (let k = 0; k < n; k++) { const g = defs[order[k]].group; if (g) (seen.get(g) ?? seen.set(g, []).get(g)!).push(k); }
      const face = (k: number) => o(k).turn + '/' + o(k).slots.map((x) => x.edge).join();
      for (const ks of seen.values()) {
        if (ks.length < 2) continue;
        cost += W.group * (ks[ks.length - 1] - ks[0] + 1 - ks.length); // alike boards not side by side
        for (const k of ks) { if (face(k) !== face(ks[0])) cost += W.group * 0.75; if (Rw[k] !== Rw[ks[0]]) cost += W.group * 0.5; }
        if (detail) detail.alike += ks[ks.length - 1] - ks[0] + 1 - ks.length + ks.filter((k) => face(k) !== face(ks[0])).length;
      }
    }
    if (W.reach || detail) {
      for (let k = 0; k < n; k++) for (const t of o(k).touch) {
        if (t.wall) { cost += W.reach; if (detail) detail.reach++; continue; }
        if (Math.abs(t.du) <= 0.6) continue;
        // facing a neighbour on its own rail, close
        const j = k + (t.du > 0 ? 1 : -1);
        if (j < 0 || j >= n || Rw[j] !== Rw[k]) continue;
        const clear = t.du > 0 ? x0(j) - (U[k] + t.u) : (U[k] + t.u) - x1(j);
        if (clear < 40) { cost += W.reach * (1 - Math.max(0, clear) / 40); if (detail && clear < 25) detail.reach++; }
      }
    }
    return cost;
  }
}

// ---------------------------------------------------------------- building the model from the classic layout

/** What you touch: an SD slot, a button, a USB port that has no cable (flashing). */
const touchOf = (linked: Set<string>): Wanted => (m, c) => {
  if (m.board.kind === 'box') return false;
  const t = c.conn?.type ?? '';
  if (t === 'sd' || t === 'microsd' || c.kind === 'switch') return true;
  return /^usb/.test(t) && !linked.has(`${m.id}/${baseRef(c.ref)}`);
};

export interface Plan { mounts: RailMount[]; cost: number; detail: Detail }

function buildModel(p: Project, classic: RailMount[], W: Weights): { model: Model; start: State } {
  const railDir = p.panel.rowDir;
  const all = p.modules.filter((m) => baseOf(p, m) === m && !isPlugPack(m.board));
  const merged = new Map(all.map((m) => [m.id, withRiders(p, m)]));
  const orig = new Map(all.map((m) => [m.id, m]));
  const modOf = (id: string) => p.modules.find((x) => x.id === id);
  const lks = (p.links ?? []).filter((l) => l.a.module !== l.b.module);
  const model = new Model(W, p.panel, lks);
  const linked = new Set<string>(lks.flatMap((l) => [`${l.a.module}/${baseRef(l.a.ref)}`, `${l.b.module}/${baseRef(l.b.ref)}`]));
  const byKey = new Map<string, number[]>();
  lks.forEach((l, i) => [l.a, l.b].forEach((r, side) => { const key = `${r.module}/${baseRef(r.ref)}`; model.eps[2 * i + side] = { link: i, key }; (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(2 * i + side); }));
  // how much each cable's length matters, and how long it may be
  const kids = new Map<string, number>();
  for (const l of lks) for (const r of [l.a, l.b]) kids.set(r.module, (kids.get(r.module) ?? 0) + 1);
  lks.forEach((l, i) => {
    const dev = [l.a, l.b].map((r) => modOf(r.module)).find((m) => m && (isHub(m.board) || isProbe(m) || /zero/i.test(m.board.name)));
    const hosted = l.kind === 'debug' || l.kind === 'jumper' || l.kind === 'uart' || (l.kind === 'usb' && !!dev);
    model.lw[i] = hosted ? W.host * (1 + Math.min(2, 0.25 * ((dev ? kids.get(dev.id) ?? 1 : 1) - 1))) : 1;
    model.lnear[i] = l.kind === 'debug' || l.kind === 'jumper';
    const probe = [l.a, l.b].map((r) => modOf(r.module)).find((m) => m && isProbe(m));
    model.lstock[i] = l.kind === 'debug' && probe ? ribbonOf(probe.board) : l.kind === 'jumper' ? 300 : 1200;
  });
  const wanted = touchOf(linked);
  const cache = new Map<string, SeatGeo>();
  const seat = (m: Module, slot: number, edge: EdgeName, turn: Turn, lie: 'flat' | undefined) => {
    const k = `${m.id}|${slot}|${edge}|${turn}|${lie ?? ''}`;
    let g = cache.get(k);
    if (!g) cache.set(k, g = seatGeo(p, m, slot, edge, turn, lie, railDir, wanted));
    return g;
  };
  // probes and adapters stand in columns by the boards they serve: their bases
  const colBase = new Set(p.modules.filter((x) => isAccessory(x.board) && isProbe(x)).map((x) => baseOf(p, x).id));
  const tall = (id: string) => columnOf(p, orig.get(id) ?? modOf(id)!).length > 0;
  const alone = (mm: Module) => isAccessory(mm.board) && isSmall(mm.board);
  const isColumn = (id: string) => tall(id) || colBase.has(id) || alone(merged.get(id) ?? modOf(id)!);
  const seatOf = (mm: Module, slot: number, turn: Turn, lie: 'flat' | undefined, edge?: EdgeName) => (isColumn(mm.id) ? columnSeat(mm, railDir, slot, tall(mm.id), [turn]) : bestDock(mm, railDir, slot, [turn], edge ? [edge] : EDGES, lie));

  // ---- a def for every way a mount can be: its boards, and each turn that costs little plug access
  type Spec = { kind: 'dock' | 'flat'; turn: Turn; slots: Slot[] };
  const flagsOf = (def: Def) => {
    for (const id of def.mods) {
      const b = modOf(id)?.board;
      if (!b) continue;
      if (b.kind !== 'box' && b.comps.some((c) => c.kind === 'hot')) def.hot = true;
      if (b.comps.some((c) => c.conn?.type.startsWith('ac_'))) def.mains = true;
    }
    def.lv = !def.mains && def.mods.every((id) => { const b = modOf(id)?.board; return !!b && !isCharger(b) && !isPlugPack(b); });
    const first = modOf(def.mods[0]);
    if (first && !isAccessory(first.board) && def.mods.length === 1) def.group = kindOfName(first.board.name);
  };
  const build = (mt: Spec, mods: string[], turn: Turn, slots: Slot[], loss: number): PlaceOpt => {
    const geos: SeatGeo[] = mt.kind === 'flat' ? [flatGeo(orig.get(mods[0]) ?? modOf(mods[0])!, turn, wanted)]
      : slots.flatMap((s, k) => (s.module ? [seat(orig.get(s.module)!, k, s.edge as EdgeName, turn, s.lie)] : []));
    const ext: [number, number, number, number] = mt.kind === 'flat' ? [Infinity, -Infinity, Infinity, -Infinity] : [-SHOE.u, SHOE.u, -SHOE.v, SHOE.v];
    const pts: PlaceOpt['pts'] = [], touch: Touch[] = [];
    for (const g of geos) {
      ext[0] = Math.min(ext[0], g.ext[0]); ext[1] = Math.max(ext[1], g.ext[1]); ext[2] = Math.min(ext[2], g.ext[2]); ext[3] = Math.max(ext[3], g.ext[3]);
      for (const [key, q] of g.plugs) for (const e of byKey.get(key) ?? []) pts.push({ e, ...q });
      touch.push(...g.touch);
    }
    return { turn, slots, loss, u0: ext[0], u1: ext[1], v0: ext[2], v1: ext[3], pts, touch };
  };
  // how each turn seats the boards of a dock: their edges, and how well their plugs can be reached
  const seats = (mt: Spec, t: Turn, pin: boolean) => mt.slots.map((s, k) => {
    if (!s.module) return { slot: { module: null, edge: 'auto' } as Slot, score: 0, blocked: false };
    const sc = seatOf(merged.get(s.module) ?? modOf(s.module)!, k, t, s.lie, pin ? (s.edge as EdgeName) : undefined);
    return { slot: { module: s.module, edge: sc.edge, ...(s.lie ? { lie: s.lie } : {}) } as Slot, score: sc.score, blocked: sc.access.some((a) => a.ok === 'blocked') };
  });
  const total = (x: ReturnType<typeof seats>) => x.reduce((a, y) => a + y.score, 0);
  /**
   * The def of a mount. `pinned`: the classic mount's own turn and edges are the first way (loss 0 against it).
   * Otherwise the best turn is the first, and its loss is what every other way costs against it. `ref`: what to measure
   * against (a pair: its two boards' own bests). Returns the def and the score of its best way.
   */
  const makeDef = (mt: Spec, pinned: boolean, ref?: number, tol = W.tol): { def: Def; best: number } => {
    const mods = mt.slots.filter((s) => s.module).map((s) => s.module!);
    const def: Def = { kind: mt.kind, mods, opts: [], hot: false, mains: false, lv: false, group: '', probe: mods.some((id) => colBase.has(id)) };
    flagsOf(def);
    if (mt.kind === 'flat') {
      // a box may be turned end for end: its ports then face the other way
      for (const t of [mt.turn, ((mt.turn + 180) % 360) as Turn]) def.opts.push(build(mt, mods, t, mt.slots.map((s) => ({ ...s })), 0));
      return { def, best: 0 };
    }
    const turns = mods.some(isColumn) ? ([0, 180] as Turn[]) : TURNS;
    const alts = turns.map((t) => ({ t, x: seats(mt, t, false) }));
    const good = alts.filter((a) => !a.x.some((y) => y.blocked));
    const best = Math.max(...(good.length ? good : alts).map((a) => total(a.x)));
    const at = ref ?? best;
    if (pinned) {
      const pin = seats(mt, mt.turn, true);
      def.opts.push(build(mt, mods, mt.turn, mt.slots.map((s) => ({ ...s })), Math.max(0, at - total(pin))));
      const pinBlocked = pin.some((y) => y.blocked);
      for (const a of alts) if (a.t !== mt.turn && (pinBlocked || !a.x.some((y) => y.blocked)) && at - total(a.x) <= tol) def.opts.push(build(mt, mods, a.t, a.x.map((y) => y.slot), Math.max(0, at - total(a.x))));
    } else {
      for (const a of [...alts].sort((x, y) => total(y.x) - total(x.x))) if (!a.x.some((y) => y.blocked) && at - total(a.x) <= tol) def.opts.push(build(mt, mods, a.t, a.x.map((y) => y.slot), Math.max(0, at - total(a.x))));
      if (!def.opts.length) { const a = alts[0]; def.opts.push(build(mt, mods, a.t, a.x.map((y) => y.slot), 0)); }
    }
    return { def, best };
  };

  // the boards that have probes' columns beside them stay unpaired (as the classic layout has it)
  const withCols = new Set<string>();
  for (const x of p.modules) if (isAccessory(x.board) && isProbe(x)) for (const l of p.links ?? []) { const o = l.a.module === x.id ? l.b : l.b.module === x.id ? l.a : null; const om = o && modOf(o.module); if (om && !isAccessory(om.board)) withCols.add(baseOf(p, om).id); }
  const pairable = (mt: RailMount) => !!p.panel.pairs && mt.kind === 'dock' && mt.slots.some((s) => s.module) && mt.slots.filter((s) => s.module).every((s) => !isColumn(s.module!) && !withCols.has(s.module!) && !alone(merged.get(s.module!) ?? modOf(s.module!)!));
  const classicDef: number[] = [], singleOf = new Map<string, number>(), lieOf = new Map<string, 'flat' | undefined>(), best1 = new Map<number, number>();
  classic.forEach((mt) => {
    if (pairable(mt)) {
      // each board on its own (a pair is one way to seat two of them), so the search can pair and unpair
      const ids = mt.slots.filter((s) => s.module).map((s) => s.module!);
      for (const id of ids) {
        const s0 = mt.slots.find((x) => x.module === id)!;
        lieOf.set(id, s0.lie);
        const { def, best } = makeDef({ kind: 'dock', turn: mt.turn, slots: [{ module: id, edge: 'auto', ...(s0.lie ? { lie: s0.lie } : {}) }, { module: null, edge: 'auto' }] }, false);
        singleOf.set(id, model.defs.push(def) - 1); best1.set(model.defs.length - 1, best);
      }
      classicDef.push(ids.length === 2 ? -1 : singleOf.get(ids[0])!);
    } else classicDef.push(model.defs.push(makeDef({ kind: mt.kind, turn: mt.turn, slots: mt.slots.map((s) => ({ ...s })) }, true).def) - 1);
  });
  // every pair that can share a dock back to back: both stand (or both lie flat), and it costs little plug access
  const pairsOf = new Map<number, number[]>(); // single def -> the pair defs it can join
  const ones = [...singleOf.entries()];
  for (let x = 0; x < ones.length; x++) for (let y = x + 1; y < ones.length; y++) {
    const [ia, da] = ones[x], [ib, db] = ones[y];
    if (lieOf.get(ia) !== lieOf.get(ib)) continue;
    const { def } = makeDef({ kind: 'dock', turn: 0, slots: [{ module: ia, edge: 'auto', ...(lieOf.get(ia) ? { lie: 'flat' as const } : {}) }, { module: ib, edge: 'auto', ...(lieOf.get(ib) ? { lie: 'flat' as const } : {}) }] }, false, best1.get(da)! + best1.get(db)!, 1.5);
    if (!def.opts.length || def.opts[0].loss > 1.5) continue;
    def.opts = def.opts.filter((o) => o.loss <= 1.5);
    const id = model.defs.push(def) - 1;
    def.members = [da, db];
    for (const q of [da, db]) (pairsOf.get(q) ?? pairsOf.set(q, []).get(q)!).push(id);
  }
  model.pairsOf = pairsOf;
  // where the classic layout has a pair, the pair def; the search may take it apart
  const key = (a: number, b: number) => `${Math.min(a, b)}/${Math.max(a, b)}`;
  const pairAt = new Map(model.defs.flatMap((d, i) => (d.members ? [[key(d.members[0], d.members[1]), i] as [string, number]] : [])));
  const start = classic.map((mt, i) => {
    if (classicDef[i] >= 0) return [classicDef[i]];
    const ids = mt.slots.filter((s) => s.module).map((s) => s.module!), a = singleOf.get(ids[0])!, b = singleOf.get(ids[1])!;
    const pd = pairAt.get(key(a, b));
    return pd != null ? [pd] : [a, b]; // (a pair the search would not choose: both boards alone, side by side)
  });
  const units = unitsOf(p, classic, start, colBase);
  return { model, start: { units, brk: units.map(() => false), sel: model.defs.map(() => 0) } };
}

/** Docks that must stay together: a board's dock and the docks of its probes' columns (they stand right beside it). */
function unitsOf(p: Project, classic: RailMount[], defOf: number[][], colBase: Set<string>): number[][] {
  const hostOf = (id: string) => {
    for (const l of p.links ?? []) {
      const other = l.a.module === id ? l.b : l.b.module === id ? l.a : null;
      const om = other && p.modules.find((x) => x.id === other.module);
      if (om && !isAccessory(om.board)) return baseOf(p, om).id;
    }
    return null;
  };
  const units: number[][] = [], at = new Map<string, number>();
  classic.forEach((mt, i) => {
    const mods = mt.slots.filter((s) => s.module).map((s) => s.module!);
    // a probe's column belongs to the board its ribbon goes to (with the option off, every dock is a unit of its own)
    const key = p.panel.opts?.probes !== 'free' && mt.kind === 'dock' && mods.length && mods.every((id) => colBase.has(id)) ? hostOf(mods[0]) ?? `d${i}` : mods[0] ?? `d${i}`;
    const u = at.get(key);
    if (u == null) { at.set(key, units.length); units.push([...defOf[i]]); } else units[u].push(...defOf[i]);
  });
  return units;
}

// ---------------------------------------------------------------- search

const clone = (s: State): State => ({ units: s.units.slice(), brk: s.brk.slice(), sel: s.sel.slice() });

function move(s: State, m: Model, rnd: () => number): State | null {
  const t = clone(s), nU = t.units.length, r = rnd();
  const pick = (n: number) => Math.floor(rnd() * n);
  if (r < 0.34 && nU > 1) {
    const i = pick(nU); let j = pick(nU - 1); if (j >= i) j++;
    const a = t.units[i]; t.units[i] = t.units[j]; t.units[j] = a;
  } else if (r < 0.5 && nU > 1) {
    const i = pick(nU); let j = pick(nU - 1); if (j >= i) j++;
    const [u] = t.units.splice(i, 1); t.units.splice(j, 0, u);
  } else if (r < 0.6 && nU > 2) {
    let i = pick(nU), j = pick(nU); if (i > j) [i, j] = [j, i];
    if (i === j) return null;
    t.units.splice(i, j - i + 1, ...t.units.slice(i, j + 1).reverse());
  } else if (r < 0.88) {
    const cand = m.defs.map((d, k) => (d.opts.length > 1 ? k : -1)).filter((k) => k >= 0);
    if (!cand.length) return null;
    const d = cand[pick(cand.length)];
    let o = pick(m.defs[d].opts.length - 1); if (o >= t.sel[d]) o++;
    t.sel[d] = o;
  } else if (r < 0.92) {
    const i = pick(nU); t.brk[i] = !t.brk[i];
  } else if (r < 0.98 && m.pairsOf.size) {
    // two boards share a dock back to back, or a pair comes apart (the second board's dock right after the first's)
    const pairs = t.units.map((u, k) => (u.length === 1 && m.defs[u[0]].members ? k : -1)).filter((k) => k >= 0);
    if (pairs.length && rnd() < 0.5) {
      const k = pairs[pick(pairs.length)], [a, b] = m.defs[t.units[k][0]].members!;
      t.units.splice(k, 1, [a], [b]); t.brk.splice(k + 1, 0, false);
    } else {
      const ones = t.units.map((u, k) => (u.length === 1 && m.pairsOf.has(u[0]) ? k : -1)).filter((k) => k >= 0);
      if (!ones.length) return null;
      const i = ones[pick(ones.length)], a = t.units[i][0];
      const opts = m.pairsOf.get(a)!.filter((d) => { const [x, y] = m.defs[d].members!; const o = x === a ? y : x; return t.units.some((u) => u.length === 1 && u[0] === o); });
      if (!opts.length) return null;
      const d = opts[pick(opts.length)], [x, y] = m.defs[d].members!, o = x === a ? y : x;
      const j = t.units.findIndex((u) => u.length === 1 && u[0] === o);
      t.units[i] = [d]; t.units.splice(j, 1); t.brk.splice(j, 1);
    }
  } else {
    const multi = t.units.map((u, k) => (u.length > 1 ? k : -1)).filter((k) => k >= 0);
    if (!multi.length) return null;
    const k = multi[pick(multi.length)];
    t.units[k] = t.units[k].slice().reverse();
  }
  return t;
}

function anneal(m: Model, start: State, iters: number, rnd: () => number): { best: State; cost: number } {
  let cur = start, cc = m.evaluate(cur), best = cur, bc = cc;
  const T0 = Math.max(60, cc * 0.02), T1 = 2;
  for (let it = 0; it < iters; it++) {
    const T = T0 * Math.pow(T1 / T0, it / iters);
    const nx = move(cur, m, rnd);
    if (!nx) continue;
    const c = m.evaluate(nx);
    if (c <= cc || rnd() < Math.exp((cc - c) / T)) { cur = nx; cc = c; if (c < bc - 1e-9) { best = nx; bc = c; } }
  }
  return { best, cost: bc };
}

/** Every layout one pairing away: two single docks made a pair (at the place of either), or a pair taken apart. */
function pairings(m: Model, s: State): State[] {
  const out: State[] = [];
  s.units.forEach((u, k) => {
    if (u.length !== 1) return;
    const d = u[0], mem = m.defs[d].members;
    if (mem) { const t = clone(s); t.units.splice(k, 1, [mem[0]], [mem[1]]); t.brk.splice(k + 1, 0, false); out.push(t); return; }
    for (const pd of m.pairsOf.get(d) ?? []) {
      const [x, y] = m.defs[pd].members!, o = x === d ? y : x, j = s.units.findIndex((v) => v.length === 1 && v[0] === o);
      if (j < 0 || j < k) continue; // (once for each two)
      for (const at of [k, j]) {
        const t = clone(s);
        t.units[at] = [pd]; t.units.splice(at === k ? j : k, 1); t.brk.splice(at === k ? j : k, 1);
        out.push(t);
      }
    }
  });
  return out;
}

/** Improve by single moves until none helps (a few passes). */
function polish(m: Model, s: State): { best: State; cost: number } {
  let best = s, bc = m.evaluate(s);
  const tryIt = (t: State) => { const c = m.evaluate(t); if (c < bc - 1e-9) { best = t; bc = c; return true; } return false; };
  for (let pass = 0; pass < 3; pass++) {
    let improved = false;
    const n = best.units.length;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const t = clone(best); const [u] = t.units.splice(i, 1); t.units.splice(j, 0, u);
      if (tryIt(t)) improved = true;
    }
    m.defs.forEach((d, k) => d.opts.forEach((_, o) => { if (o !== best.sel[k]) { const t = clone(best); t.sel[k] = o; if (tryIt(t)) improved = true; } }));
    for (let i = 0; i < best.brk.length; i++) { const t = clone(best); t.brk[i] = !t.brk[i]; if (tryIt(t)) improved = true; }
    // two boards in one dock back to back, or a pair taken apart
    for (const t of pairings(m, best)) if (tryIt(t)) { improved = true; break; }
    if (!improved) break;
  }
  return { best, cost: bc };
}

const shuffled = (s: State, rnd: () => number): State => {
  const t = clone(s);
  for (let i = t.units.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [t.units[i], t.units[j]] = [t.units[j], t.units[i]]; }
  return t;
};

const nLinks = (p: Project) => (p.links ?? []).length;

/** The planner's best layouts, best first: each is the classic docks put in a better order, turned, in rows. */
export function planCandidates(p: Project, classic: RailMount[], count = 2): Plan[] {
  const t0 = Date.now();
  const o = p.panel.opts ?? {};
  const { model, start } = buildModel(p, classic, weightsFor(o));
  model.avoid = (o.avoid ?? []).map((x) => x.split('|') as [string, string]);
  const nD = model.defs.length;
  // room to grow: leave this many docks' width free at the end of each rail
  if (model.W.spare) model.reserve = model.W.spare * (model.defs.reduce((a, d) => a + d.opts[0].u1 - d.opts[0].u0 + PAD + p.panel.gap, 0) / Math.max(1, nD));
  const c0 = model.evaluate(start);
  const rnd = mulberry(hash(`${p.modules.map((m) => m.board.name).join('|')}#${nLinks(p)}${JSON.stringify({ ...o, pick: undefined, plan: undefined, avoid: undefined })}${(o.avoid ?? []).join(';')}${p.panel.maxRail}`)); // (not `pick`: the best and the next best of one search)
  const iters = Math.min(9000, 1500 + 420 * nD);
  const found: { s: State; cost: number }[] = [{ s: start, cost: c0 }];
  [start, shuffled(start, rnd), shuffled(start, rnd)].forEach((s0, k) => {
    const r = anneal(model, s0, k === 0 ? iters : Math.round(iters * 0.6), rnd);
    const q = polish(model, r.best);
    found.push({ s: q.best, cost: q.cost });
  });
  found.sort((a, b) => a.cost - b.cost);
  // (distinct ones only: the same order of docks with the same turns is one)
  const sig = (s: State) => JSON.stringify([s.units, s.sel, s.brk.map(Number)]);
  const seen = new Set<string>(), out: Plan[] = [];
  for (const f of found) {
    if (seen.has(sig(f.s))) continue;
    seen.add(sig(f.s));
    out.push({ ...emit(model, f.s, classic), cost: f.cost });
    if (out.length >= count) break;
  }
  lastPlan = { cost: out[0].cost, classic: c0, evals: model.evals, ms: Date.now() - t0, defs: nD, candidates: out.length, detail: out[0].detail };
  return out;
}

/** A state as mounts in order, each with its turn and edges and the row it is on. */
function emit(m: Model, s: State, classic: RailMount[]): { mounts: RailMount[]; detail: Detail } {
  const det: Detail = { rows: [], order: [], lens: [], reach: 0, hot: 0, hotRow: 0, mains: 0, alike: 0, docks: 0, railLen: 0, blocked: 0 };
  m.evaluate(s, det);
  void classic;
  return { detail: det, mounts: det.order.map((d, k) => {
    const o = m.defs[d].opts[s.sel[d]];
    return { id: `auto${k}`, rail: '', at: null, kind: m.defs[d].kind, turn: o.turn, row: det.rows[k], slots: o.slots.map((x) => ({ ...x })) } as RailMount;
  }) };
}

/** The layout Auto-arrange uses: the planner's pick (`opts.pick` of its best few), never one it scores worse than the classic order. */
export function planAuto(p: Project, classic: RailMount[]): RailMount[] {
  if (!classic.length) return classic;
  const c = planCandidates(p, classic, 2);
  return c[Math.min(p.panel.opts?.pick ?? 0, c.length - 1)].mounts;
}
