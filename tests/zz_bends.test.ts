import { describe, it, beforeAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { initKernel } from '../src/cad/kernel';
import { generatePanel } from '../src/cad/panelgen';
import { resample } from '../src/cad/cablesim';
import { RACKS as MATRIX } from './collide/racks';
import { EXTRA_RACKS } from './zz_racks';

// tight bends of the settled cables: BENDS="a,b" racks (default: some); prints per rack the cables with a bend tighter than 3 diameters
const S = '/tmp/claude-0/-home-user-boarddock/9f8d8d26-36fa-584d-87d3-c19a32c74ffd/scratchpad';
const RACKS = [...MATRIX, ...EXTRA_RACKS];
const names = (process.env.BENDS ?? 'Pi cluster,boxes,busy mixed rack,rows of rails,rails along (columns),stacks,probes and adapters,no table stands').split(',');
const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const resampled = (pts: number[][]) => resample(pts, 2.5);
describe('bends', () => {
  beforeAll(async () => { await initKernel(); });
  it('scan', () => {
    const lines: string[] = [];
    for (const name of names) {
      (globalThis as any).__dbgOn = true;
      const p = RACKS.find((r) => r.name === name)!.make();
      const r = generatePanel(p);
      const D = (globalThis as any).__dbg;
      const tight: string[] = [];
      let n = 0;
      for (const c of D?.cables ?? []) {
        if (c.kind === 'debug' || c.kind === 'jumper') continue;
        n++;
        const P: number[][] = process.env.PLAN ? resampled(c.plan) : c.path;
        let worst = Infinity, at = 0;
        const K = 3; // beads either side: a 7.5 mm chord each way
        for (let i = K; i + K < P.length; i++) {
          const a = sub(P[i], P[i - K]), b = sub(P[i + K], P[i]), c = sub(P[i + K], P[i - K]);
          const la = Math.hypot(a[0], a[1], a[2]), lb = Math.hypot(b[0], b[1], b[2]), lc = Math.hypot(c[0], c[1], c[2]);
          const cr = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
          const area2 = Math.hypot(cr[0], cr[1], cr[2]); // twice the triangle's area
          const rad = area2 < 1e-9 ? Infinity : (la * lb * lc) / (2 * area2);
          if (rad < worst) { worst = rad; at = i; }
        }
        // (a bend of R mm on a cable of d mm: R/d diameters)
        if (worst < 2.5 * c.d) tight.push(`${c.id.slice(-4)} d=${c.d} R=${worst.toFixed(1)} (${(worst / c.d).toFixed(1)}d) at ${P[at].map((v) => v.toFixed(0)).join(',')}`);
      }
      const kinked = r.report.checks.find((x) => x.name === 'Cables settled')?.detail?.match(/(\d+) still bend/)?.[1] ?? '0';
      lines.push(`## ${name}: ${n} cables, ${tight.length} tighter than 2.5 diameters (sim says ${kinked} kinked)`);
      lines.push(...tight.map((t) => `   ${t}`));
    }
    writeFileSync(`${S}/bends.txt`, lines.join('\n'));
  }, 600000);
});
