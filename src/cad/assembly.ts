// Multi-board assemblies: one holder per board, combined by stacking (corner towers with press-fit pegs),
// side by side (bosses + printed link bars), or back to back (bases together, printed snap rivets).
import type { Check, GenResult, Ghost, PartOut, Project, V2 } from '../model/types';
import { bbox, round } from '../geom/poly';
import { buildModule, computeLevels, transformMesh, type ArrangeHooks, type Job } from './generate';
import { box, cyl, freeAll, poly, rect2, toMesh, unionMF } from './kernel';
import { generatePanel } from './panelgen';

type M4 = number[];
const I4: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function mul(a: M4, b: M4): M4 {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
const tr = (x: number, y: number, z: number): M4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const rotX180: M4 = [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1];

export function generate(p: Project): GenResult {
  if (p.layout === 'panel') return generatePanel(p);
  const t0 = Date.now();
  const mods = p.modules;
  const n = mods.length;
  const multi = n > 1;
  const mode = multi ? p.arrange.mode : 'single';
  const facts = mods.map((m) => {
    const bb = bbox(m.board.outline);
    const gw = m.holder.gap + m.holder.wall;
    return { bb, gw, c: [(bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2] as V2, hw: (bb.x1 - bb.x0) / 2 + gw, hh: (bb.y1 - bb.y0) / 2 + gw, lv: computeLevels(m.board, m.holder) };
  });
  const T: M4[] = mods.map(() => I4);
  const hooks: ArrangeHooks[] = mods.map(() => ({}));
  const din = mods.map((_, i) => i === 0);
  const extra: PartOut[] = [];
  const notes: string[] = [];
  const checks: Check[] = [];

  if (mode === 'stack') {
    const HW = Math.max(...facts.map((f) => f.hw)), HH = Math.max(...facts.map((f) => f.hh));
    const common: V2[] = [[-HW - 3.3, -HH - 3.3], [HW + 3.3, -HH - 3.3], [HW + 3.3, HH + 3.3], [-HW - 3.3, HH + 3.3]];
    let z = 0;
    mods.forEach((_, i) => {
      const f = facts[i];
      const height = Math.max(f.lv.topMax + p.arrange.stackGap, f.lv.zw + 1);
      T[i] = tr(-f.c[0], -f.c[1], z);
      hooks[i].towers = { pts: common.map(([x, y]) => [x + f.c[0], y + f.c[1]] as V2), height, peg: i < n - 1, socket: i > 0 };
      z += height;
    });
    checks.push({ group: 'Layout', name: `${n} boards stacked`, value: `${round(z, 0)} mm tall`, status: 'info', detail: 'press each layer onto the pegs of the one below; the bottom layer carries the mount' });
  } else if (mode === 'side') {
    // links sit on the facing walls; the actual spacing is set after building, from the real footprints
    const axis = sideAxisOf(p);
    const ax = axis === 'x';
    mods.forEach((_, i) => { din[i] = true; }); // every holder gets its own clip: they sit next to each other on the rail
    if (p.arrange.links && axis !== 'z') {
      for (let i = 0; i + 1 < n; i++) {
        const a = facts[i], b = facts[i + 1];
        const span = Math.min(ax ? a.hh : a.hw, ax ? b.hh : b.hw) - 7;
        const offs = span > 8 ? [-span * 0.6, span * 0.6] : [0];
        for (const o of offs) {
          if (ax) {
            (hooks[i].links ??= []).push({ at: [a.bb.x1 + a.gw, a.c[1] + o], n: [1, 0] });
            (hooks[i + 1].links ??= []).push({ at: [b.bb.x0 - b.gw, b.c[1] + o], n: [-1, 0] });
          } else {
            (hooks[i].links ??= []).push({ at: [a.c[0] + o, a.bb.y1 + a.gw], n: [0, 1] });
            (hooks[i + 1].links ??= []).push({ at: [b.c[0] + o, b.bb.y0 - b.gw], n: [0, -1] });
          }
        }
      }
    }
  } else if (mode === 'back') {
    if (n > 2) notes.push('Back to back uses the first two boards; the others are left out.');
    const a = facts[0], b = facts[1];
    T[0] = tr(-a.c[0], -a.c[1], 0);
    T[1] = mul(rotX180, tr(-b.c[0], -b.c[1], 0));
    // rivet points: corners of the overlap of both boards, inset
    const x0 = Math.max(a.bb.x0 - a.c[0], b.bb.x0 - b.c[0]) + 6, x1 = Math.min(a.bb.x1 - a.c[0], b.bb.x1 - b.c[0]) - 6;
    const y0 = Math.max(a.bb.y0 - a.c[1], -(b.bb.y1 - b.c[1])) + 6, y1 = Math.min(a.bb.y1 - a.c[1], -(b.bb.y0 - b.c[1])) - 6;
    const pts: V2[] = x1 > x0 && y1 > y0 ? [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] : [[0, 0]];
    hooks[0].rivets = pts.map(([x, y]) => [x + a.c[0], y + a.c[1]] as V2);
    hooks[1].rivets = pts.map(([x, y]) => [x + b.c[0], -y + b.c[1]] as V2);
    const grip = mods[0].holder.base + mods[1].holder.base;
    extra.push(rivetPart(grip, pts.length));
    if (p.mount.kind === 'din' && p.mount.mode === 'flat') notes.push('Back to back needs the DIN clip on an edge: switch the mount to "Standing off the rail".');
    checks.push({ group: 'Layout', name: 'Back to back', value: `${pts.length} snap rivets`, status: 'info', detail: `bases held together by printed rivets through ${grip.toFixed(1)} mm` });
  }

  const warnings0: string[] = [];
  const outs = mods.slice(0, mode === 'back' ? 2 : n).map((m, i) => {
    const job: Job = { p, mi: i, b: m.board, H: m.holder, din: din[i] && !(mode === 'back' && p.mount.mode === 'flat'), stand: i === 0, hooks: hooks[i], name: m.board.name };
    try {
      return buildModule(job);
    } catch (e: any) {
      notes.push(`${m.board.name}: ${e?.message ?? e}`);
      return null;
    }
  });
  if (mode === 'side') placeSide(p, facts, outs, T, extra, checks, warnings0);
  const parts: PartOut[] = [], ghosts: Ghost[] = [];
  const warnings: string[] = [...notes, ...warnings0];
  outs.forEach((o, i) => {
    if (!o) return;
    const tag = multi ? `${mods[i].board.name}: ` : '';
    for (const pt of o.parts) parts.push({ ...pt, toAssembly: mul(T[i], pt.toAssembly) });
    for (const g of o.ghosts) ghosts.push({ ...g, mesh: transformMesh(g.mesh, T[i]) });
    warnings.push(...o.warnings.map((w) => tag + w));
    checks.push(...o.checks.map((c) => ({ ...c, group: multi ? `${mods[i].board.name} · ${c.group}` : c.group })));
  });
  parts.push(...extra);
  const ai = Math.min(p.active, outs.length - 1);
  const act = outs[ai] ?? outs.find(Boolean);
  const clipIdx = outs.findIndex((o) => o?.clipT);
  for (const pt of parts) {
    const fits = (pt.size[0] <= p.printer.bed[0] && pt.size[1] <= p.printer.bed[1]) || (pt.size[1] <= p.printer.bed[0] && pt.size[0] <= p.printer.bed[1]);
    if (!fits) warnings.push(`${pt.name} (${round(pt.size[0], 0)} × ${round(pt.size[1], 0)} mm) does not fit the ${p.printer.name} bed.`);
  }
  return {
    parts,
    ghosts,
    report: {
      warnings: [...new Set(warnings)],
      checks,
      levels: act?.levels ?? { base: 0, boardBottom: 0, boardTop: 0, wallTop: 0 },
      clipAt: act?.clipAt ?? null,
      clipFrame: clipIdx >= 0 ? mul(T[clipIdx], outs[clipIdx]!.clipT!) : null,
      timeMs: Date.now() - t0,
    },
  };
}

/** Link bar for side-by-side holders: two T heads that drop into facing T-slots. Printed flat. */
function linkPart(hb: number, wallGap: number, qty: number): PartOut {
  try {
    const half = (wallGap - 2 * 3.2) / 2 + 3.2 - 0.25; // from wall face: boss is 3.2 deep, head sits 0.25 inside it
    const prof = unionMF([
      rect2(-half, -2.45, -half + 1.6, 2.45).extrude(hb - 1.5),
      rect2(half - 1.6, -2.45, half, 2.45).extrude(hb - 1.5),
      rect2(-half + 1.5, -1.12, half - 1.5, 1.12).extrude(hb - 1.5),
    ]);
    const m = toMesh(prof);
    return { id: `link_${Math.round(wallGap * 10)}`, name: `Link bar (${wallGap.toFixed(1)} mm gap)`, qty: Math.max(1, qty), mesh: m, toAssembly: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -400, 1], volume: prof.volume(), size: [2 * half, 4.9, hb - 1.5], color: '#9d8cff' };
  } finally {
    freeAll();
  }
}

/** Snap rivet: head, shank through both bases, split barbed tip. Printed lying down, flat underside. */
function rivetPart(grip: number, qty: number): PartOut {
  try {
    const shank = grip + 0.3;
    const along = (r0: number, r1: number, x0: number, x1: number) => cyl(0, 0, x0, x1, r0, r1, 32).rotate([0, 90, 0]);
    let m = unionMF([along(3.2, 3.2, -1.3, 0), along(1.6, 1.6, -0.01, shank), along(1.95, 1.1, shank - 0.01, shank + 2.0)]);
    m = m.subtract(box(shank - 2.2, -0.42, -5, shank + 2.5, 0.42, 5)); // split tip, flexes sideways in the print plane
    m = m.subtract(box(-5, -5, -5, shank + 5, 5, -1.3)); // flat underside so it prints lying down
    const mesh = toMesh(m);
    const bb = m.boundingBox();
    void poly;
    return { id: 'rivet', name: 'Snap rivet (back to back)', qty, mesh, toAssembly: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -400, 1], volume: m.volume(), size: [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]], color: '#9d8cff' };
  } finally {
    freeAll();
  }
}

type Facts = { bb: ReturnType<typeof bbox>; gw: number; c: V2; hw: number; hh: number };

/** Side by side: place holders by their real footprint (cradles, caps and plugs included) and size the link bars. */
/** Row direction: along the rail when there is a DIN clip (parallel boards when the rail runs through them). */
export function sideAxisOf(p: Project): 'x' | 'y' | 'z' {
  const M = p.mount;
  if (M.kind !== 'din') return p.arrange.sideAxis;
  if (M.mode === 'flat') return M.rotation % 180 === 0 ? 'x' : 'y';
  const along = M.rotation === 90 || M.rotation === 270;
  if (!along) return 'z';
  return M.edge === 'bottom' || M.edge === 'top' ? 'x' : 'y';
}

function placeSide(p: Project, facts: Facts[], outs: (ReturnType<typeof buildModule> | null)[], T: M4[], extra: PartOut[], checks: Check[], warnings: string[]) {
  const axis = sideAxisOf(p);
  const ax = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const ext = outs.map((o, i) => {
    let lo = ax === 0 ? facts[i].bb.x0 - facts[i].gw : ax === 1 ? facts[i].bb.y0 - facts[i].gw : 0, hi = ax === 0 ? facts[i].bb.x1 + facts[i].gw : ax === 1 ? facts[i].bb.y1 + facts[i].gw : 0;
    if (!o) return { lo, hi };
    const scan = (pos: Float32Array, M: number[]) => {
      for (let k = 0; k < pos.length; k += 3) {
        const v = M[ax] * pos[k] + M[4 + ax] * pos[k + 1] + M[8 + ax] * pos[k + 2] + M[12 + ax];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    };
    for (const pt of o.parts) if (!pt.id.endsWith('_clip')) scan(pt.mesh.pos, pt.toAssembly);
    for (const g of o.ghosts) if (g.name.startsWith('plug')) scan(g.mesh.pos, I4);
    return { lo, hi };
  });
  let run = 0;
  const wallGap: number[] = [];
  const gap = p.arrange.sideGap + (p.arrange.links && ax < 2 ? 6.4 : 2);
  facts.forEach((f, i) => {
    if (!outs[i]) return;
    const shift = run - ext[i].lo;
    T[i] = ax === 0 ? tr(shift, -f.c[1], 0) : ax === 1 ? tr(-f.c[0], shift, 0) : tr(-f.c[0], -f.c[1], shift);
    if (i > 0 && ax < 2) {
      const prevWall = (ax === 0 ? facts[i - 1].bb.x1 : facts[i - 1].bb.y1) + facts[i - 1].gw + (T[i - 1][12 + ax]);
      const wall = (ax === 0 ? f.bb.x0 : f.bb.y0) - f.gw + shift;
      wallGap.push(wall - prevWall);
      if (wall - prevWall > 30) warnings.push(`${p.modules[i - 1].board.name} and ${p.modules[i].board.name}: plugs or cradles face each other, so they sit ${Math.round(wall - prevWall)} mm apart. Turn one board to bring them closer.`);
    }
    run = shift + ext[i].hi + gap;
  });
  if (ax === 2) {
    checks.push({ group: 'Layout', name: `${facts.length} boards side by side`, value: `${Math.round(run - gap)} mm of rail`, status: 'info', detail: 'parallel boards, each on its own clip, spaced along the rail' });
    return;
  }
  if (!p.arrange.links) return;
  const hb = Math.min(...facts.map((_, i) => Math.min(outs[i]?.levels.wallTop ?? 9, 9)));
  const byLen = new Map<number, number>();
  wallGap.forEach((g, i) => {
    const cnt = (Math.min(ax === 0 ? facts[i].hh : facts[i].hw, ax === 0 ? facts[i + 1].hh : facts[i + 1].hw) - 7) > 8 ? 2 : 1;
    const key = Math.round(g * 10) / 10;
    byLen.set(key, (byLen.get(key) ?? 0) + cnt);
  });
  let total = 0;
  for (const [g, cnt] of byLen) { extra.push(linkPart(hb, g, cnt)); total += cnt; }
  checks.push({ group: 'Layout', name: `${facts.length} boards side by side`, value: `${total} link bars`, status: 'info', detail: 'drop a link bar into each pair of facing slots; on a DIN rail every holder also has its own clip' });
}
