// The board holder's flexures for the shared table (src/fea/flexures.ts): spring clips, hairpin clips, the fixed ledge and
// the anti-rattle springs. Built from the same sizing the holder uses (src/cad/grip.ts, kernel-free, so it is quick);
// its strain is the beam sum with the stress-concentration factors read off the 2D FEA, and tests/springfea.test.ts holds
// every clip it sizes to that FEA.
import { bestClip, designBow, pushTarget, spanFor, tipFor, type BoardLoad } from '../cad/grip';
import { MATERIALS } from '../model/library';
import type { Material } from '../model/types';
import type { Flexure, FlexureProvider } from './flexures';

/** The boards the clips are sized for, as the holder sizes them: a load each (size in mm, weight in g). */
export const SIZED_FOR: { name: string; load: BoardLoad }[] = [
  { name: 'Pico (51 x 21, 3 g)', load: { mass: 3, long: 51, short: 21, thick: 1.0 } },
  { name: 'Uno (69 x 53, 25 g)', load: { mass: 25, long: 68.6, short: 53.3, thick: 1.6 } },
  { name: 'Pi 4 (85 x 56, 46 g)', load: { mass: 46, long: 85, short: 56, thick: 1.6 } },
  { name: 'Mega (102 x 53, 37 g)', load: { mass: 37, long: 101.6, short: 53.3, thick: 1.6 } },
  { name: 'hub board (220 x 70, 200 g)', load: { mass: 200, long: 220, short: 70, thick: 1.6 } },
  { name: 'big board (250 x 150, 300 g)', load: { mass: 300, long: 250, short: 150, thick: 1.6 } },
];

/** Leaf height over the bed for the sizing (a docked board stands higher; the taller the leaf the stiffer, and the thinner it is made). */
const LEAF_H = 9;

/**
 * The board's flexures in `material` (a key of MATERIALS): each clip as sized for each of the boards above at every length
 * a stretch of edge can give (8 mm up to what the board asks), the fixed ledge (rigid: nothing bends, nothing rests on
 * it until the board is pulled up), and the anti-rattle springs at both of their lengths.
 */
export function boardFlexures(material = 'PETG'): Flexure[] {
  const mat = MATERIALS[material as Material] ?? MATERIALS.PETG, name = MATERIALS[material as Material] ? material : 'PETG';
  const out: Flexure[] = [];
  const play = 0.3; // the board's play in its guards
  for (const { name: board, load } of SIZED_FOR) {
    for (let L = spanFor(load); L >= 8; L -= L > 12 ? 2 : 1) {
      const c = bestClip({ L, h: LEAF_H, mat, gap: 0.3, play, tip: tipFor(load), want: pushTarget(load, true, 4) });
      const hairpin = c.kind === 'u';
      out.push({
        id: `clip.${board.split(' ')[0].toLowerCase()}.${L}${hairpin ? 'u' : ''}`, part: 'board clip', kind: 'spring',
        name: `${hairpin ? 'Hairpin clip' : 'Spring clip'}, ${L} mm, for a ${board}`, material: name, E: mat.E, rest: c.epsRest, full: c.eps,
        deflection: `lip pushed ${c.delta.toFixed(2)} mm aside (the board hard against that side's guards)`,
        restState: 'board seated: the lip 0.2 mm clear of its top, the leaf 0.1 mm off its edge, nothing pressing',
        note: `${c.leaf.u ? `arms ${c.leaf.t0} mm at the fold` : `leaf ${c.leaf.t0} to ${c.leaf.tMin} mm`}, catch ${c.tip} mm, ${c.push.toFixed(1)} N to press the board past it`,
      });
    }
  }
  out.push({
    id: 'ledge', part: 'board clip', kind: 'spring', name: 'Fixed ledge (a block on the wall, its lip 0.8 mm over the board edge)', material: name, E: mat.E, rest: 0, full: 0,
    deflection: 'none: rigid, the board tilts in under it', restState: 'nothing on it until the board is pulled up',
  });
  for (const L of [14, 16]) {
    const b = designBow({ L, h: LEAF_H, mat, gap: 0.3, stop: 0.3 });
    out.push({
      id: `bow.${L}`, part: 'holder', kind: 'spring', name: `Anti-rattle spring, ${L} mm`, material: name, E: mat.E, rest: b.epsRestMax, full: b.eps,
      deflection: `pushed ${(b.preload + 0.3 + b.tol).toFixed(2)} mm aside while the board goes in (0.15 mm bigger than nominal)`,
      restState: `pushed ${b.preload} mm aside by the board (0.15 mm bigger than nominal), ${b.F.toFixed(2)} N on it`,
      note: 'the rest figure is with the board 0.15 mm bigger',
    });
  }
  return out;
}

export const boardProvider: FlexureProvider = { area: 'board holder', run: ({ material }) => boardFlexures(material) };
