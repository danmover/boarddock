import { describe, it, beforeAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { initKernel } from '../src/cad/kernel';
import { generatePanel } from '../src/cad/panelgen';
import { RACKS } from './collide/racks';

// dumps the planned routes (rack frame) of some cables: RACK="name" ONLY="id1,id2"
const S = '/tmp/claude-0/-home-user-boarddock/9f8d8d26-36fa-584d-87d3-c19a32c74ffd/scratchpad';
const f = (q: number[]) => q.map((v) => v.toFixed(1)).join(',');
describe('dump', () => {
  beforeAll(async () => { await initKernel(); });
  it('dump', () => {
    (globalThis as any).__dbgOn = true;
    const rack = RACKS.find((r) => r.name === (process.env.RACK ?? 'Pi cluster'))!;
    const p = rack.make();
    generatePanel(p);
    const D = (globalThis as any).__dbg;
    const only = process.env.ONLY?.split(',');
    const lines: string[] = [`streets ${D.streets.map((s: number) => s.toFixed(1))}`];
    for (const o of D.obs) if (/^rail |stand|table/.test(o.label) || o.stand) if (!only || true) lines.push(`obs ${o.label}${o.stand ? ' [stand]' : ''} [${f(o.box)}]`);
    for (const c of D.cables) {
      if (only && !only.some((x) => c.id.endsWith(x) || (x === 'HIT' && c.hit.length))) continue;
      lines.push(`${c.id} ${c.kind} d=${c.d} street=${c.street} ${c.A.plug} -> ${c.B.plug}`);
      lines.push('  route ' + c.route.pts.map((q: number[], i: number) => `[${f(q)}]${c.route.kinds[i] ?? ''}`).join(' '));
      lines.push('  hit ' + JSON.stringify(c.hit));
      lines.push('  path ' + c.path.filter((_: any, i: number) => i % 3 === 0).map(f).join(' | '));
    }
    lines.push(...((globalThis as any).__tagLog ?? []).filter((x: string) => !/blocked=0$/.test(x)));
    writeFileSync(`${S}/dump.txt`, lines.join('\n'));
  }, 300000);
});
