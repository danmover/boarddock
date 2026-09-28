// Nothing inside anything, on a few quick racks (the whole matrix: npm run collisions): every printed part, board,
// plug, rail, stand and cable intersected exactly, by what met what, held against tests/collide/baseline.json; and
// automatic layouts with no failing Check line, overlap or clash warning, over-long rail or blocked plug in use that
// the baseline doesn't already list.
import { describe, it, expect, beforeAll } from 'vitest';
import { initKernel } from '../src/cad/kernel';
import { FAST, RACKS } from './collide/racks';
import { compare, readBaseline, runRack, worstOf } from './collide/run';

beforeAll(async () => { await initKernel(); });

describe('nothing inside anything (quick racks)', () => {
  const base = readBaseline();
  for (const name of FAST) {
    it(name, () => {
      const x = runRack(RACKS.find((r) => r.name === name)!);
      const { worse } = compare(x, base);
      expect(worse, `${worse.join('\n')}\nworst overlaps:\n${worstOf(x)}`).toEqual([]);
    }, 300_000);
  }
});
