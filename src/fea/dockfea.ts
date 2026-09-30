// 2D FEA of the dock's springs: the socket latch (18 mm wide, plain spring) and the rail shoe (hinge split into two
// 7 mm segments, so 14 mm effective). Both are constant profiles, which is what a plane-stress model needs.
// Linear, small displacement: each case is solved for a unit load and scaled to the travel it must reach.
import type { Loop } from '../model/types';
import { assemble2D, elementStrain, meshPolygons, nearestNode, pcg, q6Element, smoothStrain, type Mesh2D } from './fea2d';
import { GRIP, HOLD, NOSE_TIP, SHOE_GRIP } from '../cad/dockdims';

export interface DockFeaCase { part: 'latch' | 'shoe' | 'holder'; name: string; force: number; target: string; peakStrain: number; p99Strain: number; notes: string[] }
export interface DockField { name: string; x0: number; y0: number; h: number; nx: number; ny: number; elems: Int32Array; strain: Float32Array }
export interface DockFeaResult { cases: DockFeaCase[]; fields: DockField[]; mesh: { h: number; elements: number } }

const MU = 0.3; // plastic on plastic / steel
// strain limit by stiffness (PLA stiff and brittle, PETG / ABS / ASA tougher)
const allowFor = (E: number) => (E >= 3000 ? 0.015 : 0.02);
const S2 = Math.SQRT1_2;

/** `wt`: a stiffness scale by place (a part that is narrower along the rail than `t` there). `phase`: see meshPolygons. */
function model(loops: Loop[], h: number, E: number, nu: number, t: number, fix: (x: number, y: number) => boolean, wt?: (x: number, y: number) => number, phase?: [number, number]) {
  const m = meshPolygons(loops, h, phase);
  if (wt && m.w) for (let k = 0; k < m.elems.length; k++) { const g = m.elems[k]; m.w[k] *= wt(m.x0 + ((g % m.nx) + 0.5) * m.h, m.y0 + (Math.floor(g / m.nx) + 0.5) * m.h); }
  const { Ke, R } = q6Element(h, E, nu, t);
  const S = assemble2D(m, Ke);
  const fixed = new Uint8Array(S.n);
  for (let i = 0; i < m.nNodes; i++) if (fix(m.nodeXY[2 * i], m.nodeXY[2 * i + 1])) { fixed[2 * i] = 1; fixed[2 * i + 1] = 1; }
  return { m, S, R, fixed };
}

function solve(M: ReturnType<typeof model>, sel: (x: number, y: number) => boolean, dir: [number, number]) {
  const { m, S, fixed } = M;
  const f = new Float64Array(S.n);
  const ids: number[] = [];
  for (let i = 0; i < m.nNodes; i++) if (!(fixed[2 * i] && fixed[2 * i + 1]) && sel(m.nodeXY[2 * i], m.nodeXY[2 * i + 1])) ids.push(i);
  if (!ids.length) throw new Error('no load nodes');
  for (const i of ids) { f[2 * i] = dir[0] / ids.length; f[2 * i + 1] = dir[1] / ids.length; }
  return pcg(S, f, fixed, 1e-8).u; // unit total load (N)
}

function stats(m: Mesh2D, u: Float64Array, R: Float64Array, k: number) {
  // (averaged over 3 x 3 pixels: a pixel corner at a fillet reads high and jumps with the grid)
  const eps = smoothStrain(m, elementStrain(m, u, R).map((e) => e * Math.abs(k)));
  const sorted = Float64Array.from(eps).sort();
  let at = 0;
  eps.forEach((e, i) => { if (e > eps[at]) at = i; });
  const ge = m.elems[at];
  const where = `peak at y ${(m.x0 + ((ge % m.nx) + 0.5) * m.h).toFixed(1)}, z ${(m.y0 + (Math.floor(ge / m.nx) + 0.5) * m.h).toFixed(1)}`;
  return { eps, peak: sorted[sorted.length - 1], p99: sorted[Math.floor(sorted.length * 0.99)], where };
}

const field = (name: string, m: Mesh2D, h: number, eps: Float64Array): DockField => ({ name, x0: m.x0, y0: m.y0, h, nx: m.nx, ny: m.ny, elems: m.elems, strain: Float32Array.from(eps) });

/**
 * The shoe pulled up off the rail as a whole (see below): a pull on the socket's two hooks, and on each hook alone (a
 * holder pulled off-centre), held where the rail holds it. Its own function so a change to the shoe's hook slits can be
 * measured without the other cases.
 */
export function shoePullOff(shoeLoops: Loop[], E: number, nu: number, hs: number, phase?: [number, number], onProgress?: (s: string) => void): { cases: DockFeaCase[]; field: DockField; elements: number } {
  // The socket's hooks lift the shoe, and the rail's flanges hold it under the fixed hook's finger and the jaw's lip
  // (held up and down; the lip also sideways, friction holding). Nothing else is clamped, so the fixed hook's floor and
  // wall, the socket's hook beams and the 1 mm walls beside their slits carry the pull as they would, and the hinge only
  // its share. (The body used to be held from x < 14.6, y > 7.0 up, which left only the jaw side to look at.) The body
  // is the shoe's whole 21 mm, the hinge two 7 mm leaves; the socket's bosses bear on 18 mm of the hooks.
  onProgress?.('Solving: shoe pulled off the rail');
  const Po = model(shoeLoops, hs, E, nu, 21, () => false, (x, y) => (x > 15.75 && x < 17.75 && y > 9.85 && y < 20.35 ? 14 / 21 : 1), phase);
  const onTop = (x0: number, x1: number) => (x: number, y: number) => x > x0 && x < x1 && Math.abs(y - 6.2) < hs * 0.6;
  const finger = onTop(-17.45, -15.95), lipP = onTop(16.05, 17.45);
  const fixP = new Uint8Array(Po.S.n);
  for (let i = 0; i < Po.m.nNodes; i++) {
    const x = Po.m.nodeXY[2 * i], y = Po.m.nodeXY[2 * i + 1];
    if (finger(x, y) || lipP(x, y)) fixP[2 * i + 1] = 1;
    if (lipP(x, y)) fixP[2 * i] = 1;
  }
  const P2 = { ...Po, fixed: fixP };
  // the underside of a hook's tab (the boss notch's 10 degree face bears on it)
  const tab = (sg: number) => (x: number, y: number) => x * sg > 8.35 && x * sg < 9.15 && y > 20.2 && y < 20.33 + (9.15 - Math.abs(x)) * 0.175 + hs * 0.9;
  const fSock = (100 * 21) / 18;
  const reaction = (uu: Float64Array, on: (x: number, y: number) => boolean) => {
    let r = 0;
    for (let i = 0; i < Po.m.nNodes; i++) if (on(Po.m.nodeXY[2 * i], Po.m.nodeXY[2 * i + 1])) { const d = 2 * i + 1; for (let q = Po.S.rowPtr[d]; q < Po.S.rowPtr[d + 1]; q++) r += Po.S.val[q] * uu[Po.S.col[q]]; }
    return Math.abs(r);
  };
  const region = (x: number, y: number) => x > 15.75 && x < 17.75 && y > 9.85 && y < 20.35 ? 'hinge leaf' : x > 15.75 ? 'jaw' : x < -15.3 && y < 7.5 ? 'fixed hook finger' : x < -16 ? 'wall of the fixed hook' : y < 9.5 ? 'floor' : Math.abs(x) > 8.4 && Math.abs(x) < 11.7 ? 'hook beams and slit walls' : 'body';
  let shown: DockField | null = null;
  const cases: DockFeaCase[] = [];
  const pull = (name: string, up: Float64Array, target: string, show: boolean) => {
    const st = stats(Po.m, up, Po.R, fSock);
    const worst = new Map<string, number>();
    Po.m.elems.forEach((g, e) => { const r = region(Po.m.x0 + ((g % Po.m.nx) + 0.5) * Po.m.h, Po.m.y0 + (Math.floor(g / Po.m.nx) + 0.5) * Po.m.h); worst.set(r, Math.max(worst.get(r) ?? 0, st.eps[e])); });
    const regs = [...worst].sort((p, q) => q[1] - p[1]).slice(0, 4).map(([r, v]) => `${r} ${(v * 100).toFixed(2)}%`).join(', ');
    const [Rf, Rl] = [reaction(up, finger), reaction(up, lipP)];
    const c: DockFeaCase = { part: 'shoe', name, force: 100, target, peakStrain: st.peak, p99Strain: st.p99, notes: [`fixed hook takes ${((Rf / (Rf + Rl)) * 100).toFixed(0)}% of the pull, the jaw ${((Rl / (Rf + Rl)) * 100).toFixed(0)}%`, `strain by part: ${regs}`, `the worst part reaches the strain limit at about ${((allowFor(E) / st.peak) * 100).toFixed(0)} N`, st.where] };
    if (show) shown = field('Rail shoe, pulled off the rail', Po.m, hs, st.eps);
    return c;
  };
  // each hook's tab alone (1 N on it); both together is half of each
  const uJ = solve(P2, tab(1), [0, 1]), uF = solve(P2, tab(-1), [0, 1]);
  const both = uJ.map((v, i) => 0.5 * (v + uF[i]));
  cases.push(pull('Rail shoe: 100 N pull on the socket', both, 'the pull goes through both hooks, held by the flanges at the fixed hook and the jaw (no friction at the fixed hook)', true));
  // a holder pulled off-centre loads one hook, so the far flange bears more: the worse side
  const one = [pull('Rail shoe: 100 N pull on one hook (jaw side)', uJ, '', false), pull('Rail shoe: 100 N pull on one hook (fixed hook side)', uF, '', false)];
  const w1 = one[0].peakStrain >= one[1].peakStrain ? one[0] : one[1];
  w1.target = 'a holder pulled off-centre loads one hook: the worse side';
  cases.push(w1);
  return { cases, field: shown!, elements: Po.m.elems.length };
}

/** latchLoops: latch + nose + stop post, (y, z) socket-local. shoeLoops: shoe profile, (y, z) hub. */
/** gripLoops: the shoe's rail grip with a strip of the floor it hangs from (shoeFeaProfiles in dock.ts). holdLoops: the
 * holder's anti-rattle leaves, (x, z) sections of a side leaf on the tongue and a lift leaf under the pedestal
 * (holdFeaProfiles in dock.ts). */
/** `phase`: shifts the pixel grid by that fraction of a pixel (to test how little the results depend on it). */
export function dockFea(latchLoops: Loop[], shoeLoops: Loop[], E: number, nu: number, h = 0.1, onProgress?: (s: string) => void, gripLoops?: Loop[], phase?: [number, number], holdLoops?: { side: Loop[]; lift: Loop[] }): DockFeaResult {
  const cases: DockFeaCase[] = [];
  const fields: DockField[] = [];
  let elements = 0;

  // ---- socket latch: root clamped at the anchor slot; the stop post is fixed ----
  onProgress?.('Meshing the latch');
  const L = model(latchLoops, h, E, nu, 18, (x, y) => y < -20.2 || x > 9.05, undefined, phase);
  elements += L.m.elems.length;
  // the nose's tip and its 45 degree lead-in (dockdims: NOSE_TIP)
  const tip = nearestNode(L.m, NOSE_TIP + 0.05, -7.2), ramp = nearestNode(L.m, 7.4, -1.7);
  onProgress?.('Solving: tongue pushes the latch open');
  let u = solve(L, (x, y) => x < NOSE_TIP + 1.45 && y > -6.7 && y < -5.1 && y - x > -6.55 - NOSE_TIP - 0.25, [S2, -S2]);
  let k = 1.3 / u[2 * tip];
  let s = stats(L.m, u, L.R, k);
  const latLat = k * S2;
  cases.push({ part: 'latch', name: 'Latch: holder pushed in (nose out 1.3 mm)', force: latLat, target: 'nose moves 1.3 mm to let the tongue past', peakStrain: s.peak, p99Strain: s.p99, notes: [`push-in about ${(latLat * (1 + MU) / (1 - MU)).toFixed(1)} N through the 45° lead-in (friction 0.3)`] });
  onProgress?.('Solving: button wedges the latch open');
  u = solve(L, (x, y) => x > 6.55 && x < 8.25 && y > -2.5 && Math.abs(y - (x - 9.0)) < h * 1.2, [S2, -S2]);
  k = 1.15 / u[2 * tip];
  s = stats(L.m, u, L.R, k);
  const fy = k * S2;
  const travel = u[2 * ramp] * k;
  cases.push({ part: 'latch', name: 'Latch: button pressed (nose clears the groove)', force: fy * (1 + Math.SQRT2 * MU), target: 'nose moves 1.15 mm out of the tongue groove', peakStrain: s.peak, p99Strain: s.p99, notes: [`button travel to release ${travel.toFixed(2)} mm of the 3.1 mm stroke`, `${fy.toFixed(1)} N without friction`] });
  fields.push(field('Latch, button pressed', L.m, h, s.eps));

  // ---- rail shoe: body clamped, the jaw hangs on the hinge leaf ----
  const hs = Math.max(h, 0.06);
  onProgress?.('Meshing the rail shoe');
  const Sh = model(shoeLoops, hs, E, nu, 14, (x, y) => (x < 14.6 && y > 7.0) || (y > 21.0 && x < 17.95), undefined, phase);
  elements += Sh.m.elems.length;
  const lip = nearestNode(Sh.m, 16.3, 6.0), hookAt = nearestNode(Sh.m, 21.85, 29.5), post = nearestNode(Sh.m, 19.95, 21.3);
  onProgress?.('Solving: release lever pressed');
  // the lever's hook pushes the post toward the socket with its lower end: 8.3 mm under the pin at rest, 11 mm under
  // it by the time the lip is clear, so over z 28..31 of the post (measured on the geometry: tests/dinclip-review.test.ts;
  // the lever taken as rigid, turning on its pin)
  u = solve(Sh, (x, y) => x > 21.6 && x < 22.0 && y > 28.0 && y < 31.0, [-1, 0]);
  k = 1.7 / u[2 * lip];
  s = stats(Sh.m, u, Sh.R, k);
  const stopAt = (2.0 / Math.abs(u[2 * post] * k)) * 1.7; // lip travel when the post meets the body shelf (2.0 mm gap, SHOE_LEVER.stopGap)
  const hookTravel = Math.abs(u[2 * hookAt] * k);
  // lever: pivot (13.4, 39.2); the hook's contact 9.7 mm under it on average over the stroke, 11.0 under and 5.8
  // outboard at its end; the pad's middle 13.6 outboard
  const Fc = Math.abs(k), th = hookTravel / 9.7, padF = (Fc * (11.0 + MU * 5.8)) / (13.6 * Math.cos(th)), padTravel = 13.6 * Math.sin(th);
  cases.push({ part: 'shoe', name: 'Rail shoe: release lever pressed down (jaw off the flange)', force: padF, target: 'jaw lip moves 1.7 mm clear of the rail flange (1.3 mm is enough while the rail grip holds the shoe on its fixed hook)', peakStrain: s.peak, p99Strain: s.p99, notes: [`pad down ${padTravel.toFixed(1)} mm (lever turned ${((th * 180) / Math.PI).toFixed(0)}°)`, `${Fc.toFixed(1)} N on the post from the hook, friction 0.3 at the hook`, `stop engages at ${stopAt.toFixed(2)} mm lip travel`, s.where] });
  fields.push(field('Rail shoe, lever pressed', Sh.m, hs, s.eps));
  onProgress?.('Solving: clipping onto the rail');
  const a = [15.8, 6.0], b = [17.7, 3.9];
  const Lab = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const nrm: [number, number] = [(a[1] - b[1]) / Lab, (b[0] - a[0]) / Lab];
  u = solve(Sh, (x, y) => {
    const t = ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / (Lab * Lab);
    const px = a[0] + t * (b[0] - a[0]), py = a[1] + t * (b[1] - a[1]);
    return t > 0.1 && t < 0.9 && Math.hypot(x - px, y - py) < hs * 1.2;
  }, [Math.abs(nrm[0]), Math.abs(nrm[1])]);
  k = 1.8 / u[2 * lip];
  s = stats(Sh.m, u, Sh.R, k);
  cases.push({ part: 'shoe', name: 'Rail shoe: pressed onto the rail', force: Math.abs(k), target: 'flange edge pushes the jaw 1.8 mm open', peakStrain: s.peak, p99Strain: s.p99, notes: [s.where] });
  onProgress?.('Solving: dock pulled off the wall');
  // the flange pushes the lip toward the wall; friction on the flange resists the lip sliding out.
  // Superpose the normal and friction parts to find the friction the hold relies on.
  const lipTop = (x: number, y: number) => x > 16.2 && x < 17.4 && Math.abs(y - 6.2) < hs * 1.2;
  const un = solve(Sh, lipTop, [0, -1]), uf = solve(Sh, lipTop, [-1, 0]);
  const dn = un[2 * lip] * 100, df = uf[2 * lip] * 100; // lip opening per 100 N normal, per 100 N friction
  const muCrit = df < 0 ? Math.max(0, -dn / df) : Infinity;
  const letGo = dn > 0 ? (1.7 / dn) * 100 : Infinity;
  // strain while friction holds: lip pinned sideways, 100 N toward the wall
  const lockFix = Sh.fixed.slice();
  for (let i = 0; i < Sh.m.nNodes; i++) if (lipTop(Sh.m.nodeXY[2 * i], Sh.m.nodeXY[2 * i + 1])) lockFix[2 * i] = 1;
  const u3 = solve({ ...Sh, fixed: lockFix }, lipTop, [0, -1]);
  s = stats(Sh.m, u3, Sh.R, 100);
  cases.push({ part: 'shoe', name: 'Rail shoe: 100 N pull away from the wall (jaw alone)', force: 100, target: letGo > 1000 ? `holds without relying on friction (jaw opens ${Math.abs(dn).toFixed(3)} mm per 100 N)` : muCrit <= MU ? `holds while friction on the flange exceeds ${muCrit.toFixed(2)} (PETG on steel: about 0.3 to 0.5)` : `the jaw opens: needs friction above ${muCrit.toFixed(2)} to hold`, peakStrain: s.peak, p99Strain: s.p99, notes: [`hinge reaches the strain limit at about ${((allowFor(E) / s.peak) * 100).toFixed(0)} N with the jaw carrying all of it, the body held`, letGo > 1000 ? 'the pull runs straight down the hinge leaf: it cannot pry the jaw open, friction or not' : `without friction the jaw would let go at about ${letGo.toFixed(0)} N`] });

  // ---- the whole shoe pulled up off the rail ----
  const po = shoePullOff(shoeLoops, E, nu, hs, phase, onProgress);
  cases.push(...po.cases);
  fields.push(po.field);
  elements += po.elements;
  // ---- rail grip: the fork in the channel, its pad pressed back by the rail's wall ----
  // (a model of its own, the floor it hangs from held: it runs the shoe's whole 21 mm)
  if (gripLoops) {
    onProgress?.('Solving: rail grip');
    const G = model(gripLoops, hs, E, nu, 21, (_x, y) => y > 7.6, undefined, phase);
    elements += G.m.elems.length;
    const padAt = SHOE_GRIP.wall - SHOE_GRIP.gap - GRIP.pre;
    const ug = solve(G, (x, y) => x < padAt + hs * 1.5 && Math.abs(y - GRIP.pad) < 0.35, [1, 0]);
    const kg = 1 / ug[2 * nearestNode(G.m, padAt, GRIP.pad)]; // N per mm the pad is pushed in
    const Fg = kg * GRIP.pre, knock = (GRIP.pre + GRIP.stop) / GRIP.pre;
    s = stats(G.m, ug, G.R, Fg);
    cases.push({ part: 'shoe', name: `Rail shoe: rail grip pressed ${GRIP.pre} mm by the rail wall`, force: Fg, target: `slides along the rail at about ${(2 * MU * Fg).toFixed(1)} N (friction 0.3 on the pad and on the fixed hook; ${(2 * 0.2 * Fg).toFixed(1)} N at 0.2): it no longer only locates`, peakStrain: s.peak, p99Strain: s.p99, notes: [`${kg.toFixed(0)} N per mm, so ${(kg * 0.2).toFixed(1)} to ${(kg * 0.5).toFixed(1)} N for a pad pressed 0.2 to 0.5 mm (print and rail tolerance)`, `knocked across the rail, a tooth meets the wall at ${(GRIP.pre + GRIP.stop).toFixed(2)} mm: ${(s.peak * knock * 100).toFixed(2)}% peak, ${(s.p99 * knock * 100).toFixed(2)}% for 99%`, s.where] });
    fields.push(field('Rail shoe, rail grip', G.m, hs, s.eps));
  }
  // ---- the holder's anti-rattle leaves: the force each holds at rest, and its strain when a knock or the seat presses it ----
  if (holdLoops) {
    const push = (M: ReturnType<typeof model>, sel: (x: number, y: number) => boolean, dir: [number, number]) => {
      const u = solve(M, sel, dir), ids: number[] = [];
      for (let i = 0; i < M.m.nNodes; i++) if (!(M.fixed[2 * i] && M.fixed[2 * i + 1]) && sel(M.m.nodeXY[2 * i], M.m.nodeXY[2 * i + 1])) ids.push(i);
      const d = ids.reduce((a, i) => a + (u[2 * i] * dir[0] + u[2 * i + 1] * dir[1]), 0) / ids.length; // mm per N
      return { u, k: 1 / d };
    };
    onProgress?.('Solving: anti-rattle side leaf');
    const sd = HOLD.side, ty = 3.2; // (the tongue is about 3.2 mm deep in y under the leaf)
    const Ms = model(holdLoops.side, hs, E, nu, ty, (_x, y) => y > sd.root + 0.6, undefined, phase);
    elements += Ms.m.elems.length;
    const bs = push(Ms, (x, y) => x > 6.85 && x < 7.15 && y > sd.bz[0] + 0.3 && y < sd.bz[3] - 0.3, [-1, 0]);
    const dRest = 0.22; // the leaf's x travel from rest with the tongue against its stops (measured on the geometry: tests/dockhold.test.ts)
    const Fs = bs.k * dRest, ss = stats(Ms.m, bs.u, Ms.R, bs.k * dRest), sk = stats(Ms.m, bs.u, Ms.R, bs.k * sd.slot);
    cases.push({ part: 'holder', name: 'Holder: tongue side leaf, one of two (anti-rattle)', force: Fs, target: `the two leaves press the tongue back onto its divider with ${(2 * Fs).toFixed(1)} N and to the middle, at the 45° corner faces`, peakStrain: ss.peak, p99Strain: ss.p99, notes: [`${bs.k.toFixed(1)} N per mm, ${Fs.toFixed(2)} N at rest (${dRest} mm pressed), so ${(bs.k * 0.1).toFixed(1)} to ${(bs.k * 0.4).toFixed(1)} N for 0.1 to 0.4 mm (print tolerance)`, `a knock that closes the slot (${sd.slot} mm): ${(sk.peak * 100).toFixed(2)}% peak, ${(sk.p99 * 100).toFixed(2)}% for 99%`, ss.where] });
    fields.push(field('Tongue side leaf, at its stop', Ms.m, hs, sk.eps));
    onProgress?.('Solving: anti-rattle lift leaf');
    const lf = HOLD.lift, tl = lf.y1 - 0.5;
    const Ml = model(holdLoops.lift, hs, E, nu, tl, (x) => x < 1.0, undefined, phase);
    elements += Ml.m.elems.length;
    const bl = push(Ml, (x, y) => x > lf.bx[1] + 0.05 && x < lf.bx[2] - 0.05 && y < -lf.bump + 0.12, [0, 1]);
    const zRest = lf.bump - 0.3; // the latch nose's catch is 0.3 mm above the seat: the holder rises that far, and the bump is still pressed this much
    const Fl = bl.k * zRest, sl = stats(Ml.m, bl.u, Ml.R, bl.k * lf.bump);
    cases.push({ part: 'holder', name: 'Holder: pedestal lift leaf, one of two (anti-rattle)', force: Fl, target: `the two leaves hold the holder up on the latch's catch with ${(2 * Fl).toFixed(1)} N`, peakStrain: sl.peak, p99Strain: sl.p99, notes: [`${bl.k.toFixed(1)} N per mm, ${Fl.toFixed(2)} N at rest (${zRest.toFixed(2)} mm pressed)`, `strain shown with the holder pressed right home (${lf.bump} mm), when the two leaves push back with ${(2 * bl.k * lf.bump).toFixed(0)} N`, `the latch's click takes about ${(2 * Fl + 2 * MU * Math.SQRT2 * Fs).toFixed(1)} N more push than without the leaves (their lift, and friction of the corner bumps)`, sl.where] });
    fields.push(field('Pedestal lift leaf, pressed home', Ml.m, hs, sl.eps));
  }
  return { cases, fields, mesh: { h, elements } };
}
