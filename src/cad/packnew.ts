// "Pack new boards only": put the boards that are not on a rail yet where they suit, and leave everything else exactly
// where it is (every dock, rail and slot already there is untouched: what is locked, and what is not). Each new board
// is scored where it could go, against the real places of the plugs it is cabled to (the build's report): into the
// empty back slot of a dock, into a gap on a rail, on the end of a rail, or on a rail of its own, turned so its plugs
// face its cables. Kernel-free, like dockplan.ts.
import type { Module, PanelReport, Project, RailMount, Rail, Slot, Turn } from '../model/types';
import { uid } from '../geom/poly';
import { baseOf, ridersOf } from '../model/holes';
import { baseRef, isAccessory } from '../model/links';
import { isPlugPack } from '../model/powerdata';
import { isProbe } from '../model/probes';
import { bestDock, columnSeat, seatCompanion, TURNS, withRiders } from './dockplan';
import { flatGeo, seatGeo, weightsFor, type SeatGeo } from './autoplan';

type LocksLike = { all?: boolean; docks?: string[]; rails?: string[] };

/** The docks and rails that are locked (`Project.locks`: the whole layout, or docks and rails one by one). */
export function lockSets(p: Project): { docks: Set<string>; rails: Set<string> } {
  const L = (p as { locks?: LocksLike }).locks;
  const rails = new Set(L?.all ? p.panel.rails.map((r) => r.id) : L?.rails ?? []), docks = new Set(L?.docks ?? []);
  if (L) for (const m of p.panel.mounts) if (L.all || rails.has(m.rail)) docks.add(m.id);
  return { docks, rails };
}

export interface Packed { module: string; where: 'slot' | 'gap' | 'end' | 'rail' | 'beside'; mount: string; rail: string | null }

const MARGIN = 8, PAD = 10, PAD_SLOT = 0; // (PAD: room kept round a new dock beyond what is worked out for it: the real holders are a little bulkier)

/**
 * Place every board that is on no rail. `rep`: the last build's layout, to know where everything is (without it a board
 * goes where `seatBoard` would put it). Mutates `p.panel`; returns where each went. Never moves or changes a mount that
 * was there, and never adds to a locked rail or dock.
 */
export function packNew(p: Project, rep: PanelReport | null): Packed[] {
  const P = p.panel, out: Packed[] = [];
  const seated = new Set(P.mounts.flatMap((m) => m.slots.map((s) => s.module).filter(Boolean) as string[]));
  const fresh = p.modules.filter((m) => baseOf(p, m) === m && !isPlugPack(m.board) && !seated.has(m.id));
  if (!fresh.length) return out;
  const locked = lockSets(p);
  const linkedTo = (id: string) => new Set((p.links ?? []).flatMap((l) => (l.a.module === id ? [l.b.module] : l.b.module === id ? [l.a.module] : [])));
  // the boards with most cables to boards already there go first, so the rest can be put by them
  const placed = new Set(seated);
  for (const id of [...placed]) { const m = p.modules.find((x) => x.id === id); if (m) for (const r of ridersOf(p, m)) placed.add(r.id); }
  const todo = [...fresh];
  const pull = (m: Module) => [...linkedTo(m.id)].filter((id) => placed.has(id)).length;
  const rails = P.rails, vert = rails.filter((r) => r.dir === 'v').length > rails.length / 2;
  const uv = (q: number[]): [number, number] => (vert ? [q[1], -q[0]] : [q[0], q[1]]);
  const alongOf = (r: Rail) => (vert ? r.y : r.x), acrossOf = (r: Rail) => (vert ? -r.x : r.y);

  // where everything is now, in rack coordinates (u along, v across)
  const at = new Map<string, [number, number]>(); // "module/ref" -> plug
  const atz = new Map<string, number>(); // and how high each is
  for (const [k, q] of Object.entries(rep?.plugs ?? {})) { at.set(k, uv(q)); atz.set(k, q[2]); }
  // which rail (its across coordinate) every board is on: a cable between boards on one rail goes straight, not by a street
  const rowOf = new Map<string, number>();
  for (const x of rep?.modules ?? []) { const mt = rep!.mounts.find((q) => q.id === x.mount), r = mt && rails.find((q) => q.id === mt.rail); if (r) rowOf.set(x.id, acrossOf(r)); }
  const zc = P.stands !== false ? -5 : 11; // (the streets run under the rails on table stands, else just over their lips)
  const boxes = new Map<string, [number, number, number, number]>(); // footprints by mount: u0, v0, u1, v1
  for (const m of rep?.mounts ?? []) {
    const f = m.foot, [a, b] = uv([f[0], f[1]]), [c, d] = uv([f[2], f[3]]);
    boxes.set(m.id, [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)]);
  }
  // every mount, those already there and those put here: its rail, where it is along it, and the room it takes along it
  const info = new Map<string, { rail: string; at: number; a0: number; a1: number }>();
  for (const m of rep?.mounts ?? []) { const f = m.foot, a = vert ? [f[1], f[3]] : [f[0], f[2]]; info.set(m.id, { rail: m.rail, at: m.at, a0: Math.min(...a), a1: Math.max(...a) }); }
  const railV = rails.map(acrossOf).sort((a, b) => a - b);
  const streets = railV.length ? [railV[0] - 45, ...railV.slice(1).map((v, i) => (v + railV[i]) / 2), railV[railV.length - 1] + 45] : [];
  const W = weightsFor(P.opts);

  const cabled = new Set(placed);
  const endsOf = (m: Module) => (p.links ?? []).filter((l) => l.a.module === m.id || l.b.module === m.id).map((l) => (l.a.module === m.id ? { mine: l.a, other: l.b } : { mine: l.b, other: l.a }));
  const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const others: [[number, number], [number, number]][] = [];
  for (const l of p.links ?? []) { const a = at.get(`${l.a.module}/${baseRef(l.a.ref)}`), b = at.get(`${l.b.module}/${baseRef(l.b.ref)}`); if (a && b) others.push([a, b]); }

  /** What a board costs at a place: its cables to boards already there, crossings, rails crossed, plug access, rail added. */
  const cost = (m: Module, g: SeatGeo, origin: [number, number], loss: number, extra: number, skip = '') => {
    let sum = 0, cross = 0, under = 0, blocked = 0;
    const segs: [[number, number], [number, number]][] = [];
    for (const { mine, other } of endsOf(m)) {
      const q = g.plugs.get(`${m.id}/${baseRef(mine.ref)}`), o = at.get(`${other.module}/${baseRef(other.ref)}`);
      if (!q || !o || !cabled.has(other.module)) continue;
      const a: [number, number] = [origin[0] + q.u, origin[1] + q.v];
      let best = Infinity, bs = 0;
      for (const s of streets) { const c = Math.abs(a[1] - s) + Math.abs(o[1] - s); if (c < best) { best = c; bs = s; } }
      const oz = atz.get(`${other.module}/${baseRef(other.ref)}`) ?? 40;
      let len = Math.abs(a[0] - o[0]) + (streets.length ? best : Math.abs(a[1] - o[1])) + ((q.z ?? 40) - zc) + (oz - zc);
      if (Math.abs((rowOf.get(other.module) ?? 1e9) - origin[1]) < 1) len = Math.min(len, Math.hypot(a[0] - o[0], a[1] - o[1], (q.z ?? 40) - oz) + 30);
      sum += len;
      for (const y of railV) if ((y > Math.min(a[1], bs) + 5 && y < Math.max(a[1], bs) - 5 && Math.abs(y - origin[1]) > 1) || (y > Math.min(o[1], bs) + 5 && y < Math.max(o[1], bs) - 5 && Math.abs(y - o[1]) > 60)) under++;
      segs.push([a, o]);
    }
    // a cable leaves its plug the way the plug points: a neighbour's holder close in that way is where it runs into
    for (const { mine } of endsOf(m)) {
      const q = g.plugs.get(`${m.id}/${baseRef(mine.ref)}`);
      const dl = q ? Math.hypot(q.du, q.dv) : 0;
      if (!q || dl < 0.5) continue;
      const ux = q.du / dl, uy = q.dv / dl, ox = origin[0] + q.u, oy = origin[1] + q.v;
      for (const [id, b] of boxes) {
        if (id === skip) continue;
        let t0 = 0, t1 = 30;
        if (Math.abs(ux) < 1e-9) { if (ox < b[0] || ox > b[2]) continue; } else { const x = (b[0] - ox) / ux, y = (b[2] - ox) / ux; t0 = Math.max(t0, Math.min(x, y)); t1 = Math.min(t1, Math.max(x, y)); }
        if (Math.abs(uy) < 1e-9) { if (oy < b[1] || oy > b[3]) continue; } else { const x = (b[1] - oy) / uy, y = (b[3] - oy) / uy; t0 = Math.max(t0, Math.min(x, y)); t1 = Math.min(t1, Math.max(x, y)); }
        if (t0 <= t1) blocked += 1 - t0 / 30;
      }
    }
    for (const [a, b] of segs) for (const [c, d] of others) {
      if (orient(...a, ...b, ...c) * orient(...a, ...b, ...d) < 0 && orient(...c, ...d, ...a) * orient(...c, ...d, ...b) < 0) cross++;
    }
    return W.cable * sum + W.cross * cross + W.under * under + W.access * loss + W.rail * extra + 170 * blocked;
  };
  const free = (r: [number, number, number, number], skip = '') => ![...boxes].some(([id, b]) => id !== skip && r[0] < b[2] - 0.3 && b[0] < r[2] - 0.3 && r[1] < b[3] - 0.3 && b[1] < r[3] - 0.3);
  const STAND_END = 20; // (the table stand's end block: nothing within this of a rail's end)
  const end0 = P.stands !== false ? STAND_END : MARGIN;

  type Undoable = Packed & { undo: () => void };
  const guess = new Map<string, string>(); // the edge a board is worked out to dock by (the build picks its own: it knows which holds a small board)
  const put = (m: Module): Undoable => {
    const railDir = (r: Rail) => r.dir;
    const isBox = m.board.kind === 'box';
    type Cand = { c: number; make: () => Undoable };
    let best: Cand | null = null;
    const offer = (c: number, make: () => Undoable, why = '') => { (globalThis as { __pk?: string[] }).__pk?.push(`${m.board.name} ${why} ${c.toFixed(0)}`); if (!best || c < best.c - 1e-9) best = { c, make }; };
    const merged = withRiders(p, m);
    // a box lies flat on a clip, as in an automatic layout; a board stands in a dock
    const ways = (r: Rail, k: number, turns: readonly Turn[] = TURNS) => turns.map((t) => (isBox
      ? { t, edge: 'auto' as const, loss: 0, g: flatGeo(m, t) }
      : (() => { const o = isAccessory(m.board) ? columnSeat(merged, railDir(r), k, false, [t as 0 | 180]) : bestDock(merged, railDir(r), k, [t]); return { t, edge: o.edge, loss: 0 - o.score, g: seatGeo(p, m, k, o.edge, t, undefined, railDir(r)), blocked: o.access.some((a) => a.ok === 'blocked') } as { t: Turn; edge: Slot['edge']; loss: number; g: SeatGeo; blocked?: boolean }; })()));
    const okWays = (r: Rail, k: number, turns?: readonly Turn[]) => {
      const all = ways(r, k, turns).filter((w) => !('blocked' in w && w.blocked));
      const top = Math.max(...all.map((w) => -w.loss));
      return all.filter((w) => -w.loss >= top - W.tol).map((w) => ({ ...w, loss: top + w.loss }));
    };
    // 1. the empty back slot of a dock already there (it keeps its turn): the board stands behind another
    if (!isBox) for (const mt of P.mounts) {
      const k = mt.slots.findIndex((s, i) => i > 0 && !s.module);
      const r = rails.find((x) => x.id === mt.rail), rm = info.get(mt.id);
      if (mt.kind !== 'dock' || k < 0 || !r || !rm || locked.docks.has(mt.id) || locked.rails.has(mt.rail) || mt.slots.some((s) => s.lie === 'flat')) continue;
      for (const w of okWays(r, k, [mt.turn])) {
        const origin: [number, number] = [alongOf(r) + rm.at, acrossOf(r)];
        const ext = seatGeo(p, m, k, w.edge as 'top', w.t, undefined, railDir(r), undefined, false).ext;
        // (it may stand out past the dock's own footprint: not into a neighbour)
        const me: [number, number, number, number] = [origin[0] + ext[0] - PAD_SLOT, origin[1] + ext[2], origin[0] + ext[1] + PAD_SLOT, origin[1] + ext[3]];
        if (!free(me, mt.id)) continue;
        offer(cost(m, w.g, origin, w.loss, 0, mt.id) - 40, () => {
          const was = { slot: mt.slots[k], box: boxes.get(mt.id), info: { ...rm } };
          mt.slots[k] = { module: m.id, edge: 'auto' };
          guess.set(m.id, w.edge);
          // (the dock takes as much room as the two boards)
          if (was.box) boxes.set(mt.id, [Math.min(was.box[0], me[0]), Math.min(was.box[1], me[1]), Math.max(was.box[2], me[2]), Math.max(was.box[3], me[3])]);
          rm.a0 = Math.min(rm.a0, me[0]); rm.a1 = Math.max(rm.a1, me[2]);
          return { module: m.id, where: 'slot', mount: mt.id, rail: mt.rail, undo: () => { mt.slots[k] = was.slot; if (was.box) boxes.set(mt.id, was.box); Object.assign(rm, was.info); } };
        }, `slot ${mt.id} t${w.t}`);
      }
    }
    // 2. a dock of its own in a gap on a rail, on the end of one, or on a rail of its own
    for (const r of rails) {
      if (locked.rails.has(r.id)) continue;
      const on = [...info.values()].filter((x) => x.rail === r.id).sort((x, y) => x.a0 - y.a0);
      const len = r.length ?? Math.max(0, ...on.map((x) => x.a1 - alongOf(r))) + MARGIN;
      for (const w of okWays(r, 0)) {
        const [u0, u1] = [w.g.ext[0] - PAD, w.g.ext[1] + PAD];
        const starts = [alongOf(r) + end0, ...on.map((x) => x.a1 + P.gap), ...on.map((x) => x.a0 - P.gap - (u1 - u0))]; // where its left edge could go
        for (const s of starts) {
          const atPos = s - u0 - alongOf(r);
          const origin: [number, number] = [alongOf(r) + atPos, acrossOf(r)];
          if (atPos + u0 < end0 - 0.01) continue;
          const me: [number, number, number, number] = [origin[0] + u0, origin[1] + w.g.ext[2], origin[0] + u1, origin[1] + w.g.ext[3]];
          if (!free(me)) continue;
          const need = atPos + u1 + end0;
          const extra = Math.max(0, need - len);
          if (extra > 0 && (r.length != null && p.built)) continue; // a built rack's rails are cut
          const where: Packed['where'] = on.some((x) => x.a1 > origin[0] + u1 - 0.01) ? 'gap' : 'end';
          offer(cost(m, w.g, origin, w.loss, extra) + (extra > 0 ? 25 : 0), () => {
            const was = r.length;
            if (extra > 0 && r.length != null) r.length = Math.ceil(need);
            const mt: RailMount = { id: uid('d'), rail: r.id, at: Math.round(atPos * 10) / 10, kind: isBox ? 'flat' : 'dock', turn: w.t, slots: isBox ? [{ module: m.id, edge: 'auto' }] : [{ module: m.id, edge: 'auto' }, { module: null, edge: 'auto' }] };
            P.mounts.push(mt);
            guess.set(m.id, w.edge);
            boxes.set(mt.id, me);
            info.set(mt.id, { rail: r.id, at: atPos, a0: origin[0] + u0, a1: origin[0] + u1 });
            return { module: m.id, where, mount: mt.id, rail: r.id, undo: () => { P.mounts.splice(P.mounts.indexOf(mt), 1); boxes.delete(mt.id); info.delete(mt.id); r.length = was; } };
          }, `${r.id}@${atPos.toFixed(0)} t${w.t} loss${w.loss.toFixed(1)}`);
        }
      }
    }
    if (best) return (best as Cand).make();
    // 3. no room on any rail: a rail of its own, under the rest
    const dir = rails[rails.length - 1]?.dir ?? P.rowDir, n = rails.reduce((a, r) => Math.max(a, +r.id.replace(/\D/g, '') || 0), 0) + 1;
    const nr: Rail = dir === 'h'
      ? { id: `r${n}`, x: rails.length ? Math.min(...rails.map((r) => r.x)) : 0, y: (rails.length ? Math.min(...rails.map((r) => r.y)) : 0) - 130, dir, length: null }
      : { id: `r${n}`, x: (rails.length ? Math.max(...rails.map((r) => r.x)) : 0) + 130, y: rails.length ? Math.min(...rails.map((r) => r.y)) : 0, dir, length: null };
    const w = okWays(nr, 0)[0];
    P.rails.push(nr);
    const mt: RailMount = { id: uid('d'), rail: nr.id, at: null, kind: isBox ? 'flat' : 'dock', turn: w.t, slots: isBox ? [{ module: m.id, edge: 'auto' }] : [{ module: m.id, edge: 'auto' }, { module: null, edge: 'auto' }] };
    P.mounts.push(mt);
    guess.set(m.id, w.edge);
    info.set(mt.id, { rail: nr.id, at: 0, a0: alongOf(nr), a1: alongOf(nr) });
    return { module: m.id, where: 'rail' as const, mount: mt.id, rail: nr.id, undo: () => { P.mounts.splice(P.mounts.indexOf(mt), 1); P.rails.splice(P.rails.indexOf(nr), 1); info.delete(mt.id); } };
  };

  /** Where a board's plugs are now, for the boards placed after it (the build says exactly: this is enough to choose by). */
  const note = (m: Module): string[] => {
    const mt = P.mounts.find((x) => x.slots.some((s) => s.module === m.id));
    if (!mt || mt.at == null) return [];
    const r = rails.find((x) => x.id === mt.rail);
    if (!r) return [];
    const k = mt.slots.findIndex((s) => s.module === m.id);
    const edge = (guess.get(m.id) ?? mt.slots[k].edge) as 'top';
    if (mt.kind !== 'flat' && (edge as string) === 'auto') return [];
    const g = mt.kind === 'flat' ? flatGeo(m, mt.turn) : seatGeo(p, m, k, edge, mt.turn, mt.slots[k].lie, r.dir);
    for (const [key, q] of g.plugs) { at.set(key, [alongOf(r) + mt.at + q.u, acrossOf(r) + q.v]); atz.set(key, q.z ?? 40); }
    rowOf.set(m.id, acrossOf(r));
    return [...g.plugs.keys()];
  };
  const done = new Map<string, { res: Undoable; keys: string[] }>();
  const settle = (m: Module, res: Undoable) => { done.set(m.id, { res, keys: note(m) }); placed.add(m.id); for (const r of ridersOf(p, m)) placed.add(r.id); cabled.add(m.id); };
  // probes and adapters go by their board (its dock's free slot, or beside it); the rest by cost, most cabled first
  const order: Module[] = [];
  while (todo.length) {
    todo.sort((a, b) => pull(b) - pull(a));
    const m = todo.shift()!;
    order.push(m);
    if (isProbe(m) && isAccessory(m.board)) {
      const s = seatCompanion(p, m.id);
      settle(m, { module: m.id, where: s.where === 'new' ? 'rail' : 'beside', mount: s.mount, rail: s.rail, undo: () => {} });
    } else settle(m, put(m));
  }
  // then each again with all the others in place: a board with no cable to the rack went anywhere the first time
  const movable = order.filter((m) => !(isProbe(m) && isAccessory(m.board)));
  if (movable.length > 1 && (p.links ?? []).length) for (let pass = 0; pass < 2; pass++) for (const m of movable) {
    const d = done.get(m.id)!;
    // (a board whose dock another new board stands behind stays: its dock goes with it)
    if (d.res.where !== 'slot' && order.some((o) => o !== m && done.get(o.id)!.res.where === 'slot' && done.get(o.id)!.res.mount === d.res.mount)) continue;
    d.res.undo(); for (const k of d.keys) at.delete(k);
    cabled.delete(m.id);
    settle(m, put(m));
  }
  return order.map((m) => { const { undo, ...rest } = done.get(m.id)!.res; void undo; return rest; });
}
