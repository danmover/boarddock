// One share of the racks for the full collision run: each is built, measured and held against the baseline; with
// `npm run collisions:update` its results are written into the baseline instead (on purpose only, when a fix lowers it).
import { writeFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initKernel } from '../../src/cad/kernel';
import { RACKS } from './racks';
import { compare, readBaseline, runRack, worstOf, writeBaseline, type RackResult } from './run';

export function shard(k: number, of: number) {
  const update = import.meta.env.MODE === 'update';
  const done: RackResult[] = [];
  beforeAll(async () => { await initKernel(); });
  afterAll(() => {
    if (update) writeBaseline(done);
    // (for trying a change: COLLIDE_OUT=dir writes each shard's results there, to compare without touching the baseline)
    if (process.env.COLLIDE_OUT) writeFileSync(`${process.env.COLLIDE_OUT}/shard${k}.json`, JSON.stringify({ racks: Object.fromEntries(done.map((x) => [x.name, { cats: x.cats, issues: x.issues }])) }));
  });
  describe(`collisions ${k} of ${of}`, () => {
    const base = readBaseline();
    RACKS.forEach((rack, i) => {
      if (i % of !== k - 1) return;
      it(rack.name, () => {
        const x = runRack(rack);
        done.push(x);
        const { worse, better } = compare(x, base);
        if (better.length && !update) console.log(`${rack.name}: better than the baseline (npm run collisions:update to lower it):\n  ${better.join('\n  ')}`);
        if (!update && !process.env.COLLIDE_OUT) expect(worse, `${worse.join('\n')}\nworst overlaps:\n${worstOf(x)}`).toEqual([]);
      }, 600_000);
    });
  });
}
