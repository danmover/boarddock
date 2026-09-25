// Panel mode: boards in docks (or flat clips) on DIN rails. Builds every holder, places each mount on its rail
// with the real 3D extents (so plugs and cradles never collide), starts new rows when a rail is full, and
// reports plug access, collisions, rail lengths and the parts list.
import type { Check, EdgeName, GenResult, Ghost, MeshData, Module, PanelReport, PartOut, Project, Rail, RailMount } from '../model/types';
import { MATERIALS } from '../model/library';
import { round } from '../geom/poly';
import { basis, dir, I4, inv, mul, rotZ, tr, type M4 } from '../geom/mat';
import { buildModule, transformMesh, type ModuleOut } from './generate';
import { freeAll, toMesh, type MF } from './kernel';
import { END_POSE, LEN_X, rail as railSolid, shoe, socket, SOCKET_Z } from './dock';
import { autoAssign, bestDock, classify, clipToRail, plugDirs, railMatrix, slotMatrix } from './dockplan';

const SHOE_BOX = { x: [-LEN_X / 2, LEN_X / 2], y: [-25.1, 25.1], z: [0, 29.5] };

interface Seat { mod: Module; mi: number; slot: number; edge: EdgeName; out: ModuleOut; M: M4 }
interface Placed { mt: RailMount; seats: Seat[]; lo: number; hi: number; ylo: number; yhi: number; zhi: number; boxes: { id: string; b: number[] }[]; lever: 1 | -1 }

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
  const placedIds = new Set(mounts.flatMap((mt) => mt.slots.map((s) => s.module)).filter(Boolean) as string[]);
  const unplaced = p.modules.filter((m) => !placedIds.has(m.id)).map((m) => m.id);
  if (unplaced.length) warnings.push(`${unplaced.length} board${unplaced.length > 1 ? 's are' : ' is'} not on a rail yet: drag ${unplaced.length > 1 ? 'them' : 'it'} onto a rail in the Panel step, or press Auto-arrange.`);

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
      const edge: EdgeName = sl.edge === 'auto' ? bestDock(m, railDir, slot, [mt.turn]).edge : sl.edge;
      try {
        const out = buildModule({
          p, mi: i, b: m.board, H: m.holder, din: mt.kind === 'flat', stand: false, hooks: {}, name: m.board.name,
          dock: mt.kind === 'dock' ? { edge, fit: P.fit ?? 0 } : undefined,
          mount: mt.kind === 'flat' ? { ...p.mount, kind: 'din', mode: 'flat', rotation: mt.turn, at: null } : undefined,
        });
        const M = mt.kind === 'dock' ? slotMatrix(mt.turn, slot, out.dockM!) : mul(clipToRail(p.mount.clipWidth), inv(out.clipT ?? I4));
        seats.push({ mod: m, mi: i, slot, edge, out, M });
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
    for (const pl of placed) {
      if (row.length && cursor + (pl.hi - pl.lo) > P.maxRail - margin) { rows.push(row); row = []; cursor = margin; }
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
      const r: Rail = { id: `r${k + 1}`, x, y, dir: P.rowDir, length: round(len, 0) };
      rails.push(r);
      rw.forEach((q, j) => { q.mt.rail = r.id; q.mt.id = `d${k + 1}.${j + 1}`; });
      prev = { x, y, ylo, yhi };
    });
    mounts = placed.map((q) => q.mt);
  } else {
    for (const r of rails) {
      const on = placed.filter((q) => q.mt.rail === r.id);
      let cursor = margin;
      for (const q of on) {
        if (q.mt.at == null) q.mt.at = Math.max(cursor - q.lo, 0);
        cursor = q.mt.at + q.hi + gap;
      }
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
    if (r.length == null) r.length = round(Math.max(need, 50), 0);
    else if (need - margin > r.length + 0.5 || start < -0.5) warnings.push(`Rail ${r.id.replace(/^r/, '')}: the mounts run past the end of the ${r.length} mm rail (need ${round(need, 0)} mm).`);
  }

  // ---- parts ----
  const parts: PartOut[] = [], ghosts: Ghost[] = [];
  const access: PanelReport['modules'] = [];
  const mountOut: PanelReport['mounts'] = [];
  const docks = placed.filter((q) => q.mt.kind === 'dock');
  const shoeInst: M4[] = [], sockInst: M4[] = [];
  try {
    const sh = docks.length ? rest(shoe(), END_POSE.pose) : null;
    const so = docks.length ? rest(socket(), END_POSE.pose) : null;
    for (const q of placed) {
      const r = railOf(q.mt)!;
      const R = mul(railMatrix(r), tr(q.mt.at!, 0, 0));
      if (q.mt.kind === 'dock') {
        shoeInst.push(mul(R, rotZ(q.lever > 0 ? 0 : 180), sh!.back));
        sockInst.push(mul(R, tr(0, 0, SOCKET_Z), rotZ(q.mt.turn), so!.back));
      }
      for (const s of q.seats) {
        const T = mul(R, s.M);
        for (const pt of s.out.parts) parts.push({ ...pt, toAssembly: mul(T, pt.toAssembly) });
        for (const g of s.out.ghosts) if (!g.name.startsWith('DIN rail')) ghosts.push({ ...g, mesh: transformMesh(g.mesh, T) });
        const bx = q.boxes.find((b) => b.id === s.mod.id)!.b;
        const acc = plugDirs(s.mod.board).map((d) => ({ ref: d.ref, type: d.type, ...classify(dir(T, d.v), r.dir) }));
        access.push({ id: s.mod.id, mount: q.mt.id, slot: s.slot, edge: s.edge, turn: q.mt.turn, foot: toPanel(r, q.mt.at!, bx), z1: bx[5], access: acc });
        const blocked = acc.filter((a) => a.ok === 'blocked');
        if (blocked.length) warnings.push(`${s.mod.board.name}: ${blocked.map((a) => a.ref).join(', ')} face${blocked.length > 1 ? '' : 's'} the wall. Turn the dock or pick another dock edge.`);
        warnings.push(...s.out.warnings.map((w) => `${s.mod.board.name}: ${w}`));
        checks.push(...s.out.checks.map((c) => ({ ...c, group: `${s.mod.board.name} · ${c.group}` })));
      }
      const all = [q.lo, q.ylo, 0, q.hi, q.yhi, q.zhi];
      const f = toPanel(r, q.mt.at!, all);
      const c = mul(railMatrix(r), tr(q.mt.at!, 0, 0));
      mountOut.push({ ...q.mt, at: q.mt.at!, x: c[12], y: c[13], foot: f, leverSide: q.lever });
    }
    const base = { toAssembly: I4, color: '' };
    if (sh && so) {
      parts.push({ ...base, id: 'dock_shoe', name: 'Rail shoe (thumb-lever release)', qty: docks.length, mesh: sh.mesh, toAssembly: shoeInst[0], instances: shoeInst.slice(1), volume: sh.volume, size: sh.size, color: '#f59e42' });
      parts.push({ ...base, id: 'dock_socket', name: 'Dock socket (turns 4 ways, 2 slots)', qty: docks.length, mesh: so.mesh, toAssembly: sockInst[0], instances: sockInst.slice(1), volume: so.volume, size: so.size, color: '#5b8def' });
    }
    for (const r of rails) {
      const m = toMesh(railSolid(r.length!));
      ghosts.push({ name: `DIN rail ${r.id}`, mesh: transformMesh(m, mul(railMatrix(r), tr(r.length! / 2, 0, 0))), color: '#94a3b8', opacity: 0.6 });
    }
  } finally {
    freeAll();
  }

  // ---- checks ----
  const eR = mat.E / MATERIALS.PETG.E;
  const allow = mat.strainAllow;
  const st = (eps: number): Check['status'] => (eps <= allow * 0.85 ? 'ok' : eps <= allow * 1.1 ? 'warn' : 'bad');
  if (docks.length) {
    // PETG numbers from the in-app 2D FEA (0.06 mm mesh), scaled by stiffness; the Check tab reruns it for your material
    checks.push({ group: 'Panel', name: 'Rail shoe release', value: `${(2.7 * eR).toFixed(1)} N push`, status: 'info', detail: 'lift the boards out first, then push the ridged lever pad beside the socket toward it (about 3.3 mm) and tilt the dock off the rail. A stop meets the post at 2.1 mm of jaw travel (1.7 needed), so the hinge cannot be over-bent. Each dock puts its lever on the side with the most room.' });
    checks.push({ group: 'Panel', name: 'Rail shoe hinge', value: '1.9% peak', status: st(0.019), detail: 'uniform 0.9 mm leaf above the lip, at its root fillet; 99% of the shoe stays under 0.6%. Clipping on: 4.3 N (PETG) at the jaw ramp.' });
    checks.push({ group: 'Panel', name: 'Socket latch (per board)', value: `${(9.8 * eR).toFixed(1)} N to plug in`, status: st(0.018), detail: `1.8% peak at the spring root while the tongue goes in, 1.3% while the button releases it; the nose clears the groove after 1.9 mm of the 3.1 mm button stroke; a stop post prevents over-bending` });
    checks.push({ group: 'Panel', name: 'Rail shoe pull-off', value: `~${Math.round(90 * (allow / 0.02))} N`, status: 'ok', detail: 'the hinge leaf stands above the lip, so a pull straight off the wall runs down the leaf and cannot pry the jaw open, friction or not; this is where the hinge reaches its strain limit.' });
    checks.push({ group: 'Panel', name: 'Socket to shoe hooks', value: '0.84% strain', status: st(0.0084), detail: 'press the socket into the shoe in any of 4 turns; a pull tightens the 10° hooks' });
  }
  const railLens = rails.map((r) => r.length!);
  checks.push({ group: 'Panel', name: 'Rails to cut', value: railLens.length ? railLens.map((l) => `${l} mm`).join(' + ') : 'none', status: 'info', detail: `${docks.length} dock${docks.length === 1 ? '' : 's'}, ${placed.length - docks.length} flat clip${placed.length - docks.length === 1 ? '' : 's'}; TS35 top-hat rail` });
  const depth = Math.max(0, ...placed.map((q) => q.zhi));
  checks.push({ group: 'Panel', name: 'Depth from the wall', value: `${round(depth, 0)} mm`, status: 'info', detail: 'furthest point of any holder, plug or button from the panel surface' });

  // ---- report ----
  const act = placed.flatMap((q) => q.seats).find((s) => s.mi === p.active) ?? placed[0]?.seats[0];
  let cx = 0, cy = 0;
  if (mountOut.length) {
    const xs = mountOut.flatMap((m) => [m.foot[0], m.foot[2]]), ys = mountOut.flatMap((m) => [m.foot[1], m.foot[3]]);
    cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  }
  const panel: PanelReport = { rails: rails as PanelReport['rails'], mounts: mountOut, modules: access, unplaced, depth, collisions };
  return {
    parts,
    ghosts,
    report: {
      warnings: [...new Set(warnings)],
      checks,
      levels: act?.out.levels ?? { base: 0, boardBottom: 0, boardTop: 0, wallTop: 0 },
      clipAt: null,
      clipFrame: basis([0, 0, 1], [0, 1, 0], [-1, 0, 0], [cx, cy, 0]),
      timeMs: Date.now() - t0,
      panel,
    },
  };
}
