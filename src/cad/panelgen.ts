// Panel mode: boards in docks (or flat clips) on DIN rails. Builds every holder, places each mount on its rail
// with the real 3D extents (so plugs and cradles never collide), starts new rows when a rail is full, and
// reports plug access, collisions, rail lengths and the parts list.
import type { Anim, Check, EdgeName, Feature, GenResult, Ghost, Link, MeshData, Module, Motion, PanelReport, PartOut, PickTag, Project, Rail, RailMount, V2 } from '../model/types';

const CABLE_ORDER: NonNullable<Link['kind']>[] = ['power', 'usb', 'net', 'video', 'audio', 'wire'];
// assembly steps after every board's (boards use 300 + 10 per seat): cables, the other plugs, caps
const CABLE_SEQ = 1e6, PLUG_SEQ = 1e6 + 90, CAP_SEQ = 1e6 + 100;
import { MATERIALS } from '../model/library';
import { bbox, round } from '../geom/poly';
import { basis, dir, I4, inv, mul, pt as ptM, rotZ, tr, type M4 } from '../geom/mat';
import { smooth, sphereMesh, tubeMesh } from './boardviz';
import { baseRef, cableToBuy, KIND_COLOR, KIND_NAME } from '../model/links';
import { buildModule, computeLevels, transformMesh, type ArrangeHooks, type ModuleOut } from './generate';
import { baseOf, ridersOf, stackLayers, type StackLayer } from '../model/holes';
import { freeAll, toMesh, type MF } from './kernel';
import { END_POSE, LEN_X, rail as railSolid, shoe, shoeBody, shoeLever, socket, SOCKET_Z } from './dock';
import { autoAssign, bestDock, classify, clipToRail, dockSite, plugDirs, railMatrix, slotMatrix, withRiders } from './dockplan';
import { capStress, pieceMesh, planStands, railI, standBoxes, STAND, type StandLane } from './railstand';
import { assemble, bestRoute, escapes, hits, slope, type CableEnd, type Choice, type Obstacle, type Route } from './cableroute';

const SHOE_BOX = { x: [-LEN_X / 2, LEN_X / 2], y: [-29, 29], z: [0, 42.8] };

interface Layer { mod: Module; mi: number; out: ModuleOut; T: M4 } // a board stacked on the seat's board: T = its holder -> base holder frame
interface Seat { mod: Module; mi: number; slot: number; edge: EdgeName; out: ModuleOut; M: M4; above: Layer[]; riders: Module[] }
interface Placed { mt: RailMount; seats: Seat[]; lo: number; hi: number; ylo: number; yhi: number; zhi: number; boxes: { id: string; b: number[] }[]; lever: 1 | -1 }

/**
 * Lane order in a cable street (lowest v first) with the fewest crossings: each cable drops into its lane at both
 * ends from the side its plug is on, crossing every lane between that side and its own where another cable runs
 * past. Exhaustive for up to 6 cables, the given order beyond that.
 */
export function laneOrder<T extends { a1: number[]; b1: number[] }>(rs: T[], c: number): T[] {
  if (rs.length < 2 || rs.length > 6) return rs;
  const span = (q: T) => [Math.min(q.a1[0], q.b1[0]), Math.max(q.a1[0], q.b1[0])];
  const crossings = (order: T[]) => {
    let n = 0;
    order.forEach((q, i) => {
      for (const e of [q.a1, q.b1]) {
        const below = e[1] < c; // drops in from the low-v side
        order.forEach((o, j) => {
          if (o === q || (below ? j >= i : j <= i)) return;
          const [u0, u1] = span(o);
          if (e[0] > u0 + 0.5 && e[0] < u1 - 0.5) n++;
        });
      }
    });
    return n;
  };
  let best = rs, bestN = crossings(rs);
  const perm = (done: T[], rest: T[]) => {
    if (!bestN) return;
    if (!rest.length) { const n = crossings(done); if (n < bestN) { best = done; bestN = n; } return; }
    rest.forEach((q, i) => perm([...done, q], [...rest.slice(0, i), ...rest.slice(i + 1)]));
  };
  perm([], rs);
  return best;
}

/** Move a part's animation into another frame. */
export const moveAnim = (a: Anim | undefined, T: M4): Anim | undefined => (a ? { ...a, dir: dir(T, a.dir), pre: a.pre?.map((m) => ({ ...m, dir: dir(T, m.dir) })) } : undefined);

/** Stack towers: corner points round every printed layer (each in its own frame) and the layer heights. The two
 * towers on a docked base's dock side are pulled back inside the dock face. */
function stackPlan(p: Project, layers: StackLayer[], dockEdge: EdgeName | null) {
  const facts = layers.map((L) => {
    const m = L.mod, bb = bbox(m.board.outline), gw = m.holder.gap + m.holder.wall, lv = computeLevels(m.board, m.holder);
    let top = lv.topMax;
    for (const bo of L.bolted) top = Math.max(top, lv.zt + bo.dz + bo.mod.board.thickness + Math.max(0, ...bo.mod.board.comps.filter((c) => !c.hidden && c.side === 'top').map((c) => c.h)));
    return { bb, gw, lv, top };
  });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  layers.forEach((L, i) => { const f = facts[i]; x0 = Math.min(x0, L.dx + f.bb.x0 - f.gw); y0 = Math.min(y0, L.dy + f.bb.y0 - f.gw); x1 = Math.max(x1, L.dx + f.bb.x1 + f.gw); y1 = Math.max(y1, L.dy + f.bb.y1 + f.gw); });
  let common: V2[] = [[x0 - 3.3, y0 - 3.3], [x1 + 3.3, y0 - 3.3], [x1 + 3.3, y1 + 3.3], [x0 - 3.3, y1 + 3.3]];
  if (dockEdge) {
    const n = ({ bottom: [0, -1], top: [0, 1], left: [-1, 0], right: [1, 0] } as Record<EdgeName, V2>)[dockEdge];
    const b0 = layers[0].mod.board, face = Math.max(...b0.outline.map((q) => q[0] * n[0] + q[1] * n[1])) + facts[0].gw;
    common = common.map((c) => { const over = c[0] * n[0] + c[1] * n[1] - (face - 4); return over > 0 ? [c[0] - n[0] * over, c[1] - n[1] * over] as V2 : c; });
  }
  let z = 0;
  return layers.map((L, i) => {
    const f = facts[i];
    const height = Math.max(f.top + p.arrange.stackGap, f.lv.zw + 1);
    const hooks: ArrangeHooks = { towers: { pts: common.map(([x, y]) => [x - L.dx, y - L.dy] as V2), height, peg: i < layers.length - 1, socket: i > 0 } };
    const T = tr(L.dx, L.dy, z);
    z += height;
    return { hooks, T };
  });
}

const boltedOf = (L: StackLayer) => L.bolted.map((bo) => ({ b: bo.mod.board, dx: bo.dx, dy: bo.dy, dz: bo.dz, mid: bo.mod.id }));

let shoeRest: (ReturnType<typeof rest> & { body: MeshData; lever: MeshData }) | null = null, sockRest: ReturnType<typeof rest> | null = null;

/** The shoe in its print pose, plus its body and its lever alone in the same frame (shown in two colours). */
function shoeRested() {
  const all = shoe();
  const r = rest(all, END_POSE.pose);
  const dz = -all.transform(END_POSE.pose as any).boundingBox().min[2]; // the rest translation
  const place = (m: MF) => toMesh(m.transform(END_POSE.pose as any).translate([0, 0, dz]));
  return { ...r, body: place(shoeBody()), lever: place(shoeLever()) };
}

function rest(m: MF, pose: M4): { mesh: MeshData; back: M4; volume: number; size: [number, number, number] } {
  const pm = m.transform(pose as any);
  const bb = pm.boundingBox();
  const moved = pm.translate([0, 0, -bb.min[2]]);
  return { mesh: toMesh(moved), back: mul(inv(pose), tr(0, 0, bb.min[2])), volume: m.volume(), size: [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]] };
}

function boxOf(pos: Float32Array, M: M4, b: number[]) {
  for (let k = 0; k < pos.length; k += 3) {
    const x = pos[k], y = pos[k + 1], z = pos[k + 2];
    const X = M[0] * x + M[4] * y + M[8] * z + M[12], Y = M[1] * x + M[5] * y + M[9] * z + M[13], Z = M[2] * x + M[6] * y + M[10] * z + M[14];
    if (X < b[0]) b[0] = X; if (X > b[3]) b[3] = X;
    if (Y < b[1]) b[1] = Y; if (Y > b[4]) b[4] = Y;
    if (Z < b[2]) b[2] = Z; if (Z > b[5]) b[5] = Z;
  }
}
const emptyBox = () => [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
const railCache = new Map<number, MeshData>();
function railMesh(len: number): MeshData {
  let m = railCache.get(len);
  if (!m) { m = toMesh(railSolid(len)); railCache.set(len, m); if (railCache.size > 32) railCache.delete(railCache.keys().next().value!); }
  return m;
}

/** Rail-frame box (x along, y across, z out) -> panel-frame box [x0, y0, x1, y1] and z1. */
function toPanel(r: Rail, at: number, b: number[]): [number, number, number, number] {
  if (r.dir === 'h') return [r.x + at + b[0], r.y + b[1], r.x + at + b[3], r.y + b[4]];
  return [r.x - b[4], r.y + at + b[0], r.x - b[1], r.y + at + b[3]];
}

export function generatePanel(p: Project): GenResult {
  const t0 = Date.now();
  const P = p.panel;
  const warnings: string[] = [], checks: Check[] = [];
  const mods = new Map(p.modules.map((m, i) => [m.id, { m, i }]));
  const mat = MATERIALS[p.modules[0]?.holder.material ?? 'PETG'];

  let mounts: RailMount[] = P.auto ? autoAssign(p) : structuredClone(P.mounts);
  let rails: Rail[] = P.auto ? [] : structuredClone(P.rails);
  const railOf = (mt: RailMount) => rails.find((r) => r.id === mt.rail);
  if (!P.auto) {
    for (const mt of mounts) if (!railOf(mt)) warnings.push(`A ${mt.kind === 'dock' ? 'dock' : 'flat clip'} sits on a rail that no longer exists; it was left out.`);
    mounts = mounts.filter((mt) => railOf(mt));
  }
  // boards stacked on another board ride with it: they never take a slot of their own
  const rider = (id: string | null) => { const m = id ? mods.get(id)?.m : null; return !!m && baseOf(p, m) !== m; };
  for (const mt of mounts) for (const sl of mt.slots) if (rider(sl.module)) sl.module = null;
  const placedIds = new Set(mounts.flatMap((mt) => mt.slots.map((s) => s.module)).filter(Boolean) as string[]);
  for (const id of [...placedIds]) for (const r of ridersOf(p, mods.get(id)!.m)) placedIds.add(r.id);
  const unplaced = p.modules.filter((m) => !placedIds.has(m.id)).map((m) => m.id);
  if (unplaced.length) warnings.push(`${unplaced.length} board${unplaced.length > 1 ? 's are' : ' is'} not on a rail yet: drag ${unplaced.length > 1 ? 'them' : 'it'} onto a rail in the Rails step, or press Auto-arrange.`);

  // ---- build every seated holder ----
  const failed: string[] = [];
  const placed: Placed[] = [];
  for (const mt of mounts) {
    const railDir = P.auto ? P.rowDir : railOf(mt)!.dir;
    const seats: Seat[] = [];
    mt.slots.forEach((sl, slot) => {
      if (!sl.module || (mt.kind === 'flat' && slot > 0)) return;
      const hit = mods.get(sl.module);
      if (!hit) return;
      const { m, i } = hit;
      const edge: EdgeName = sl.edge === 'auto' ? bestDock(withRiders(p, m), railDir, slot, [mt.turn]).edge : sl.edge;
      try {
        const layers = stackLayers(p, m);
        const riders = ridersOf(p, m);
        const plan = layers.length > 1 ? stackPlan(p, layers, mt.kind === 'dock' ? edge : null) : null;
        const out = buildModule({
          p, mi: i, b: m.board, H: m.holder, din: mt.kind === 'flat', stand: false, hooks: plan?.[0].hooks ?? {}, name: m.board.name, bolted: boltedOf(layers[0]),
          dock: mt.kind === 'dock' ? { edge, fit: P.fit ?? 0 } : undefined,
          mount: mt.kind === 'flat' ? { ...p.mount, kind: 'din', mode: 'flat', rotation: mt.turn, at: null } : undefined,
        });
        const M = mt.kind === 'dock' ? slotMatrix(mt.turn, slot, out.dockM!) : mul(clipToRail(p.mount.clipWidth), inv(out.clipT ?? I4));
        const above: Layer[] = layers.slice(1).map((L, k) => {
          const r = L.mod, ri = mods.get(r.id)!.i;
          return { mod: r, mi: ri, T: plan![k + 1].T, out: buildModule({ p, mi: ri, b: r.board, H: r.holder, din: false, stand: false, hooks: plan![k + 1].hooks, name: r.board.name, level: k + 1, bolted: boltedOf(L) }) };
        });
        if (mt.kind === 'dock' && riders.length && dockSite(m.board, m.holder, edge).side === 0 && Math.min(...[m, ...riders].map((x) => { const b = bbox(x.board.outline); return Math.min(b.x1 - b.x0, b.y1 - b.y0); })) < 30) warnings.push(`${m.board.name}: the stack's corner towers are close to the dock's release button; check them in 3D.`);
        seats.push({ mod: m, mi: i, slot, edge, out, M, above, riders });
      } catch (e: any) {
        failed.push(`${m.board.name}: ${e?.message ?? e}`);
      }
    });
    // extents in the rail frame with the mount at 0
    const all = emptyBox();
    const boxes: Placed['boxes'] = [];
    if (mt.kind === 'dock') {
      const sb = [SHOE_BOX.x[0], SHOE_BOX.y[0], SHOE_BOX.z[0], SHOE_BOX.x[1], SHOE_BOX.y[1], SHOE_BOX.z[1]];
      boxes.push({ id: '', b: sb });
      for (let k = 0; k < 3; k++) { all[k] = Math.min(all[k], sb[k]); all[k + 3] = Math.max(all[k + 3], sb[k + 3]); }
    }
    for (const s of seats) {
      const b = emptyBox();
      for (const pt of s.out.parts) boxOf(pt.mesh.pos, mul(s.M, pt.toAssembly), b);
      for (const g of s.out.ghosts) if (!g.name.startsWith('DIN rail')) boxOf(g.mesh.pos, s.M, b);
      for (const L of s.above) {
        for (const pt of L.out.parts) boxOf(pt.mesh.pos, mul(s.M, L.T, pt.toAssembly), b);
        for (const g of L.out.ghosts) boxOf(g.mesh.pos, mul(s.M, L.T), b);
      }
      boxes.push({ id: s.mod.id, b });
      for (let k = 0; k < 3; k++) { all[k] = Math.min(all[k], b[k]); all[k + 3] = Math.max(all[k + 3], b[k + 3]); }
    }
    if (!isFinite(all[0])) { all.splice(0, 6, -LEN_X / 2, -20, 0, LEN_X / 2, 20, 30); }
    // release lever on the side where the boards overhang the shoe least (easiest to reach)
    const mb = boxes.filter((bx) => bx.id);
    const over = (sgn: number) => Math.max(0, ...mb.map((bx) => (sgn > 0 ? bx.b[4] : -bx.b[1]) - 20));
    const lever: 1 | -1 = mt.lever === 'pos' ? 1 : mt.lever === 'neg' ? -1 : over(-1) < over(1) - 0.5 ? -1 : 1;
    placed.push({ mt, seats, lo: all[0], hi: all[3], ylo: all[1], yhi: all[4], zhi: all[5], boxes, lever });
  }
  if (failed.length) warnings.push(...failed);

  // ---- positions along the rails ----
  const margin = 8, gap = P.gap;
  if (P.auto) {
    let row: Placed[] = [];
    const rows: Placed[][] = [];
    let cursor = margin;
    const isBox = (pl: Placed) => pl.seats.some((st) => st.mod.board.kind === 'box');
    for (const pl of placed) {
      const newKind = row.length && isBox(pl) && !isBox(row[row.length - 1]);
      if (row.length && (newKind || cursor + (pl.hi - pl.lo) > P.maxRail - margin)) { rows.push(row); row = []; cursor = margin; }
      pl.mt.at = cursor - pl.lo;
      cursor = pl.mt.at + pl.hi + gap;
      row.push(pl);
    }
    if (row.length) rows.push(row);
    let prev: { x: number; y: number; ylo: number; yhi: number } | null = null;
    rows.forEach((rw, k) => {
      const ylo = Math.min(...rw.map((q) => q.ylo)), yhi = Math.max(...rw.map((q) => q.yhi));
      const len = Math.max(...rw.map((q) => q.mt.at! + q.hi)) + margin;
      let x = 0, y = 0;
      if (prev) {
        if (P.rowDir === 'h') y = prev.y + prev.ylo - P.rowGap - yhi;
        else x = prev.x - prev.ylo + P.rowGap + yhi;
      }
      const r: Rail = { id: `r${k + 1}`, x, y, dir: P.rowDir, length: Math.ceil(len - 1e-6) };
      rails.push(r);
      rw.forEach((q, j) => { q.mt.rail = r.id; q.mt.id = `d${k + 1}.${j + 1}`; });
      prev = { x, y, ylo, yhi };
    });
    // on table stands the rails make a rectangle: every rail as long as the longest, so the sleepers run straight across
    if (P.stands !== false && rails.length > 1) { const L = Math.max(...rails.map((r) => r.length!)); for (const r of rails) r.length = L; }
    mounts = placed.map((q) => q.mt);
  } else {
    const free = (q: Placed) => q.mt.place === 'free' && q.mt.at == null;
    for (const r of rails) {
      const on = placed.filter((q) => q.mt.rail === r.id && !free(q));
      let cursor = margin;
      for (const q of on) {
        if (q.mt.at == null) q.mt.at = Math.max(cursor - q.lo, 0);
        cursor = q.mt.at + q.hi + gap;
      }
    }
    // a board added to a laid-out rack goes into the first gap that fits, on the rail of a board it is cabled to if it
    // can, without moving anything else; if nothing fits it goes on the end of the rail with the most room
    const end0 = P.stands !== false ? STAND.len - STAND.back + 1 : margin;
    /** The empty back (or front) slot of a dock already on the rack: no new shoe or socket, no rail to add. */
    const intoSlot = (q: Placed, liked: Set<string>): boolean => {
      const s0 = q.seats[0];
      if (q.mt.kind !== 'dock' || q.seats.length !== 1 || s0.riders.length || s0.above.length) return false;
      const docksWithRoom = placed.filter((o) => o !== q && o.mt.kind === 'dock' && o.mt.at != null && railOf(o.mt)?.dir === railOf(q.mt)?.dir && o.mt.slots.some((sl) => !sl.module) && o.seats.length === 1)
        .sort((a, b) => Number(liked.has(b.mt.rail)) - Number(liked.has(a.mt.rail)));
      const allBoxes = (skip: Placed) => placed.filter((o) => o !== q && o.mt.at != null && railOf(o.mt)).flatMap((o) => o.boxes.filter((bx) => o !== skip || bx.id).map((bx) => { const f = toPanel(railOf(o.mt)!, o.mt.at!, bx.b); return [f[0], f[1], bx.b[2], f[2], f[3], bx.b[5]]; }));
      for (const o of docksWithRoom) {
        const k = o.mt.slots.findIndex((sl) => !sl.module), r = railOf(o.mt)!;
        const bd = bestDock(withRiders(p, s0.mod), r.dir, k, [o.mt.turn]);
        if (bd.access.some((a) => a.ok === 'blocked')) continue;
        let out = s0.out;
        if (bd.edge !== s0.edge) {
          try { out = buildModule({ p, mi: s0.mi, b: s0.mod.board, H: s0.mod.holder, din: false, stand: false, hooks: {}, name: s0.mod.board.name, bolted: [], dock: { edge: bd.edge, fit: P.fit ?? 0 } }); } catch { continue; }
        }
        const M = slotMatrix(o.mt.turn, k, out.dockM!);
        const b = emptyBox();
        for (const pt of out.parts) boxOf(pt.mesh.pos, mul(M, pt.toAssembly), b);
        for (const g of out.ghosts) if (!g.name.startsWith('DIN rail')) boxOf(g.mesh.pos, M, b);
        const f = toPanel(r, o.mt.at!, b), me = [f[0], f[1], b[2], f[2], f[3], b[5]];
        // the holder must stay on the rail and clear of the stands' end blocks, like any other spot
        if (o.mt.at! + Math.min(o.lo, b[0]) < end0 - 0.01 || (r.length != null && o.mt.at! + Math.max(o.hi, b[3]) > r.length - end0 + 0.01)) continue;
        if (allBoxes(o).some((ob) => [0, 1, 2].every((j) => me[j] < ob[j + 3] - 0.3 && ob[j] < me[j + 3] - 0.3))) continue;
        o.seats.push({ ...s0, slot: k, edge: bd.edge, out, M });
        o.mt.slots = o.mt.slots.map((sl, j) => (j === k ? { module: s0.mod.id, edge: bd.edge } : sl));
        o.boxes.push({ id: s0.mod.id, b });
        o.lo = Math.min(o.lo, b[0]); o.hi = Math.max(o.hi, b[3]); o.ylo = Math.min(o.ylo, b[1]); o.yhi = Math.max(o.yhi, b[4]); o.zhi = Math.max(o.zhi, b[5]);
        placed.splice(placed.indexOf(q), 1);
        return true;
      }
      return false;
    };
    for (const q of placed.filter(free)) {
      const home = railOf(q.mt);
      const mine = new Set(q.seats.flatMap((s) => [s.mod.id, ...s.riders.map((x) => x.id)]));
      const partners = new Set((p.links ?? []).flatMap((l) => (mine.has(l.a.module) ? [l.b.module] : mine.has(l.b.module) ? [l.a.module] : [])));
      const railOfMod = (id: string) => placed.find((o) => o !== q && o.mt.at != null && o.seats.some((s) => s.mod.id === id))?.mt.rail;
      const liked = new Set([...partners].map(railOfMod).filter(Boolean) as string[]);
      if (intoSlot(q, liked)) continue;
      const cands = rails.filter((r) => r.dir === home?.dir);
      const w = q.hi - q.lo;
      // everything already placed, as panel-frame boxes: a spot must clear boards on the neighbouring rails too
      const others = placed.filter((o) => o !== q && o.mt.at != null && railOf(o.mt)).flatMap((o) => o.boxes.map((bx) => { const f = toPanel(railOf(o.mt)!, o.mt.at!, bx.b); return [f[0], f[1], bx.b[2], f[2], f[3], bx.b[5]]; }));
      const clear = (r: Rail, at: number) => q.boxes.every((bx) => {
        const f = toPanel(r, at, bx.b), me = [f[0], f[1], bx.b[2], f[2], f[3], bx.b[5]];
        return !others.some((o) => [0, 1, 2].every((k) => me[k] < o[k + 3] - 0.3 && o[k] < me[k + 3] - 0.3));
      });
      const spot = (r: Rail, fixedLength = true) => {
        const hiEnd = r.length != null && fixedLength ? r.length - end0 : Infinity;
        // start positions to try: the rail's start and just past the end of anything already placed (along this rail)
        const ends = others.map((o) => (r.dir === 'h' ? o[3] - r.x : o[4] - r.y) + gap);
        for (const s of [...new Set([end0, ...ends])].filter((s) => s >= end0).sort((a, b) => a - b)) if (s + w <= hiEnd && clear(r, s - q.lo)) return s;
        return null;
      };
      const order = [...cands].sort((a, b) => Number(liked.has(b.id)) - Number(liked.has(a.id)));
      let chosen = order.map((r) => ({ r, s: spot(r) })).find((x) => x.s != null);
      if (!chosen && cands.length) {
        // no gap: the first clear place past the end of a rail, on the rail that needs the least added
        const tail = (r: Rail) => spot(r, false) ?? Math.max(end0, ...placed.filter((o) => o !== q && o.mt.rail === r.id && o.mt.at != null).map((o) => o.mt.at! + o.hi + gap));
        const r = [...order].sort((a, b) => Number(liked.has(b.id)) - Number(liked.has(a.id)) || tail(a) + w - (a.length ?? 0) - (tail(b) + w - (b.length ?? 0)))[0];
        const s = tail(r), need = Math.ceil(s + w + end0 - 1e-6);
        if (r.length != null && need > r.length) { warnings.push(`There was no room on the rails for ${q.seats.map((x) => x.mod.board.name).join(' + ')}, so it went on the end of rail ${r.id.replace(/^r/, '')}, which now has to be ${need} mm long (it was ${r.length}). Cut a longer rail, or drag the board somewhere else in the Rails step.`); r.length = need; }
        chosen = { r, s };
      }
      if (chosen) { q.mt.rail = chosen.r.id; q.mt.at = chosen.s! - q.lo; }
    }
  }

  // ---- collisions (panel frame boxes of every module and shoe) ----
  const world: { id: string; mount: string; b: number[] }[] = [];
  for (const q of placed) {
    const r = railOf(q.mt)!;
    for (const bx of q.boxes) {
      const f = toPanel(r, q.mt.at!, bx.b);
      world.push({ id: bx.id || q.mt.id, mount: q.mt.id, b: [f[0], f[1], bx.b[2], f[2], f[3], bx.b[5]] });
    }
  }
  const collisions: string[][] = [];
  const nameOf = (id: string) => mods.get(id)?.m.board.name ?? `dock ${id}`;
  for (let i = 0; i < world.length; i++) for (let j = i + 1; j < world.length; j++) {
    const a = world[i], b = world[j];
    if (a.mount === b.mount) continue;
    const ov = [0, 1, 2].every((k) => a.b[k] < b.b[k + 3] - 0.3 && b.b[k] < a.b[k + 3] - 0.3);
    if (ov) collisions.push([a.id, b.id]);
  }
  for (const [a, b] of collisions) warnings.push(`${nameOf(a)} and ${nameOf(b)} overlap on the panel. Move one along its rail, turn it, or press Auto-arrange.`);

  // ---- rail lengths ----
  for (const r of rails) {
    const on = placed.filter((q) => q.mt.rail === r.id);
    const need = on.length ? Math.max(...on.map((q) => q.mt.at! + q.hi)) + margin : 50;
    const start = on.length ? Math.min(...on.map((q) => q.mt.at! + q.lo)) : 0;
    if (r.length == null) r.length = Math.ceil(Math.max(need, 50) - 1e-6);
    else if (start < -0.5) warnings.push(`Rail ${r.id.replace(/^r/, '')}: a mount hangs ${round(-start, 0)} mm off the start of the rail. Drag it along, or press Auto-arrange.`);
    else if (need - margin > r.length + 0.5) warnings.push(`Rail ${r.id.replace(/^r/, '')}: the mounts run past the end of the ${r.length} mm rail (need ${Math.ceil(need)} mm).`);
    else if (P.stands !== false && on.length && (start < STAND.len - STAND.back + 1 || need - margin > r.length - (STAND.len - STAND.back + 1))) warnings.push(`Rail ${r.id.replace(/^r/, '')}: a mount sits within ${STAND.len - STAND.back + 1} mm of a rail end, where the table stand's end block goes. Move it in or lengthen the rail.`);
  }

  // ---- parts ----
  const parts: PartOut[] = [], ghosts: Ghost[] = [], display: PartOut[] = [];
  const access: PanelReport['modules'] = [];
  const mountOut: PanelReport['mounts'] = [];
  const docks = placed.filter((q) => q.mt.kind === 'dock');
  const shoeInst: M4[] = [], sockInst: M4[] = [], dockIds: string[] = [];
  const features: Feature[] = [];
  const frames: Record<string, number[]> = {};
  const ends = new Map<string, { p: number[]; d: number[]; cable: number }>();
  // only links whose two boards are on the rack and still have that plug get a cable (and hold back their plugs)
  const hasRef = (id: string, ref: string) => !!mods.get(id)?.m.board.comps.some((c) => c.ref === baseRef(ref));
  const live = (p.links ?? []).filter((l) => placedIds.has(l.a.module) && placedIds.has(l.b.module) && hasRef(l.a.module, l.a.ref) && hasRef(l.b.module, l.b.ref));
  const linked = new Set(live.flatMap((l) => [`${l.a.module}/${l.a.ref}`, `${l.b.module}/${l.b.ref}`]));
  // assembly steps: stands 100-130, docks 200-210, each board 300 + 10k (+1 rod, +2 board, +3 stack, +4 into its dock),
  // cables CABLE_SEQ + kind (power first), then other plugs, then caps
  const steps: NonNullable<GenResult['steps']> = [];
  let seatNo = 0;
  const cableSeq = (k: Link['kind']) => CABLE_SEQ + CABLE_ORDER.indexOf(k ?? 'usb');
  const plugSeq = new Map(live.flatMap((l) => [[`${l.a.module}/${l.a.ref}`, cableSeq(l.kind)], [`${l.b.module}/${l.b.ref}`, cableSeq(l.kind)]] as [string, number][]));
  try {
    const sh = docks.length ? (shoeRest ??= shoeRested()) : null;
    const so = docks.length ? (sockRest ??= rest(socket(), END_POSE.pose)) : null;
    for (const q of placed) {
      const r = railOf(q.mt)!;
      const R = mul(railMatrix(r), tr(q.mt.at!, 0, 0));
      if (q.mt.kind === 'dock') {
        shoeInst.push(mul(R, rotZ(q.lever > 0 ? 0 : 180), sh!.back));
        sockInst.push(mul(R, tr(0, 0, SOCKET_Z), rotZ(q.mt.turn), so!.back));
        dockIds.push(q.mt.id);
      }
      for (const s of q.seats) {
        const T = mul(R, s.M);
        const layers = [{ mod: s.mod, out: s.out, T }, ...s.above.map((L) => ({ mod: L.mod, out: L.out, T: mul(T, L.T) }))];
        // assembly steps for this board, as you would do it: the release rod into the spine and the board into its
        // holder on the bench, then anything stacked on it, then the whole holder into its dock (or onto its clip)
        const b0 = 300 + 10 * seatNo++;
        const hasRod = layers[0].out.parts.some((pt) => pt.tag?.kind === 'rod');
        const stacked = layers.length > 1 || s.riders.length > 0;
        const IN: Motion = { seq: b0 + 4, dir: [0, 0, 1], dist: 70 };
        const nm = s.mod.board.name, box = s.mod.board.kind === 'box';
        if (hasRod) steps.push({ seq: b0 + 1, text: `Slide the release rod into the spine of the ${nm} holder.` });
        steps.push({ seq: b0 + 2, text: box ? `Set the ${nm} into its holder and strap it down with a hook-and-loop strap through the loops.` : `Snap the ${nm} into its holder: it clicks under the fingers or onto the pins.` });
        if (stacked) steps.push({ seq: b0 + 3, text: [...s.riders].map((x) => (layers.some((L) => L.mod === x) ? `Press the ${x.board.name} holder onto the corner towers.` : `Bolt the ${x.board.name} onto the ${nm} on its standoffs.`)).join(' ') });
        steps.push({ seq: b0 + 4, text: q.mt.kind === 'dock' ? `Push the ${nm} holder straight into its dock until the latch clicks.` : `Press the ${nm} holder onto its rail clip.` });
        layers.forEach((L, li) => {
          const nrm = dir(L.T, [0, 0, 1]) as [number, number, number];
          const layerPre: Motion[] = li > 0 ? [{ seq: b0 + 3, dir: nrm, dist: 30 }] : [];
          for (const pe of L.out.plugs) ends.set(`${pe.module}/${pe.ref}`, { p: ptM(L.T, pe.p), d: dir(L.T, pe.d), cable: pe.cable });
          for (const pt of L.out.parts) {
            const own = moveAnim(pt.anim, L.T);
            const k = pt.tag?.kind;
            const a: Anim = pt.id.endsWith('_clip') || k === 'clip' ? { seq: 210, dir: [0, 0, 1], dist: 40 }
              : k === 'cap' ? { seq: CAP_SEQ, dir: own?.dir ?? [0, 0, 1], dist: 25 }
              : k === 'rod' ? { ...IN, pre: [{ seq: b0 + 1, dir: own?.dir ?? [0, 0, 1], dist: 30 }, ...layerPre], show: b0 + 1 }
              : { ...IN, pre: layerPre, show: li > 0 ? b0 + 3 : hasRod ? b0 + 1 : b0 + 2 };
            parts.push({ ...pt, toAssembly: mul(L.T, pt.toAssembly), anim: a });
          }
          for (const g of L.out.ghosts) {
            if (g.name.startsWith('DIN rail')) continue;
            // a plug with a routed cable loses its straight stub: the routed cable leaves the plug instead
            const key = `${g.tag?.module}/${g.tag?.refs?.[0]}`;
            if (g.mat === 'cable' && g.tag?.kind === 'plug' && (linked.has(key) || linked.has(`${key}:2`))) continue;
            const own = moveAnim(g.anim, L.T);
            let a: Anim | undefined = own;
            if (g.tag?.kind === 'plug') a = { seq: plugSeq.get(key) ?? plugSeq.get(`${key}:2`) ?? PLUG_SEQ, dir: own?.dir ?? [0, 0, 1], dist: 30 };
            else if (g.tag?.kind === 'board' || g.tag?.kind === 'parts') {
              // the layer's own board drops into its holder; a board bolted onto it comes one step later
              const mine = g.tag.module === L.mod.id;
              a = { ...IN, pre: [{ seq: mine ? b0 + 2 : b0 + 3, dir: nrm, dist: mine ? 30 : 25 }, ...(mine ? layerPre : [])], show: mine ? (li > 0 ? b0 + 3 : b0 + 2) : b0 + 3 };
            }
            ghosts.push({ ...g, mesh: transformMesh(g.mesh, L.T), anim: a });
          }
          features.push(...L.out.features);
          frames[L.mod.id] = L.T;
        });
        const bx = q.boxes.find((b) => b.id === s.mod.id)!.b;
        const accOf = (b: Module['board']) => plugDirs(b).map((d) => ({ ref: d.ref, type: d.type, ...classify(dir(T, d.v), r.dir) }));
        const acc = [s.mod, ...s.riders].flatMap((mm) => accOf(mm.board).map((a) => (mm === s.mod ? a : { ...a, ref: `${a.ref}·${mm.board.name.slice(0, 10)}` })));
        access.push({ id: s.mod.id, mount: q.mt.id, slot: s.slot, edge: s.edge, turn: q.mt.turn, foot: toPanel(r, q.mt.at!, bx), z1: bx[5], access: acc, stack: s.riders.map((x) => x.board.name) });
        const blocked = acc.filter((a) => a.ok === 'blocked');
        if (blocked.length) warnings.push(`${s.mod.board.name}: ${blocked.map((a) => a.ref).join(', ')} point${blocked.length > 1 ? '' : 's'} down into the table. Turn the dock or pick another dock edge.`);
        for (const L of layers) {
          warnings.push(...L.out.warnings.map((w) => `${L.mod.board.name}: ${w}`));
          checks.push(...L.out.checks.map((c) => ({ ...c, group: `${L.mod.board.name} · ${c.group}` })));
        }
        if (s.riders.length) checks.push({ group: `${s.mod.board.name} · Stack`, name: `${s.riders.length + 1} boards stacked`, value: [s.mod, ...s.riders].map((x) => x.board.name).join(' < '), status: 'info', detail: `${s.above.length ? `${s.above.length} printed layer${s.above.length > 1 ? 's press' : ' presses'} onto the corner pegs of the one below; ` : ''}${s.riders.length - s.above.length ? `${s.riders.length - s.above.length} bolted on standoffs; ` : ''}the bottom holder carries the dock` });
      }
      const all = [q.lo, q.ylo, 0, q.hi, q.yhi, q.zhi];
      const f = toPanel(r, q.mt.at!, all);
      const c = mul(railMatrix(r), tr(q.mt.at!, 0, 0));
      mountOut.push({ ...q.mt, at: q.mt.at!, x: c[12], y: c[13], foot: f, leverSide: q.lever });
    }
    const base = { toAssembly: I4, color: '' };
    if (sh && so) {
      const out: [number, number, number] = [0, 0, 1];
      const tags = (kind: 'shoe' | 'socket') => dockIds.map((id) => ({ kind, mount: id }));
      parts.push({ ...base, id: 'dock_shoe', name: 'Rail shoe (press-down release lever)', qty: docks.length, mesh: sh.mesh, displayMesh: sh.body, toAssembly: shoeInst[0], instances: shoeInst.slice(1), volume: sh.volume, size: sh.size, color: '#5b6570',
        tag: tags('shoe')[0], tags: tags('shoe').slice(1), anim: { seq: 200, dir: out, dist: 45 }, anims: dockIds.slice(1).map(() => ({ seq: 200, dir: out, dist: 45 })) });
      display.push({ ...base, id: 'dock_lever', name: 'Rail release lever (prints with the shoe)', qty: docks.length, mesh: sh.lever, toAssembly: shoeInst[0], instances: shoeInst.slice(1), volume: 0, size: sh.size, color: '#ff4d5e',
        tag: tags('shoe')[0], tags: tags('shoe').slice(1), anim: { seq: 200, dir: out, dist: 45 }, anims: dockIds.slice(1).map(() => ({ seq: 200, dir: out, dist: 45 })) });
      parts.push({ ...base, id: 'dock_socket', name: 'Dock socket (turns 4 ways, 2 slots)', qty: docks.length, mesh: so.mesh, toAssembly: sockInst[0], instances: sockInst.slice(1), volume: so.volume, size: so.size, color: '#4c8dff',
        tag: tags('socket')[0], tags: tags('socket').slice(1), anim: { seq: 210, dir: out, dist: 45 }, anims: dockIds.slice(1).map(() => ({ seq: 210, dir: out, dist: 45 })) });
    }
    for (const r of rails) {
      const m = railMesh(r.length!);
      ghosts.push({ name: `DIN rail ${r.id}`, mesh: transformMesh(m, mul(railMatrix(r), tr(r.length! / 2, 0, 0))), color: '#94a3b8', opacity: 0.6, tag: { kind: 'rail', rail: r.id }, anim: { seq: 110, dir: [0, 0, 1], dist: 60 } });
    }
  } finally {
    freeAll();
  }

  // ---- cables: out of each plug, down to a street between (or beside) the rails, along it, and up to the other
  // plug. On table stands the streets run under the rails' level, through a comb slot in every sleeper they cross;
  // each cable gets its own lane in its street.
  const cables: NonNullable<GenResult['report']['cables']> = [];
  const nameOf2 = (id: string) => mods.get(id)?.m.board.name ?? '?';
  const stands = P.stands !== false && rails.length > 0;
  const vert = rails.filter((r) => r.dir === 'v').length > rails.length / 2;
  // rack coordinates: u along the rails, v across them
  const uv = (q: number[]) => (vert ? [q[1], -q[0], q[2]] : [q[0], q[1], q[2]]);
  const xy = (q: number[]) => (vert ? [-q[1], q[0], q[2]] : [q[0], q[1], q[2]]);
  const rackRails = rails.filter((r) => r.dir === (vert ? 'v' : 'h'));
  const across = rackRails.map((r) => (vert ? -r.x : r.y)).sort((a, b) => a - b);
  const streets = across.length ? [across[0] - 45, ...across.slice(1).map((v, i) => (v + across[i]) / 2), across[across.length - 1] + 45] : [];
  const lanes: StandLane[] = [];
  const standRails = rackRails.map((r) => { const u0 = vert ? r.y : r.x; return { id: r.id, u0, u1: u0 + r.length!, v: vert ? -r.x : r.y }; });
  if ((p.links ?? []).length && streets.length) {
    // obstacles, in rack coordinates: every holder, board, plug, dock, rail and stand piece as a bounding box
    const uvBox = (b: number[]) => (vert ? [b[1], -b[3], b[2], b[4], -b[0], b[5]] : b);
    const obs: Obstacle[] = [];
    const labelOf = (t: PickTag | undefined, name: string) => {
      const nm = t?.module ? nameOf2(t.module) : '';
      switch (t?.kind) {
        case 'holder': case 'rod': return `the ${nm} holder`;
        case 'cap': return `a plug cap on the ${nm}`;
        case 'clip': return `the ${nm} rail clip`;
        case 'board': case 'parts': return `the ${nm}`;
        case 'plug': return `the ${nm} ${t.refs?.[0] ?? ''} plug`;
        case 'shoe': case 'socket': return `dock ${t.mount?.replace(/^d/, '') ?? ''}`;
        case 'rail': return `rail ${t.rail?.replace(/^r/, '') ?? ''}`;
        default: return name;
      }
    };
    for (const pt of parts) {
      if (pt.tag?.kind === 'railstand') continue;
      [pt.toAssembly, ...(pt.instances ?? [])].forEach((T, i) => {
        const b = emptyBox(); boxOf(pt.mesh.pos, T, b);
        const t = i ? pt.tags?.[i - 1] ?? pt.tag : pt.tag;
        obs.push({ box: uvBox(b), label: labelOf(t, pt.name), module: t?.module });
      });
    }
    for (const g of ghosts) {
      if (g.tag?.kind === 'cable') continue;
      const b = emptyBox(); boxOf(g.mesh.pos, I4, b);
      obs.push({ box: uvBox(b), label: labelOf(g.tag, g.name), module: g.tag?.module, plug: g.tag?.kind === 'plug' ? `${g.tag.module}/${g.tag.refs?.[0]}` : undefined });
    }
    const pre = stands ? planStands(standRails, streets, []) : null;
    if (pre) for (const sb of standBoxes(pre)) obs.push({ ...sb, stand: true });
    const stations = pre?.stations ?? [];
    // each board's own envelope, to step clear of it
    const ownBox = new Map<string, number[]>();
    for (const o of obs) if (o.module && !o.plug) { const b = ownBox.get(o.module) ?? emptyBox(); for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], o.box[k]); b[k + 3] = Math.max(b[k + 3], o.box[k + 3]); } ownBox.set(o.module, b); }

    const routes: { l: NonNullable<Project['links']>[number]; A: CableEnd; B: CableEnd; ch: Choice; d: number; zc: number }[] = [];
    for (const l of p.links ?? []) {
      const ka = `${l.a.module}/${l.a.ref}`, kb = `${l.b.module}/${l.b.ref}`;
      const EA = ends.get(ka), EB = ends.get(kb);
      if (!EA || !EB) continue;
      const A: CableEnd = { p: uv(EA.p), d: uv(EA.d), module: l.a.module, plug: `${l.a.module}/${baseRef(l.a.ref)}` }, B: CableEnd = { p: uv(EB.p), d: uv(EB.d), module: l.b.module, plug: `${l.b.module}/${baseRef(l.b.ref)}` };
      const d = 2 * Math.max(1.4, Math.max(EA.cable, EB.cable) / 2);
      // on stands the streets run under the rails; without them just over the rail lips
      const zc = stands ? STAND.floor + d / 2 + 0.25 : 8.5 + d / 2;
      const ch = bestRoute(A, B, streets, zc, d / 2, obs, ownBox.get(l.a.module) ?? null, ownBox.get(l.b.module) ?? null, stations);
      if (ch) routes.push({ l, A, B, ch, d, zc });
    }
    // lanes: side by side in each street, ordered so the fewest cables cross
    const colOf = (e: CableEnd, r: Route | 'slope', c: number) => (r === 'slope' ? [e.p[0] + e.d[0] * 14, c] : r.pts[r.pts.length - 1]);
    const laneOf = new Map<string, number>();
    streets.forEach((c, k) => {
      const rs0 = routes.filter((q) => q.ch.street === k).map((q) => ({ q, a1: colOf(q.A, q.ch.ea, c), b1: colOf(q.B, q.ch.eb, c) }))
        .sort((x, y) => (x.a1[1] + x.b1[1]) - (y.a1[1] + y.b1[1]) || Math.min(x.a1[0], x.b1[0]) - Math.min(y.a1[0], y.b1[0]));
      const rs = laneOrder(rs0, c);
      const pitch = Math.max(0, ...rs.map((x) => x.q.d)) + 2.9;
      rs.forEach((x, i) => laneOf.set(x.q.l.id, c + (i - (rs.length - 1) / 2) * pitch));
    });
    for (const q of routes) {
      const { l, A, B, ch, d, zc } = q;
      const vl = laneOf.get(l.id)!;
      const ea = ch.ea === 'slope' ? slope(A, vl, zc) ?? escapes(A, null, zc, d / 2)[0] : ch.ea;
      const eb = ch.eb === 'slope' ? slope(B, vl, zc) ?? escapes(B, null, zc, d / 2)[0] : ch.eb;
      const route = assemble(ea, eb, vl, zc);
      const hit = hits(route, obs, [A, B], d / 2);
      const path = smooth(route.pts, 3).map(xy);
      let len = 0;
      for (let i = 1; i < path.length; i++) len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]);
      const kind = l.kind ?? 'usb';
      ghosts.push({ name: `cable ${l.id}`, mesh: tubeMesh(path, d / 2, 10), color: KIND_COLOR[kind], opacity: 1, tag: { kind: 'cable', refs: [l.id] }, anim: { seq: cableSeq(kind), dir: [0, 0, 1], dist: 0, grow: true }, mat: 'cable' });
      const clash = [...new Set(hit.map((h) => h.ob.label))];
      for (const h of hit.slice(0, 3)) ghosts.push({ name: `clash ${l.id}`, mesh: sphereMesh(xy(h.at), Math.max(3, d * 0.9)), color: '#ff3b3b', opacity: 0.55, tag: { kind: 'cable', refs: [l.id] }, anim: { seq: cableSeq(kind), dir: [0, 0, 1], dist: 0 } });
      cables.push({ id: l.id, a: `${nameOf2(l.a.module)} ${l.a.ref}`, b: `${nameOf2(l.b.module)} ${l.b.ref}`, ends: `${l.a.module}/${l.a.ref}|${l.b.module}/${l.b.ref}`, kind, length: round(len, 0), buy: cableToBuy(len), ...(clash.length ? { clash: clash.join(', ') } : {}) });
      const si = route.kinds.indexOf('street');
      const su = si >= 0 ? [route.pts[si][0], route.pts[si + 1][0]] : [route.pts[0][0], route.pts[route.pts.length - 1][0]];
      lanes.push({ street: ch.street, y: vl, d: Math.round(d * 10) / 10, u0: Math.min(...su), u1: Math.max(...su) });
    }
    const clashing = cables.filter((c) => c.clash);
    for (const c of clashing) warnings.push(`The ${c.a} to ${c.b} cable runs into ${c.clash}. Move or turn one of the boards, or connect it to another plug (routes are checked against bounding boxes, so this may be a close shave rather than a real clash).`);
    if (cables.length) checks.push({ group: 'Panel', name: 'Cable routes', value: clashing.length ? `${clashing.length} of ${cables.length} touch something` : `all ${cables.length} clear`, status: clashing.length ? 'warn' : 'ok', detail: clashing.length ? clashing.map((c) => `${c.a} to ${c.b}: ${c.clash}`).join('; ') : 'every cable was routed clear of the holders, boards, plugs, docks, rails and stands (checked against their bounding boxes, so a route marked clear really is)' });
    const long = cables.filter((c) => c.length > 1200);
    if (long.length) warnings.push(`${long.map((c) => `${c.a} to ${c.b}`).join(', ')}: over 1.2 m of ${long.length > 1 ? 'cable each' : 'cable'}. Put the two boards closer (Auto-arrange keeps connected boards together).`);
    if (cables.length) checks.push({ group: 'Panel', name: 'Cables', value: `${cables.length}, ${round(cables.reduce((a, c) => a + c.length, 0) / 1000, 1)} m`, status: 'info', detail: cables.map((c) => `${KIND_NAME[c.kind]} ${c.a} to ${c.b}: ${round(c.length / 10, 0)} cm (buy ${c.buy} m)`).join('; ') });
  }

  // ---- table stands: sleepers across the rails, with cable combs where the streets cross them ----
  let standOut: PanelReport['stands'];
  if (stands) {
    const off = rails.filter((r) => !rackRails.includes(r));
    if (off.length) warnings.push(`Rail${off.length > 1 ? 's' : ''} ${off.map((r) => r.id.replace(/^r/, '')).join(', ')} ${off.length > 1 ? 'run' : 'runs'} across the others, so the table stands leave ${off.length > 1 ? 'them' : 'it'} out. Turn ${off.length > 1 ? 'them' : 'it'} to match.`);
    const plan = planStands(rackRails.map((r) => { const u0 = vert ? r.y : r.x; return { id: r.id, u0, u1: u0 + r.length!, v: vert ? -r.x : r.y }; }), streets, lanes);
    warnings.push(...plan.warnings);
    const Rk: M4 = vert ? basis([0, 1, 0], [-1, 0, 0], [0, 0, 1], [0, 0, 0]) : I4;
    const NAME = { end: 'Rail end block (the rail pushes in)', saddle: 'Rail saddle', spacer: 'Stand spacer', outrigger: 'Stand foot' } as const;
    const groups = new Map<string, typeof plan.pieces>();
    for (const pc of plan.pieces) groups.set(pc.key, [...(groups.get(pc.key) ?? []), pc]);
    const foot = new Map<number, number[]>();
    try {
      let k = 0;
      for (const [, list] of groups) {
        const pc0 = list[0], m = pieceMesh(pc0);
        const T = list.map((pc) => mul(Rk, pc.M));
        const len = pc0.to != null ? ` ${Math.round(pc0.to - 2 * STAND.half)} mm` : '';
        const name = `${NAME[pc0.kind]}${len}${pc0.lanes.length ? `, comb for ${pc0.lanes.length} cable${pc0.lanes.length > 1 ? 's' : ''}` : ''}`;
        const tag = (pc: (typeof list)[number]) => ({ kind: 'railstand' as const, refs: [`s${pc.station + 1}`] });
        // saddles go down first, the rails into them, end blocks slide onto the rail ends, spacers slide in along the rails
        const uAx = dir(Rk, [1, 0, 0]);
        const anim = (pc: (typeof list)[number], i: number): Anim => {
          if (pc.kind === 'saddle') return { seq: 100, dir: [0, 0, 1], dist: 40 };
          if (pc.kind === 'end') { const zi = dir(T[i], [0, 0, 1]); return { seq: 120, dir: [-zi[0], -zi[1], -zi[2]], dist: 35 }; }
          const last = plan.stations[pc.station] >= Math.max(...plan.stations) - 0.5 && plan.stations.length > 1;
          return { seq: 130, dir: (last ? uAx : uAx.map((v) => -v)) as [number, number, number], dist: 45 };
        };
        parts.push({ id: `stand_${++k}`, name, qty: list.length, mesh: m.mesh, toAssembly: T[0], instances: T.slice(1), volume: m.volume, size: m.size, color: '#7c8896',
          tag: tag(pc0), tags: list.slice(1).map(tag), anim: anim(pc0, 0), anims: list.slice(1).map((pc, i) => anim(pc, i + 1)) });
        list.forEach((pc, i) => { const b = foot.get(pc.station) ?? emptyBox(); boxOf(m.mesh.pos, T[i], b); foot.set(pc.station, b); });
      }
    } finally {
      freeAll();
    }
    standOut = plan.stations.map((_, i) => ({ station: i + 1, foot: [foot.get(i)?.[0] ?? 0, foot.get(i)?.[1] ?? 0, foot.get(i)?.[3] ?? 0, foot.get(i)?.[4] ?? 0] as [number, number, number, number], pieces: plan.pieces.filter((q) => q.station === i).length, combs: plan.pieces.filter((q) => q.station === i && q.lanes.length).length })).filter((s) => s.pieces);
    const combs = plan.pieces.filter((q) => q.lanes.length).length;
    if (plan.pieces.length) {
      checks.push({ group: 'Panel', name: 'Table stands', value: `${plan.stations.length} sleepers, ${plan.pieces.length} pieces`, status: 'info', detail: `the rails stand ${STAND.H} mm off the table. Each rail end pushes ${STAND.len - STAND.back} mm into an end block (crush ribs make it a light press fit); saddles carry the rails between; spacer bars slide into the blocks' dovetails along the rail.${combs ? ` ${combs} spacer${combs > 1 ? 's carry' : ' carries'} a cable comb where a cable street crosses the sleeper: press each cable into its slot.` : ''} Every piece prints on its end, no supports. Lifting a rail end with 20 N puts about ${capStress(20).toFixed(0)} MPa in the caps over its lips (hand calculation; PETG yields near 50). Not print-tested yet.` });
      // sag of the longest unsupported span under a 20 N press at mid-span (steel rail; aluminium sags ~2.9x more)
      const I = railI(), F = 20, L = plan.span, E = 200e3;
      const sag = (F * L ** 3) / (48 * E * I);
      checks.push({ group: 'Panel', name: 'Rail sag between sleepers', value: `${sag.toFixed(2)} mm`, status: sag < 0.5 ? 'ok' : sag < 1.5 ? 'warn' : 'bad', detail: `longest span ${Math.round(L)} mm, 20 N pressed at mid-span (pushing a board in), steel TS35 (I = ${Math.round(I)} mm⁴, simply supported beam). Aluminium rail sags about 2.9 times as much.` });
    }
  }

  // ---- checks ----
  const eR = mat.E / MATERIALS.PETG.E;
  const allow = mat.strainAllow;
  const st = (eps: number): Check['status'] => (eps <= allow * 0.85 ? 'ok' : eps <= allow * 1.1 ? 'warn' : 'bad');
  if (docks.length) {
    // PETG numbers from the in-app 2D FEA (0.06 mm mesh), scaled by stiffness; the Check tab reruns it for your material
    checks.push({ group: 'Panel', name: 'Rail shoe release', value: `${(1.4 * eR).toFixed(1)} N press`, status: 'info', detail: 'lift the boards out, then press the ridged pad of the lever beside the socket down (about 8 mm) and lift the dock off the rail. The lever is printed in place on its pin; its hook pulls the jaw off the flange, and the jaw spring lifts it back. A stop meets the post at 2.2 mm of jaw travel (1.7 needed), so the hinge cannot be over-bent. Each dock puts its lever on the side of the rail with the most room.' });
    checks.push({ group: 'Panel', name: 'Rail shoe hinge', value: '1.9% peak', status: st(0.019), detail: 'uniform 0.9 mm leaf above the lip, at its root fillet; 99% of the shoe stays under 0.6%. Clipping on: 4.3 N (PETG) at the jaw ramp.' });
    checks.push({ group: 'Panel', name: 'Socket latch (per board)', value: `${(9.8 * eR).toFixed(1)} N to plug in`, status: st(0.018), detail: `1.8% peak at the spring root while the tongue goes in, 1.3% while the button releases it; the nose clears the groove after 1.9 mm of the 3.1 mm button stroke; a stop post prevents over-bending` });
    checks.push({ group: 'Panel', name: 'Rail shoe pull-off', value: `~${Math.round(90 * (allow / 0.02))} N`, status: 'ok', detail: 'the hinge leaf stands above the lip, so a pull straight up off the rail runs down the leaf and cannot pry the jaw open, friction or not; this is where the hinge reaches its strain limit.' });
    checks.push({ group: 'Panel', name: 'Socket to shoe hooks', value: '0.84% strain', status: st(0.0084), detail: 'press the socket into the shoe in any of 4 turns; a pull tightens the 10° hooks' });
  }
  const railLens = rails.map((r) => r.length!);
  checks.push({ group: 'Panel', name: 'Rails to cut', value: railLens.length ? railLens.map((l) => `${l} mm`).join(' + ') : 'none', status: 'info', detail: `${docks.length} dock${docks.length === 1 ? '' : 's'}, ${placed.length - docks.length} flat clip${placed.length - docks.length === 1 ? '' : 's'}; TS35 top-hat rail` });
  const depth = Math.max(0, ...placed.map((q) => q.zhi));
  checks.push({ group: 'Panel', name: stands ? 'Height above the table' : 'Height above the rail base', value: `${round(depth + (stands ? STAND.H : 0), 0)} mm`, status: 'info', detail: 'tallest point of any holder, plug or button' });

  // ---- report ----
  const act = placed.flatMap((q) => q.seats).find((s) => s.mi === p.active) ?? placed[0]?.seats[0];
  let cx = 0, cy = 0;
  if (mountOut.length) {
    const xs = mountOut.flatMap((m) => [m.foot[0], m.foot[2]]), ys = mountOut.flatMap((m) => [m.foot[1], m.foot[3]]);
    cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  }
  // ---- assembly captions for the steps that are in this build ----
  const pieces = parts.filter((x) => x.tag?.kind === 'railstand');
  const has = (w: string) => pieces.some((x) => x.name.startsWith(w));
  if (has('Rail saddle')) steps.push({ seq: 100, text: 'Set the saddles on the table where the rails will run.' });
  if (rails.length) steps.push({ seq: 110, text: has('Rail saddle') ? `Lay ${rails.length > 1 ? 'each rail in its saddles' : 'the rail in its saddles'}.` : `Lay out the rail${rails.length > 1 ? 's' : ''}.` });
  if (has('Rail end block')) steps.push({ seq: 120, text: 'Push an end block onto each end of every rail, all the way in (a snug fit).' });
  if (has('Stand spacer') || has('Stand foot')) steps.push({ seq: 130, text: `Slide the spacer bars${has('Stand foot') ? ' and feet' : ''} into the blocks' dovetails along the rails${pieces.some((x) => /comb/.test(x.name)) ? '; the ones with combs go where the cables will run' : ''}.` });
  if (docks.length) steps.push({ seq: 200, text: 'Clip a rail shoe on at every dock: hook it under the rail on the side away from the lever and press it down until it clicks.' });
  const flats = placed.length - docks.length;
  if (docks.length || flats) steps.push({ seq: 210, text: `${docks.length ? 'Press a socket into each shoe, turned the way it is shown.' : ''}${docks.length && flats ? ' ' : ''}${flats ? `Clip the flat rail clip${flats > 1 ? 's' : ''} onto the rail.` : ''}` });
  for (const k of CABLE_ORDER) {
    const cs = cables.filter((c) => c.kind === k);
    if (!cs.length) continue;
    const combed = pieces.some((x) => /comb/.test(x.name));
    steps.push({ seq: cableSeq(k), text: `Plug in the ${KIND_NAME[k]} cable${cs.length > 1 ? 's' : ''}: ${cs.map((c) => `${c.a} to ${c.b} (${c.buy} m)`).join(', ')}${combed ? '. Press each one into its comb slot as you go' : ''}.` });
  }
  if (ghosts.some((g) => g.tag?.kind === 'plug' && g.anim?.seq === PLUG_SEQ)) steps.push({ seq: PLUG_SEQ, text: 'Plug in the cables that leave the rack (power supplies, screens, your computer).' });
  if (parts.some((x) => x.tag?.kind === 'cap')) steps.push({ seq: CAP_SEQ, text: 'Snap the caps over the plugs to lock them in.' });

  const panel: PanelReport = { rails: rails as PanelReport['rails'], mounts: mountOut, modules: access, unplaced, depth, height: round(depth + (standOut?.length ? STAND.H : 0), 1), collisions, stands: standOut };
  return {
    parts,
    ghosts,
    display,
    steps,
    report: {
      warnings: [...new Set(warnings)],
      checks,
      levels: act?.out.levels ?? { base: 0, boardBottom: 0, boardTop: 0, wallTop: 0 },
      clipAt: null,
      clipFrame: basis([0, 0, 1], [0, 1, 0], [-1, 0, 0], [cx, cy, 0]),
      timeMs: Date.now() - t0,
      panel,
      features,
      frames,
      cables,
    },
  };
}
