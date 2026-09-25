// Builds every printable part for a project: the board holder (tray), DIN clip, plug caps, plus display ghosts
// (board, components, plugs, rail) and a report of checks. All parts come out in print orientation.
import type { Board, Check, EdgeName, GenResult, Ghost, HolderSettings, Loop, MeshData, MountSettings, PartOut, Project, V2 } from '../model/types';
import { DEFAULT_FEATURES, MATERIALS } from '../model/library';
import { bbox, centroid, compRect, extentAlong, inside, rad, rayExit, round } from '../geom/poly';
import type { CS, MF } from './kernel';
import { box, circle2, cyl, ext, extCh, freeAll, K, orientedBox, poly, rect2, roundCS, sweepTZ, toMesh, unionCS, unionMF } from './kernel';
import { buildClip, clipDims, clipSlots, hookOffset4, railProfile } from './dinclip';
import { textCS, textWidth } from './font';
import { computeLevels } from './levels';
import { DOCK_MIN_ZB, gripSpan, holderDock, HD, rod } from './dock';
import { dockFrame, dockSite, type DockSite } from './dockplan';
import { inv, type M4 } from '../geom/mat';

const ID = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Extra features a module gets from the multi-board arrangement (all in the module's own board frame). */
export interface ArrangeHooks {
  towers?: { pts: V2[]; height: number; peg: boolean; socket: boolean };
  links?: { at: V2; n: V2 }[];
  rivets?: V2[];
}

export interface Job {
  p: Project; mi: number; b: Board; H: HolderSettings; din: boolean; stand: boolean; hooks: ArrangeHooks; name: string;
  mount?: MountSettings; // overrides p.mount (panel flat clips)
  dock?: { edge: EdgeName; fit?: number }; // holder plugs into a rail dock with this board edge
}

interface Ctx {
  p: Project;
  job: Job;
  H: HolderSettings;
  b: Board;
  base: number;
  s: number; // standoff
  zb: number;
  zt: number;
  zw: number;
  O: CS;
  inner: CS;
  outer: CS;
  warnings: string[];
  checks: Check[];
  pos: MF[]; // added to the holder
  neg: MF[]; // cut from the holder
  late: MF[]; // added after the cuts (cradles etc. carry their own cuts)
  keep: CS[]; // zones the base pattern must avoid
  blocked: { poly: Loop; why: string }[]; // wall stretches used by openings/features (tabs and labels avoid them)
  parts: PartOut[];
  ghosts: Ghost[];
  standoffs: { x: number; y: number; r: number }[];
  keepouts: { rect: Loop; need: number; why: string }[];
  dock: DockSite | null;
}

const dirOf = (a: number): V2 => [Math.cos(rad(a)), Math.sin(rad(a))];
const left = (d: V2): V2 => [-d[1], d[0]];
const add = (a: V2, b: V2, k = 1): V2 => [a[0] + b[0] * k, a[1] + b[1] * k];

function rectDist(p: V2, r: Loop): number {
  if (inside(p, r)) return 0;
  let d = Infinity;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    d = Math.min(d, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return d;
}

function polysOverlap(a: Loop, b: Loop): boolean {
  if (a.some((p) => inside(p, b)) || b.some((p) => inside(p, a))) return true;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    const p1 = a[i], p2 = a[(i + 1) % a.length], p3 = b[j], p4 = b[(j + 1) % b.length];
    const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
    if (Math.abs(d) < 1e-12) continue;
    const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
    const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true;
  }
  return false;
}

function orientedRect(o: V2, d: V2, s0: number, s1: number, t0: number, t1: number): Loop {
  const t = left(d);
  return [add(add(o, d, s0), t, t0), add(add(o, d, s1), t, t0), add(add(o, d, s1), t, t1), add(add(o, d, s0), t, t1)];
}

function matFromBasis(x: number[], y: number[], z: number[], o: number[]) {
  return [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, o[0], o[1], o[2], 1];
}

function meshFrom(m: MF): MeshData {
  return toMesh(m);
}

function part(id: string, name: string, m: MF, toAssembly: number[], color: string, qty = 1): PartOut {
  // rest on the bed: translate so min z = 0, keep xy
  const bb = m.boundingBox();
  const moved = m.translate([0, 0, -bb.min[2]]);
  const T = [...toAssembly];
  // compensate: assembly = A * (p + (0,0,minz))
  T[12] += toAssembly[8] * bb.min[2];
  T[13] += toAssembly[9] * bb.min[2];
  T[14] += toAssembly[10] * bb.min[2];
  return { id, name, qty, mesh: meshFrom(moved), toAssembly: T, volume: m.volume(), size: [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]], color };
}

// ---------------------------------------------------------------------------------------------

export { computeLevels } from './levels';

export interface ModuleOut { parts: PartOut[]; ghosts: Ghost[]; warnings: string[]; checks: Check[]; levels: GenResult['report']['levels']; clipAt: V2 | null; clipT: number[] | null; dockM: M4 | null }

export function buildModule(job: Job): ModuleOut {
  try {
    return build(job);
  } finally {
    freeAll();
  }
}

function build(job: Job): ModuleOut {
  const { p, b, H } = job;
  const warnings: string[] = [...b.notes];
  const checks: Check[] = [];
  const mat = MATERIALS[H.material];

  // ---- clearance under the board ----
  const keepouts: Ctx['keepouts'] = [];
  for (const c of b.comps) {
    if (c.side === 'bottom' && c.h > 0) keepouts.push({ rect: compRect(c, 0.5), need: c.h + 0.5, why: `${c.ref} (bottom, ${round(c.h, 1)} mm)` });
    if (c.side === 'top' && c.tht) keepouts.push({ rect: compRect(c, 0.6), need: H.leadLen + 0.4, why: `${c.ref} leads` });
  }
  const site = job.dock ? dockSite(b, H, job.dock.edge) : null;
  const { needMax, base, s, zb, zt, zw } = computeLevels(b, H, site?.minZb ?? 0);
  const O = poly(b.outline);
  const inner = O.offset(H.gap, 'Round');
  const outer = O.offset(H.gap + H.wall, 'Round');
  const C: Ctx = { p, job, H, b, base, s, zb, zt, zw, O, inner, outer, warnings, checks, pos: [], neg: [], late: [], keep: [], blocked: [], parts: [], ghosts: [], standoffs: [], keepouts, dock: site };
  checks.push({ group: 'Board', name: 'Clearance under the board', value: `${round(s, 1)} mm`, status: 'info', detail: needMax ? `tallest underside item needs ${round(needMax, 1)} mm (${keepouts.sort((a, c) => c.need - a.need)[0].why}); deeper items get pockets in the base` : 'nothing under the board' });

  // ---- base and wall ----
  C.pos.push(extCh(outer, 0, base, 0, H.chamfer ? 0.4 : 0));
  const ring = outer.subtract(inner);
  const wallParts: MF[] = [ext(ring, 0, zw - (H.chamfer ? 0.6 : 0))];
  if (H.chamfer) for (let i = 1; i <= 3; i++) {
    const r = outer.offset(-i * 0.2, 'Round').subtract(inner.offset(Math.min(i, 2) * 0.2, 'Round'));
    wallParts.push(ext(r, zw - 0.6 + (i - 1) * 0.2, zw - 0.6 + i * 0.2));
  }
  C.pos.push(unionMF(wallParts));

  connectors(C);
  overhangs(C);
  if (site) dockBlocks(C, site);
  // label first so it gets a long free wall; if that leaves no room for two fingers, drop the label
  const mark = { pos: C.pos.length, neg: C.neg.length, late: C.late.length, blocked: C.blocked.length, warn: C.warnings.length, checks: C.checks.length };
  const labelled = H.label.trim() ? label(C) : false;
  let tabsUsed = tabs(C);
  if (labelled && tabsUsed.length < 2 && (H.tabs === 'on' || (H.tabs === 'auto' && !C.b.holes.some((h) => h.use === 'snap')))) {
    C.pos.length = mark.pos; C.neg.length = mark.neg; C.late.length = mark.late; C.blocked.length = mark.blocked; C.warnings.length = mark.warn; C.checks.length = mark.checks;
    tabsUsed = tabs(C);
    C.checks.push({ group: 'Holder', name: 'Label', value: 'left off', status: 'info', detail: 'it would take the wall the snap fingers need; shorten it to fit both' });
  }
  standoffs(C, tabsUsed.length >= 2);
  pockets(C);
  if (job.din && (job.mount ?? p.mount).kind === 'din') mountDin(C);
  if (site) dockFeatures(C, site);
  if (job.stand && p.stand.enabled) stand(C);
  arrangeFeatures(C);
  if (H.notches) notches(C, tabsUsed);
  pattern(C);

  // ---- assemble the holder ----
  let holder = unionMF(C.pos);
  if (C.neg.length) holder = holder.subtract(unionMF(C.neg));
  if (C.late.length) holder = unionMF([holder, ...C.late]);
  const pieces = holder.decompose();
  if (pieces.length > 1) {
    // keep the main body, report stray islands (can happen with odd user geometry)
    const main = pieces.reduce((a, c) => (c.volume() > a.volume() ? c : a));
    const lost = pieces.filter((x) => x !== main).reduce((sum, x) => sum + x.volume(), 0);
    if (lost > 1) warnings.push(`${pieces.length - 1} loose piece(s) (${round(lost, 0)} mm³) were dropped from the holder. Check features near the board edge.`);
    holder = main;
  }
  C.parts.unshift(part('holder', `Holder: ${job.name}`, holder, ID, H.color ?? '#e4ebe6'));
  for (const pt of C.parts) pt.id = `m${job.mi}_${pt.id}`;

  // ---- ghosts ----
  boardGhosts(C);

  // ---- summary checks ----
  for (const pt of C.parts) {
    const fits = (pt.size[0] <= p.printer.bed[0] && pt.size[1] <= p.printer.bed[1]) || (pt.size[1] <= p.printer.bed[0] && pt.size[0] <= p.printer.bed[1]);
    if (!fits) warnings.push(`${pt.name} (${round(pt.size[0], 0)} × ${round(pt.size[1], 0)} mm) does not fit the ${p.printer.name} bed.`);
  }
  checks.push({ group: 'Print', name: 'Material', value: H.material, status: H.material === 'PLA' ? 'warn' : 'ok', detail: H.material === 'PLA' ? `PLA is stiff and brittle for springs and softens at ~${mat.tg} °C. PETG, ASA or PA are better for clips.` : `strain limit used for springs: ${(mat.strainAllow * 100).toFixed(1)}%` });
  const clip = C.parts.find((x) => x.id.endsWith('_clip'));
  return { parts: C.parts, ghosts: C.ghosts, warnings, checks, levels: { base, boardBottom: zb, boardTop: zt, wallTop: zw }, clipAt: (C as any).clipAt ?? null, clipT: clip ? clip.toAssembly : null, dockM: site ? dockFrame(site.edge, site.tc, site.L0) : null };
}

// ---------------------------------------------------------------------------------------------
function strainStatus(C: Ctx, eps: number): Check['status'] {
  const allow = MATERIALS[C.H.material].strainAllow;
  return eps <= allow * 0.85 ? 'ok' : eps <= allow * 1.1 ? 'warn' : 'bad';
}

function standoffs(C: Ctx, fingersHold: boolean) {
  const { b, base, zb, zt } = C;
  const H = C.H;
  let snaps = 0;
  for (const h of b.holes) {
    if (h.use === 'none') continue;
    const at: V2 = [h.x, h.y];
    let rMax = h.d / 2 + 2.2;
    for (const k of C.keepouts) { const d = rectDist(at, k.rect); if (d > 0) rMax = Math.min(rMax, d - 0.2); }
    const r = Math.max(h.d / 2 + 0.6, rMax);
    if (rMax < h.d / 2 + 0.6) C.warnings.push(`Standoff at hole (${round(h.x, 1)}, ${round(h.y, 1)}) touches a part under the board; it was kept at the minimum size.`);
    C.standoffs.push({ x: h.x, y: h.y, r });
    C.keep.push(circle2(h.x, h.y, r + 1.4));
    C.pos.push(cyl(h.x, h.y, base - 0.01, zb, r));
    C.pos.push(cyl(h.x, h.y, base - 0.01, base + 0.4, r + 0.5), cyl(h.x, h.y, base + 0.39, base + 0.8, r + 0.25));
    const rp = h.d / 2 - H.pinClear;
    const snap = h.use === 'snap' || (h.use === 'auto' && !fingersHold && h.d >= 2.0);
    if (snap && h.d >= 1.8) {
      snaps++;
      const barb = Math.min(0.3, Math.max(0.2, 0.08 * h.d));
      const sw = Math.min(1.1, Math.max(0.6, 0.3 * h.d));
      const cone = rp + barb - 0.45 * rp;
      C.pos.push(cyl(h.x, h.y, zb - 0.01, zt + 0.1, rp));
      C.pos.push(cyl(h.x, h.y, zt + 0.1, zt + 0.1 + cone, rp + barb, 0.45 * rp));
      const slotDepth = Math.min(2.5, C.s - 0.6);
      C.neg.push(box(h.x - sw / 2, h.y - rp - barb - 0.1, zb - slotDepth, h.x + sw / 2, h.y + rp + barb + 0.1, zt + 5));
      const L = zt + 0.1 + cone / 2 - (zb - slotDepth);
      const halfT = rp - sw / 2;
      const defl = barb + H.pinClear * 0 + 0.05;
      const eps = (3 * halfT * defl) / (2 * L * L);
      if (snaps === 1) C.checks.push({ group: 'Board', name: `Snap pins (Ø${round(h.d, 2)} holes)`, value: `${(eps * 100).toFixed(2)}% strain`, status: strainStatus(C, eps * 1.3), detail: `split pin, ${round(barb, 2)} mm barb, ${round(L, 1)} mm flexing length. Bends across layers, so judged 30% stricter.` });
    } else {
      C.pos.push(cyl(h.x, h.y, zb - 0.01, zt + 0.5, rp), cyl(h.x, h.y, zt + 0.49, zt + 0.5 + rp * 0.5, rp, rp * 0.5));
    }
  }
  if (!fingersHold && !snaps && C.b.holes.length) C.warnings.push('Neither wall fingers nor snap pins hold this board: it sits loose in the tray. Enable fingers or set holes to snap.');
}

// ------------------------------- connectors ------------------------------------------------------
function connectors(C: Ctx) {
  const { b, zt, zb, zw } = C;
  const H = C.H;
  const F = { ...DEFAULT_FEATURES, ...(H.feat ?? {}) };
  const specs: CradleSpec[] = [];
  for (const c of b.comps) {
    const cn = c.conn;
    if (!cn || c.hidden) continue;
    if (cn.entry === 'top') {
      if (cn.tie && F.ties) tieAnchor(C, [c.x, c.y], null);
      continue;
    }
    const d = dirOf(cn.angle);
    const mouth = add([c.x, c.y], d, extentAlong(c, cn.angle));
    const zAx = c.side === 'top' ? zt + cn.zc : zb - cn.zc;
    const { w: pw, h: ph, len: pl } = cn.plug;
    const cl = 0.6;
    // signed distance from the mouth to the board edge along d (negative when the receptacle overhangs)
    const sEdge = inside(mouth, C.b.outline) ? Math.min(rayExit(mouth, d, C.b.outline), 50) : -Math.min(rayExit(mouth, [-d[0], -d[1]], C.b.outline), 50);
    const toOut = sEdge + H.gap + H.wall; // outer face of the wall
    const zLo = zAx - ph / 2 - cl, zHi = Math.max(zAx + ph / 2 + cl, zw + 1);
    C.neg.push(orientedBox(mouth, d, Math.min(-0.6, sEdge - 0.5), toOut + 4, -(pw / 2 + cl), pw / 2 + cl, zLo, zHi + 20));
    C.blocked.push({ poly: orientedRect(mouth, d, -2, toOut + 2, -(pw / 2 + cl + 3), pw / 2 + cl + 3), why: c.ref });
    // plug ghost
    C.ghosts.push({ name: `plug ${c.ref}`, mesh: meshFrom(orientedBox(mouth, d, 0.4, 0.4 + pl, -pw / 2, pw / 2, zAx - ph / 2, zAx + ph / 2)), color: '#e8a15a', opacity: 0.33 });
    if (cn.cradle && F.cradles && ph > 0.5) {
      specs.push({ ref: c.ref, mouth, d, sEdge, toOut, zAx, pw, ph, pl, cap: cn.cap && F.caps, angle: cn.angle });
    } else if (cn.guard && F.guards) {
      // collar that shields the receptacle and frames the opening
      const ow = pw + 2 * cl, oh = ph + 2 * cl;
      const frame = roundCS(rect2(-(ow / 2 + 1.8), 0, ow / 2 + 1.8, zAx + oh / 2 + 1.8), 0.8).subtract(rect2(-ow / 2, zLo, ow / 2, zAx + oh / 2)).intersect(rect2(-50, 0, 50, 200));
      C.late.push(sweepTZ(mouth, d, frame, toOut - 0.6, toOut + 2.5));
    }
    if (cn.tie && F.ties) tieAnchor(C, mouth, { d, half: pw / 2 + cl });
  }
  buildCradles(C, specs);
}

interface CradleSpec { ref: string; mouth: V2; d: V2; sEdge: number; toOut: number; zAx: number; pw: number; ph: number; pl: number; cap: boolean; angle: number }

const CW = 1.8; // cradle side wall
const CC = 0.3; // plug clearance in the cradle

/**
 * U-cradles outside the wall that carry the plug bodies. Neighbouring connectors on the same edge share walls and
 * one snap-on cap, so tightly packed plugs (like a Raspberry Pi's front edge) still get full protection.
 */
function buildCradles(C: Ctx, specs: CradleSpec[]) {
  const H = C.H;
  const ok = specs.filter((sp) => {
    const zf = sp.zAx - sp.ph / 2 - CC;
    if (zf < 0.8) C.warnings.push(`${sp.ref}: plug axis is too close to the bed for a cradle (floor at ${round(zf, 1)} mm). Raise the clearance under the board.`);
    return zf >= 0.8;
  });
  // group by edge direction, then by adjacency along the edge
  const groups: CradleSpec[][] = [];
  const byDir = new Map<number, CradleSpec[]>();
  for (const sp of ok) { const k = Math.round((((sp.angle % 360) + 360) % 360)); (byDir.get(k) ?? byDir.set(k, []).get(k)!).push(sp); }
  for (const list of byDir.values()) {
    const d = list[0].d, t = left(d);
    const pos = (sp: CradleSpec) => sp.mouth[0] * t[0] + sp.mouth[1] * t[1];
    list.sort((a, b2) => pos(a) - pos(b2));
    let cur: CradleSpec[] = [];
    for (const sp of list) {
      const prev = cur[cur.length - 1];
      if (prev && pos(sp) - sp.pw / 2 - (pos(prev) + prev.pw / 2) - 2 * (CC + CW) < 3) cur.push(sp);
      else { if (cur.length) groups.push(cur); cur = [sp]; }
    }
    if (cur.length) groups.push(cur);
  }
  for (const g of groups) cradleGroup(C, g, H);
}

function cradleGroup(C: Ctx, g: CradleSpec[], H: HolderSettings) {
  const o = g[0].mouth, d = g[0].d, t = left(d);
  const T = (sp: CradleSpec) => (sp.mouth[0] - o[0]) * t[0] + (sp.mouth[1] - o[1]) * t[1];
  const S = (sp: CradleSpec) => (sp.mouth[0] - o[0]) * d[0] + (sp.mouth[1] - o[1]) * d[1];
  const bodies: MF[] = [], cuts: MF[] = [];
  let sMin = Infinity, sMax = -Infinity, capS0 = -Infinity;
  const m = g.map((sp) => {
    const ti = T(sp), si = S(sp);
    const zf = sp.zAx - sp.ph / 2 - CC;
    const halfIn = sp.pw / 2 + CC, halfOut = halfIn + CW;
    const zs = Math.min(sp.zAx + sp.ph * 0.2, sp.zAx + sp.ph / 2 - 0.5);
    const len = Math.min(26, Math.max(12, 0.55 * sp.pl));
    const s0 = si + Math.min(0.3, sp.sEdge + H.gap + 0.3), s1 = si + Math.max(sp.toOut, 0) + len;
    sMin = Math.min(sMin, s0); sMax = Math.max(sMax, s1);
    capS0 = Math.max(capS0, si + Math.max(sp.toOut, 0.5) + 1.5);
    return { sp, ti, si, zf, halfIn, halfOut, zs, s0, s1 };
  });
  for (const k of m) {
    bodies.push(sweepTZ(o, d, roundCS(rect2(k.ti - k.halfOut, 0, k.ti + k.halfOut, k.zs), 0.6), k.s0, k.s1));
    cuts.push(sweepTZ(o, d, rect2(k.ti - k.halfIn, k.zf, k.ti + k.halfIn, k.zs + 30), sMin - 1, sMax + 1));
    if (k.zf > 4.5 && k.halfIn > 2.5) {
      const w2 = k.halfIn - 1.2, top = k.zf - 1.6;
      cuts.push(sweepTZ(o, d, poly([[k.ti - w2, -1], [k.ti + w2, -1], [k.ti + w2, top - w2], [k.ti, top], [k.ti - w2, top - w2]], 'NonZero'), k.s0 - 1, k.s1 + 1));
    }
    // zip-tie tunnel under the floor near the outer end (or side grooves if there's no room)
    const sT = k.s1 - 4.5;
    if (k.zf > 2.8) cuts.push(orientedBox(o, d, sT - 2, sT + 2, k.ti - k.halfOut - 1, k.ti + k.halfOut + 1, k.zf - 2.3, k.zf - 0.7));
  }
  // fill the gaps between neighbours so they share one solid wall
  for (let i = 0; i + 1 < m.length; i++) {
    const a = m[i], b2 = m[i + 1];
    const t0 = a.ti + a.halfOut - 0.01, t1 = b2.ti - b2.halfOut + 0.01;
    if (t1 > t0) bodies.push(orientedBox(o, d, Math.max(a.s0, b2.s0), Math.min(a.s1, b2.s1), t0, t1, 0, Math.min(a.zs, b2.zs)));
  }
  const first = m[0], last = m[m.length - 1];
  const tL = first.ti - first.halfOut, tR = last.ti + last.halfOut;
  const capL = 8, sc0 = capS0, sc1 = sc0 + capL + 0.6;
  const withCap = g.some((sp) => sp.cap);
  const zFloorMin = Math.min(...m.map((k) => k.zf));
  const ledgeZ0 = Math.max(0.6, zFloorMin - 4.0 > 0.6 ? zFloorMin - 4.0 : zFloorMin - 1.5);
  if (withCap) for (const [tw, sgn] of [[tL, -1], [tR, 1]] as [number, number][]) {
    const pr = poly([[tw - sgn * 0.01, ledgeZ0], [tw + sgn * 0.7, ledgeZ0], [tw + sgn * 0.7, ledgeZ0 + 0.3], [tw - sgn * 0.01, ledgeZ0 + 1.0]], 'NonZero');
    bodies.push(sweepTZ(o, d, pr, sc0, sc1));
  }
  C.late.push(unionMF(bodies).subtract(unionMF(cuts)));
  C.blocked.push({ poly: orientedRect(o, d, sMin, sMax, tL - 2, tR + 2), why: 'cradle' });
  for (const k of m) {
    const F = 20, hW = Math.max(0.5, k.zs - k.zf), Lw = k.s1 - k.s0;
    const sigma = (6 * F * hW) / (Lw * CW * CW);
    C.checks.push({ group: 'Plugs', name: `${k.sp.ref}: cradle wall, 20 N side knock`, value: `${round(sigma, 1)} MPa`, status: sigma < MATERIALS[H.material].yield * 0.5 ? 'ok' : 'warn', detail: `the plug bears on the cradle (${round(hW, 1)} mm wall over ${round(Lw, 1)} mm), not on the connector's solder joints` });
  }
  if (!withCap) return;
  // one cap over the whole group: top plate, a pad pressing on each plug, legs with hooks at the two outer ends
  const legT = 1.1, top = 1.6, gp = 0.25, hook = 0.6;
  const plugTops = m.map((k) => k.sp.zAx + k.sp.ph / 2);
  const zPlate = Math.max(...plugTops) + 0.2;
  const zHook = ledgeZ0 - 0.05;
  const xl = tL - gp, xr = tR + gp;
  let prof = poly([
    [xl - legT, zHook - 1.4], [xl + hook, zHook - 0.6], [xl + hook, zHook], [xl, zHook], [xl, zPlate], [xr, zPlate], [xr, zHook], [xr - hook, zHook], [xr - hook, zHook - 0.6], [xr + legT, zHook - 1.4],
    [xr + legT, zPlate + top - 0.6], [xr + legT - 0.6, zPlate + top], [xl - legT + 0.6, zPlate + top], [xl - legT, zPlate + top - 0.6],
  ], 'NonZero');
  m.forEach((k, i) => { if (zPlate - plugTops[i] > 0.4) prof = prof.add(rect2(k.ti - k.halfIn + 0.4, plugTops[i] + 0.2, k.ti + k.halfIn - 0.4, zPlate + 0.01)); });
  const mesh = prof.extrude(capL);
  const at: V2 = add(o, d, sc0 + 0.3);
  const Tm = matFromBasis([t[0], t[1], 0], [0, 0, 1], [d[0], d[1], 0], [at[0], at[1], 0]);
  const L = zPlate - zHook;
  const eps = (3 * legT * (hook + 0.1)) / (2 * L * L);
  const refs = g.map((sp) => sp.ref).join(' + ');
  C.parts.push(part(`cap_${C.parts.length}`, `Plug cap (${refs})`, mesh, Tm, '#ffc857'));
  C.checks.push({ group: 'Plugs', name: `Cap legs (${refs})`, value: `${(eps * 100).toFixed(2)}% strain`, status: strainStatus(C, eps), detail: `${round(L, 1)} mm legs, ${hook} mm hooks under the cradle ledges; they flex within the layers` });
}

function tieAnchor(C: Ctx, at: V2, edgeConn: { d: V2; half: number } | null) {
  // find the nearest wall point and its outward normal
  const b = C.b, H = C.H;
  let q: V2, n: V2;
  if (edgeConn) {
    const t = left(edgeConn.d);
    // put it beside the opening on the side with more room
    const cand = [add(at, t, edgeConn.half + 4), add(at, t, -(edgeConn.half + 4))];
    q = cand.find((pt) => !C.blocked.some((bl) => inside(pt, bl.poly))) ?? cand[0];
    n = edgeConn.d;
  } else {
    let best = { d: Infinity, q: at as V2, n: [0, -1] as V2 };
    for (let i = 0; i < b.outline.length; i++) {
      const a = b.outline[i], c = b.outline[(i + 1) % b.outline.length];
      const dx = c[0] - a[0], dy = c[1] - a[1], L2 = dx * dx + dy * dy || 1;
      const tt = Math.max(0, Math.min(1, ((at[0] - a[0]) * dx + (at[1] - a[1]) * dy) / L2));
      const pq: V2 = [a[0] + tt * dx, a[1] + tt * dy];
      const dd = Math.hypot(pq[0] - at[0], pq[1] - at[1]);
      const L = Math.sqrt(L2);
      if (dd < best.d) best = { d: dd, q: pq, n: [dy / L, -dx / L] };
    }
    q = best.q;
    n = best.n;
  }
  const o = add(q, n, H.gap + H.wall - 0.3);
  const hgt = Math.min(C.zw, 7);
  // block with a vertical tunnel for a 2.5-3.6 mm zip tie; tie wraps the cable against the block
  const blk = orientedBox(o, n, 0, 4.2, -3.2, 3.2, 0, hgt).subtract(orientedBox(o, n, 1.2, 2.9, -2.0, 2.0, -1, hgt + 1));
  C.late.push(blk);
  C.blocked.push({ poly: orientedRect(o, n, -2, 5, -5, 5), why: 'tie anchor' });
}

function overhangs(C: Ctx) {
  // component bodies that stick out past the board edge need openings in the wall
  const { b, zt, zb } = C;
  for (const c of b.comps) {
    if (c.hidden || c.h <= 0) continue;
    const r = compRect(c, 0.4);
    if (r.every((pt) => inside(pt, b.outline))) continue;
    const bb = bbox(r);
    const z0 = c.side === 'top' ? zt - 0.4 : zb - c.h - 0.4;
    const z1 = c.side === 'top' ? zt + c.h + 50 : zb + 0.4;
    const rc = poly(r).extrude(z1 - z0).translate([0, 0, z0]);
    C.neg.push(rc);
    C.blocked.push({ poly: compRect(c, 3), why: c.ref });
    void bb;
  }
}

// ------------------------------- wall snap fingers ----------------------------------------------
interface Site { q: V2; d: V2; n: V2; seg: number; len: number; free: number }

function edgeSites(C: Ctx, need: number, extraBlocked: Loop[] = [], checkComps = true): Site[] {
  const b = C.b, H = C.H;
  const sites: Site[] = [];
  const L = b.outline.length;
  for (let i = 0; i < L; i++) {
    const a = b.outline[i], c = b.outline[(i + 1) % L];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (len < need + 3) continue;
    const d: V2 = [(c[0] - a[0]) / len, (c[1] - a[1]) / len];
    const n: V2 = [d[1], -d[0]];
    // scan along the segment for stretches of length `need` free of blocked zones
    for (let s = 1.5; s + need <= len - 1.5; s += 1) {
      const q = add(a, d, s);
      const zone = orientedRect(q, d, 0, need, -(H.gap + H.wall + 1), 2.5); // local t = inward
      const conflict = C.blocked.some((bl) => polysOverlap(zone, bl.poly)) || extraBlocked.some((bl) => polysOverlap(zone, bl)) ||
        (checkComps && b.comps.some((cc) => cc.side === 'top' && !cc.hidden && cc.h > 0 && polysOverlap(zone, compRect(cc, 0.3))));
      if (!conflict) sites.push({ q, d, n, seg: i, len, free: s });
    }
  }
  return sites;
}

function pickSpread(sites: Site[], count: number, center: V2): Site[] {
  // choose sites on different sides: bucket by outward normal, prefer the middle of each side
  const buckets = new Map<number, Site[]>();
  for (const s of sites) {
    const k = Math.round((Math.atan2(s.n[1], s.n[0]) / Math.PI) * 2) & 3;
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(s);
  }
  const best: Site[] = [];
  const order = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [, list] of order) {
    // most central along the side
    list.sort((a, b) => Math.abs(a.free + 7 - a.len / 2) - Math.abs(b.free + 7 - b.len / 2));
    best.push(list[0]);
  }
  // prefer opposite pairs
  best.sort((a, b) => Math.hypot(b.q[0] - center[0], b.q[1] - center[1]) - Math.hypot(a.q[0] - center[0], a.q[1] - center[1]));
  return best.slice(0, count);
}

function tabs(C: Ctx): Site[] {
  const H = C.H;
  const snaps = C.b.holes.filter((h) => h.use === 'snap').length;
  const want = H.tabs === 'on' || (H.tabs === 'auto' && snaps < 2);
  if (!want) return [];
  const bb = bbox(C.b.outline);
  const small = Math.min(bb.x1 - bb.x0, bb.y1 - bb.y0) < 30;
  const Lf = small ? 10 : 14;
  const sites = edgeSites(C, Lf + 1);
  const chosen = pickSpread(sites, 4, centroid(C.b.outline));
  const pinsCanHold = C.b.holes.filter((h) => (h.use === 'auto' || h.use === 'snap') && h.d >= 1.8).length >= 2;
  if (chosen.length < 2) {
    if (pinsCanHold) C.checks.push({ group: 'Board', name: 'Wall snap fingers', value: 'no room', status: 'info', detail: 'plugs and the dock take the free wall; snap pins in the mounting holes hold the board instead' });
    else C.warnings.push('Could not find room for two wall snap fingers: the board is held by the wall only. Add holes or free up an edge.');
  }
  const { zt, zw } = C;
  const tf = small ? 1.0 : 1.2;
  const Leff0 = Lf * 0.78 - 0.2;
  const allow = MATERIALS[H.material].strainAllow;
  const lip = Math.max(0.4, Math.min(H.tabLip, (0.8 * allow * 2 * Leff0 * Leff0) / (3 * tf)));
  const zTop = zt + 0.1 + 0.3 + lip + H.gap + 0.4;
  for (const st of chosen) {
    const { q, d } = st;
    const tw0 = -(H.gap + H.wall), tw1 = -H.gap; // wall band in local t (inward positive)
    C.pos.push(orientedBox(q, d, 0, Lf, tw0, tw1, Math.max(zw - 0.3, zt - 0.5), zTop));
    C.neg.push(orientedBox(q, d, 0, Lf + 0.6, tw0 - 0.1, tw1 + 0.05, zt - 1.0, zt - 0.4)); // slot under the finger
    C.neg.push(orientedBox(q, d, Lf, Lf + 0.6, tw0 - 0.1, tw1 + 0.05, zt - 1.0, zTop + 1)); // free end
    C.neg.push(orientedBox(q, d, 1.5, Lf + 0.6, tw0 - 0.1, tw1 - tf, zt - 1.0, zTop + 1)); // thin the finger
    const lipProf = poly([[tw1 - 0.01, zt + 0.1], [lip, zt + 0.1], [lip, zt + 0.4], [tw1 - 0.01, zt + 0.4 + lip + H.gap]], 'NonZero');
    C.late.push(sweepTZ(q, d, lipProf, Lf * 0.55, Lf - 0.4));
    // pull nub on the outside of the free end
    C.late.push(orientedBox(q, d, Lf - 3, Lf - 0.4, tw0 - 0.9, tw1 - tf + 0.2, zt - 0.3, zTop));
    C.blocked.push({ poly: orientedRect(q, d, -1, Lf + 1.6, -(H.gap + H.wall + 2), 3), why: 'finger' });
  }
  if (chosen.length) {
    const Leff = Leff0;
    const eps = (3 * tf * lip) / (2 * Leff * Leff);
    C.checks.push({ group: 'Board', name: `Wall snap fingers (${chosen.length})`, value: `${(eps * 100).toFixed(2)}% strain`, status: strainStatus(C, eps), detail: `${Lf} mm horizontal fingers, ${round(lip, 2)} mm lip over the board; they bend within the layers` });
  }
  return chosen;
}

function notches(C: Ctx, used: Site[]) {
  const H = C.H;
  const blocked = used.map((s) => orientedRect(s.q, s.d, -3, 17, -5, 5));
  const sites = edgeSites(C, 12, blocked, false);
  const pick = pickSpread(sites, 2, centroid(C.b.outline));
  const ringCS = C.outer.subtract(C.inner);
  const ringMF = ext(ringCS, C.zt - 2.2, C.zw + 5);
  for (const st of pick) {
    const o = add(add(st.q, st.d, 6), st.n, H.gap + H.wall);
    C.neg.push(cyl(o[0], o[1], C.zt - 2.2, C.zw + 5, 5.5).intersect(ringMF));
    C.blocked.push({ poly: orientedRect(st.q, st.d, 0, 12, -6, 3), why: 'notch' });
  }
}

// ------------------------------- pockets & pattern -----------------------------------------------
function pockets(C: Ctx) {
  for (const k of C.keepouts) {
    if (k.need <= C.s + 0.01) continue;
    const depth = k.need - C.s;
    const through = depth > C.base - 0.6;
    const pk = poly(k.rect).offset(0.3, 'Round');
    C.neg.push(ext(pk, through ? -1 : C.base - depth, C.base + 0.01));
    C.keep.push(pk.offset(1.2, 'Round'));
  }
}

function pattern(C: Ctx) {
  const H = C.H;
  if (H.pattern === 'none') return;
  const region = C.O.offset(-2.2, 'Round').subtract(unionCS(C.keep));
  if (region.isEmpty()) return;
  const bb = region.bounds();
  const cells: CS[] = [];
  const pitch = Math.max(5, H.cell), rib = Math.max(1.2, H.rib);
  const full = pitch - rib;
  const minArea = 0.4 * full * full * 0.8;
  if (H.pattern === 'hex') {
    const r = full / Math.sqrt(3); // circumradius of a hexagon with flat-to-flat `full`
    const hex: V2[] = [];
    for (let k = 0; k < 6; k++) hex.push([r * Math.cos(Math.PI / 6 + (k * Math.PI) / 3), r * Math.sin(Math.PI / 6 + (k * Math.PI) / 3)]);
    const dy = (pitch * Math.sqrt(3)) / 2;
    for (let j = 0, y = bb.min[1]; y < bb.max[1] + pitch; j++, y += dy)
      for (let x = bb.min[0] + (j % 2 ? pitch / 2 : 0); x < bb.max[0] + pitch; x += pitch) cells.push(poly(hex.map(([a, c]) => [a + x, c + y] as V2), 'NonZero'));
  } else if (H.pattern === 'circles') {
    for (let y = bb.min[1]; y < bb.max[1] + pitch; y += pitch) for (let x = bb.min[0]; x < bb.max[0] + pitch; x += pitch) cells.push(circle2(x, y, full / 2, 24));
  } else {
    const long = bb.max[0] - bb.min[0] >= bb.max[1] - bb.min[1];
    for (let v = long ? bb.min[1] : bb.min[0]; v < (long ? bb.max[1] : bb.max[0]) + pitch; v += pitch) {
      const r = long ? rect2(bb.min[0] - 5, v - full / 4, bb.max[0] + 5, v + full / 4) : rect2(v - full / 4, bb.min[1] - 5, v + full / 4, bb.max[1] + 5);
      cells.push(r);
    }
  }
  const kept: CS[] = [];
  for (const c of cells) {
    const cut = c.intersect(region);
    if (cut.isEmpty()) continue;
    const rr = Math.min(1.0, full / 5);
    for (const piece of cut.decompose()) if (piece.area() > (H.pattern === 'slots' ? 6 : minArea)) kept.push(piece.offset(-rr, 'Round').offset(rr, 'Round'));
  }
  if (!kept.length) return;
  const holes = unionCS(kept);
  C.neg.push(ext(holes, -1, C.base + 0.01));
}

// ------------------------------- DIN mount -------------------------------------------------------
function mountDin(C: Ctx) {
  const M = C.job.mount ?? C.p.mount, H = C.H;
  const W = M.clipWidth;
  const upSign = M.tabSide === 'down' ? 1 : -1;
  const dims0 = clipDims({ W, tf: M.railT, tabExt: 0 });
  const slotRects = (c: V2, er: V2, ev: V2, sl: ReturnType<typeof clipSlots>, four: boolean): Loop[] => {
    const out: Loop[] = [];
    for (const [a, bb] of (four ? [[er, ev], [ev, er]] : [[er, ev]]) as [V2, V2][]) {
      for (const sgn of [1, -1]) {
        const o = add(c, bb, sgn * (sl.inner + sl.outer) / 2);
        out.push(orientedRect(o, a, -sl.len / 2, sl.len / 2, -(sl.outer - sl.inner) / 2, (sl.outer - sl.inner) / 2));
      }
    }
    return out;
  };
  if (M.mode === 'flat') {
    const er = dirOf(M.rotation), ev0 = left(er);
    const ev: V2 = [ev0[0] * upSign, ev0[1] * upSign];
    const cen = centroid(C.b.outline);
    const bb = bbox(C.b.outline);
    const tabNeed = (c: V2) => {
      const down: V2 = [-ev[0], -ev[1]];
      const D = rayExit(c, down, C.b.outline) + H.gap + H.wall;
      const std = dims0.vc - (dims0.tabEnd - 3.2); // mount centre to grip bottom
      return Math.max(0, D + 6 - std);
    };
    // 4-fold hook pattern first (clip can be turned in 90 degree steps); smaller boards fall back to 2-fold
    const configs = [{ HA: hookOffset4(W), four: true }, { HA: 8.6, four: false }, { HA: 5.5, four: false }];
    let at: V2 | null = null, cfg = configs[0];
    for (const cf of configs) {
      const sl = clipSlots(W, cf.HA);
      const ok = (c: V2) => {
        const zone = slotRects(c, er, ev, sl, cf.four);
        const re = cf.four ? sl.outer + 1.5 : sl.len / 2 + 1.0, rv = sl.outer + 1.5;
        const corners: V2[] = [add(add(c, er, re), ev, rv), add(add(c, er, -re), ev, rv), add(add(c, er, -re), ev, -rv), add(add(c, er, re), ev, -rv)];
        if (!corners.every((pt) => inside(pt, C.b.outline))) return false;
        if (C.standoffs.some((so) => zone.some((z) => rectDist([so.x, so.y], z) < so.r + 1.0))) return false;
        if (C.keepouts.some((k) => k.need > C.s - 2.2 && zone.some((z) => polysOverlap(z, k.rect)))) return false;
        return true;
      };
      if (M.at) { at = M.at; cfg = cf; break; }
      let best = Infinity;
      for (let x = bb.x0; x <= bb.x1; x += 1.5) for (let y = bb.y0; y <= bb.y1; y += 1.5) {
        const c: V2 = [x, y];
        if (!ok(c)) continue;
        const dr = (c[0] - cen[0]) * er[0] + (c[1] - cen[1]) * er[1];
        const score = tabNeed(c) + 0.35 * Math.abs(dr) + 0.1 * Math.abs((c[0] - cen[0]) * ev[0] + (c[1] - cen[1]) * ev[1]);
        if (score < best) { best = score; at = c; }
      }
      if (at) { cfg = cf; break; }
    }
    if (!at) {
      at = cen;
      cfg = configs[2];
      C.warnings.push('No clear spot under the board for the DIN clip hooks: placed at the centre. Raise the standoff, or use rack mode.');
    } else if (!cfg.four) C.warnings.push('The board is too small for the 4-way clip pattern: the clip fits in two orientations (0/180 degrees) only.');
    (C as any).clipAt = at;
    const sl = clipSlots(W, cfg.HA);
    for (const r of slotRects(at, er, ev, sl, cfg.four)) C.neg.push(ext(poly(r), -1, C.base + 0.02));
    C.keep.push(poly(orientedRect(at, er, -(sl.outer + 2.5), sl.outer + 2.5, -(sl.outer + 2.5), sl.outer + 2.5)));
    const tabExt = tabNeed(at);
    const d = clipDims({ W, tf: M.railT, tabExt, HA: cfg.HA });
    const clip = buildClip({ W, tf: M.railT, tabExt, HA: cfg.HA });
    // clip print frame: x = u, y = v, z = w. Assembly: u -> +z (u = uF at the base underside), v -> ev, w -> u x v
    const Wd: V2 = [-ev[1], ev[0]]; // z x ev
    const o = add(add(at, ev, -d.vc), Wd, -W / 2);
    const T = matFromBasis([0, 0, 1], [ev[0], ev[1], 0], [Wd[0], Wd[1], 0], [o[0], o[1], -d.uF]);
    C.parts.push(part('clip', 'DIN rail clip (pull tab)', clip, T, '#ff6b5b'));
    railGhost(C, T, W);
    clipChecks(C, d, tabExt);
  } else {
    // rack / inline: a plate standing off the chosen edge
    const bb = bbox(C.b.outline);
    const gw = H.gap + H.wall;
    const E = { bottom: { n: [0, -1], e: bb.y0 - gw, c: [(bb.x0 + bb.x1) / 2, bb.y0 - gw] }, top: { n: [0, 1], e: bb.y1 + gw, c: [(bb.x0 + bb.x1) / 2, bb.y1 + gw] }, left: { n: [-1, 0], e: bb.x0 - gw, c: [bb.x0 - gw, (bb.y0 + bb.y1) / 2] }, right: { n: [1, 0], e: bb.x1 + gw, c: [bb.x1 + gw, (bb.y0 + bb.y1) / 2] } }[M.edge];
    const n = E.n as V2;
    const te: V2 = [-n[1], n[0]];
    const facing = C.b.comps.filter((c) => c.conn?.entry === 'edge' && !c.hidden && Math.cos(rad(c.conn.angle)) * n[0] + Math.sin(rad(c.conn.angle)) * n[1] > 0.7);
    if (facing.length) C.warnings.push(`${facing.map((c) => c.ref).join(', ')} face the rail on the ${M.edge} edge: pick another edge under Layout & mounting.`);
    const sl = clipSlots(W);
    const pocket = sl.lipTop - sl.plateT + 1.4, pt = sl.plateT;
    const half = sl.outer + 3.0;
    const ph = Math.max(C.zw, 2 * half);
    const zc = ph / 2;
    const c0 = E.c as V2;
    // plate + side webs + floor web, all in the edge frame (s along n, t along te)
    const plate = orientedBox(c0, n, pocket - 0.01, pocket + pt, -half, half, 0, ph);
    const webs = unionMF([orientedBox(c0, n, -1.0, pocket + 0.01, -half, -half + 2.0, 0, ph), orientedBox(c0, n, -1.0, pocket + 0.01, half - 2.0, half, 0, ph), orientedBox(c0, n, -1.0, pocket + 0.01, -half, half, 0, C.base)]);
    let pl = unionMF([plate, webs]);
    // "+" slot pattern in the plate (axes te and z)
    for (const horiz of [true, false]) for (const sgn of [1, -1]) {
      const along = (sl.inner + sl.outer) / 2 * sgn;
      const t0 = horiz ? -sl.len / 2 : along - (sl.outer - sl.inner) / 2, t1 = horiz ? sl.len / 2 : along + (sl.outer - sl.inner) / 2;
      const z0 = horiz ? zc + along - (sl.outer - sl.inner) / 2 : zc - sl.len / 2, z1 = horiz ? zc + along + (sl.outer - sl.inner) / 2 : zc + sl.len / 2;
      pl = pl.subtract(orientedBox(c0, n, pocket - 0.5, pocket + pt + 0.5, t0, t1, z0, z1));
    }
    C.late.push(pl);
    C.blocked.push({ poly: orientedRect(c0, n, -3, pocket + pt + 1, -half - 1, half + 1), why: 'DIN plate' });
    const tabExt = 0;
    const d = clipDims({ W, tf: M.railT, tabExt });
    const clip = buildClip({ W, tf: M.railT, tabExt });
    // clip u axis points from the rail towards the holder: -n. Plate outer face at c0 + n*(pocket+pt)
    const face = add(c0, n, pocket + pt);
    const rail90 = M.rotation === 90 || M.rotation === 270;
    const flip = (M.rotation >= 180 ? -1 : 1) * upSign;
    // rack: rail along z, v along te;  inline: rail along te, v along z
    const U = [-n[0], -n[1], 0];
    const Vv = rail90 ? [0, 0, flip] : [te[0] * flip, te[1] * flip, 0];
    // w axis = U x V for a right-handed frame
    const Wd = [U[1] * Vv[2] - U[2] * Vv[1], U[2] * Vv[0] - U[0] * Vv[2], U[0] * Vv[1] - U[1] * Vv[0]];
    const o = [face[0] - U[0] * d.uF - Vv[0] * d.vc - Wd[0] * (W / 2), face[1] - U[1] * d.uF - Vv[1] * d.vc - Wd[1] * (W / 2), zc - U[2] * d.uF - Vv[2] * d.vc - Wd[2] * (W / 2)];
    const T = matFromBasis(U, Vv, Wd, o);
    C.parts.push(part('clip', 'DIN rail clip (pull tab)', clip, T, '#ff6b5b'));
    (C as any).clipAt = c0;
    railGhost(C, T, W);
    clipChecks(C, d, tabExt);
  }
}

function clipChecks(C: Ctx, d: ReturnType<typeof clipDims>, tabExt: number) {
  if (C.job.dock) return;
  const L = d.uF + d.plateT + 0.1 + 0.35 - 10.0;
  const eps = (3 * 1.0 * 0.65) / (2 * L * L);
  C.checks.push({ group: 'DIN clip', name: 'Holder snap hooks', value: `${(eps * 100).toFixed(2)}% strain`, status: strainStatus(C, eps), detail: `${round(L, 1)} mm hooks, 0.55 mm catch; click the holder on in any of 4 orientations` });
  C.checks.push({ group: 'DIN clip', name: 'Release', value: 'pull the tab toward you', status: 'info', detail: `lip engagement ${d.eL} mm, travel stop after ~1.9 mm. Run the clip FEA in the Check tab for forces and strain.${tabExt > 0 ? ` Tab lengthened by ${round(tabExt, 1)} mm so it reaches past the holder edge.` : ''}` });
}

function railGhost(C: Ctx, T: number[], W: number) {
  const L = Math.max(80, W + 60);
  const rail = unionMF(railProfile().map((l) => poly(l, 'NonZero').extrude(L).translate([0, 0, -(L - W) / 2])));
  C.ghosts.push({ name: 'DIN rail', mesh: transformMesh(meshFrom(rail), T), color: '#94a3b8', opacity: 0.55 });
}

export function transformMesh(m: MeshData, T: number[]): MeshData {
  const pos = new Float32Array(m.pos.length);
  for (let i = 0; i < m.pos.length; i += 3) {
    const x = m.pos[i], y = m.pos[i + 1], z = m.pos[i + 2];
    pos[i] = T[0] * x + T[4] * y + T[8] * z + T[12];
    pos[i + 1] = T[1] * x + T[5] * y + T[9] * z + T[13];
    pos[i + 2] = T[2] * x + T[6] * y + T[10] * z + T[14];
  }
  return { pos, idx: m.idx };
}

// ------------------------------- stand socket ----------------------------------------------------
function stand(C: Ctx) {
  const S = C.p.stand, H = C.H;
  const bb = bbox(C.b.outline);
  const gw = H.gap + H.wall;
  const E = { bottom: { n: [0, -1], c: [(bb.x0 + bb.x1) / 2 + S.offset, bb.y0 - gw] }, top: { n: [0, 1], c: [(bb.x0 + bb.x1) / 2 + S.offset, bb.y1 + gw] }, left: { n: [-1, 0], c: [bb.x0 - gw, (bb.y0 + bb.y1) / 2 + S.offset] }, right: { n: [1, 0], c: [bb.x1 + gw, (bb.y0 + bb.y1) / 2 + S.offset] } }[S.edge];
  const n = E.n as V2, c0 = E.c as V2;
  const size = S.shape === 'tripod' ? 11.1 : S.size;
  const clr = S.fit === 'press' ? 0.05 : S.clearance;
  const hs = size + clr; // hole size (diameter / side / across flats)
  const wall = Math.max(2, S.wall);
  const axis = S.shape === 'tripod' ? 'down' : S.axis;
  // hole profile in its own 2D frame (x across, y up for 'edge'; plan view for 'down')
  const profile = (teardrop: boolean): CS => {
    const r = hs / 2;
    if (S.shape === 'square') return rect2(-r, -r, r, r);
    if (S.shape === 'hex' || S.shape === 'tripod') {
      const R = hs / Math.sqrt(3);
      const pts: V2[] = [];
      for (let k = 0; k < 6; k++) pts.push([R * Math.cos(Math.PI / 2 + (k * Math.PI) / 3), R * Math.sin(Math.PI / 2 + (k * Math.PI) / 3)]); // vertex up
      return poly(pts, 'NonZero');
    }
    let cs = circle2(0, 0, r);
    if (teardrop) cs = cs.add(poly([[-r * Math.SQRT1_2, r * Math.SQRT1_2], [r * Math.SQRT1_2, r * Math.SQRT1_2], [0, r * Math.SQRT2]], 'NonZero'));
    if (S.shape === 'd') cs = cs.subtract(rect2(-r - 1, -r - 1, r + 1, -r + 0.3 * hs));
    if (S.fit === 'press') for (const a of [-90, 30, 150]) {
      const ca = Math.cos(rad(a)), sa = Math.sin(rad(a));
      cs = cs.subtract(poly([[ca * r - sa * 0.45, sa * r + ca * 0.45], [ca * r + sa * 0.45, sa * r - ca * 0.45], [ca * (r - 0.35), sa * (r - 0.35)]], 'NonZero'));
    }
    return cs;
  };
  const outerW = hs + 2 * wall;
  let boss: MF, hole: MF;
  if (axis === 'edge') {
    const hgt = Math.max(C.zw, outerW + 0.5);
    const zc = hgt / 2;
    const depth = S.depth + 2.5;
    const prof = roundCS(rect2(-outerW / 2, 0, outerW / 2, hgt), 1.2);
    boss = sweepTZ(c0, n, prof, -1.0, depth);
    hole = sweepTZ(c0, n, profile(true).translate([0, zc]), 2.5, depth + 1);
    C.ghosts.push({ name: 'stand post', mesh: meshFrom(sweepTZ(c0, n, profile(false).offset(-clr / 2).translate([0, zc]), 3, depth + 40)), color: '#6cb6ff', opacity: 0.35 });
  } else {
    // vertical socket in an ear outside the edge; opens at the bed, 45-degree roof
    const r = outerW / 2;
    const cc = add(c0, n, r - 0.8);
    const hgt = Math.max(C.zw, S.depth + hs / 2 + 2.5);
    boss = unionMF([cyl(cc[0], cc[1], 0, hgt, r), orientedBox(c0, n, -1.0, r, -r, r, 0, Math.min(hgt, C.zw))]);
    if (S.shape === 'tripod') {
      // 1/4"-20 nut trap: nut drops in from the top, screw comes up from below through a 6.6 mm hole
      hole = unionMF([cyl(cc[0], cc[1], -1, hgt + 1, 3.3), ext(profile(false).translate(cc), 3.0, hgt + 1)]);
    } else {
      const pr = profile(false).translate(cc);
      hole = unionMF([ext(pr, -1, S.depth), K().Manifold.hull([ext(pr, S.depth - 0.01, S.depth), K().Manifold.cube([0.01, 0.01, 0.01], true).translate([cc[0], cc[1], S.depth + hs / 2])])]);
    }
    C.ghosts.push({ name: 'stand post', mesh: meshFrom(ext(profile(false).offset(-clr / 2).translate(cc), -40, S.depth - 0.5)), color: '#6cb6ff', opacity: 0.35 });
  }
  C.late.push(boss.subtract(hole));
  C.blocked.push({ poly: orientedRect(c0, n, -3, S.depth + 5, -outerW / 2 - 2, outerW / 2 + 2), why: 'stand socket' });
  C.checks.push({ group: 'Stand', name: 'Stand socket', value: `${S.shape === 'tripod' ? '1/4"-20 nut trap' : `${S.shape} ${round(size, 2)} mm`}`, status: 'info', detail: `${S.fit === 'press' ? 'press fit with crush ribs' : `slip fit, +${round(clr, 2)} mm`}; ${round(S.depth, 1)} mm deep, axis ${axis === 'edge' ? 'out of the ' + S.edge + ' edge' : 'downwards'}` });
}

// ------------------------------- label -----------------------------------------------------------
function label(C: Ctx): boolean {
  const H = C.H;
  const text = H.label.trim().slice(0, 40);
  const hmax = Math.min(5, C.zw - C.base - 1.6);
  if (hmax < 2.4) { C.warnings.push('Walls too low for an engraved label.'); return false; }
  let hgt = hmax, tw = 0, sites: Site[] = [];
  for (hgt = hmax; hgt >= 2.4; hgt -= 0.4) {
    tw = textWidth(text, hgt);
    sites = edgeSites(C, tw + 4, [], false);
    if (sites.length) break;
  }
  if (!sites.length) { C.checks.push({ group: 'Holder', name: 'Label', value: 'left off', status: 'info', detail: 'no free straight wall is long enough; shorten the label to fit it' }); return false; }
  // longest free stretch, prefer bottom-facing edges (the front when mounted)
  sites.sort((a, b) => (b.len - a.len) + (a.n[1] - b.n[1]) * 5);
  const st = sites[0];
  const L = st.len;
  const sMid = Math.min(Math.max(L / 2, st.free + (tw + 4) / 2), L - (tw + 4) / 2);
  const a = C.b.outline[st.seg];
  const o = add(add(a, st.d, sMid), st.n, H.gap + H.wall);
  // text reads along d when seen from outside (for a CCW outline); depth axis = outward normal
  const glyphs = textCS(text, hgt).translate([-tw / 2, 0]);
  const m = glyphs.extrude(1.2).translate([0, 0, -0.6]);
  const zc = C.base + 0.8 + (C.zw - C.base - 1.6 - hgt) / 2;
  const T = matFromBasis([st.d[0], st.d[1], 0], [0, 0, 1], [st.n[0], st.n[1], 0], [o[0], o[1], zc]);
  // m spans local z in [-0.6, 0.6] -> 0.6 mm engraving depth into the wall
  C.neg.push(m.transform(T as any));
  C.blocked.push({ poly: orientedRect(add(a, st.d, sMid - tw / 2 - 1), st.d, 0, tw + 2, -(H.gap + H.wall + 1), 1), why: 'label' });
  return true;
}

// ------------------------------- ghosts ----------------------------------------------------------
function boardGhosts(C: Ctx) {
  const { b, zb, zt } = C;
  let bcs = C.O;
  for (const cu of b.cutouts) bcs = bcs.subtract(poly(cu));
  for (const h of b.holes) bcs = bcs.subtract(circle2(h.x, h.y, h.d / 2, 24));
  C.ghosts.push({ name: 'board', mesh: meshFrom(ext(bcs, zb, zt)), color: '#17804f', opacity: 0.92 });
  const col: Record<string, string> = { connector: '#e2e8f0', header: '#1f2937', switch: '#475569', led: '#fde047', module: '#64748b', hot: '#ef4444', antenna: '#60a5fa', generic: '#334155' };
  const boxes: Record<string, MF[]> = {};
  for (const c of b.comps) {
    if (c.hidden || c.h <= 0.05) continue;
    const z0 = c.side === 'top' ? zt : zb - c.h, z1 = c.side === 'top' ? zt + c.h : zb;
    (boxes[c.kind] ??= []).push(ext(poly(compRect(c)), z0, z1));
  }
  for (const [k, list] of Object.entries(boxes)) C.ghosts.push({ name: `parts ${k}`, mesh: meshFrom(unionMF(list)), color: col[k] ?? '#334155', opacity: 0.9 });
}


// ------------------------------- multi-board arrangement features --------------------------------
function arrangeFeatures(C: Ctx) {
  const A = C.job.hooks;
  if (A.towers) {
    // corner towers: this layer stands on the one below via pegs, the next layer sits on top
    const { pts, height, peg, socket } = A.towers;
    const cen = centroid(C.b.outline);
    for (const q of pts) {
      let tw = extCh(roundCS(rect2(q[0] - 3.5, q[1] - 3.5, q[0] + 3.5, q[1] + 3.5), 1.5), 0, height, 0.4, 0.4);
      if (peg) tw = unionMF([tw, cyl(q[0], q[1], height - 0.01, height + 3.4, 2.0), cyl(q[0], q[1], height + 3.39, height + 4.0, 2.0, 1.4)]);
      if (socket) {
        let hole = unionMF([cyl(q[0], q[1], -1, 4.6, 2.12), cyl(q[0], q[1], 4.59, 6.7, 2.12, 0.02)]);
        // three crush ribs for a firm press fit
        for (const a of [90, 210, 330]) hole = hole.subtract(box(-0.35, 1.85, -1, 0.35, 2.3, 4.6).rotate([0, 0, a - 90]).translate([q[0], q[1], 0]));
        tw = tw.subtract(hole);
      }
      // arm back to the tray, clipped so it never enters the board area
      const d: V2 = [cen[0] - q[0], cen[1] - q[1]];
      const L = Math.hypot(d[0], d[1]) || 1;
      const u: V2 = [d[0] / L, d[1] / L];
      const arm = orientedBox(q, u, 0, L, -2.5, 2.5, 0, Math.min(C.zw, 6)).subtract(ext(C.inner, -1, 100));
      C.late.push(tw, arm);
      C.blocked.push({ poly: orientedRect(q, u, -4, 8, -5, 5), why: 'tower' });
    }
    C.checks.push({ group: 'Layout', name: 'Stacking towers', value: `${round(height, 1)} mm`, status: 'info', detail: `${pts.length} corner towers${peg ? ', Ø4 pegs on top' : ''}${socket ? ', press-fit sockets underneath (crush ribs)' : ''}` });
  }
  if (A.links) {
    // bosses with a vertical T-slot; a printed link bar drops into two facing slots
    for (const { at, n } of A.links) {
      const hb = Math.min(C.zw, 9);
      const boss = orientedBox(at, n, -1.2, 3.2, -5, 5, 0, hb);
      const slot = unionMF([orientedBox(at, n, 1.75, 3.4, -1.3, 1.3, 1.2, hb + 1), orientedBox(at, n, 0.2, 1.95, -2.6, 2.6, 1.2, hb + 1)]);
      C.late.push(boss.subtract(slot));
      C.blocked.push({ poly: orientedRect(at, n, -3, 4, -6, 6), why: 'link' });
    }
  }
  if (A.rivets) {
    for (const q of A.rivets) {
      C.neg.push(cyl(q[0], q[1], -1, C.base + 1, 1.75));
      C.keep.push(circle2(q[0], q[1], 5));
    }
  }
}

// ------------------------------- rail dock (holder side) -----------------------------------------
const tsPoly = (s: DockSite, t0: number, t1: number, s0: number, s1: number): Loop =>
  [[t0, s0], [t1, s0], [t1, s1], [t0, s1]].map(([t, d]) => [s.e[0] * t + s.n[0] * (s.L0 - d), s.e[1] * t + s.n[1] * (s.L0 - d)] as V2);

function dockBlocks(C: Ctx, s: DockSite) {
  C.blocked.push({ poly: tsPoly(s, s.tc - 12, s.tc + 12, -3, 6), why: 'dock' });
  const [g0, g1] = gripSpan(s.side);
  C.blocked.push({ poly: tsPoly(s, s.tc + g0 - 2, s.tc + g1 + 2, s.far - 6, s.far + 3), why: 'release button' });
  if (!s.under) C.blocked.push({ poly: tsPoly(s, s.tc - HD.spineHx - 1, s.tc + HD.spineHx + 1, -3, s.far + 3), why: 'dock spine' });
}

function dockFeatures(C: Ctx, s: DockSite) {
  const H = C.H, mat = MATERIALS[H.material];
  const D = inv(dockFrame(s.edge, s.tc, s.L0)); // socket-local -> holder
  const f = holderDock(s.far, s.ped, s.side, C.job.dock?.fit ?? 0);
  C.pos.push(f.add.transform(D as any));
  C.neg.push(f.cut.transform(D as any));
  C.keep.push(poly(tsPoly(s, s.tc - HD.spineHx - 1.2, s.tc + HD.spineHx + 1.2, -1, s.far + 1)), poly(tsPoly(s, s.tc - HD.base.hx - 1.2, s.tc + HD.base.hx + 1.2, -1, s.ped + 1.5)));
  const r = rod(f.zg1, s.side);
  C.parts.push(part('rod', 'Release rod + button', r.m.transform(D as any), ID, '#ff5d6c'));
  if (s.conflicts.length) C.warnings.push(`Dock on the ${s.edge} edge: ${s.conflicts.join(', ')} ${s.conflicts.length > 1 ? 'are' : 'is'} in the way. Pick another dock edge in the Panel step.`);
  const eRatio = mat.E / MATERIALS.PETG.E;
  const F = 20, Mo = F * s.far, sig = Mo / 32; // tongue root 12 x 4 mm, out-of-plane push on the far edge
  C.checks.push({ group: 'Dock', name: 'Release', value: `press the button, ${HD.stroke} mm`, status: 'info', detail: `thumb on the button at the ${({ bottom: 'top', top: 'bottom', left: 'right', right: 'left' } as Record<EdgeName, string>)[s.edge]} edge, two fingers under the grip bar, squeeze and lift. About ${(4.0 * eRatio).toFixed(1)} N (${H.material}); the latch spring returns the button. Rod: ${round(r.len, 0)} mm, printed flat.` });
  C.checks.push({ group: 'Dock', name: `Tongue root, ${F} N push on the far edge`, value: `${round(sig, 0)} MPa`, status: sig < 0.4 * mat.yield ? 'ok' : sig < 0.8 * mat.yield ? 'warn' : 'bad', detail: `${round(s.far, 0)} mm lever onto the 12 × 4 mm tongue (${H.material} yields at ~${mat.yield} MPa). Hold the holder while plugging in stiff cables at the far end.` });
  if (s.under && C.zb > DOCK_MIN_ZB - 0.2) C.checks.push({ group: 'Dock', name: 'Board raised over the rod spine', value: `${round(C.zb, 1)} mm`, status: 'info', detail: 'the release-rod spine runs under the board' });
}
