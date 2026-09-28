// Builds every printable part for a project: the board holder (tray), DIN clip, plug caps, plus display ghosts
// (board, components, plugs, rail) and a report of checks. All parts come out in print orientation.
import type { Anim, Board, Check, Comp, EdgeName, Feature, GenResult, Ghost, HolderSettings, Loop, MeshData, MountSettings, PartOut, PickTag, Pin, Project, V2 } from '../model/types';
import { holeKeepout, isMountHole } from '../model/holes';
import { boxProblems } from '../model/boxes';
import { DEBUG_TYPES, isDebugPort, isUartPort } from '../model/links';
import { headerPins, UART_WIRES, uartPins } from '../model/probes';
import { baseRef, isAccessory } from '../model/links';
import { DEFAULT_FEATURES, MATERIALS } from '../model/library';
import { bbox, centroid, compRect, extentAlong, inside, rad, rayExit, round, segDist } from '../geom/poly';
import type { CS, MF } from './kernel';
import { box, circle2, csLoops, cyl, ext, extCh, freeAll, K, orientedBox, poly, rect2, roundCS, sweepTZ, toMesh, unionCS, unionMF } from './kernel';
import { buildClip, clipDims, clipSlots, hookOffset4, railProfile } from './dinclip';
import { textCS, textWidth } from './font';
import { computeLevels } from './levels';
import { boardDetail, plugDetail, plugUp } from './boardviz';
import { DOCK_MIN_ZB, flatHolderDock, gripSpan, holderDock, HD, rod } from './dock';
import { EAR, TONGUE } from './dockdims';
import { dockFrame, dockSite, earSite, flatFrame, type DockSite, type EarSite } from './dockplan';
import { inv, type M4 } from '../geom/mat';
import { rectSection, roundSection, solveFrame, type FElem, type FNode } from '../fea/frame3d';

const ID = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Extra features a module gets from the multi-board arrangement (all in the module's own board frame). */
export interface ArrangeHooks {
  towers?: { pts: V2[]; height: number; peg: boolean; socket: boolean };
  links?: { at: V2; n: V2 }[];
  rivets?: V2[];
}

export interface Job {
  p: Project; mi: number; b: Board; H: HolderSettings; din: boolean; stand: boolean; hooks: ArrangeHooks; name: string;
  level?: number; // 0 = bottom of a stack (default), 1 = the board above it...
  bolted?: { b: Board; dx: number; dy: number; dz: number; mid: string }[]; // boards screwed on top on standoffs (shown, no holder of their own)
  mount?: MountSettings; // overrides p.mount (panel flat clips)
  dock?: { edge: EdgeName; fit?: number; shift?: number; lie?: 'flat' }; // holder plugs into a rail dock with this board edge (shift: its tongue that far off the middle; lie: flat, by an ear on that edge)
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
  mid: string; // module id
  frame: boolean; // frame style: rim, corner guards and ribs instead of a full base and wall
  rimH: number; // frame rim height
  ribNodes: { p: V2; r: number }[]; // points the frame's ribs must reach (pins, pads)
  features: Feature[];
  plugs: PlugEnd[];
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

function part(id: string, name: string, m: MF, toAssembly: number[], color: string, qty = 1, tag?: PickTag, anim?: Anim): PartOut {
  // rest on the bed: translate so min z = 0, keep xy
  const bb = m.boundingBox();
  const moved = m.translate([0, 0, -bb.min[2]]);
  const T = [...toAssembly];
  // compensate: assembly = A * (p + (0,0,minz))
  T[12] += toAssembly[8] * bb.min[2];
  T[13] += toAssembly[9] * bb.min[2];
  T[14] += toAssembly[10] * bb.min[2];
  return { id, name, qty, mesh: meshFrom(moved), toAssembly: T, volume: m.volume(), size: [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]], color, tag, anim };
}

/** Record a pickable feature: a plan-view loop (holder frame) and a height range. */
function feat(C: Ctx, kind: Feature['kind'], loop: Loop, z0: number, z1: number, refs?: string[]) {
  const b = bbox(loop);
  C.features.push({ kind, module: C.mid, refs, box: [b.x0, b.y0, z0, b.x1, b.y1, z1] });
}

/** Solid wall band over a stretch of the outline (frame style has no continuous wall). */
function wallPiece(C: Ctx, q: V2, d: V2, s0: number, s1: number, z1: number) {
  if (!C.frame) return;
  const H = C.H;
  C.pos.push(orientedBox(q, d, s0, s1, -(H.gap + H.wall), -H.gap + 0.01, 0, z1));
}

// ---------------------------------------------------------------------------------------------

export { computeLevels } from './levels';

/** Where a cable leaves a plug: point, outward direction, cable size, and (for a ribbon) the plug's width axis. */
/** Where a cable leaves a plug: the point, its axis out, the plug's width axis; `span`: how deep an IDC socket is across
 * its ribbon; `wires`: a serial cable's loose ends, the top of each jumper on its pin. */
export interface PlugEnd { module: string; ref: string; p: [number, number, number]; d: [number, number, number]; cable: number; w?: [number, number, number]; span?: number; wires?: { p: [number, number, number]; colour: string; pin?: string }[]; open?: [number, number] } // open: the opening cut for the plug in the holder's wall, across and up (mm)
export interface ModuleOut { parts: PartOut[]; ghosts: Ghost[]; warnings: string[]; checks: Check[]; levels: GenResult['report']['levels']; clipAt: V2 | null; clipT: number[] | null; dockM: M4 | null; features: Feature[]; plugs: PlugEnd[] }

// Built modules are cached by their inputs: moving, turning or re-pairing docks does not rebuild holders.
const cache = new Map<string, ModuleOut>();
const CACHE_MAX = 48;

export function buildModule(job: Job): ModuleOut {
  const { p } = job;
  const key = JSON.stringify([job.mi, p.modules[job.mi]?.id, job.b, job.H, job.din, job.stand, job.hooks, job.name, job.level ?? 0, job.mount ?? null, job.dock ?? null, job.bolted ?? null,
    job.din ? p.mount : null, job.stand ? p.stand : null, p.printer.bed]);
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  try {
    const out = build(job);
    cache.set(key, out);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    return out;
  } finally {
    freeAll();
  }
}

/** A flat-mounted box holder longer than the printer bed goes in two halves: the direction along it (the rail's), else null. */
function splitAxis(C: Ctx): V2 | null {
  if (C.b.kind !== 'box' || C.job.dock) return null;
  const M = C.job.mount ?? C.p.mount;
  if (M.mode !== 'flat') return null;
  const er = dirOf(M.rotation), gw = C.H.gap + C.H.wall;
  const ext = (d: V2) => { const t = C.b.outline.map((q) => q[0] * d[0] + q[1] * d[1]); return Math.max(...t) - Math.min(...t) + 2 * gw; };
  const bed = C.p.printer.bed;
  const fits = (a: number, c: number) => (a <= bed[0] && c <= bed[1]) || (a <= bed[1] && c <= bed[0]);
  return fits(ext(er), ext(left(er))) ? null : er;
}

/**
 * A debug probe (J-Link): a thin box that slides down into a slot from its open end, plugs first out, and stays there
 * (see slotBody). Several for one board stack as slots on corner towers.
 */
const isProbeBox = (b: Board) => isAccessory(b) && b.comps.some((c) => isDebugPort(c) || isUartPort(c));

/** The pins of a header that have a wire pushed on (a jumper link's, or a serial cable's loose ends), with its colour. */
function wiredPins(C: Ctx, c: Comp): { pin: Pin; colour: string }[] {
  const mine = (r: { module: string; ref: string }) => r.module === C.mid && baseRef(r.ref) === c.ref;
  const l = (C.p.links ?? []).find((x) => mine(x.a) || mine(x.b));
  if (!l) return [];
  if (l.kind === 'jumper' && l.wires?.length) {
    const pins = headerPins(c), end = mine(l.a) ? 'a' : 'b';
    return l.wires.flatMap((w) => { const q = pins.find((x) => x.n === w[end]); return q ? [{ pin: q, colour: w.colour ?? '#4f9d57' }] : []; });
  }
  const u = l.kind === 'uart' ? uartPins(c) : null;
  return u ? UART_WIRES.map((wd) => ({ pin: u[wd.key], colour: wd.colour })) : [];
}

/** Boxes (hubs, chargers, probes) sit in low guards: no snap fingers, notches or label. Hubs and chargers are strapped down. */
const holderFor = (H: HolderSettings, b: Board): HolderSettings =>
  isAccessory(b) ? { ...H, tabs: 'off', notches: false, label: '', wallAbove: Math.min(H.wallAbove, -(b.thickness - 8)), standoff: H.standoff ?? 1.2, minStandoff: 1.2 } : H;

/** A holder's heights as it is really built: box settings applied, and raised over the dock's spine when docked. */
export function builtLevels(b: Board, H0: HolderSettings, dockEdge?: EdgeName | null) {
  const H = holderFor(H0, b);
  return computeLevels(b, H, dockEdge ? dockSite(b, H, dockEdge).minZb : 0);
}

function build(job: Job): ModuleOut {
  const { p, b } = job;
  const H = holderFor(job.H, b);
  const warnings: string[] = [...b.notes];
  const checks: Check[] = [];
  const mat = MATERIALS[H.material];
  if (b.box) for (const x of boxProblems(b.box)) checks.push({ group: 'Board', name: 'Box ports', value: "don't fit", status: 'bad', detail: `${x} Make the box bigger under Board › Box, or put fewer ports on that side.` });

  // ---- clearance under the board ----
  const keepouts: Ctx['keepouts'] = [];
  for (const c of b.comps) {
    if (c.side === 'bottom' && c.h > 0) keepouts.push({ rect: compRect(c, 0.5), need: c.h + 0.5, why: `${c.ref} (bottom, ${round(c.h, 1)} mm)` });
    if (c.side === 'top' && c.tht) keepouts.push({ rect: compRect(c, 0.6), need: H.leadLen + 0.4, why: `${c.ref} leads` });
  }
  // holes the wizard marked as connector pegs, part leads or stacking standoffs stay free and clear underneath
  for (const h of b.holes) {
    const k = holeKeepout(h, H.leadLen);
    if (k) keepouts.push({ rect: [[h.x - k.r, h.y - k.r], [h.x + k.r, h.y - k.r], [h.x + k.r, h.y + k.r], [h.x - k.r, h.y + k.r]], need: k.need, why: `${h.role} hole at ${round(h.x, 1)}, ${round(h.y, 1)}` });
  }
  const flatDock = job.dock?.lie === 'flat';
  const site = job.dock && !flatDock ? dockSite(b, H, job.dock.edge, job.dock.shift) : null;
  const ear = job.dock && flatDock ? earSite(b, H, job.dock.edge, job.dock.shift) : null;
  const { needMax, base, s, zb, zt, zw } = computeLevels(b, H, site?.minZb ?? 0);
  const O = poly(b.outline);
  const inner = O.offset(H.gap, 'Round');
  const outer = O.offset(H.gap + H.wall, 'Round');
  const frame = (H.style ?? 'frame') === 'frame';
  const C: Ctx = { p, job, H, b, base, s, zb, zt, zw, O, inner, outer, warnings, checks, pos: [], neg: [], late: [], keep: [], blocked: [], parts: [], ghosts: [], standoffs: [], keepouts, dock: site,
    mid: p.modules[job.mi]?.id ?? `m${job.mi}`, frame, rimH: Math.min(zb - 0.3, base + 1.2), ribNodes: [], features: [], plugs: [] };
  checks.push({ group: 'Board', name: 'Clearance under the board', value: `${round(s, 1)} mm`, status: 'info', detail: needMax ? `tallest underside item needs ${round(needMax, 1)} mm (${keepouts.sort((a, c) => c.need - a.need)[0].why}); deeper items get pockets in the base` : 'nothing under the board' });

  // ---- base and wall ----
  if (isProbeBox(b)) slotBody(C);
  else if (frame) frameBody(C);
  else {
    C.pos.push(extCh(outer, 0, base, 0, H.chamfer ? 0.4 : 0));
    const ring = outer.subtract(inner);
    const wallParts: MF[] = [ext(ring, 0, zw - (H.chamfer ? 0.6 : 0))];
    if (H.chamfer) for (let i = 1; i <= 3; i++) {
      const r = outer.offset(-i * 0.2, 'Round').subtract(inner.offset(Math.min(i, 2) * 0.2, 'Round'));
      wallParts.push(ext(r, zw - 0.6 + (i - 1) * 0.2, zw - 0.6 + i * 0.2));
    }
    C.pos.push(unionMF(wallParts));
  }

  connectors(C);
  if (b.kind === 'box' && !isProbeBox(b)) strapLoops(C);
  overhangs(C);
  if (site) dockBlocks(C, site);
  if (ear) earBlocks(C, ear);
  // label first so it gets a long free wall; if that leaves no room for two fingers, drop the label
  const mark = { pos: C.pos.length, neg: C.neg.length, late: C.late.length, blocked: C.blocked.length, warn: C.warnings.length, checks: C.checks.length, feat: C.features.length };
  const reset = () => { C.pos.length = mark.pos; C.neg.length = mark.neg; C.late.length = mark.late; C.blocked.length = mark.blocked; C.warnings.length = mark.warn; C.checks.length = mark.checks; C.features.length = mark.feat; };
  const labelled = H.label.trim() ? label(C) : false;
  let tabsUsed = tabs(C);
  const pinsHold = C.b.holes.filter((h) => isMountHole(h) && (h.use === 'auto' || h.use === 'snap') && h.d >= 1.8).length >= 2;
  if (labelled && tabsUsed.length < 2 && (H.tabs === 'on' || (H.tabs === 'auto' && !pinsHold))) {
    // the fingers are short of a wall: try without the label, and keep that only if it really gives them room
    reset();
    const without = tabs(C);
    if (without.length > tabsUsed.length) {
      tabsUsed = without;
      C.checks.push({ group: 'Holder', name: 'Label', value: 'left off', status: 'info', detail: 'it would take the wall the snap fingers need to hold the board; shorten it to fit both' });
    } else {
      reset();
      label(C);
      tabsUsed = tabs(C);
    }
  }
  standoffs(C, tabsUsed.length >= 2);
  seats(C);
  pockets(C);
  if (job.din && (job.mount ?? p.mount).kind === 'din') mountDin(C);
  if (site) dockFeatures(C, site);
  if (ear) earFeatures(C, ear);
  if (job.stand && p.stand.enabled) stand(C);
  arrangeFeatures(C);
  if (H.notches && !frame) notches(C, tabsUsed);
  if (frame) frameRibs(C);
  else { pattern(C); supportChecks(C, supportFea(C, C.ribNodes, [], 1, 2 * base)); }

  // ---- assemble the holder ----
  let holder = unionMF(C.pos);
  if (C.neg.length) holder = holder.subtract(unionMF(C.neg));
  if (C.late.length) holder = unionMF([holder, ...C.late]);
  const pieces = holder.decompose();
  if (pieces.length > 1) {
    // keep the main body, report stray islands (can happen with odd user geometry)
    const main = pieces.reduce((a, c) => (c.volume() > a.volume() ? c : a));
    const lostList = pieces.filter((x) => x !== main);
    const lost = lostList.reduce((sum, x) => sum + x.volume(), 0);
    const where = lostList.map((x) => { const bb = x.boundingBox(); return `${round((bb.min[0] + bb.max[0]) / 2, 0)}, ${round((bb.min[1] + bb.max[1]) / 2, 0)}, z ${round(bb.min[2], 1)}–${round(bb.max[2], 1)}`; }).join('; ');
    if (lost > 1) warnings.push(`${pieces.length - 1} loose piece(s) (${round(lost, 0)} mm³) were dropped from the holder (at ${where}). Check features near the board edge.`);
    holder = main;
  }
  const lv = job.level ?? 0;
  const inDir: [number, number, number] = site ? [-site.n[0], -site.n[1], 0] : [0, 0, 1]; // (a flat one comes down onto its dock)
  const split = job.din && (job.mount ?? p.mount).mode === 'flat' ? splitAxis(C) : null;
  if (split) {
    // two halves, cut square across the middle, each on its own clip (they meet end to end on the rail)
    const cen = centroid(b.outline), big = 2000, gap = 0.2;
    const halfBox = (s: number) => orientedBox(cen, split, s > 0 ? gap / 2 : -big, s > 0 ? big : -gap / 2, -big, big, -50, 300);
    C.parts.unshift(part('holder_b', `Holder: ${job.name} (second half)`, holder.intersect(halfBox(1)), ID, H.color ?? '#e4ebe6', 1, { kind: 'holder', module: C.mid }, { seq: 3 + 2 * lv, dir: inDir }));
    C.parts.unshift(part('holder', `Holder: ${job.name} (first half)`, holder.intersect(halfBox(-1)), ID, H.color ?? '#e4ebe6', 1, { kind: 'holder', module: C.mid }, { seq: 3 + 2 * lv, dir: inDir }));
    checks.push({ group: 'Holder', name: 'In two halves', value: 'longer than the bed', status: 'info', detail: `the box is longer than the ${p.printer.name} bed, so its holder is printed in two halves that meet end to end, each clipped to the rail on its own` });
  } else C.parts.unshift(part('holder', `Holder: ${job.name}`, holder, ID, H.color ?? '#e4ebe6', 1, { kind: 'holder', module: C.mid }, { seq: 3 + 2 * lv, dir: inDir }));
  for (const pt of C.parts) pt.id = `m${job.mi}_${pt.id}`;

  // ---- ghosts ----
  boardGhosts(C);
  for (const bo of job.bolted ?? []) boltedGhosts(C, bo);

  // ---- summary checks ----
  for (const pt of C.parts) {
    const fits = (pt.size[0] <= p.printer.bed[0] && pt.size[1] <= p.printer.bed[1]) || (pt.size[1] <= p.printer.bed[0] && pt.size[0] <= p.printer.bed[1]);
    if (!fits) warnings.push(`${pt.name} (${round(pt.size[0], 0)} × ${round(pt.size[1], 0)} mm) does not fit the ${p.printer.name} bed.`);
  }
  checks.push({ group: 'Print', name: 'Material', value: H.material, status: H.material === 'PLA' ? 'warn' : 'ok', detail: H.material === 'PLA' ? `PLA is stiff and brittle for springs and softens at ~${mat.tg} °C. PETG, ASA or PA are better for clips.` : `strain limit used for springs: ${(mat.strainAllow * 100).toFixed(1)}%` });
  const clip = C.parts.find((x) => x.id.endsWith('_clip'));
  return { parts: C.parts, ghosts: C.ghosts, warnings, checks, levels: { base, boardBottom: zb, boardTop: zt, wallTop: zw }, clipAt: (C as any).clipAt ?? null, clipT: clip ? clip.toAssembly : null, dockM: site ? dockFrame(site.edge, site.tc, site.L0) : ear ? flatFrame(ear.edge, ear.tc, ear.L0) : null, features: C.features, plugs: C.plugs };
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
    if (!isMountHole(h)) continue;
    const at: V2 = [h.x, h.y];
    let rMax = h.d / 2 + 2.2;
    for (const k of C.keepouts) { const d = rectDist(at, k.rect); if (d > 0) rMax = Math.min(rMax, d - 0.2); }
    const r = Math.max(h.d / 2 + 0.6, rMax);
    if (rMax < h.d / 2 + 0.6) C.warnings.push(`Standoff at hole (${round(h.x, 1)}, ${round(h.y, 1)}) touches a part under the board; it was kept at the minimum size.`);
    C.standoffs.push({ x: h.x, y: h.y, r });
    C.ribNodes.push({ p: at, r });
    C.keep.push(circle2(h.x, h.y, r + 1.4));
    feat(C, 'pin', [[h.x - r, h.y - r], [h.x + r, h.y + r]], 0, zt + 1.5, [h.id]);
    C.pos.push(cyl(h.x, h.y, C.frame ? 0 : base - 0.01, zb, r));
    const zf = C.frame ? Math.max(C.rimH, Math.min(C.zb - 0.8, C.rimH + 1.6)) : base; // top of the ribs or of the base
    C.pos.push(cyl(h.x, h.y, zf - 0.01, Math.min(zb - 0.3, zf + 1.6), r + 1.4, r)); // 45 degree fillet into the post
    const rp = h.d / 2 - H.pinClear;
    const snap = h.use === 'snap' || (h.use === 'auto' && !fingersHold && h.d >= 2.0);

    if (snap && h.d >= 1.8) {
      snaps++;
      let barb = Math.min(0.3, Math.max(0.2, 0.08 * h.d));
      let sw = Math.min(1.1, Math.max(0.6, 0.3 * h.d));
      const slotDepth = Math.min(2.5, C.s - 0.6);
      // leg bending strain of the split pin (it bends across layers, so it is judged 30% stricter)
      const strainOf = (bb: number, w: number) => {
        const L = zt + 0.1 + (rp + bb - 0.45 * rp) / 2 - (zb - slotDepth);
        return { L, eps: (3 * (rp - w / 2) * (bb + 0.05)) / (2 * L * L) };
      };
      // a short pin (little room under the board) flexes too far: thin its legs (a wider split, legs at least
      // 0.6 mm) until it is comfortably within the material's limit; only if it would still break, take a little
      // off the barb (that costs grip)
      const allow = MATERIALS[H.material].strainAllow, ok = (allow * 0.85) / 1.3, breaks = (allow * 1.1) / 1.3;
      let tuned = false;
      while (strainOf(barb, sw).eps > ok && sw + 0.1 <= 2 * (rp - 0.6) + 1e-9) { sw += 0.1; tuned = true; }
      while (strainOf(barb, sw).eps > breaks * 0.97 && barb > 0.18 + 1e-9) { barb = Math.max(0.18, barb - 0.02); tuned = true; }
      const cone = rp + barb - 0.45 * rp;
      C.pos.push(cyl(h.x, h.y, zb - 0.01, zt + 0.1, rp));
      C.pos.push(cyl(h.x, h.y, zt + 0.1, zt + 0.1 + cone, rp + barb, 0.45 * rp));
      C.neg.push(box(h.x - sw / 2, h.y - rp - barb - 0.1, zb - slotDepth, h.x + sw / 2, h.y + rp + barb + 0.1, zt + 5));
      const { L, eps } = strainOf(barb, sw);
      if (snaps === 1) C.checks.push({ group: 'Board', name: `Snap pins (Ø${round(h.d, 2)} holes)`, value: `${(eps * 100).toFixed(2)}% strain`, status: strainStatus(C, eps * 1.3), detail: `split pin, ${round(barb, 2)} mm barb, ${round(sw, 1)} mm split, ${round(L, 1)} mm flexing length${tuned ? ' (split widened for the short pin)' : ''}. Bends across layers, so judged 30% stricter.` });
    } else {
      C.pos.push(cyl(h.x, h.y, zb - 0.01, zt + 0.5, rp), cyl(h.x, h.y, zt + 0.49, zt + 0.5 + rp * 0.5, rp, rp * 0.5));
    }
  }
  if (!fingersHold && !snaps && C.b.holes.some(isMountHole)) C.warnings.push('Neither wall fingers nor snap pins hold this board: it sits loose in the holder. Enable fingers or set holes to snap.');
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
      if (cn.tie && F.ties) tieAnchor(C, [c.x, c.y], null, c.ref);
      const zTop = (c.side === 'top' ? zt + c.h : zb - c.h) + cn.plug.len + 0.6;
      // a port in the top of a box gets its plug drawn standing in it, a debug header its probe's IDC socket (along
      // the header's long side)
      const ang = b.kind === 'box' && !isDebugPort(c) ? c.rot : c.w >= c.l ? c.rot : c.rot + 90;
      const tag = { kind: 'plug' as const, module: C.mid, refs: [c.ref] }, anim = { seq: 30, dir: [0, 0, 1] as [number, number, number] };
      const wp = c.side === 'top' && cn.type === 'header' ? wiredPins(C, c) : [];
      if (wp.length) {
        // jumper wires' housings, each pushed down over its pin onto the header's plastic
        const z0 = zt + Math.min(2.5, c.h), top = z0 + 14.6;
        const wires = wp.map(({ pin: q, colour }) => { C.ghosts.push(...plugUp(q.x, q.y, z0 - 0.6, { w: 2.5, h: 2.5, len: 14, cable: 1.4 }, tag, anim, 'dupont')); return { p: [q.x, q.y, top] as [number, number, number], colour, pin: q.n }; });
        const cx = wires.reduce((a2, q) => a2 + q.p[0], 0) / wires.length, cy = wires.reduce((a2, q) => a2 + q.p[1], 0) / wires.length;
        C.plugs.push({ module: C.mid, ref: c.ref, p: [cx, cy, top], d: [0, 0, 1], cable: cn.plug.cable, w: [Math.cos(rad(ang)), Math.sin(rad(ang)), 0], wires });
        continue;
      }
      if (c.side === 'top' && (b.kind === 'box' || DEBUG_TYPES.has(cn.type))) C.ghosts.push(...plugUp(c.x, c.y, zt + c.h, cn.plug, tag, anim, cn.type, ang));
      C.plugs.push({ module: C.mid, ref: c.ref, p: [c.x, c.y, zTop], d: [0, 0, c.side === 'top' ? 1 : -1], cable: cn.plug.cable, w: [Math.cos(rad(ang)), Math.sin(rad(ang)), 0], ...(DEBUG_TYPES.has(cn.type) ? { span: cn.plug.h } : {}) });
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
    // right-angle pins: a jumper's housing on each pin with a wire, straight out
    if (cn.type === 'pins_ra') {
      const wires = wiredPins(C, c).map(({ pin: q, colour }) => {
        C.ghosts.push(...plugDetail([q.x, q.y], d, zAx, { w: 2.5, h: 2.5, len: 14, cable: 1.4 }, { kind: 'plug', module: C.mid, refs: [c.ref] }, { seq: 30, dir: [d[0], d[1], 0] }, 'dupont'));
        return { p: [q.x + d[0] * 14.6, q.y + d[1] * 14.6, zAx] as [number, number, number], colour, pin: q.n };
      });
      const n = Math.max(1, wires.length), cx = wires.reduce((a2, q) => a2 + q.p[0], 0) / n || mouth[0] + d[0] * 14.6, cy = wires.reduce((a2, q) => a2 + q.p[1], 0) / n || mouth[1] + d[1] * 14.6;
      C.plugs.push({ module: C.mid, ref: c.ref, p: [cx, cy, zAx], d: [d[0], d[1], 0], cable: 1.4, w: [-d[1], d[0], 0], ...(wires.length ? { wires } : {}) });
      continue;
    }
    // plug ghost: drawn as the plug is made, then turned the way the socket is (a box's USB-A on its side)
    const roll = cn.roll ?? 0, side = roll % 180 !== 0;
    C.ghosts.push(...plugDetail(mouth, d, zAx, side ? { ...cn.plug, w: ph, h: pw } : cn.plug, { kind: 'plug', module: C.mid, refs: [c.ref] }, { seq: 30, dir: [d[0], d[1], 0] }, cn.type, roll));
    const pe = [mouth[0] + d[0] * (cn.plug.len + 0.6), mouth[1] + d[1] * (cn.plug.len + 0.6)];
    const open: [number, number] = [pw + 2 * cl, ph + 2 * cl];
    if (cn.type === 'usb_a_dual') {
      const off = c.side === 'top' ? 3.9 : -3.9;
      C.plugs.push({ module: C.mid, ref: c.ref, p: [pe[0], pe[1], zAx - off], d: [d[0], d[1], 0], cable: cn.plug.cable, open }, { module: C.mid, ref: `${c.ref}:2`, p: [pe[0], pe[1], zAx + off], d: [d[0], d[1], 0], cable: cn.plug.cable, open });
    } else C.plugs.push({ module: C.mid, ref: c.ref, p: [pe[0], pe[1], zAx], d: [d[0], d[1], 0], cable: cn.plug.cable, w: side ? [0, 0, 1] : [-d[1], d[0], 0], open });
    if (cn.cradle && F.cradles && ph > 0.5) {
      specs.push({ ref: c.ref, mouth, d, sEdge, toOut, zAx, pw, ph, pl, cap: cn.cap && F.caps, angle: cn.angle });
    } else if (cn.guard && F.guards) {
      // collar that shields the receptacle and frames the opening
      const ow = pw + 2 * cl, oh = ph + 2 * cl;
      const frame = roundCS(rect2(-(ow / 2 + 1.8), 0, ow / 2 + 1.8, zAx + oh / 2 + 1.8), 0.8).subtract(rect2(-ow / 2, zLo, ow / 2, zAx + oh / 2)).intersect(rect2(-50, 0, 50, 200));
      C.late.push(sweepTZ(mouth, d, frame, toOut - 0.6, toOut + 2.5));
      wallPiece(C, add(add(mouth, d, sEdge), left(d), -(ow / 2 + 4)), left(d), 0, ow + 8, zw); // frame style: a wall to carry the collar
      feat(C, 'guard', orientedRect(mouth, d, toOut - 0.6, toOut + 2.5, -(ow / 2 + 1.8), ow / 2 + 1.8), 0, zAx + oh / 2 + 1.8, [c.ref]);
    }
    if (cn.tie && F.ties) tieAnchor(C, mouth, { d, half: pw / 2 + cl, sEdge }, c.ref);
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
    const len = Math.min(18, Math.max(10, 0.45 * sp.pl)); // carries the plug body's root, where knocks lever it
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
  feat(C, 'cradle', orientedRect(o, d, sMin, sMax, tL, tR), 0, Math.max(...m.map((k) => k.zs)), g.map((sp) => sp.ref));
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
  C.parts.push(part(`cap_${C.parts.length}`, `Plug cap (${refs})`, mesh, Tm, '#f2c94c', 1, { kind: 'cap', module: C.mid, refs: g.map((sp) => sp.ref) }, { seq: 20 + (C.job.level ?? 0), dir: [0, 0, 1] }));
  C.checks.push({ group: 'Plugs', name: `Cap legs (${refs})`, value: `${(eps * 100).toFixed(2)}% strain`, status: strainStatus(C, eps), detail: `${round(L, 1)} mm legs, ${hook} mm hooks under the cradle ledges; they flex within the layers` });
}

/** Loops on the two long sides of a box: a hook-and-loop strap goes over the box and through them. */
function strapLoops(C: Ctx) {
  const H = C.H, ol = C.b.outline, bb = bbox(ol);
  const alongX = bb.x1 - bb.x0 >= bb.y1 - bb.y0;
  // the strap runs over the top between a pair of loops on the long sides: keep it off ports on those sides and on top
  const L0 = alongX ? bb.x0 : bb.y0, L = alongX ? bb.x1 - bb.x0 : bb.y1 - bb.y0;
  // a side port only gets in the way when its plug reaches down to the loops (7 mm tall)
  const low = (c: Comp) => C.zt + c.conn!.zc - c.conn!.plug.h / 2 < 8;
  const busy = C.b.comps.filter((c) => c.conn && !c.hidden && (c.conn.entry === 'top' || ((alongX ? Math.abs(Math.sin(rad(c.conn.angle))) > 0.7 : Math.abs(Math.cos(rad(c.conn.angle))) > 0.7) && low(c))))
    .map((c) => { const at = (alongX ? c.x : c.y) - L0, half = Math.max(c.w, c.l, c.conn!.plug.w) / 2 + 10; return [at - half, at + half]; });
  const free = (f: number) => !busy.some(([a, b]) => f * L > a && f * L < b);
  const pick = (want: number, lo: number, hi: number) => { let best: number | null = null; for (let f = lo; f <= hi + 1e-9; f += 0.01) if (free(f) && (best == null || Math.abs(f - want) < Math.abs(best - want))) best = f; return best; };
  const fa = pick(0.28, 0.1, 0.46), fb = pick(0.72, 0.54, 0.9);
  if (fa == null || fb == null) C.warnings.push('The strap loops could not all miss the ports: check that the strap clears them.');
  for (const f of [fa ?? 0.28, fb ?? 0.72]) for (const side of [-1, 1]) {
    const q: V2 = alongX ? [bb.x0 + (bb.x1 - bb.x0) * f, side > 0 ? bb.y1 : bb.y0] : [side > 0 ? bb.x1 : bb.x0, bb.y0 + (bb.y1 - bb.y0) * f];
    const n: V2 = alongX ? [0, side] : [side, 0];
    const t0 = H.gap + H.wall - 0.4, t1 = t0 + 5.5;
    const blk = orientedBox(q, n, t0, t1, -8, 8, 0, 7).subtract(orientedBox(q, n, t0 + 1.6, t0 + 3.9, -6.5, 6.5, -1, 8));
    C.late.push(blk);
    wallPiece(C, add(q, left(n), -9), left(n), 0, 18, 7);
    C.blocked.push({ poly: orientedRect(q, n, -2, t1 + 1, -9, 9), why: 'strap loop' });
    feat(C, 'tie', orientedRect(q, n, t0, t1, -8, 8), 0, 7, ['strap']);
  }
  C.checks.push({ group: 'Holder', name: 'Strap loops', value: '4', status: 'info', detail: 'thread a 12 mm hook-and-loop strap (or two zip ties) over the box through the loops on each long side' });
}

function tieAnchor(C: Ctx, at: V2, edgeConn: { d: V2; half: number; sEdge: number } | null, ref: string) {
  // find the nearest wall point and its outward normal
  const b = C.b, H = C.H;
  let q: V2, n: V2;
  if (edgeConn) {
    const t = left(edgeConn.d);
    // beside the opening, on the holder's wall at the board edge (not out at the plug's mouth, where a receptacle
    // that overhangs the edge would leave it floating clear of the rim), on the side with more room
    const e = add(at, edgeConn.d, edgeConn.sEdge);
    const cand = [add(e, t, edgeConn.half + 4), add(e, t, -(edgeConn.half + 4))];
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
  wallPiece(C, add(q, left(n), -5), left(n), 0, 10, Math.min(C.zw, hgt));
  C.blocked.push({ poly: orientedRect(o, n, -2, 5, -5, 5), why: 'tie anchor' });
  feat(C, 'tie', orientedRect(o, n, 0, 4.2, -3.2, 3.2), 0, hgt, [ref]);
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
  const snaps = C.b.holes.filter((h) => h.use === 'snap' && isMountHole(h)).length;
  const want = H.tabs === 'on' || (H.tabs === 'auto' && snaps < 2);
  if (!want) return [];
  const bb = bbox(C.b.outline);
  const small = Math.min(bb.x1 - bb.x0, bb.y1 - bb.y0) < 30;
  const pinsCanHold = C.b.holes.filter((h) => isMountHole(h) && (h.use === 'auto' || h.use === 'snap') && h.d >= 1.8).length >= 2;
  let Lf = small ? 10 : 14;
  let chosen = pickSpread(edgeSites(C, Lf + 1), 4, centroid(C.b.outline));
  if (chosen.length < 2 && (!pinsCanHold || H.tabs === 'on')) {
    // crowded edges: shorter fingers fit in the gaps between plugs (stiffer, so a smaller lip)
    const short = pickSpread(edgeSites(C, 9), 4, centroid(C.b.outline));
    if (short.length > chosen.length) { chosen = short; Lf = 8; }
  }
  if (chosen.length < 2) {
    if (pinsCanHold) C.checks.push({ group: 'Board', name: 'Wall snap fingers', value: chosen.length ? 'only one fits' : 'no room', status: 'info', detail: `plugs${C.job.dock ? ', the dock' : ''} and the label take the free edges${H.tabs === 'on' ? ', even for short fingers' : ''}; snap pins in the mounting holes hold the board instead` });
    else C.warnings.push(`Nothing clips this board in: no mounting holes for snap pins${C.b.holes.some((h) => h.role === 'standoff') ? ' (they carry the standoffs of the board on top)' : ''} and no free edge for two snap fingers. Free an edge (turn off a cradle or the label), or set two holes to "mount" in the hole wizard.`);
  }
  const { zt, zw } = C;
  const tf = small || Lf < 10 ? 1.0 : 1.2;
  const Leff0 = Lf * 0.78 - 0.2;
  const allow = MATERIALS[H.material].strainAllow;
  const lip = Math.max(0.4, Math.min(H.tabLip, (0.8 * allow * 2 * Leff0 * Leff0) / (3 * tf)));
  const zTop = zt + 0.1 + 0.3 + lip + H.gap + 0.4;
  for (const st of chosen) {
    const { q, d } = st;
    const tw0 = -(H.gap + H.wall), tw1 = -H.gap; // wall band in local t (inward positive)
    wallPiece(C, q, d, -3, Lf + 2.5, zw);
    feat(C, 'finger', orientedRect(q, d, 0, Lf, tw0 - 1, tw1 + lip), 0, zTop);
    C.pos.push(orientedBox(q, d, 0, Lf, tw0, tw1, Math.max(zw - 0.3, zt - 0.5), zTop));
    // slot under the finger, deep enough that its first layer (a short overhang over the slot) can droop a little
    // without touching the wall below and welding to it
    const slotBot = Math.max(C.base + 0.6, zt - 2.4);
    C.neg.push(orientedBox(q, d, 0, Lf + 0.6, tw0 - 0.1, tw1 + 0.05, slotBot, zt - 0.4));
    C.neg.push(orientedBox(q, d, Lf, Lf + 0.6, tw0 - 0.1, tw1 + 0.05, slotBot, zTop + 1)); // free end
    C.neg.push(orientedBox(q, d, 1.5, Lf + 0.6, tw0 - 0.1, tw1 - tf, slotBot, zTop + 1)); // thin the finger
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

// ------------------------------- frame style -----------------------------------------------------
// The "frame" holder merges the lean spine-and-rib carrier with the tray: a rim runs round the board (under its
// edge and out to the wall line), short wall guards at the corners locate it, a ledge carries the board edge, and
// ribs laid out as a minimum spanning tree tie every pin to the rim or the dock spine. About half the plastic of
// a full tray and far fewer layers with large areas, so it prints much faster.
const RIM_IN = 1.6; // how far the rim reaches under the board edge

/** Outline points nearest the bounding-box corners (and the middle of long sides): where the guards go. */
function guardPoints(ol: Loop): V2[] {
  const bb = bbox(ol);
  const want: V2[] = [[bb.x0, bb.y0], [bb.x1, bb.y0], [bb.x1, bb.y1], [bb.x0, bb.y1]];
  if (bb.x1 - bb.x0 > 90) want.push([(bb.x0 + bb.x1) / 2, bb.y0], [(bb.x0 + bb.x1) / 2, bb.y1]);
  if (bb.y1 - bb.y0 > 90) want.push([bb.x0, (bb.y0 + bb.y1) / 2], [bb.x1, (bb.y0 + bb.y1) / 2]);
  const out: V2[] = [];
  for (const w of want) {
    let best = { d: Infinity, q: w };
    for (let i = 0; i < ol.length; i++) { const r = segDist(w, ol[i], ol[(i + 1) % ol.length]); if (r.d < best.d) best = { d: r.d, q: r.q }; }
    if (!out.some((o) => Math.hypot(o[0] - best.q[0], o[1] - best.q[1]) < 8)) out.push(best.q);
  }
  return out;
}

function frameBody(C: Ctx) {
  const { H, O, outer, inner } = C;
  const rim = outer.subtract(O.offset(-RIM_IN, 'Round'));
  C.pos.push(extCh(rim, 0, C.rimH, H.chamfer ? 0.4 : 0, 0));
  const ring = outer.subtract(inner);
  const guards = ring.intersect(unionCS(guardPoints(C.b.outline).map(([x, y]) => circle2(x, y, 7, 32))));
  if (!guards.isEmpty()) C.pos.push(extCh(guards, 0, C.zw, H.chamfer ? 0.4 : 0, 0));
}

/**
 * A slot for a thin probe: it slides in from its open end (the end its plugs are on, which in a dock points up, away
 * from the rail) down to a stop, under a lip along each side, and rests on a rim. Nothing to strap, snap or screw:
 * lift it out the way it went in.
 */
function slotBody(C: Ctx) {
  const { H, O, outer, zb, zt } = C;
  const ol = C.b.outline, gw = H.gap + H.wall;
  // the open end: away from the dock, else the side most of its plugs are on
  let open: V2 = C.dock ? [-C.dock.n[0], -C.dock.n[1]] : [0, 0];
  if (!C.dock) {
    for (const c of C.b.comps) if (c.conn?.entry === 'edge' && !c.hidden) { const d = dirOf(c.conn.angle); open = [open[0] + d[0], open[1] + d[1]]; }
    const L = Math.hypot(open[0], open[1]);
    open = L > 0.3 ? [open[0] / L, open[1] / L] : [0, 1];
  }
  const side = left(open);
  const u = (q: V2) => q[0] * open[0] + q[1] * open[1], t = (q: V2) => q[0] * side[0] + q[1] * side[1];
  const u0 = Math.min(...ol.map(u)), u1 = Math.max(...ol.map(u)), t0 = Math.min(...ol.map(t)), t1 = Math.max(...ol.map(t));
  const LIP = 1.6, zL = zt + 0.3, zTop = zL + 1.2;
  // the rim it rests on
  C.pos.push(extCh(outer.subtract(O.offset(-RIM_IN - 1, 'Round')), 0, zb, H.chamfer ? 0.4 : 0, 0));
  // a channel along each side: the wall, and the lip over the probe's edge
  for (const [tE, sg] of [[t1, 1], [t0, -1]] as const) {
    const w0 = tE + sg * H.gap, w1 = tE + sg * gw;
    C.pos.push(orientedBox([0, 0], open, u0 - gw, u1, Math.min(w0, w1), Math.max(w0, w1), 0, zTop));
    const l0 = tE - sg * LIP, l1 = tE + sg * (H.gap + 0.01);
    C.pos.push(orientedBox([0, 0], open, u0 - gw, u1 - 1.5, Math.min(l0, l1), Math.max(l0, l1), zL, zTop));
    // a lead-in at the open end: the lip starts 1.5 mm in, chamfered
    C.pos.push(orientedBox([0, 0], open, u1 - 1.5, u1, Math.min(l0, l1) + (sg > 0 ? 0.8 : 0), Math.max(l0, l1) - (sg < 0 ? 0.8 : 0), zL + 0.4, zTop));
    feat(C, 'rim', orientedRect([0, 0], open, u0 - gw, u1, Math.min(w1, l0), Math.max(w1, l0)), 0, zTop, ['slot']);
  }
  // the stop at the closed end
  C.pos.push(orientedBox([0, 0], open, u0 - gw, u0 - H.gap, t0 - gw, t1 + gw, 0, zTop));
  // no lip over a part standing at an edge (an adapter's USB socket, its pins): the slot is open there
  for (const c of C.b.comps) if (!c.hidden && c.side === 'top' && c.h > 0.5) C.neg.push(ext(poly(compRect(c, 0.6)), zt + 0.05, zTop + 2));
  C.checks.push({ group: 'Holder', name: 'Slot', value: `${round(zt - zb, 1)} mm, open ${Math.abs(open[1]) > 0.7 ? (open[1] > 0 ? 'at the back' : 'at the front') : open[0] > 0 ? 'at the right' : 'at the left'}`, status: 'info', detail: `the probe slides in from its open end (plugs out), under a ${LIP} mm lip along each side, down to the stop; ${C.dock ? 'in the dock the open end points up, so it stays put' : 'friction holds it'}. Set its thickness under Box (Height) to match yours. Not print-tested yet.` });
}

/**
 * Seat posts under the board edge carry it where no pin is near (both styles): at the corners and along long
 * edges, never on a part or lead under the board.
 */
function seats(C: Ctx) {
  const { b, zb } = C;
  const ol = b.outline;
  const supports: V2[] = C.standoffs.map((so) => [so.x, so.y]);
  const cand: V2[] = [...guardPoints(ol)];
  let run = 0;
  for (let i = 0; i < ol.length; i++) {
    const a = ol[i], c = ol[(i + 1) % ol.length];
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    for (let t = (25 - run) % 25; t < L; t += 25) cand.push([a[0] + ((c[0] - a[0]) * t) / L, a[1] + ((c[1] - a[1]) * t) / L]);
    run = (run + L) % 25;
  }
  const clear = (q: V2) => !C.keepouts.some((k) => rectDist(q, k.rect) < 3.2) && !b.comps.some((c) => !c.hidden && c.side === 'bottom' && inside(q, compRect(c, 3)));
  const band = C.O.offset(-0.02, 'Round').subtract(C.O.offset(-RIM_IN - 1.0, 'Round'));
  const pads: CS[] = [];
  for (const q of cand) {
    if (supports.some((s2) => Math.hypot(s2[0] - q[0], s2[1] - q[1]) < 20) || !clear(q)) continue;
    supports.push(q);
    pads.push(circle2(q[0], q[1], 3.2, 24));
  }
  if (!pads.length) return;
  const pad = unionCS(pads).intersect(band.add(C.outer.subtract(C.inner)));
  C.pos.push(ext(pad, C.frame ? 0.01 : C.base - 0.01, zb));
  C.checks.push({ group: 'Board', name: 'Edge seats', value: `${pads.length}`, status: 'info', detail: 'posts under the board edge where no pin is close, clear of parts and leads under the board' });
}

interface Rib { a: V2; b: V2; na: number; nb: number } // na / nb: node index, or -1 for the rim / spine

function frameRibs(C: Ctx) {
  const nodes = C.ribNodes;
  const mat = MATERIALS[C.H.material];
  const loops = O_inner(C);
  const spine = (C as any).spine as { a: V2; b: V2; hx: number } | undefined;
  const toFrame = (p: V2) => {
    let best = { d: Infinity, q: p as V2 };
    for (const L of loops) for (let i = 0; i < L.length; i++) { const r = segDist(p, L[i], L[(i + 1) % L.length]); if (r.d < best.d) best = { d: r.d, q: r.q }; }
    if (spine) { const r = segDist(p, spine.a, spine.b); if (r.d - spine.hx < best.d) best = { d: r.d - spine.hx, q: r.q }; }
    return best;
  };
  /** Nearest rim or spine point from p in a direction at least `apart` degrees from every direction in `used`. */
  const frameInSector = (p: V2, used: V2[], apart: number): V2 | null => {
    let best: { d: number; q: V2 } | null = null;
    for (let a = 0; a < 360; a += 10) {
      const d: V2 = [Math.cos(rad(a)), Math.sin(rad(a))];
      if (used.some((u) => d[0] * u[0] + d[1] * u[1] > Math.cos(rad(apart)))) continue;
      let dist = Infinity;
      for (const L of loops) dist = Math.min(dist, rayExit(p, d, L));
      if (spine) {
        // ray against the spine segment
        const ax = spine.a, bx = spine.b, ex = bx[0] - ax[0], ey = bx[1] - ax[1];
        const den = d[0] * ey - d[1] * ex;
        if (Math.abs(den) > 1e-9) {
          const t = ((ax[0] - p[0]) * ey - (ax[1] - p[1]) * ex) / den, u = ((ax[0] - p[0]) * d[1] - (ax[1] - p[1]) * d[0]) / den;
          if (t > 0 && u >= 0 && u <= 1) dist = Math.min(dist, t - spine.hx);
        }
      }
      if (dist < 60 && (!best || dist < best.d)) best = { d: dist, q: [p[0] + d[0] * dist, p[1] + d[1] * dist] };
    }
    return best?.q ?? null;
  };
  // Prim's minimum spanning tree with the frame (rim + spine) as one node
  const n = nodes.length;
  const best = nodes.map((nd) => ({ ...toFrame(nd.p), from: -1 }));
  const done = new Array(n).fill(false);
  const ribs: Rib[] = [];
  for (let k = 0; k < n; k++) {
    let i = -1;
    for (let j = 0; j < n; j++) if (!done[j] && (i < 0 || best[j].d < best[i].d)) i = j;
    done[i] = true;
    if (best[i].d > nodes[i].r * 0.6) ribs.push({ a: nodes[i].p, b: best[i].q, na: i, nb: best[i].from });
    for (let j = 0; j < n; j++) {
      if (done[j]) continue;
      const d = Math.hypot(nodes[j].p[0] - nodes[i].p[0], nodes[j].p[1] - nodes[i].p[1]) - nodes[i].r;
      if (d < best[j].d) best[j] = { d, q: nodes[i].p, from: i };
    }
  }
  // posts that hang on one rib (or only reach the frame through another post) get a second rib to the frame,
  // pointing well away from the first: two supports instead of one cantilever
  const ribsAt = (i: number) => ribs.filter((r) => r.na === i || r.nb === i);
  const dirFrom = (i: number, r: Rib): V2 => { const o = r.na === i ? r.b : r.a; const p = nodes[i].p, L = Math.hypot(o[0] - p[0], o[1] - p[1]) || 1; return [(o[0] - p[0]) / L, (o[1] - p[1]) / L]; };
  const brace = (i: number, force = false) => {
    const at = ribsAt(i);
    const toFrameDirect = at.some((r) => (r.na === i && r.nb === -1) || (r.nb === i && r.na === -1));
    const len = at.reduce((m, r) => Math.max(m, Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1])), 0);
    if (!force && at.length >= 2 && toFrameDirect) return false;
    if (!force && at.length === 1 && toFrameDirect && len < 14) return false;
    if (at.length >= 4) return false;
    const q = frameInSector(nodes[i].p, at.map((r) => dirFrom(i, r)), 60);
    if (!q || Math.hypot(q[0] - nodes[i].p[0], q[1] - nodes[i].p[1]) < nodes[i].r * 0.8) return false;
    ribs.push({ a: nodes[i].p, b: q, na: i, nb: -1 });
    return true;
  };
  for (let i = 0; i < n; i++) if (C.standoffs.some((so) => so.x === nodes[i].p[0] && so.y === nodes[i].p[1])) brace(i);

  // size the ribs from the frame FEA: start lean, deepen and widen where a post is loaded too hard
  let w = 2.6, h = Math.max(C.rimH, Math.min(C.zb - 0.8, C.rimH + 1.6));
  const hMax = Math.max(h, C.zb - 0.6);
  let fea = supportFea(C, nodes, ribs, w, h);
  const braced = new Set<number>();
  for (let pass = 0; pass < 8 && fea.worst.sigma > 0.33 * mat.yield; pass++) {
    const i = fea.worst.node;
    // deeper ribs first (stiffness grows with the cube of the depth), then one more rib to the worst post, then wider ribs
    if (h < hMax - 0.05) h = Math.min(hMax, h + 1.5);
    else if (i >= 0 && !braced.has(i) && (braced.add(i), brace(i, true))) { /* added a rib */ }
    else if (w < 4) w = Math.min(4, w + 0.7);
    else break;
    fea = supportFea(C, nodes, ribs, w, h);
  }

  // plan view: rib strips, pads under the posts and a band of the rim, filleted where they meet
  const strips: CS[] = [];
  for (const r of ribs) {
    const L = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]);
    const d: V2 = [(r.b[0] - r.a[0]) / L, (r.b[1] - r.a[1]) / L];
    strips.push(poly(orientedRect(r.a, d, 0, L + 0.8, -w / 2, w / 2), 'NonZero'));
  }
  if (strips.length) {
    const pads = unionCS(C.standoffs.map((so) => circle2(so.x, so.y, so.r + 1.4, 32)));
    const rimBand = C.outer.subtract(C.O.offset(-RIM_IN - 0.5, 'Round'));
    const net = unionCS([...strips, pads]);
    const fil = unionCS([net, rimBand]).offset(1.4, 'Round').offset(-1.4, 'Round').intersect(net.offset(3, 'Round'));
    C.pos.push(extCh(fil.intersect(C.outer), 0, h, 0.4, 0.2));
    // gussets: each rib climbs to the post it carries over its last 5 mm
    for (const r of ribs) for (const [end, other, ni] of [[r.a, r.b, r.na], [r.b, r.a, r.nb]] as [V2, V2, number][]) {
      const so = ni >= 0 ? C.standoffs.find((q) => q.x === nodes[ni].p[0] && q.y === nodes[ni].p[1]) : undefined;
      if (!so) continue;
      const L = Math.hypot(other[0] - end[0], other[1] - end[1]);
      const d: V2 = [(other[0] - end[0]) / L, (other[1] - end[1]) / L];
      const top = C.zb - 0.4, run = Math.min(L - 0.5, so.r + 5);
      if (run <= so.r + 0.5 || top <= h + 0.3) continue;
      const prof = poly([[0, 0], [run, 0], [run, h], [so.r + 0.3, top], [0, top]], 'NonZero');
      const t: V2 = [-d[1], d[0]];
      // profile (s, z) extruded across the rib: local x -> d, local y -> z, local z -> -t (right handed)
      C.pos.push(prof.extrude(w * 0.8).transform([d[0], d[1], 0, 0, 0, 0, 1, 0, -t[0], -t[1], 0, 0, end[0] + t[0] * w * 0.4, end[1] + t[1] * w * 0.4, 0, 1] as any));
    }
  }
  // parts under the board sink into the ribs where they need more room than the ribs leave
  for (const k of C.keepouts) if (k.need > C.zb - h) C.neg.push(ext(poly(k.rect).offset(0.3, 'Round'), Math.max(0.6, C.zb - k.need - 0.3), C.zb + 0.1));
  C.checks.push({ group: 'Holder', name: 'Frame', value: `${ribs.length} rib${ribs.length === 1 ? '' : 's'}`, status: 'info', detail: `rim ${round(RIM_IN + C.H.gap + C.H.wall, 1)} × ${round(C.rimH, 1)} mm round the board, ${guardPoints(C.b.outline).length} corner guards; ribs ${round(w, 1)} × ${round(h, 1)} mm with gussets up each post tie ${n} pin${n === 1 ? '' : 's'} and pads to the rim${spine ? ' or the dock spine' : ''}` });
  supportChecks(C, fea);
}

/**
 * Beam model of the posts and ribs (the rim and the dock spine are taken as rigid). Each post is loaded on its own:
 * 20 N pushing the board down onto it (a plug pressed in from above), and 10 N sideways in x and in y (the board
 * knocked). Returns the worst post and every post's peak stress and deflection.
 */
function supportFea(C: Ctx, nodes: Ctx['ribNodes'], ribs: Rib[], w: number, h: number) {
  const mat = MATERIALS[C.H.material];
  const N: FNode[] = [], E: FElem[] = [];
  const zc = h / 2;
  const base = nodes.map((nd) => N.push({ x: nd.p[0], y: nd.p[1], z: zc }) - 1);
  const posts = C.standoffs.map((so) => {
    const ni = nodes.findIndex((nd) => nd.p[0] === so.x && nd.p[1] === so.y);
    const top = N.push({ x: so.x, y: so.y, z: C.zb }) - 1;
    if (ni >= 0) E.push({ a: base[ni], b: top, s: roundSection(so.r), name: 'post' });
    else { const fix = N.push({ x: so.x, y: so.y, z: zc, fixed: true }) - 1; E.push({ a: fix, b: top, s: roundSection(so.r), name: 'post' }); }
    return { so, top, ni };
  });
  const sec = rectSection(w, h);
  for (const r of ribs) {
    const a = r.na >= 0 ? base[r.na] : N.push({ x: r.a[0], y: r.a[1], z: zc, fixed: true }) - 1;
    const b = r.nb >= 0 ? base[r.nb] : N.push({ x: r.b[0], y: r.b[1], z: zc, fixed: true }) - 1;
    if (Math.hypot(N[a].x - N[b].x, N[a].y - N[b].y) > 0.3) E.push({ a, b, s: sec, name: 'rib' });
  }
  // nodes not reached by any rib (pads over the rim) sit on the rim: clamp them
  N.forEach((nd, i) => { if (!nd.fixed && !E.some((e) => e.a === i || e.b === i)) nd.fixed = true; });
  for (const pt of posts) if (pt.ni >= 0 && !E.some((e) => e.name === 'rib' && (e.a === base[pt.ni] || e.b === base[pt.ni]))) N[base[pt.ni]].fixed = true;
  const out = posts.map((pt) => {
    let sigma = 0, defl = 0, which = '';
    for (const [f, lab] of [[[0, 0, -20], 'down'], [[10, 0, 0], 'x'], [[0, 10, 0], 'y']] as [[number, number, number], string][]) {
      const r = solveFrame(N, E, mat.E, mat.nu, [{ node: pt.top, f }]);
      const s = Math.max(...r.stress);
      const u = Math.hypot(r.u[pt.top * 6], r.u[pt.top * 6 + 1], r.u[pt.top * 6 + 2]);
      if (s > sigma) { sigma = s; which = lab; }
      defl = Math.max(defl, u);
    }
    return { so: pt.so, sigma, defl, which, node: pt.ni };
  });
  const worst = out.reduce((a, c) => (c.sigma > a.sigma ? c : a), { so: null as any, sigma: 0, defl: 0, which: '', node: -1 });
  return { posts: out, worst };
}

function supportChecks(C: Ctx, fea: ReturnType<typeof supportFea>) {
  if (!fea.posts.length) return;
  const mat = MATERIALS[C.H.material];
  const w = fea.worst;
  const st: Check['status'] = w.sigma < 0.33 * mat.yield ? 'ok' : w.sigma < 0.6 * mat.yield ? 'warn' : 'bad';
  const hole = (so: { x: number; y: number }) => C.b.holes.findIndex((h) => Math.abs(h.x - so.x) < 1e-6 && Math.abs(h.y - so.y) < 1e-6) + 1;
  C.checks.push({ group: 'Board', name: 'Hole supports (beam FEA)', value: `${round(w.sigma, 1)} MPa`, status: st,
    detail: `worst post: hole ${hole(w.so)}, ${w.which === 'down' ? '20 N pushing the board down' : `10 N sideways (${w.which})`}, ${round(w.defl, 2)} mm movement. ${mat.yield} MPa yield for ${C.H.material}; posts and ribs as beams, the rim held rigid. ` +
      fea.posts.map((p) => `Hole ${hole(p.so)}: ${round(p.sigma, 1)} MPa, ${round(p.defl, 2)} mm`).join('; ') });
}

/** Loops a rib may end on: just inside the rim's inner edge. */
function O_inner(C: Ctx): Loop[] {
  return csLoops(C.O.offset(-RIM_IN + 0.6, 'Round'));
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
    // a box longer than the printer bed is held by two halves, each on its own clip, one in each half
    const split = splitAxis(C);
    const half = (c: V2) => (split ? Math.sign((c[0] - cen[0]) * split[0] + (c[1] - cen[1]) * split[1]) : 0);
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
        if (!ok(c) || (split && half(c) >= 0)) continue;
        const dr = (c[0] - cen[0]) * er[0] + (c[1] - cen[1]) * er[1];
        // (split: the middle of its half, on the line along the rail)
        const score = tabNeed(c) + (split ? 0.35 * Math.abs(Math.abs(dr) - (bb.x1 - bb.x0 + bb.y1 - bb.y0) / 8) : 0.35 * Math.abs(dr)) + (split ? 2 : 0.1) * Math.abs((c[0] - cen[0]) * ev[0] + (c[1] - cen[1]) * ev[1]);
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
    // the second half's clip: the first one's mirror across the middle, along the rail
    const ats: V2[] = [at];
    if (split) { const k = 2 * ((cen[0] - at[0]) * split[0] + (cen[1] - at[1]) * split[1]); ats.push(add(at, split, k)); }
    ats.forEach((a, i) => {
      for (const r of slotRects(a, er, ev, sl, cfg.four)) C.neg.push(ext(poly(r), -1, C.base + 0.02));
      const pad = orientedRect(a, er, -(sl.outer + 2.5), sl.outer + 2.5, -(sl.outer + 2.5), sl.outer + 2.5);
      C.keep.push(poly(pad));
      if (C.frame) { C.pos.push(ext(roundCS(poly(pad), 2), 0, C.base)); C.ribNodes.push({ p: a, r: sl.outer + 2.5 }); }
      const tabExt = tabNeed(a);
      const d = clipDims({ W, tf: M.railT, tabExt, HA: cfg.HA });
      const clip = buildClip({ W, tf: M.railT, tabExt, HA: cfg.HA });
      // clip print frame: x = u, y = v, z = w. Assembly: u -> +z (u = uF at the base underside), v -> ev, w -> u x v
      const Wd: V2 = [-ev[1], ev[0]]; // z x ev
      const o = add(add(a, ev, -d.vc), Wd, -W / 2);
      const T = matFromBasis([0, 0, 1], [ev[0], ev[1], 0], [Wd[0], Wd[1], 0], [o[0], o[1], -d.uF]);
      C.parts.push(part(i ? 'clip2' : 'clip', 'DIN rail clip (pull tab)', clip, T, '#ff6b5b', 1, { kind: 'clip', module: C.mid }, { seq: 2, dir: [0, 0, -1] }));
      railGhost(C, T, W);
      if (!i) clipChecks(C, d, tabExt);
    });
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
    C.parts.push(part('clip', 'DIN rail clip (pull tab)', clip, T, '#ff6b5b', 1, { kind: 'clip', module: C.mid }, { seq: 2, dir: [n[0], n[1], 0] }));
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
  const u = [T[0], T[1], T[2]]; // clip u axis: from the rail towards the holder
  C.ghosts.push({ name: 'DIN rail', mesh: transformMesh(meshFrom(rail), T), color: '#94a3b8', opacity: 0.55, tag: { kind: 'rail' }, anim: { seq: 0, dir: [-u[0], -u[1], -u[2]] } });
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
  feat(C, 'stand', orientedRect(c0, n, -1, S.depth + 3, -outerW / 2, outerW / 2), 0, Math.max(C.zw, outerW + 0.5));
  const post = C.ghosts[C.ghosts.length - 1];
  if (post?.name === 'stand post') { post.tag = { kind: 'stand', module: C.mid }; post.anim = { seq: 30, dir: axis === 'edge' ? [n[0], n[1], 0] : [0, 0, -1] }; }
  C.checks.push({ group: 'Stand', name: 'Stand socket', value: `${S.shape === 'tripod' ? '1/4"-20 nut trap' : `${S.shape} ${round(size, 2)} mm`}`, status: 'info', detail: `${S.fit === 'press' ? 'press fit with crush ribs' : `slip fit, +${round(clr, 2)} mm`}; ${round(S.depth, 1)} mm deep, axis ${axis === 'edge' ? 'out of the ' + S.edge + ' edge' : 'downwards'}` });
}

// ------------------------------- label -----------------------------------------------------------
const MAKER_WORDS = new Set(['raspberry', 'pi', 'arduino', 'adafruit', 'sparkfun', 'espressif', 'board', 'dev', 'module', 'kit']);
/**
 * Shorter forms of a board's own name, longest first, that still say which board it is: runs of its words, never
 * just maker words or a stub ("Raspberry Pi Zero 2 W" -> "Pi Zero 2 W", "Zero 2 W", ... "Zero"; never "2 W").
 */
export function labelForms(label: string, boardName: string): string[] {
  const t = label.trim().slice(0, 40);
  if (t !== boardName.trim()) return [t]; // the user's own words are never cut
  const w = t.split(/\s+/), out: string[] = [];
  for (let n = w.length; n >= 1; n--) for (let i = w.length - n; i >= 0; i--) {
    const run = w.slice(i, i + n);
    if (run.every((x) => MAKER_WORDS.has(x.toLowerCase())) || run.join('').length < 3 || !run.some((x) => /[a-z]{2}/i.test(x))) continue;
    out.push(run.join(' '));
  }
  return [...new Set(out)];
}

function label(C: Ctx): boolean {
  const H = C.H;
  const hmax = Math.min(5, C.zw - C.base - 1.6);
  if (hmax < 2.4) { C.checks.push({ group: 'Holder', name: 'Label', value: 'left off', status: 'info', detail: 'the walls are too low for engraved text; raise "Wall above board"' }); return false; }
  const forms = labelForms(H.label, C.b.name);
  let hgt = hmax, tw = 0, sites: Site[] = [], text = forms[0];
  found: for (const f of forms) for (hgt = hmax; hgt >= 2.4; hgt -= 0.4) {
    tw = textWidth(f, hgt);
    sites = edgeSites(C, tw + 4, [], false);
    if (sites.length) { text = f; break found; }
  }
  if (!sites.length) { C.checks.push({ group: 'Holder', name: 'Label', value: 'left off', status: 'info', detail: 'no free straight wall is long enough; plugs, fingers and the dock take them. A shorter label may fit.' }); return false; }
  C.checks.push({ group: 'Holder', name: 'Label', value: `"${text}"`, status: 'info', detail: `engraved ${round(hgt, 1)} mm high, 0.6 mm deep${text !== forms[0] ? `; "${forms[0]}" did not fit a free wall` : ''}` });
  // longest free stretch, prefer bottom-facing edges (the front when mounted)
  sites.sort((a, b) => (b.len - a.len) + (a.n[1] - b.n[1]) * 5);
  const st = sites[0];
  const L = st.len;
  const sMid = Math.min(Math.max(L / 2, st.free + (tw + 4) / 2), L - (tw + 4) / 2);
  const a = C.b.outline[st.seg];
  const o = add(add(a, st.d, sMid), st.n, H.gap + H.wall);
  // text reads along d when seen from outside (for a CCW outline); depth axis = outward normal
  wallPiece(C, add(a, st.d, sMid - tw / 2 - 2.5), st.d, 0, tw + 5, C.zw);
  feat(C, 'label', orientedRect(add(a, st.d, sMid - tw / 2 - 1), st.d, 0, tw + 2, -(H.gap + H.wall + 0.5), 0), 0, C.zw);
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
  const lv = C.job.level ?? 0;
  C.ghosts.push(...boardDetail(C.b, C.zb, C.zt, { kind: 'board', module: C.mid }, { seq: 4 + 2 * lv, dir: [0, 0, 1] }));
}


/** A board screwed on top on standoffs: its slab, parts and plugs, plus the standoffs, all as ghosts. */
function boltedGhosts(C: Ctx, bo: NonNullable<Job['bolted']>[number]) {
  const { b, dx, dy, dz, mid } = bo;
  const z0 = C.zt + dz, z1 = z0 + b.thickness;
  const tag: PickTag = { kind: 'board', module: mid }, anim: Anim = { seq: 4.5 + 2 * (C.job.level ?? 0), dir: [0, 0, 1] };
  const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, dx, dy, 0, 1];
  for (const g of boardDetail(b, z0, z1, tag, anim)) C.ghosts.push({ ...g, mesh: transformMesh(g.mesh, T) });
  // standoffs where the holes line up with the board below
  const posts: MF[] = [];
  for (const h of b.holes) {
    const x = h.x + dx, y = h.y + dy;
    if (C.b.holes.some((q) => Math.hypot(q.x - x, q.y - y) < 0.8)) posts.push(cyl(x, y, C.zt, z0, 2.5, 2.5, 6));
  }
  if (posts.length) C.ghosts.push({ name: 'standoffs', mesh: meshFrom(unionMF(posts)), color: '#c9a74a', opacity: 1, tag, anim, mat: 'gold' });
  for (const c of b.comps) {
    const cn = c.conn;
    if (!cn || c.hidden || cn.entry !== 'edge') continue;
    const d = dirOf(cn.angle);
    const mouth = add([c.x + dx, c.y + dy], d, extentAlong(c, cn.angle));
    const zAx = c.side === 'top' ? z1 + cn.zc : z0 - cn.zc;
    const { w: pw, h: ph, len: pl } = cn.plug;
    C.ghosts.push(...plugDetail(mouth, d, zAx, { w: pw, h: ph, len: pl, cable: cn.plug.cable }, { kind: 'plug', module: mid, refs: [c.ref] }, { seq: 30, dir: [d[0], d[1], 0] }, cn.type));
    const pe = [mouth[0] + d[0] * (pl + 0.6), mouth[1] + d[1] * (pl + 0.6)];
    const off = cn.type === 'usb_a_dual' ? (c.side === 'top' ? 3.9 : -3.9) : 0;
    C.plugs.push({ module: mid, ref: c.ref, p: [pe[0], pe[1], zAx - off], d: [d[0], d[1], 0], cable: cn.plug.cable });
    if (off) C.plugs.push({ module: mid, ref: `${c.ref}:2`, p: [pe[0], pe[1], zAx + off], d: [d[0], d[1], 0], cable: cn.plug.cable });
  }
  C.checks.push({ group: 'Stack', name: `${b.name} bolted on top`, value: `${round(dz, 1)} mm standoffs`, status: 'info', detail: `sits on standoffs screwed into the holes it shares with ${C.b.name}; those holes get no holder pins and the holder leaves room under them for screw heads or nuts. Its plugs get no cradles of their own.` });
}

/** Press-fit socket for a Ø4 tower peg, open at z = 0: three crush ribs make it a firm fit. */
function pegSocket(q: V2): MF {
  let hole = unionMF([cyl(q[0], q[1], -1, 4.6, 2.12), cyl(q[0], q[1], 4.59, 6.7, 2.12, 0.02)]);
  for (const a of [90, 210, 330]) hole = hole.subtract(box(-0.35, 1.85, -1, 0.35, 2.3, 4.6).rotate([0, 0, a - 90]).translate([q[0], q[1], 0]));
  return hole;
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
      if (socket) tw = tw.subtract(pegSocket(q));
      // arm back to the tray, clipped so it never enters the board area
      const d: V2 = [cen[0] - q[0], cen[1] - q[1]];
      const L = Math.hypot(d[0], d[1]) || 1;
      const u: V2 = [d[0] / L, d[1] / L];
      const arm = orientedBox(q, u, 0, L, -2.5, 2.5, 0, Math.min(C.zw, 6)).subtract(ext(C.inner, -1, 100));
      C.late.push(tw, arm);
      C.blocked.push({ poly: orientedRect(q, u, -4, 8, -5, 5), why: 'tower' });
      feat(C, 'tower', [[q[0] - 3.5, q[1] - 3.5], [q[0] + 3.5, q[1] + 3.5]], 0, height + (peg ? 4 : 0));
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
      if (C.frame) { C.pos.push(cyl(q[0], q[1], 0, C.base, 4.5)); C.ribNodes.push({ p: q, r: 4.5 }); }
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
  C.parts.push(part('rod', 'Release rod + button', r.m.transform(D as any), ID, '#ff5d6c', 1, { kind: 'rod', module: C.mid }, { seq: 3.5, dir: [-s.n[0], -s.n[1], 0] }));
  feat(C, 'dock', tsPoly(s, s.tc - HD.base.hx, s.tc + HD.base.hx, -14, s.ped + 1), 0, HD.spineY1);
  (C as any).spine = { a: tsPoly(s, s.tc, s.tc, 0, 0)[0], b: tsPoly(s, s.tc, s.tc, s.far, s.far)[0], hx: HD.spineHx };
  if (s.conflicts.length) C.warnings.push(`Dock on the ${s.edge} edge: ${s.conflicts.join(', ')} ${s.conflicts.length > 1 ? 'are' : 'is'} in the way. Pick another dock edge in the Rails step.`);
  const rl = s.release;
  C.checks.push({ group: 'Holder', name: 'Release button', value: rl.got === 'centre' ? 'centred' : 'beside the board', status: 'info',
    detail: rl.want !== 'auto' && rl.want !== rl.got ? `${rl.want === 'side' ? 'beside the board' : 'centred'} would block ${rl.blocked.join(', ') || 'a plug'}, so it went ${rl.got === 'centre' ? 'in the middle' : 'beside the board'}` : rl.got === 'centre' ? 'the spine runs under the board' : 'the spine runs beside the board, which sits lower' });
  const eRatio = mat.E / MATERIALS.PETG.E;
  // tongue root at the socket mouth, bending under an out-of-plane push on the far edge
  const tb = 2 * TONGUE.hx, th = TONGUE.y1 - TONGUE.y0, F = 20, Mo = F * s.far, sig = Mo / ((tb * th * th) / 6);
  C.checks.push({ group: 'Dock', name: 'Release', value: `press the button, ${HD.stroke} mm`, status: 'info', detail: `thumb on the button at the ${({ bottom: 'top', top: 'bottom', left: 'right', right: 'left' } as Record<EdgeName, string>)[s.edge]} edge, two fingers under the grip bar, squeeze and lift. About ${(4.0 * eRatio).toFixed(1)} N (${H.material}); the latch spring returns the button. Rod: ${round(r.len, 0)} mm, printed flat.` });
  C.checks.push({ group: 'Dock', name: `Tongue root, ${F} N push on the far edge`, value: `${round(sig, 0)} MPa`, status: sig < 0.4 * mat.yield ? 'ok' : sig < 0.8 * mat.yield ? 'warn' : 'bad', detail: `${round(s.far, 0)} mm lever onto the ${tb} × ${th} mm tongue (${H.material} yields at ~${mat.yield} MPa). Hold the holder while plugging in stiff cables at the far end.` });
  if (s.under && C.zb > DOCK_MIN_ZB - 0.2) C.checks.push({ group: 'Dock', name: 'Board raised over the rod spine', value: `${round(C.zb, 1)} mm`, status: 'info', detail: 'the release-rod spine runs under the board' });
}

// ------------------------------- rail dock, lying flat (holder side) -----------------------------
/** The ear's footprint and the wall it joins (t along the edge, s in from the holder's outer face; outside is negative). */
const earPoly = (s: EarSite, t0: number, t1: number, s0: number, s1: number): Loop =>
  [[t0, s0], [t1, s0], [t1, s1], [t0, s1]].map(([t, d]) => [s.e[0] * t + s.n[0] * (s.L0 - d), s.e[1] * t + s.n[1] * (s.L0 - d)] as V2);

function earBlocks(C: Ctx, s: EarSite) {
  // the wall the ear joins takes no finger, label or cut-out
  C.blocked.push({ poly: earPoly(s, s.tc - EAR.hx - 1, s.tc + EAR.hx + 1, -3, s.inset + C.H.wall + 2), why: 'dock' });
}

function earFeatures(C: Ctx, s: EarSite) {
  const H = C.H, mat = MATERIALS[H.material];
  const D = inv(flatFrame(s.edge, s.tc, s.L0)); // socket-local -> holder
  // the ear reaches from over the socket to the wall, into it by most of the wall's thickness
  const f = flatHolderDock(EAR.len + s.inset + H.wall * 0.7, C.job.dock?.fit ?? 0);
  C.pos.push(f.add.transform(D as any));
  C.neg.push(f.cut.transform(D as any));
  const r = rod(f.top, 0);
  C.parts.push(part('rod', 'Release rod + button', r.m.transform(D as any), ID, '#ff5d6c', 1, { kind: 'rod', module: C.mid }, { seq: 3.5, dir: [0, 0, 1] }));
  feat(C, 'dock', earPoly(s, s.tc - EAR.hx, s.tc + EAR.hx, -EAR.len, 0), 0, EAR.drop + f.top + HD.stroke + HD.head.t);
  if (s.conflicts.length) C.warnings.push(`Dock ear on the ${s.edge} edge: ${s.conflicts.join(', ')} ${s.conflicts.length > 1 ? 'are' : 'is'} in the way. Pick another dock edge in the Rails step.`);
  C.checks.push({ group: 'Dock', name: 'Lying flat', value: `ear on the ${s.edge} edge`, status: 'info', detail: `the holder lies top face up on its dock by a tab on its ${s.edge} edge, with the same tongue and socket as a standing one: so it takes the same shoe and socket, and a J-Link or adapter can stand behind it in the socket's other half.` });
  const eRatio = mat.E / MATERIALS.PETG.E;
  C.checks.push({ group: 'Dock', name: 'Release', value: `press the button, ${HD.stroke} mm`, status: 'info', detail: `thumb on the button on the tab, fingers under the tab, squeeze and lift the holder straight up. About ${(4.0 * eRatio).toFixed(1)} N (${H.material}); the latch spring returns the button. Rod: ${round(r.len, 0)} mm, printed flat.` });
  // a press on the far side of the holder (plugging in from above) bends the tongue at the socket mouth the same way
  // a push on a standing holder's far edge does
  const tb = 2 * TONGUE.hx, th = TONGUE.y1 - TONGUE.y0, F = 20, lever = s.far - (TONGUE.y0 + TONGUE.y1) / 2, sig = (F * lever) / ((tb * th * th) / 6);
  C.checks.push({ group: 'Dock', name: `Tongue root, ${F} N press on the far side`, value: `${round(sig, 0)} MPa`, status: sig < 0.4 * mat.yield ? 'ok' : sig < 0.8 * mat.yield ? 'warn' : 'bad', detail: `${round(lever, 0)} mm lever onto the ${tb} × ${th} mm tongue (${H.material} yields at ~${mat.yield} MPa). Hold the holder while pushing stiff plugs in at the far side${sig >= 0.4 * mat.yield ? ', or let this board stand instead (Rails step)' : ''}.` });
}
