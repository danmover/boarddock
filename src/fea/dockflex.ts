// The dock's rows for the flexure table (flexures.ts): the socket latch, the release rod's two barb fingers, and the
// tongue's crush ribs. Each is solved on the real geometry (dock.ts), so a change to a profile changes its row.
import { CRUSH, HD, LATCH, TONGUE } from '../cad/dockdims';
import { crushFea, fingerFea, latchFea } from './dockfea';
import type { Flexure } from './flexures';

/** How hard a printed line crushes (MPa): an assumption (a 0.4 mm line, the layers' gaps in it): not measured. */
export const CRUSH_SIGMA = 15;

/** The socket's normal gap to the tongue's front corner face, and how far a crest is pressed at most (tongue pushed against a corner). */
export const CRUSH_DEPTH = () => Math.max(0, CRUSH.proud - (Math.SQRT1_2 * 0.4));

/** What the rod's fingers and the ribs come to, for the docs and the check text. */
export interface DockFlexInfo { latch: ReturnType<typeof latchFea>['data']; finger: { delta: number; force: number; peak: number }; crush: { depth: number; perRib: number; total: number; contact: number } }

export async function dockFlexures(o: { E: number; nu: number; h: number; material: string }, info?: (i: DockFlexInfo) => void): Promise<Flexure[]> {
  const { initKernel, csLoops, freeAll, rect2, poly } = await import('../cad/kernel');
  const { latchProfile, noseProfile, rod } = await import('../cad/dock');
  await initKernel();
  const rows: Flexure[] = [];
  const base = { part: 'socket', material: o.material, E: o.E };
  // ---- the socket latch
  const lf = latchFea(csLoops(latchProfile().add(noseProfile())), o.E, o.nu, o.h);
  const d = lf.data;
  rows.push({
    ...base, id: 'socket-latch', name: 'Socket latch beam (tapered, undercut hook)', kind: 'spring', rest: 0, full: d.stop.peak, fullP99: d.stop.p99,
    deflection: `nose out ${d.stop.delta.toFixed(2)} mm (the button pressed right home; ${d.insertion.delta.toFixed(2)} mm lets the tongue in)`, restState: 'nose in its groove, nothing pushing it: the printed shape is the rest shape',
    also: [{ label: `${d.pull.force} N pull on the holder (nose ${d.pull.nose >= 0 ? '+' : ''}${d.pull.nose.toFixed(2)} mm)`, strain: d.pull.peak }],
  });
  // ---- the release rod's barb fingers: half the rod's (x, z) section at mid height round a finger, the shaft held under its root
  const gate = HD.catch, zg1 = 54, zcat = zg1 - gate.gate - 0.2, zb = zcat - gate.ramp - gate.flat, delta = HD.rodHx + gate.barb - gate.ledge;
  const m = rod(zg1, 0).m.transform([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1] as any);
  const sec = m.slice((HD.rodY[0] + HD.rodY[1]) / 2).intersect(rect2(0, -(zcat + 2), 3, -(zb - gate.root - 1.5)));
  const loops = csLoops(sec).map((l) => l.map(([x, y]) => [x, -y] as [number, number]));
  const ff = fingerFea(loops, o.E, o.nu, Math.max(o.h, 0.1), { below: zb - gate.root - 0.6, xOuter: HD.rodHx + gate.barb, zLoad: zcat - 0.3, delta, yThick: HD.rodY[1] - HD.rodY[0] });
  rows.push({
    ...base, part: 'release rod', id: 'rod-barb-fingers', name: 'Release rod, barb fingers', kind: 'once', rest: 0, full: ff.peak, fullP99: ff.p99,
    deflection: `each finger bent ${delta.toFixed(2)} mm as the barb passes the gate (${ff.force.toFixed(1)} N each)`, restState: 'standing free in the pocket under the gate',
    note: 'each finger bends once, when the rod is pushed in past the gate, and clicks out into the pocket; it is unloaded there, and only meets the gate if the rod is pulled up',
  });
  freeAll();
  // ---- the tongue's crush ribs: a rib in section (across the face, out of it) on a slab of tongue, crushed by the socket wall
  const { proud, base: rb, crown } = CRUSH, half = (rb - crown) / 2, depth = CRUSH_DEPTH();
  const slab = 3, prof = poly([[-1, -slab], [rb + 1, -slab], [rb + 1, -0.05], [rb, -0.05], [half + crown, proud], [half, proud], [0, -0.05], [-1, -0.05]] as [number, number][], 'NonZero');
  const cf = crushFea(csLoops(prof), o.E, o.nu, 0.05, { proud, base: rb, crown, depth, sigma: CRUSH_SIGMA, slab });
  const len = Math.min(...CRUSH.z.map(([a, b]) => b - a)) - 2 * CRUSH.ramp, perRib = cf.perMm * len;
  rows.push({
    ...base, part: 'holder tongue', id: 'tongue-crush-rib', name: 'Tongue crush ribs (front corner faces)', kind: 'once', rest: 0, full: cf.peak, fullP99: cf.p99,
    deflection: `the socket wall crushes a crest ${depth.toFixed(2)} mm, at about ${perRib.toFixed(0)} N a rib (${CRUSH_SIGMA} MPa over ${cf.contact.toFixed(2)} mm x ${len.toFixed(1)} mm); strain shown is the rib's base and the tongue behind it`, restState: 'after the first push in the crest has taken the socket\'s size, and the tongue is snug',
    note: `the crest yields by design, on the first push in: about ${(2 * CRUSH.z.length * perRib).toFixed(0)} N for the ${2 * CRUSH.z.length} ribs (an assumed ${CRUSH_SIGMA} MPa crush stress, not measured); after that the holder goes in and out on the latch's push`,
  });
  info?.({ latch: d, finger: { delta, force: ff.force, peak: ff.peak }, crush: { depth, perRib, total: 2 * CRUSH.z.length * perRib, contact: cf.contact } });
  void LATCH; void TONGUE;
  return rows;
}
