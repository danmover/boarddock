import { describe, it, beforeAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { initKernel } from '../src/cad/kernel';
import { generatePanel } from '../src/cad/panelgen';
import { EXTRA_RACKS, LAYOUT_RACKS } from './collide/layoutracks';
import { flatGeo, seatGeo } from '../src/cad/autoplan';

describe('calib', () => {
  beforeAll(async () => { await initKernel(); });
  it('compares', () => {
    const lines: string[] = [];
    for (const rack of [...LAYOUT_RACKS, ...EXTRA_RACKS]) {
      const p = rack.make();
      const r = generatePanel(p), pr = r.report.panel!;
      const rd = p.panel.rowDir;
      const err: Record<string, number[][]> = { seat: [], flatP: [], flatN: [] };
      const ext: number[][] = [];
      for (const mt of pr.mounts) {
        const rail = pr.rails.find((x) => x.id === mt.rail)!;
        const toRail = (q: number[]) => (rail.dir === 'h' ? [q[0] - rail.x - mt.at, q[1] - rail.y] : [q[1] - rail.y - mt.at, -(q[0] - rail.x)]);
        const foots = pr.modules.filter((x) => x.mount === mt.id).map((x) => x.foot);
        if (mt.kind === 'flat') {
          const m = p.modules.find((x) => x.id === mt.slots[0].module)!;
          for (const [tag, sg] of [['flatP', 1], ['flatN', -1]] as const) {
            const g = flatGeo(m, mt.turn, sg);
            for (const [k, v] of g.plugs) { const q = pr.plugs?.[k]; if (!q) continue; const [u, w] = toRail(q); err[tag].push([Math.abs(u - v.u), Math.abs(w - v.v)]); }
          }
          continue;
        }
        let e0 = [Infinity, -Infinity, Infinity, -Infinity];
        mt.slots.forEach((sl, i) => {
          if (!sl.module) return;
          const m = p.modules.find((x) => x.id === sl.module)!;
          const ms = pr.modules.find((x) => x.id === sl.module);
          const g = seatGeo(p, m, i, (ms?.edge ?? sl.edge) as any, mt.turn, ms?.lie, rd);
          for (const [k, v] of g.plugs) { const q = pr.plugs?.[k]; if (!q) continue; const [u, w] = toRail(q); err.seat.push([Math.abs(u - v.u), Math.abs(w - v.v)]); }
          e0 = [Math.min(e0[0], g.ext[0]), Math.max(e0[1], g.ext[1]), Math.min(e0[2], g.ext[2]), Math.max(e0[3], g.ext[3])];
        });
        if (foots.length) {
          let r0 = [Infinity, -Infinity, Infinity, -Infinity];
          for (const f of foots) { for (const c of [[f[0], f[1]], [f[2], f[3]]]) { const [u, w] = toRail(c); r0 = [Math.min(r0[0], u), Math.max(r0[1], u), Math.min(r0[2], w), Math.max(r0[3], w)]; } }
          ext.push([e0[0] - r0[0], e0[1] - r0[1], e0[2] - r0[2], e0[3] - r0[3]]);
        }
      }
      const st = (a: number[][]) => a.length ? `n=${a.length} mean(${(a.reduce((s, x) => s + x[0], 0) / a.length).toFixed(1)},${(a.reduce((s, x) => s + x[1], 0) / a.length).toFixed(1)}) max(${Math.max(...a.map((x) => x[0])).toFixed(0)},${Math.max(...a.map((x) => x[1])).toFixed(0)})` : 'n=0';
      const m4 = ext.length ? [0, 1, 2, 3].map((k) => (ext.reduce((s, x) => s + x[k], 0) / ext.length).toFixed(1)).join(',') : '-';
      lines.push(`${rack.name}: seat ${st(err.seat)} | flat+ ${st(err.flatP)} flat- ${st(err.flatN)} | ext(proxy-real) mean u0,u1,v0,v1 = ${m4}`);
      writeFileSync(process.env.CAL_OUT!, lines.join('\n') + '\n');
    }
  }, 600_000);
});
