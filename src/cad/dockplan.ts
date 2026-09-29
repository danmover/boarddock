// Panel planning without geometry: where plugs point once a board sits in a dock, which orientation keeps them
// reachable, and the automatic assignment of boards to docks (pairing back to back where it costs nothing).
// Panel frame: X right, Y up, Z out of the wall. Hub frame (per rail): X along the rail, Y across, Z out.
import type { Access, AccessDir, Board, EdgeName, HolderSettings, Loop, Module, PanelReport, Project, RailMount, Turn, V2 } from '../model/types';
import { bbox, compRect, extentAlong, rad, uid } from '../geom/poly';
import { basis, dir, I4, inv, mul, rotZ, tr, type M4 } from '../geom/mat';
import { DOCK_MIN_ZB, EAR, gripSpan, HD, headSpan, SOCKET_Z, SPINE_TOP, TONGUE } from './dockdims';
import { MATERIALS } from '../model/library';
import { computeLevels } from './levels';
import { holdOf } from './grip';
import { baseOf, ridersOf } from '../model/holes';
import { isProbe, probesOf, targetOf } from '../model/probes';
import { isAccessory } from '../model/links';
import { isPlugPack } from '../model/powerdata';

/** A module plus the plugs of every board stacked on it: what orientation scoring should look at. */
export function withRiders(p: Project, m: Module): Module {
  const up = ridersOf(p, m);
  if (!up.length) return m;
  return { ...m, board: { ...m.board, comps: [...m.board.comps, ...up.flatMap((r) => r.board.comps)] } };
}

export const EDGES: EdgeName[] = ['bottom', 'top', 'left', 'right'];
export const TURNS: Turn[] = [0, 90, 180, 270];

export const edgeNormal = (e: EdgeName): V2 => ({ bottom: [0, -1], top: [0, 1], left: [-1, 0], right: [1, 0] } as Record<EdgeName, V2>)[e];

/** Holder frame -> socket-local frame of a dock slot, from the dock edge and the tongue position. */
export function dockFrame(edge: EdgeName, tc: number, L0: number): M4 {
  const n = edgeNormal(edge), e = [n[1], -n[0]];
  // socket-local -> holder: x -> e, y -> +z (holder back at y = 0.5), z -> -n (away from the dock face)
  const D = basis([e[0], e[1], 0], [0, 0, 1], [-n[0], -n[1], 0], [tc * e[0] + L0 * n[0], tc * e[1] + L0 * n[1], -0.5]);
  return inv(D);
}

/**
 * Holder frame -> socket-local frame of a dock slot whose holder lies flat, docked by the ear on `edge` (tongue at `tc`
 * along it, holder's outer face `L0` out along its normal): the ear's tip over the socket's divider, the holder's
 * underside on the key's pedestal, its top face up out of the socket.
 */
export function flatFrame(edge: EdgeName, tc: number, L0: number): M4 {
  const n = edgeNormal(edge), e = [n[1], -n[0]];
  // socket-local -> holder: x -> -e, y -> -n (in from the ear's tip), z -> +z; the holder's underside on the key's
  // pedestal, EAR.ped above the socket top
  const D = basis([-e[0], -e[1], 0], [-n[0], -n[1], 0], [0, 0, 1], [tc * e[0] + (L0 + EAR.len) * n[0], tc * e[1] + (L0 + EAR.len) * n[1], -EAR.ped]);
  return inv(D);
}

/** Holder frame -> socket-local for a slot, standing or lying flat. */
export const slotFrame = (edge: EdgeName, tc: number, L0: number, lie?: 'flat' | 'up'): M4 => (lie === 'flat' ? flatFrame(edge, tc, L0) : dockFrame(edge, tc, L0));

/** Rail frame -> panel. */
export function railMatrix(r: { x: number; y: number; dir: 'h' | 'v' }): M4 {
  return r.dir === 'h' ? tr(r.x, r.y, 0) : basis([0, 1, 0], [-1, 0, 0], [0, 0, 1], [r.x, r.y, 0]);
}

/** Holder frame -> rail frame (mount centred at 0) for a dock slot. */
export function slotMatrix(turn: number, slot: number, holderToSocket: M4): M4 {
  return mul(tr(0, 0, SOCKET_Z), rotZ((turn + (slot ? 180 : 0)) % 360), holderToSocket);
}

/** Clip frame (u out of the wall, v across the rail, w along it) -> rail frame, mount centred at 0. */
export function clipToRail(W: number): M4 {
  return basis([0, 0, 1], [0, 1, 0], [-1, 0, 0], [W / 2, 0, 0]);
}

/** Plug directions of a board, in its own frame (unit vectors). */
export function plugDirs(b: Board): { ref: string; type: string; v: [number, number, number] }[] {
  const out: { ref: string; type: string; v: [number, number, number] }[] = [];
  for (const c of b.comps) {
    if (!c.conn || c.hidden) continue;
    const v: [number, number, number] = c.conn.entry === 'edge' ? [Math.cos(rad(c.conn.angle)), Math.sin(rad(c.conn.angle)), 0] : [0, 0, c.side === 'top' ? 1 : -1];
    out.push({ ref: c.ref, type: c.conn.type, v });
  }
  return out;
}

export function classify(v: number[], railDir: 'h' | 'v'): { dir: AccessDir; ok: Access['ok'] } {
  if (v[2] > 0.7) return { dir: 'front', ok: 'good' };
  if (v[2] < -0.7) return { dir: 'wall', ok: 'blocked' };
  const d: AccessDir = Math.abs(v[0]) >= Math.abs(v[1]) ? (v[0] > 0 ? 'right' : 'left') : v[1] > 0 ? 'up' : 'down';
  const along = railDir === 'h' ? d === 'left' || d === 'right' : d === 'up' || d === 'down';
  return { dir: d, ok: along ? 'side' : 'good' };
}

const SCORE = { front: 3, good: 2, down: 0.25, side: -2, blocked: -25 };

/** Rotation from the holder frame to the panel for a dock slot (tongue position does not matter for directions). */
function dockRot(edge: EdgeName, turn: number, slot: number, railDir: 'h' | 'v', lie?: 'flat' | 'up'): M4 {
  return mul(railMatrix({ x: 0, y: 0, dir: railDir }), slotMatrix(turn, slot, slotFrame(edge, 0, 0, lie)));
}

/** Rotation from the holder frame to the panel for a flat clip (board lies on the panel, rail along board direction `turn`). */
function flatRot(turn: number, railDir: 'h' | 'v'): M4 {
  // board -> panel: rail direction (board frame angle `turn`) -> along the rail, component side -> out of the wall
  return mul(railMatrix({ x: 0, y: 0, dir: railDir }), rotZ(-turn));
}

export function accessOf(b: Board, rot: M4, railDir: 'h' | 'v'): Access[] {
  return plugDirs(b).map((p) => ({ ref: p.ref, type: p.type, ...classify(dir(rot, p.v), railDir) }));
}

function score(b: Board, acc: Access[], reach: number, alongRail: number): number {
  let s = 0;
  for (const a of acc) s += a.ok === 'blocked' ? SCORE.blocked : a.ok === 'side' ? SCORE.side : a.dir === 'front' ? SCORE.front : SCORE.good + (a.dir === 'down' ? SCORE.down : 0);
  void b;
  return s - 0.015 * reach - 0.008 * alongRail;
}

const earCache = new WeakMap<Module, Partial<Record<EdgeName, number>>>();
function earConflicts(m: Module, edge: EdgeName): number {
  const c = earCache.get(m) ?? {};
  if (c[edge] == null) { c[edge] = earSite(m.board, m.holder, edge).conflicts.length; earCache.set(m, c); }
  return c[edge]!;
}

const siteCache = new WeakMap<Module, Partial<Record<EdgeName, number>>>();
function siteConflicts(m: Module, edge: EdgeName): number {
  const c = siteCache.get(m) ?? {};
  if (c[edge] == null) { c[edge] = dockSite(m.board, m.holder, edge).conflicts.length; siteCache.set(m, c); }
  return c[edge]!;
}

export interface Orientation { edge: EdgeName; turn: Turn; score: number; access: Access[]; lie?: 'flat' }

/** Size of a board's holder in its own frame: along x, along y, and height (rough, for choosing orientations). */
function holderSize(m: Module) {
  const bb = bbox(m.board.outline);
  const gw = m.holder.gap + m.holder.wall;
  const top = Math.max(0, ...m.board.comps.filter((c) => c.side === 'top' && !c.hidden).map((c) => c.h));
  return { x: bb.x1 - bb.x0 + 2 * gw, y: bb.y1 - bb.y0 + 2 * gw, z: 12 + m.board.thickness + top };
}

export interface DockSite {
  edge: EdgeName;
  n: V2; // outward normal of the dock edge (board frame)
  e: V2; // along the dock edge (socket-local +x)
  tc: number; // tongue / spine centre along e
  L0: number; // dock face: p.n of the holder's outer face on that edge
  far: number; // depth of the far (top) wall's outer face from the dock face
  ped: number; // pedestal depth into the holder
  minZb: number; // board bottom above the bed (to clear the spine when it runs under the board)
  under: boolean; // spine runs under the board (else beside it)
  side: number; // 0 under; +1 / -1 beside the board on its +e / -e side
  conflicts: string[];
  /** what the release setting asked for and what it got; `blocked` names the plugs that stopped the wanted spot */
  release: { want: 'centre' | 'side' | 'auto'; got: 'centre' | 'side'; blocked: string[] };
}

const dirOf = (a: number): V2 => [Math.cos(rad(a)), Math.sin(rad(a))];

/**
 * Where the tongue, spine, grip bar and button go on a holder docked by `edge`: clear of standoffs and plugs.
 * Under the middle of the board is best balanced but lifts the board over the spine; beside the board keeps the
 * board low and dodges a crowded top edge. `shift`: slide the holder along the dock by moving the tongue that far
 * from the middle (a probe lining up with its board's headers). Pure geometry, no kernel.
 */
export function dockSite(b: Board, H: HolderSettings, edge: EdgeName, shift = 0): DockSite {
  const n = edgeNormal(edge), e: V2 = [n[1], -n[0]];
  const gw = H.gap + H.wall;
  const dn = (p: V2) => p[0] * n[0] + p[1] * n[1], de = (p: V2) => p[0] * e[0] + p[1] * e[1];
  const ol = b.outline;
  const L0 = Math.max(...ol.map(dn)) + gw;
  const far = L0 - (Math.min(...ol.map(dn)) - gw);
  const bt0 = Math.min(...ol.map(de)), bt1 = Math.max(...ol.map(de)), tMid = (bt0 + bt1) / 2;
  const ts = (loop: Loop) => {
    const t = loop.map(de), s = loop.map((p) => L0 - dn(p));
    return { t0: Math.min(...t), t1: Math.max(...t), s0: Math.min(...s), s1: Math.max(...s) };
  };
  const posts = b.holes.filter((h) => h.use !== 'none').map((h) => ({ t: de([h.x, h.y]), s: L0 - dn([h.x, h.y]), r: h.d / 2 + 2.2 }));
  const under = b.comps.filter((c) => !c.hidden && ((c.side === 'bottom' && c.h > 0) || (c.side === 'top' && c.tht)))
    .map((c) => ({ ...ts(compRect(c, 0.5)), need: c.side === 'bottom' ? c.h + 0.5 : H.leadLen + 0.4 }));
  const plugs = plugZones(b, dn, de, L0);
  const ov = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;
  const zbLow = computeLevels(b, H).zb;
  const spineW = HD.spineHx + 0.4;
  // a board without snap-capable holes needs its side edges for the spring clips: a spine beside it takes one
  const fingerHeld = b.holes.filter((h) => (h.use === 'auto' || h.use === 'snap') && h.d >= 1.8).length < 2 && holdOf(H) !== 'pins';
  let best = { pen: Infinity, tc: tMid, conflicts: [] as string[], under: true, side: 0 };
  let bestWanted = { pen: Infinity, conflicts: [] as string[] };
  const wanted = H.release ?? 'centre';
  // candidates: under the board, or just outside either side wall (spine fused to it)
  const lo = bt0 - gw - HD.spineHx + 0.4, hi = bt1 + gw + HD.spineHx - 0.4;
  for (let tc = lo; tc <= hi + 1e-9; tc += 0.5) {
    const isUnder = ov(tc - HD.spineHx, tc + HD.spineHx, bt0 - H.gap, bt1 + H.gap); // else it sits beside the board, fused to the wall
    const side = isUnder ? 0 : tc > tMid ? 1 : -1;
    const [g0, g1] = gripSpan(side), [h0, h1] = headSpan(side);
    const want = H.release ?? 'centre';
    let pen = 0.3 * Math.abs(tc - tMid - shift) + (!isUnder && fingerHeld ? 12 : 0) + (want === 'centre' && !isUnder ? 200 : want === 'side' && isUnder ? 200 : 0);
    const conflicts: string[] = [];
    if (isUnder) {
      for (const p of posts) if (Math.abs(p.t - tc) < p.r + 3.3) pen += 1000;
      pen += ((H.style ?? 'frame') === 'frame' && (H.release ?? 'centre') === 'auto' ? 2.6 : 1.2) * Math.max(0, DOCK_MIN_ZB - zbLow); // a raised board makes every post and wall taller
      for (const k of under) if (ov(k.t0, k.t1, tc - spineW, tc + spineW)) pen += 3 * k.need;
    }
    for (const q of plugs) {
      if (ov(q.t0, q.t1, tc - 11, tc + 11) && ov(q.s0, q.s1, -30, 3)) { pen += 500; conflicts.push(`${q.ref} (at the dock)`); }
      if ((ov(q.t0, q.t1, tc + g0 - 0.5, tc + g1 + 0.5) && ov(q.s0, q.s1, far + 0.3, far + HD.grip.gap + HD.grip.t + 0.5)) ||
        (ov(q.t0, q.t1, tc + h0 - 0.5, tc + h1 + 0.5) && ov(q.s0, q.s1, far + 0.3, far + HD.grip.gap + HD.grip.t + HD.stroke + HD.head.t + 1))) { pen += 500; conflicts.push(`${q.ref} (at the release button)`); }
      if (!isUnder && ov(q.t0, q.t1, tc - spineW, tc + spineW) && ov(q.s0, q.s1, -1, far + 1)) { pen += 500; conflicts.push(`${q.ref} (beside the spine)`); }
    }
    if (pen < best.pen) best = { pen, tc, conflicts, under: isUnder, side };
    if ((wanted === 'centre' ? isUnder : wanted === 'side' ? !isUnder : true) && pen < bestWanted.pen) bestWanted = { pen, conflicts };
  }
  const tc = best.tc;
  let minZb = 0;
  if (best.under) {
    minZb = DOCK_MIN_ZB;
    for (const k of under) if (ov(k.t0, k.t1, tc - spineW, tc + spineW)) minZb = Math.max(minZb, SPINE_TOP + 0.3 + k.need);
  }
  // pedestal: reaches in from the dock face until it meets the tray wall
  let inset = 0;
  for (let t = tc - HD.base.hx; t <= tc + HD.base.hx; t += 0.5) {
    let hit = -Infinity;
    for (let i = 0; i < ol.length; i++) {
      const a = ol[i], c = ol[(i + 1) % ol.length];
      const ta = de(a), tb = de(c);
      if ((ta - t) * (tb - t) > 0 || ta === tb) continue;
      const u = (t - ta) / (tb - ta);
      hit = Math.max(hit, dn(a) + u * (dn(c) - dn(a)));
    }
    if (hit > -Infinity) inset = Math.max(inset, L0 - gw - hit);
  }
  const got = best.under ? 'centre' as const : 'side' as const;
  const blocked = wanted !== 'auto' && wanted !== got ? [...new Set(bestWanted.conflicts.map((c) => c.replace(/ \(.*$/, '')))] : [];
  return { edge, n, e, tc, L0, far, ped: Math.min(HD.base.t + inset, 30), minZb, under: best.under, side: best.side, conflicts: [...new Set(best.conflicts)], release: { want: wanted, got, blocked } };
}

/** Where a holder lying flat has its ear: along `edge`, clear of the plugs there. */
export interface EarSite {
  edge: EdgeName;
  n: V2;
  e: V2;
  tc: number; // the ear's middle (and the tongue's) along e
  L0: number; // the holder's outer face on that edge, along n
  far: number; // from the ear's tip to the holder's far side
  inset: number; // how far in the outline is from L0 under the ear (a round board): the ear reaches in that much more
  conflicts: string[];
}

/** The ear of a holder lying flat: the middle of `edge`, or as near it as keeps the plugs there clear. Pure geometry. */
export function earSite(b: Board, H: HolderSettings, edge: EdgeName, shift = 0): EarSite {
  const n = edgeNormal(edge), e: V2 = [n[1], -n[0]];
  const gw = H.gap + H.wall;
  const dn = (p: V2) => p[0] * n[0] + p[1] * n[1], de = (p: V2) => p[0] * e[0] + p[1] * e[1];
  const ol = b.outline;
  const L0 = Math.max(...ol.map(dn)) + gw, far = L0 - (Math.min(...ol.map(dn)) - gw) + EAR.len;
  const bt0 = Math.min(...ol.map(de)), bt1 = Math.max(...ol.map(de)), tMid = (bt0 + bt1) / 2;
  const plugs = plugZones(b, dn, de, L0);
  const ov = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;
  const lo = Math.min(tMid, bt0 - gw + EAR.hx), hi = Math.max(tMid, bt1 + gw - EAR.hx);
  let best = { pen: Infinity, tc: tMid, conflicts: [] as string[] };
  for (let tc = lo; tc <= hi + 1e-9; tc += 0.5) {
    let pen = 0.3 * Math.abs(tc - tMid - shift);
    const conflicts: string[] = [];
    for (const q of plugs) if (ov(q.t0, q.t1, tc - EAR.hx - 1, tc + EAR.hx + 1) && ov(q.s0, q.s1, -EAR.len - 2, 2)) { pen += 500; conflicts.push(`${q.ref} (at the ear)`); }
    if (pen < best.pen) best = { pen, tc, conflicts };
  }
  // how far in the outline is under the ear (a round or notched edge): the ear reaches in to meet the wall
  let inset = 0;
  for (let t = best.tc - EAR.hx; t <= best.tc + EAR.hx; t += 0.5) {
    let hit = -Infinity;
    for (let i = 0; i < ol.length; i++) {
      const a = ol[i], c = ol[(i + 1) % ol.length], ta = de(a), tb = de(c);
      if ((ta - t) * (tb - t) > 0 || ta === tb) continue;
      const u = (t - ta) / (tb - ta);
      hit = Math.max(hit, dn(a) + u * (dn(c) - dn(a)));
    }
    if (hit > -Infinity) inset = Math.max(inset, L0 - gw - hit);
  }
  return { edge, n, e, tc: best.tc, L0, far, inset: Math.min(inset, 20), conflicts: [...new Set(best.conflicts)] };
}

/** The room each edge plug's cable needs, in (t along the edge, s in from the holder's outer face) terms. */
function plugZones(b: Board, dn: (p: V2) => number, de: (p: V2) => number, L0: number) {
  return b.comps.filter((c) => c.conn?.entry === 'edge' && !c.hidden).map((c) => {
    const d = dirOf(c.conn!.angle);
    const m0 = extentAlong(c, c.conn!.angle);
    const mouth: V2 = [c.x + d[0] * m0, c.y + d[1] * m0];
    const half = c.conn!.plug.w / 2 + 2.5, t = [-d[1], d[0]];
    const len = c.conn!.plug.len + 24;
    const loop: Loop = [[-1, -half], [len, -half], [len, half], [-1, half]].map(([a, q]) => [mouth[0] + d[0] * a + t[0] * q, mouth[1] + d[1] * a + t[1] * q] as V2);
    const ts = loop.map(de), ss = loop.map((p) => L0 - dn(p));
    return { t0: Math.min(...ts), t1: Math.max(...ts), s0: Math.min(...ss), s1: Math.max(...ss), ref: c.ref };
  });
}

/**
 * The bending stress at the root of a holder's tongue under a 20 N push on its far side, the same estimate as the
 * Check step's "Tongue root" line: the lever is the holder's depth from its dock edge (lying flat, to the far side
 * past the ear). `depth` includes the walls.
 */
export function tongueStress(depth: number, lie?: 'flat' | 'up'): number {
  const tb = 2 * TONGUE.hx, th = TONGUE.y1 - TONGUE.y0;
  const lever = lie === 'flat' ? depth + EAR.len - (TONGUE.y0 + TONGUE.y1) / 2 : depth;
  return (20 * lever) / ((tb * th * th) / 6);
}

/**
 * Score taken off an orientation for its tongue: over the Check step's limit (80% of the plastic's yield, where Check
 * fails it) it is all but ruled out, so the board docks by another edge even if a plug or two then points along the
 * rail; below that a little for a long lever, so the shorter one wins when the plugs allow.
 */
function leverCost(m: Module, depth: number, lie?: 'flat' | 'up'): number {
  const y = (MATERIALS[m.holder.material] ?? MATERIALS.PETG).yield, sig = tongueStress(depth, lie);
  return (sig >= 0.9 * y ? 16 : sig >= 0.8 * y ? 14 : 0) + 0.02 * Math.max(0, sig - 0.4 * y);
}

/** Whether a way of docking keeps the tongue under the Check step's limit. */
export function tongueOk(m: Module, o: Pick<Orientation, 'edge' | 'lie'>): boolean {
  const y = (MATERIALS[m.holder.material] ?? MATERIALS.PETG).yield, sz = holderSize(m);
  return tongueStress(o.edge === 'bottom' || o.edge === 'top' ? sz.y : sz.x, o.lie) < 0.8 * y;
}

/**
 * A way to dock a board with its tongue under the Check step's limit, keeping the dock's turn: another edge standing
 * up, or lying flat; the one that keeps its plugs easiest to reach, none pointing into the table. Null when there is none.
 */
export function shorterLever(m: Module, railDir: 'h' | 'v', turn: Turn, slot = 0): { edge: EdgeName; lie?: 'flat' } | null {
  const y = (MATERIALS[m.holder.material] ?? MATERIALS.PETG).yield, sz = holderSize(m);
  let best: { edge: EdgeName; lie?: 'flat'; score: number } | null = null;
  for (const lie of [undefined, 'flat'] as const) for (const edge of EDGES) {
    const depth = edge === 'bottom' || edge === 'top' ? sz.y : sz.x;
    if (tongueStress(depth, lie) >= 0.8 * y) continue;
    const o = bestDock(m, railDir, slot, [turn], [edge], lie);
    if (o.access.some((a) => a.ok === 'blocked')) continue;
    if (!best || o.score > best.score) best = { edge, ...(lie ? { lie } : {}), score: o.score };
  }
  return best && { edge: best.edge, ...(best.lie ? { lie: best.lie } : {}) };
}

/** Best dock edge and socket turn for a board in dock slot `slot`, optionally with the turn fixed. */
export function bestDock(m: Module, railDir: 'h' | 'v', slot = 0, turns: Turn[] = TURNS, edges: EdgeName[] = EDGES, lie?: 'flat' | 'up'): Orientation {
  const sz = holderSize(m);
  let best: Orientation | null = null;
  for (const edge of edges) for (const turn of turns) {
    const acc = accessOf(m.board, dockRot(edge, turn, slot, railDir, lie), railDir);
    const vert = edge === 'bottom' || edge === 'top';
    let s: number;
    if (lie === 'flat') {
      // lying flat it hardly stands out of the wall, but it takes its width (or its depth, turned) of the rail
      const v = dir(inv(slotMatrix(turn, slot, flatFrame(edge, 0, 0))), [1, 0, 0]);
      const n = edgeNormal(edge), depth = (vert ? sz.y : sz.x) + EAR.len, width = vert ? sz.x : sz.y;
      const along = Math.abs(v[0] * n[0] + v[1] * n[1]) * depth + Math.abs(v[0] * n[1] - v[1] * n[0]) * width;
      s = score(m.board, acc, SOCKET_Z + EAR.ped + sz.z, along) - 6 * earConflicts(m, edge) - leverCost(m, depth - EAR.len, 'flat');
    } else {
      const reach = (vert ? sz.y : sz.x) + SOCKET_Z + 20;
      const across = vert ? sz.x : sz.y;
      const along = (turn + (slot ? 180 : 0)) % 180 === 0 ? across : sz.z;
      s = score(m.board, acc, reach, along) - 6 * siteConflicts(m, edge) - leverCost(m, vert ? sz.y : sz.x);
    }
    if (!best || s > best.score + 1e-9) best = { edge, turn, score: s, access: acc, ...(lie === 'flat' ? { lie } : {}) };
  }
  return best!;
}

/** Standing or lying flat, whichever the rack's setting asks for (or suits the board better, on auto). */
export function bestSeat(m: Module, railDir: 'h' | 'v', want: 'up' | 'flat' | 'auto' | undefined, slot = 0, turns: Turn[] = TURNS, edges: EdgeName[] = EDGES): Orientation {
  if (want === 'flat') return bestDock(m, railDir, slot, turns, edges, 'flat');
  const up = bestDock(m, railDir, slot, turns, edges);
  const flat = bestDock(m, railDir, slot, turns, edges, 'flat');
  // a board too big to stand on any edge without its tongue failing Check lies flat instead, when that holds it
  if (!tongueOk(m, up) && tongueOk(m, flat)) return flat;
  if (want !== 'auto') return up;
  // lying flat takes more rail: only when it keeps the plugs clearly easier to reach
  return flat.score > up.score + 0.5 ? flat : up;
}

export function flatAccess(m: Module, turn: number, railDir: 'h' | 'v'): Access[] {
  return accessOf(m.board, flatRot(turn, railDir), railDir);
}

export function slotAccess(m: Module, mt: Pick<RailMount, 'kind' | 'turn'>, slot: number, edge: EdgeName, railDir: 'h' | 'v', lie?: 'flat' | 'up'): Access[] {
  return mt.kind === 'flat' ? flatAccess(m, mt.turn, railDir) : accessOf(m.board, dockRot(edge, mt.turn, slot, railDir, lie), railDir);
}

/**
 * Automatic assignment: every board gets the dock orientation that keeps its plugs reachable; two boards share
 * a dock back to back when that costs (almost) nothing in plug access. Rails and positions are left to the
 * generator, which packs mounts with their real 3D extents.
 */
export function autoAssign(p: Project): RailMount[] {
  const railDir = p.panel.rowDir;
  // stacked boards ride on the board below them; score each stack with all of its plugs
  // (a plug pack lives in an outlet, off the rails)
  const all = p.modules.filter((m) => baseOf(p, m) === m && !isPlugPack(m.board)).map((m) => withRiders(p, m));
  // a board's debug probes (J-Links) stand in the back slot of its dock, stacked, so every ribbon just goes round it
  const backs = probeSlots(p, all);
  // any more of a board's probes that are not stacked on the first (taken off the stack by hand) get a dock of their own
  // right beside the board's, so their ribbons and jumper wires still reach
  const extras = extraCompanions(p, all, backs);
  const docked = new Map([...backs].map(([board, pr]) => [pr.id, board]));
  for (const [board, xs] of extras) for (const x of xs) docked.set(x.id, board);
  const q = docked.size ? { ...p, links: (p.links ?? []).map((l) => ({ ...l, a: { ...l.a, module: docked.get(l.a.module) ?? l.a.module }, b: { ...l.b, module: docked.get(l.b.module) ?? l.b.module } })) } : p;
  // boxes (hubs, chargers) lie flat right after the boards they feed, so their cables stay short; boards connected to
  // each other sit together
  const out: RailMount[] = [];
  for (const seg of byBoxes(q, all.filter((m) => !isAccessory(m.board)), all.filter((m) => isAccessory(m.board) && !docked.has(m.id)))) {
    const docks: RailMount[] = [];
    docksFor(q, orderByLinks(q, seg.boards), railDir, docks, backs, extras);
    const flats: RailMount[] = seg.boxes.map((m) => { const bb = bbox(m.board.outline); return { id: '', rail: '', at: null, kind: 'flat', turn: bb.x1 - bb.x0 >= bb.y1 - bb.y0 ? 0 : 90, slots: [{ module: m.id, edge: 'auto' }] }; });
    // the box in the middle of the boards it feeds, so the farthest cable is half as long
    const mid = flats.length && docks.length >= 2 ? Math.floor(docks.length / 2) : docks.length;
    out.push(...docks.slice(0, mid), ...flats, ...docks.slice(mid));
  }
  out.forEach((m, i) => { m.id = `auto${i}`; });
  return out;
}

/**
 * Boards grouped with the box (charger, hub) they are cabled to: boards with no box first, then each box after its
 * boards, the busiest box first and after that the boxes cabled to boards already placed (a hub on a Pi).
 */
export function byBoxes<T extends Module>(p: Project, boards: T[], boxes: T[]): { boards: T[]; boxes: T[] }[] {
  const links = p.links ?? [];
  if (!links.length || !boxes.length) return [{ boards, boxes }];
  const nb = (id: string) => new Set(links.flatMap((l) => (l.a.module === id ? [l.b.module] : l.b.module === id ? [l.a.module] : [])));
  const deg = (m: T) => nb(m.id).size;
  const left = new Set(boards.map((m) => m.id)), done = new Set<string>();
  const todo = [...boxes].sort((a, b) => deg(b) - deg(a));
  const segs: { boards: T[]; boxes: T[] }[] = [];
  while (todo.length) {
    let i = todo.findIndex((bx) => [...nb(bx.id)].some((id) => done.has(id)));
    if (i < 0) i = 0;
    const bx = todo.splice(i, 1)[0], n = nb(bx.id);
    const mine = boards.filter((m) => left.has(m.id) && n.has(m.id));
    for (const m of mine) { left.delete(m.id); done.add(m.id); }
    done.add(bx.id);
    // a box with no boards of its own (a second hub on the same Pi) joins the box before it
    if (!mine.length && segs.length) segs[segs.length - 1].boxes.push(bx);
    else segs.push({ boards: mine, boxes: [bx] });
  }
  const rest = boards.filter((m) => left.has(m.id));
  return rest.length ? [{ boards: rest, boxes: [] }, ...segs] : segs;
}

/**
 * The probe stack that goes in the back slot of each board's dock: the first probe cabled to the board (with the
 * probes stacked on it), when that probe is not itself stacked on something else. Board id -> probe (with riders).
 */
export function probeSlots<T extends Module>(p: Project, bases: T[]): Map<string, T> {
  const out = new Map<string, T>(), used = new Set<string>();
  for (const m of bases) {
    if (isAccessory(m.board)) continue;
    // probes of the board and of any board stacked on it
    const mine = [m, ...ridersOf(p, m)].flatMap((x) => probesOf(p, p.modules.find((y) => y.id === x.id) ?? x));
    const pr = mine.map((x) => bases.find((b) => b.id === x.id)).find((x) => x && !used.has(x.id));
    if (pr) { out.set(m.id, pr); used.add(pr.id); }
  }
  return out;
}

/**
 * A board's probes and adapters that are neither in its back slot nor stacked on the one that is: each board id ->
 * those companions (with their riders), in the order of the board's headers.
 */
export function extraCompanions<T extends Module>(p: Project, bases: T[], backs: Map<string, T>): Map<string, T[]> {
  const out = new Map<string, T[]>(), used = new Set([...backs.values()].map((x) => x.id));
  for (const m of bases) {
    if (isAccessory(m.board)) continue;
    const mine = [m, ...ridersOf(p, m)].flatMap((x) => probesOf(p, p.modules.find((y) => y.id === x.id) ?? x));
    const xs = mine.map((x) => bases.find((b) => b.id === x.id)).filter((x): x is T => !!x && !used.has(x.id));
    for (const x of xs) used.add(x.id);
    if (xs.length) out.set(m.id, xs);
  }
  return out;
}

/** Docks for a run of boards: in pairs back to back where that costs little plug access, else one per dock; a
 * board with debug probes gets its probe stack in the back slot, and any more of its probes a dock right after it. */
function docksFor<T extends Module>(p: Project, mods: T[], railDir: 'h' | 'v', out: RailMount[], backs = new Map<string, T>(), extras = new Map<string, T[]>()) {
  const companions = (m: T) => {
    const xs = extras.get(m.id) ?? [];
    for (let k = 0; k < xs.length; k += 2) {
      const a = bestDock(xs[k], railDir, 0), b = xs[k + 1] ? bestDock(xs[k + 1], railDir, 1, [a.turn]) : null;
      out.push({ id: `auto${out.length}`, rail: '', at: null, kind: 'dock', turn: a.turn, slots: [{ module: xs[k].id, edge: a.edge }, b ? { module: xs[k + 1].id, edge: b.edge } : { module: null, edge: 'auto' }] });
    }
  };
  // each board standing up or lying flat, as the rack's setting asks (or whichever suits it, on auto)
  const best = mods.map((m) => bestSeat(m, railDir, p.panel.lie, 0));
  const lieOf = (o: Orientation) => (o.lie ? { lie: o.lie } : {});
  const used = new Set<number>();
  mods.forEach((m, i) => {
    if (used.has(i)) return;
    used.add(i);
    const lie = best[i].lie;
    const back = backs.get(m.id);
    if (back) {
      // the turn that suits the board and its probes together (the probes stand, even behind a board lying flat);
      // nothing may point into the table
      let pick: { turn: Turn; a: Orientation; b: Orientation; s: number } | null = null;
      for (const t of TURNS) {
        const a = bestDock(m, railDir, 0, [t], EDGES, lie), b = bestDock(back, railDir, 1, [t]);
        const s = a.score + b.score - (a.access.some((x) => x.ok === 'blocked') || b.access.some((x) => x.ok === 'blocked') ? 1000 : 0);
        if (!pick || s > pick.s + 1e-9) pick = { turn: t, a, b, s };
      }
      out.push({ id: `auto${out.length}`, rail: '', at: null, kind: 'dock', turn: pick!.turn, slots: [{ module: m.id, edge: pick!.a.edge, ...lieOf(pick!.a) }, { module: back.id, edge: pick!.b.edge }] });
      companions(m);
      return;
    }
    let pick: { j: number; turn: Turn; a: Orientation; b: Orientation } | null = null;
    if (p.panel.pairs) {
      let bestLoss = 1.5;
      mods.forEach((m2, j) => {
        // two boards share a dock back to back when both stand or both lie flat (ears back to back)
        if (used.has(j) || j <= i || backs.has(m2.id) || best[j].lie !== lie) return;
        for (const t of TURNS) {
          const a = bestDock(m, railDir, 0, [t], EDGES, lie), b = bestDock(m2, railDir, 1, [t], EDGES, lie);
          if (a.access.some((x) => x.ok === 'blocked') || b.access.some((x) => x.ok === 'blocked')) continue;
          const loss = best[i].score + best[j].score - a.score - b.score;
          if (loss < bestLoss - 1e-9) { bestLoss = loss; pick = { j, turn: t, a, b }; }
        }
      });
    }
    if (pick) {
      const pk = pick as { j: number; turn: Turn; a: Orientation; b: Orientation };
      used.add(pk.j);
      out.push({ id: `auto${out.length}`, rail: '', at: null, kind: 'dock', turn: pk.turn, slots: [{ module: m.id, edge: pk.a.edge, ...lieOf(pk.a) }, { module: mods[pk.j].id, edge: pk.b.edge, ...lieOf(pk.b) }] });
      companions(m); companions(mods[pk.j]);
    } else {
      out.push({ id: `auto${out.length}`, rail: '', at: null, kind: 'dock', turn: best[i].turn, slots: [{ module: m.id, edge: best[i].edge, ...lieOf(best[i]) }, { module: null, edge: 'auto' }] });
      companions(m);
    }
  });
}

/** Boards in an order that keeps connected ones next to each other (walks the connection graph). */
export function orderByLinks<T extends Module>(p: Project, mods: T[]): T[] {
  const links = p.links ?? [];
  if (!links.length) return mods;
  const deg = new Map(mods.map((m) => [m.id, links.filter((l) => l.a.module === m.id || l.b.module === m.id).length]));
  const nb = (id: string) => links.flatMap((l) => (l.a.module === id ? [l.b.module] : l.b.module === id ? [l.a.module] : []));
  const left = new Set(mods.map((m) => m.id)), out: T[] = [];
  while (left.size) {
    // start from the best-connected board left, then follow its connections
    let cur = [...left].sort((a, b) => (deg.get(b) ?? 0) - (deg.get(a) ?? 0))[0];
    while (cur) {
      left.delete(cur);
      out.push(mods.find((m) => m.id === cur)!);
      cur = nb(cur).filter((id) => left.has(id)).sort((a, b) => (deg.get(b) ?? 0) - (deg.get(a) ?? 0))[0];
    }
  }
  return out;
}

/** Friendly name of a dock turn on a rail, e.g. "standing, parts face left". */
export function turnLabel(turn: number, railDir: 'h' | 'v', kind: 'dock' | 'flat' = 'dock', lie?: 'flat'): string {
  if (kind === 'flat') return `flat, turned ${turn}°`;
  if (lie === 'flat') return `lying flat, turned ${turn}°`;
  // component side of the front slot: hub +y turned by `turn`
  const v = dir(mul(railMatrix({ x: 0, y: 0, dir: railDir }), rotZ(turn)), [0, 1, 0]);
  const face = classify(v, railDir).dir;
  const standing = face === 'left' || face === 'right';
  return `${standing ? 'standing' : 'shelf'}, parts face ${face}`;
}

/** Put a board on the panel in a new dock at the end of the last rail (manual layouts). */
export function appendDock(p: Project, moduleId: string) {
  const P = p.panel;
  for (const mt of P.mounts) for (const sl of mt.slots) if (sl.module === moduleId) sl.module = null;
  const m0 = p.modules.find((x) => x.id === moduleId);
  if (!m0 || isPlugPack(m0.board)) return; // a plug pack lives in an outlet, off the rails
  const m = withRiders(p, m0);
  let rail = P.rails[P.rails.length - 1];
  if (!rail) { rail = { id: 'r1', x: 0, y: 0, dir: P.rowDir, length: null }; P.rails.push(rail); }
  const o = bestDock(m, rail.dir, 0);
  P.mounts.push({ id: uid('d'), rail: rail.id, at: null, place: 'free', kind: 'dock', turn: o.turn, slots: [{ module: moduleId, edge: o.edge }, { module: null, edge: 'auto' }] });
}

/**
 * Put a new board on a rack laid out by hand or built: into a free slot of a dock already there when it docks well in
 * it (the dock keeps its turn, and none of the board's plugs ends up blocked), so all there is to print is its holder;
 * a dock beside a board it is cabled to first, then the one where its plugs are easiest to reach. Else a new dock at
 * the end of the last rail. Boxes (hubs, chargers) and docks with a board lying flat are left out. Says which it did.
 */
export function seatBoard(p: Project, moduleId: string): { where: 'slot' | 'new'; mount: string } {
  const P = p.panel, m0 = p.modules.find((x) => x.id === moduleId);
  const fresh = () => { appendDock(p, moduleId); return { where: 'new' as const, mount: P.mounts[P.mounts.length - 1]?.id ?? '' }; };
  if (!m0 || m0.board.kind === 'box' || m0.on) return fresh();
  const m = withRiders(p, m0);
  const cabled = new Set((p.links ?? []).flatMap((l) => (l.a.module === moduleId ? [l.b.module] : l.b.module === moduleId ? [l.a.module] : [])));
  let best: { mt: RailMount; k: number; score: number } | null = null;
  for (const mt of P.mounts) {
    if (mt.kind !== 'dock' || mt.slots.some((s) => s.lie === 'flat')) continue;
    const k = mt.slots.findIndex((s) => !s.module);
    const rail = P.rails.find((r) => r.id === mt.rail);
    if (k < 0 || !rail) continue;
    const o = bestDock(m, rail.dir, k, [mt.turn]);
    if (o.access.some((a) => a.ok === 'blocked')) continue;
    // beside a board it is cabled to, its cables stay short
    const score = o.score + (mt.slots.some((s) => s.module && cabled.has(s.module)) ? 5 : 0);
    if (!best || score > best.score + 1e-9) best = { mt, k, score };
  }
  if (!best) return fresh();
  for (const mt of P.mounts) for (const sl of mt.slots) if (sl.module === moduleId) sl.module = null;
  best.mt.slots[best.k] = { module: moduleId, edge: 'auto' };
  return { where: 'slot', mount: best.mt.id };
}

/** Where seatCompanion put a probe: behind its own board, in the free slot of another dock on that rail, or in a new
 * dock (the generator finds it a gap, else the end of a rail). `rail`: the rail it went on, when known. */
export interface Seated { where: 'home' | 'near' | 'new'; mount: string; rail: string | null; beside?: string }

/**
 * Put a probe or adapter behind the board it serves (laid-out or built racks): into the free slot of that board's
 * dock, so all that is new to print is its own slot holder; else the free slot of the nearest dock on that rail; else a
 * new dock at the end of the rail. Says where it went.
 */
export function seatCompanion(p: Project, moduleId: string): Seated {
  const P = p.panel, m = p.modules.find((x) => x.id === moduleId);
  const t = m && targetOf(p, m), tb = t && baseOf(p, t);
  const home = tb && P.mounts.find((mt) => mt.kind === 'dock' && mt.slots.some((s) => s.module === tb.id));
  const put = (mt: RailMount) => { const k = mt.slots.findIndex((s) => !s.module); if (k < 0) return false; for (const x of P.mounts) for (const sl of x.slots) if (sl.module === moduleId) sl.module = null; mt.slots[k] = { module: moduleId, edge: 'auto' }; return true; };
  if (home && put(home)) return { where: 'home', mount: home.id, rail: home.rail };
  if (home) {
    const near = P.mounts.filter((mt) => mt !== home && mt.kind === 'dock' && mt.rail === home.rail && mt.slots.some((s) => !s.module)).sort((a, b) => Math.abs((a.at ?? 0) - (home.at ?? 0)) - Math.abs((b.at ?? 0) - (home.at ?? 0)));
    if (near[0] && put(near[0])) return { where: 'near', mount: near[0].id, rail: near[0].rail, beside: near[0].slots.find((s) => s.module && s.module !== moduleId)?.module ?? undefined };
  }
  appendDock(p, moduleId);
  const mt = P.mounts[P.mounts.length - 1];
  return { where: 'new', mount: mt.id, rail: mt.rail };
}

/**
 * After cables change on a rack laid out by hand or built: a probe or adapter now cabled to a board goes behind it.
 * One stacked on another probe leaves its own dock; one alone in a dock of its own (a J-Link added from the library
 * gets one) moves into the free slot of its board's dock, or of a dock beside it on that rail. A probe that is part of
 * the built rack stays where it is, and one with nowhere better to go stays put. Docks it leaves empty go. Returns the
 * probes that moved.
 */
export function seatCompanions(p: Project): string[] {
  if (p.layout !== 'panel' || p.panel.auto) return [];
  const P = p.panel, moved: string[] = [];
  const built = new Set(p.built?.boards ?? []);
  const lone = (mt: RailMount, id: string) => mt.slots.every((s) => !s.module || s.module === id);
  for (const m of p.modules) {
    if (!isProbe(m) || built.has(m.id)) continue;
    const t = targetOf(p, m), tb = t && baseOf(p, t);
    if (!tb) continue;
    const own = P.mounts.find((mt) => mt.slots.some((s) => s.module === m.id));
    if (m.on) {
      // stacked on another probe: it rides on that one's holder
      if (!own) continue;
      for (const sl of own.slots) if (sl.module === m.id) sl.module = null;
      if (lone(own, m.id)) P.mounts.splice(P.mounts.indexOf(own), 1);
      moved.push(m.id);
      continue;
    }
    const home = P.mounts.find((mt) => mt.kind === 'dock' && mt.slots.some((s) => s.module === tb.id));
    if (!home || own === home || (own && !lone(own, m.id))) continue;
    const room = (mt: RailMount) => mt.kind === 'dock' && mt !== own && mt.slots.some((s) => !s.module);
    const nearby = P.mounts.filter((mt) => mt.rail === home.rail && room(mt) && mt !== home && Math.abs((mt.at ?? 0) - (home.at ?? 0)) < 120);
    if (!room(home) && !nearby.length) continue;
    seatCompanion(p, m.id);
    if (own && lone(own, '')) P.mounts.splice(P.mounts.indexOf(own), 1);
    moved.push(m.id);
  }
  return moved;
}

/** Take out docks with nothing in them that `before` did not already have empty (a move left them behind). */
export function dropEmptied(p: Project, before: Project) {
  const wasEmpty = new Set(before.panel.mounts.filter((mt) => mt.slots.every((s) => !s.module)).map((mt) => mt.id));
  p.panel.mounts = p.panel.mounts.filter((mt) => mt.slots.some((s) => s.module) || wasEmpty.has(mt.id) || !before.panel.mounts.some((b) => b.id === mt.id));
}

/** A laid-out mount's reach along its rail, from its position `at`: [start, end] (holders, boards and all). */
export function alongExtent(rep: PanelReport, mountId: string): [number, number] | null {
  const m = rep.mounts.find((x) => x.id === mountId), r = m && rep.rails.find((x) => x.id === m.rail);
  if (!m || !r) return null;
  return r.dir === 'h' ? [m.foot[0] - m.x, m.foot[2] - m.x] : [m.foot[1] - m.y, m.foot[3] - m.y];
}

/**
 * The spot nearest `at` on a rail where a mount clears everything else on that rail by `clear` mm (a dock dropped
 * onto another one slides to the gap beside it). Only the rail's own mounts are looked at; the rest of the rack
 * stays where it is. Returns `at` itself when it is already clear, or when nothing is.
 */
export function nearestFree(rep: PanelReport, mountId: string, railId: string, at: number, clear = 2): number {
  const me = alongExtent(rep, mountId);
  if (!me) return at;
  const others = rep.mounts.filter((o) => o.rail === railId && o.id !== mountId).map((o) => { const e = alongExtent(rep, o.id)!; return [o.at + e[0] - clear, o.at + e[1] + clear]; });
  const ok = (a: number) => a + me[0] >= -0.01 && others.every(([lo, hi]) => a + me[1] <= lo + 0.01 || a + me[0] >= hi - 0.01);
  const cands = [at, ...others.flatMap(([lo, hi]) => [hi - me[0], lo - me[1]]), -me[0]].filter(ok);
  return cands.length ? cands.reduce((b, a) => (Math.abs(a - at) < Math.abs(b - at) ? a : b)) : at;
}

/**
 * On a built rack: a board added since that went into a free slot of a built dock, where it now reaches over the dock
 * beside it, goes into a dock of its own instead (the generator finds it a free gap, else the end of a rail), so no
 * built dock has to slide along. Returns the ids of the boards it moved. Pure: uses what the last build measured.
 */
export function ownDocks(p: Project, rep: PanelReport): string[] {
  const b = p.built;
  if (!b) return [];
  const built = new Set(b.boards), builtMounts = new Set(Object.keys(b.mounts ?? {}));
  const mountOf = (id: string) => rep.mounts.find((x) => x.id === id) ?? rep.mounts.find((x) => x.id === rep.modules.find((q) => q.id === id)?.mount);
  const out: string[] = [];
  for (const pair of rep.collisions) {
    const ms = pair.map(mountOf);
    if (!ms[0] || !ms[1] || ms[0].rail !== ms[1].rail) continue;
    for (const mt of ms) {
      // a dock that was there when it was built (racks built before docks' places were kept: one with a built board in it)
      if (!(builtMounts.has(mt!.id) || mt!.slots.some((s) => s.module && built.has(s.module)))) continue;
      for (const s of mt!.slots) if (s.module && !built.has(s.module) && !out.includes(s.module)) out.push(s.module);
    }
  }
  for (const id of out) appendDock(p, id);
  return out;
}

/**
 * Tidy a rack laid out by hand: along each rail, in the order the mounts are in, slide each one on just far enough to
 * clear the one before it by `clear` mm. Nothing that already clears moves, and nothing changes rail, turn or slot.
 * Returns the ids of the mounts that moved. Pure: uses the positions the last build measured.
 */
export function spreadOut(p: Project, rep: PanelReport, clear = 2, rails?: string[]): string[] {
  const moved: string[] = [];
  for (const r of p.panel.rails) {
    if (rails && !rails.includes(r.id)) continue;
    const on = p.panel.mounts.filter((m) => m.rail === r.id && m.at != null && alongExtent(rep, m.id)).sort((a, b) => a.at! - b.at!);
    let cursor = -Infinity;
    for (const m of on) {
      const [lo, hi] = alongExtent(rep, m.id)!;
      if (m.at! + lo < cursor - 0.05) { m.at = Math.round((cursor - lo) * 10) / 10; moved.push(m.id); }
      cursor = Math.max(cursor, m.at! + hi + clear);
    }
  }
  return moved;
}

/**
 * Slide rails apart across, where something docked on one reaches over the next rail's docks (a board laid flat reaches
 * across its rail, further than it stood): of each overlapping pair on two parallel rails, the rail further from the
 * first rail moves away from it just far enough to clear the other by `clear` mm, and every rail beyond it on that side
 * moves with it, so the gaps between them stay as they were. Rails at right angles to the first (an L-shape) and rails
 * in line with it are left alone. Returns the ids of the rails that moved. Pure: uses what the last build measured.
 */
export function spreadRails(p: Project, rep: PanelReport, clear = 2): string[] {
  const first = p.panel.rails[0];
  if (!first) return [];
  const ax = first.dir === 'h' ? 1 : 0; // across the rails: y for rails along x
  const across = (r: { x: number; y: number }) => (ax ? r.y : r.x);
  const off = (r: { x: number; y: number }) => across(r) - across(first);
  const shift = new Map<string, number>(); // how far each rail has moved across so far
  const railOf = (id: string) => { const mt = rep.mounts.find((m) => m.id === id) ?? rep.mounts.find((m) => m.id === rep.modules.find((q) => q.id === id)?.mount); return mt && p.panel.rails.find((r) => r.id === mt.rail && r.dir === first.dir); };
  const footOf = (id: string) => rep.modules.find((q) => q.id === id)?.foot ?? rep.mounts.find((m) => m.id === id)?.foot;
  const pairs = rep.collisions.map(([a, b]) => ({ ra: railOf(a), rb: railOf(b), fa: footOf(a), fb: footOf(b) }))
    .filter((q) => q.ra && q.rb && q.fa && q.fb && q.ra !== q.rb && Math.abs(off(q.ra) - off(q.rb)) > 1)
    .map((q) => (Math.abs(off(q.ra!)) > Math.abs(off(q.rb!)) ? { near: q.rb!, far: q.ra!, ff: q.fa!, fn: q.fb! } : { near: q.ra!, far: q.rb!, ff: q.fb!, fn: q.fa! }))
    .sort((a, b) => Math.abs(off(a.far)) - Math.abs(off(b.far)));
  for (const { near, far, ff, fn } of pairs) {
    const side = Math.sign(off(far) - off(near)) || 1;
    // where the two reach across now, after the moves so far
    const sf = shift.get(far.id) ?? 0, sn = shift.get(near.id) ?? 0;
    const need = side > 0 ? fn[ax + 2] + sn + clear - (ff[ax] + sf) : ff[ax + 2] + sf + clear - (fn[ax] + sn);
    if (need <= 0.05) continue;
    const s = Math.round(need * 10) / 10 + 0.1;
    for (const r of p.panel.rails) {
      if (r.dir !== first.dir || Math.sign(off(r) - off(near)) !== side || Math.abs(off(r)) < Math.abs(off(far)) - 0.5) continue;
      shift.set(r.id, (shift.get(r.id) ?? 0) + side * s);
    }
  }
  const moved: string[] = [];
  for (const r of p.panel.rails) {
    const s = shift.get(r.id);
    if (!s) continue;
    if (ax) r.y = Math.round((r.y + s) * 10) / 10; else r.x = Math.round((r.x + s) * 10) / 10;
    moved.push(r.id);
  }
  return moved;
}

export { I4 };
