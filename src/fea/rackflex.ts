// The rack's own flexures for the shared table (src/fea/flexures.ts): the DIN clip's jaw leaf and holder hooks, the plug caps'
// legs, and (below) whatever else in the rack springs or clicks that is not the dock's or the board holder's own clips.
// Each row is solved on the real profile the generator builds (kernel profile -> 2D plane-stress FEA at `h`), so a change to
// the geometry changes the table; `pushStrain` (beamfea.ts) does the pushing.
import { initKernel, csLoops, freeAll } from '../cad/kernel';
import { clipDims, clipProfile, HOOK, hookMove } from '../cad/dinclip';
import { CAP, capLeg, capProfile } from '../cad/plugcap';
import { RIVET, rivetClip, rivetMove } from '../cad/rivet';
import { spacerProfile, STAND } from '../cad/railstand';
import { MATERIALS } from '../model/library';
import type { Material } from '../model/types';
import { clipFea } from './clipfea';
import { pushStrain } from './beamfea';
import type { Flexure, FlexureProvider } from './flexures';

/** Leg lengths the plug caps get across the library: the shortest seen (a micro-USB plug low on its board), a Pi's power plug, a USB-A on a tall standoff. */
export const CAP_LEGS = [9.5, 11.2, 17.6];

export async function rackFlexures(opts: { E: number; nu: number; h: number; material: string }): Promise<Flexure[]> {
  await initKernel();
  const mat = MATERIALS[opts.material as Material] ?? MATERIALS.PETG, material = MATERIALS[opts.material as Material] ? opts.material : 'PETG';
  const out: Flexure[] = [];
  try {
    // ---- DIN clip: the jaw's leaf, released by the pull tab three ways and clipped on, and the holder's snap hooks ----
    const W = 14, p = { W, tf: 1.0, tabExt: 0 }, d = clipDims(p), loops = csLoops(clipProfile(p).cs);
    const r = clipFea(loops, d, W, opts.E, opts.nu, opts.h);
    const stop = d.legU - d.barEnd; // the jaw bar's travel to the stop
    const atStop = (c: { flexPeak: number; flexP99: number; barMove: number }) => ({ peak: c.flexPeak * (stop / c.barMove), p99: c.flexP99 * (stop / c.barMove) });
    const cases = r.cases.filter((c) => !/Rail grip/.test(c.name));
    const worst = cases.map(atStop).reduce((a, b) => (b.peak > a.peak ? b : a));
    out.push({
      id: 'din.jaw', name: 'DIN clip: the jaw leaf', part: 'DIN clip', kind: 'spring', material, E: opts.E, rest: 0, full: worst.peak, fullP99: worst.p99,
      deflection: `the jaw bar against its travel stop, ${stop.toFixed(1)} mm (the lip needs ${d.travel.toFixed(2)} mm of drop; the stop is a gusseted leg, so a yank goes no further)`,
      restState: `lip ${(0.1).toFixed(1)} mm clear of the flange, leaf straight, nothing pressing`,
      note: `a ${(d.leafV[1] - d.leafV[0]).toFixed(0)} mm leaf, ${d.leafT} mm thick, bending in the layers; the lip holds the rail by its face, ${d.eL} mm behind the flange`,
      also: cases.map((c) => ({ label: `${c.name.replace(/^Release: /, 'release, ').replace(/^Snap-on: /, 'snap-on, ')} (${c.force.toFixed(1)} N)`, strain: c.flexPeak })),
    });
    // holder hooks: each hook's beam pushed in by the plate's slot, as the holder is pressed on
    const hk = HOOK, mv = hookMove().move, s = 1, vh = d.vc + s * d.HA, vo = vh + s * hk.off, uC = d.uF + d.plateT + 0.1;
    const band = (y: number) => y > vo - hk.tRoot - hk.slotIn - 0.7 && y < vo + hk.slotOut + 0.7;
    const hr = pushStrain(loops, {
      t: W, h: opts.h, E: opts.E, nu: opts.nu,
      fixed: (x, y) => x < 7.0 || !band(y) || x > uC + 3,
      load: (x, y) => x > uC - 0.05 && x < uC + 1.9 && y > vo + hk.barb - 0.15 && y < vo + hk.barb + 0.05,
      dir: [0, -s], probe: [uC + 0.5, vo + s * (hk.barb - 0.1)], along: [0, -s], target: mv,
      region: (x, y) => x > hk.root - 1 && x < uC + 0.2 && band(y),
    });
    out.push({
      id: 'din.hooks', name: 'DIN clip: the holder snap hooks (4 of them)', part: 'DIN clip', kind: 'spring', material, E: opts.E, rest: 0, full: hr.peak, fullP99: hr.p99,
      deflection: `each beam pushed ${mv.toFixed(2)} mm in to click through the plate's slot (${hr.force.toFixed(1)} N a hook at ${W} mm wide)`,
      restState: `barb ${(hookMove().catch).toFixed(2)} mm behind the slot's edge, beam 0.075 mm off it: nothing pressing`,
      note: `beams ${hk.tRoot} to ${hk.tTip} mm, 10 mm long from inside the back plate, slits ending in full rounds; the flat face of the barb is the catch`,
    });
    // ---- plug caps: legs of each length the library gives ----
    for (const L of CAP_LEGS) {
      const leg = capLeg(L), zHook = 0, zPlate = L, tL = 0, tR = 12, gp = leg.ledge + CAP.gap, hook = gp - CAP.wall, xl = tL - gp;
      const prof = capProfile(tL, tR, zHook, zPlate, leg);
      const cr = pushStrain(csLoops(prof), {
        t: 8, h: opts.h, E: opts.E, nu: opts.nu,
        fixed: (x, y) => y > zPlate - 0.05 && x > xl - CAP.root - 1 && x < tR + gp + CAP.root + 1,
        load: (x, y) => x > xl + hook - 0.2 && x < xl + hook + 0.05 && y > zHook - 0.6 && y < zHook,
        dir: [-1, 0], probe: [xl + hook, zHook - 0.3], along: [-1, 0], target: leg.move,
        region: (x, y) => x < xl + 3 && y > zHook + 0.2,
      });
      out.push({
        id: `cap.legs.${L}`, name: `Plug cap: legs ${L} mm long`, part: 'plug cap', kind: 'spring', material, E: opts.E, rest: 0, full: cr.peak, fullP99: cr.p99,
        deflection: `each leg sprung out ${leg.move.toFixed(2)} mm to pass its ledge (${cr.force.toFixed(1)} N a leg, 8 mm wide)`,
        restState: `hook ${CAP.wall} mm off the wall, ${leg.e.toFixed(2)} mm under a ${leg.ledge} mm ledge, leg ${CAP.gap} mm clear of the ledge's tip`,
        note: `legs ${CAP.root} mm at the plate to ${CAP.tip} mm at the hook, filleted at the plate; the ledge is sized from the leg's length (a leg shorter than 7 mm can't reach 1% with a catch worth having)`,
      });
    }
    // ---- the rivet's clip (holders back to back): the neck clicks through the throat ----
    {
      const c = RIVET.cavity / 2, y0 = RIVET.body, y1 = RIVET.body + RIVET.arm, mv = rivetMove();
      const rr = pushStrain(csLoops(rivetClip()), {
        t: RIVET.clipT, h: Math.min(opts.h, 0.05), E: opts.E, nu: opts.nu,
        fixed: (_x, y) => y < y0 - 0.2,
        load: (x, y) => x > 0 && y > y1 - 1.0 && y < y1 - 0.5 && x < c,
        load2: (x, y) => x < 0 && y > y1 - 1.0 && y < y1 - 0.5 && x > -c,
        dir: [1, 0], probe: [RIVET.throat / 2, y1 - 0.75], along: [1, 0], target: mv,
        region: (_x, y) => y > y0 - 0.5,
      });
      out.push({
        id: 'rivet.clip', name: 'Back-to-back rivet: the clip on the pin', part: 'rivet', kind: 'spring', material, E: opts.E, rest: 0, full: rr.peak, fullP99: rr.p99,
        deflection: `each lip moves ${mv.toFixed(2)} mm as the pin's Ø${(2 * RIVET.neck).toFixed(1)} mm neck clicks through the ${RIVET.throat} mm throat (${rr.force.toFixed(1)} N a lip)`,
        restState: `neck in the cavity, lips ${((2 * RIVET.neck - RIVET.throat) / 2).toFixed(2)} mm over it, nothing pressing`,
        note: `two ${RIVET.arm} mm arms, ${RIVET.tRoot} mm at the body to ${RIVET.tTip} mm at the lips, filleted; the flat face of each lip is the catch; the pin itself is rigid`,
      });
    }
    // ---- the cable comb: its lips take a stiff cable pressed in (a soft one squashes instead) ----
    {
      const dCab = 5, lanes = [{ y: 30, d: dCab }, { y: 42, d: dCab }], zTop = -2.5;
      const mouth = Math.max(1.4, dCab * 0.78) / 2, F = 10; // N on each lip
      const prof = csLoops(spacerProfile(72, lanes));
      const yL = lanes[0].y;
      const cr = pushStrain(prof, {
        t: STAND.spacerT, h: Math.min(opts.h, 0.05), E: opts.E, nu: opts.nu,
        fixed: (_x, y) => y < zTop - 1.0,
        load: (x, y) => y > zTop && Math.abs(x - (yL - mouth)) < 0.12,
        load2: (x, y) => y > zTop && Math.abs(x - (yL + mouth)) < 0.12,
        dir: [-1, 0], probe: [yL - mouth, zTop + 1.0], along: [-1, 0], target: 0.02,
        region: (_x, y) => y > zTop - 1.0,
      });
      const k = F / cr.force;
      out.push({
        id: 'comb.lips', name: 'Stand spacer: a cable comb\'s lips', part: 'table stand', kind: 'spring', material, E: opts.E, rest: 0, full: cr.peak * k, fullP99: cr.p99 * k,
        deflection: `a stiff ${dCab} mm cable pressed through its slot's mouth (22% narrower than it), ${F} N on each lip; a soft cable squashes instead and the lips do not move`,
        restState: 'cable 0.25 mm clear of the slot all round, nothing pressing',
        note: 'the teeth are 3.5 mm tall and 4 mm thick: rigid, the cable is the spring; the retention is the narrow mouth',
      });
    }
  } finally {
    freeAll();
  }
  void mat;
  return out;
}

export const rackProvider: FlexureProvider = { area: 'rack', run: rackFlexures };
