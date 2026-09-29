import { describe, it, beforeAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { initKernel } from '../src/cad/kernel';
import { generate } from '../src/cad/assembly';
import { RACKS } from './collide/racks';
import { measure } from './collide/measure';

const OUT = '/tmp/claude-0/-home-user-boarddock/9f8d8d26-36fa-584d-87d3-c19a32c74ffd/scratchpad/out.txt';
describe('scratch', () => {
  beforeAll(async () => { await initKernel(); });
  it('columns', () => {
    (globalThis as any).__dbgOn = true;
    const rack = RACKS.find((r) => r.name === 'rails along (columns)')!;
    const p = rack.make();
    const r = generate(p);
    const m = measure(p, r);
    const lines: string[] = [];
    lines.push('warnings: ' + JSON.stringify(r.report.warnings.filter((w) => /runs into/.test(w)), null, 1));
    for (const c of r.report.cables ?? []) lines.push(`${c.id} ${c.kind} ${c.a} -> ${c.b} len ${c.length} clash=${c.clash ?? ''}`);
    lines.push(JSON.stringify(Object.fromEntries(Object.entries(m.cats).filter(([, v]) => v.n).map(([k, v]) => [k, [v.vol.toFixed(1), v.depth.toFixed(2)]]))));
    for (const w of m.worst) lines.push(`${w.cat}: ${w.a} x ${w.b} ${w.vol.toFixed(2)} ${w.depth.toFixed(2)} at ${w.at.map((v) => v.toFixed(1)).join(',')}`);
    const f = (q: number[]) => q.map((v) => v.toFixed(1)).join(',');
    for (const d of (globalThis as any).__dbg ?? []) {
      if (d.id !== 'lw95xp5') continue;
      lines.push(`DBG ${d.id} vert=${d.vert} streets=${d.streets}`);
      lines.push(`A p=${f(d.A.p)} d=${f(d.A.d)} ${d.A.plug}`); lines.push(`B p=${f(d.B.p)} d=${f(d.B.d)} ${d.B.plug}`);
      lines.push('route ' + d.route.pts.map(f).map((s: string, i: number) => `[${s}]${d.route.kinds[i] ?? ''}`).join(' '));
      lines.push('hits ' + JSON.stringify(d.hits));
      lines.push('path ' + d.path.filter((_: any, i: number) => i % 4 === 0).map(f).join(' | '));
      for (const o of d.obsPlugs) lines.push(`obs ${o.plug ?? "-"} ${o.l} ${o.module ?? ""} [${f(o.box)}]`);
    }
    writeFileSync(OUT, lines.join('\n'));
  });
});
