import { describe, it, beforeAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { initKernel } from '../src/cad/kernel';
import { RACKS } from './collide/racks';
import { runRack } from './collide/run';

// a quick subset of the collision matrix: SUBSET="name1|name2" (default: the five below); WORST=n overlaps per rack
const S = '/tmp/claude-0/-home-user-boarddock/9f8d8d26-36fa-584d-87d3-c19a32c74ffd/scratchpad';
const names = (process.env.SUBSET ?? 'Pi cluster,boxes,busy mixed rack,probes and adapters,rails along (columns)').split(',');
describe('subset', () => {
  beforeAll(async () => { await initKernel(); });
  for (const name of names) {
    it(name, () => {
      const rack = RACKS.find((r) => r.name === name);
      if (!rack) throw new Error(`no rack ${name}`);
      const x = runRack(rack);
      const tot = Object.values(x.cats).reduce((a, c) => a + c[0], 0);
      const lines = [`## ${name}: ${tot.toFixed(1)} mm3 ${JSON.stringify(x.cats)} issues=${JSON.stringify(x.issues)} (${x.ms} ms)`];
      for (const w of x.worst.slice(0, Number(process.env.WORST ?? 8))) lines.push(`  ${w.cat}: ${w.a} x ${w.b}, ${w.vol.toFixed(1)} mm3, ${w.depth.toFixed(2)} deep, at ${w.at.map((v) => v.toFixed(0)).join(',')}`);
      writeFileSync(`${S}/subset_${name.replace(/[^a-z0-9]+/gi, '_')}.txt`, lines.join('\n'));
    }, 600000);
  }
});
