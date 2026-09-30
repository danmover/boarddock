import { describe, it, beforeAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { initKernel } from '../src/cad/kernel';
import { generatePanel } from '../src/cad/panelgen';
import { flatGeo, seatGeo } from '../src/cad/autoplan';
import { rackOf } from './collide/layoutracks';
import { seeded } from './collide/racks';

describe('dbg', () => {
  beforeAll(async () => { await initKernel(); });
  it('prints', () => {
    const p = seeded(1, () => rackOf(['rpi4', 'usb_hub7', 'usb_charger', 'net_switch5']));
    const r = generatePanel(p), pr = r.report.panel!;
    const out: string[] = [];
    for (const mt of pr.mounts) {
      const rail = pr.rails.find((x) => x.id === mt.rail)!;
      out.push(`mount ${mt.id} at ${mt.at} turn ${mt.turn} rail ${rail.dir} ${rail.x},${rail.y} foot ${mt.foot.map((v) => v.toFixed(0))}`);
      if (mt.kind === 'flat') {
        const m = p.modules.find((x) => x.id === mt.slots[0].module)!;
        const toR = (q: number[]) => [q[0] - rail.x - mt.at, q[1] - rail.y];
        const g = flatGeo(m, mt.turn, 1), g2 = flatGeo(m, mt.turn, -1);
        out.push(`  flat ${m.board.name} real foot rail-frame ${[toR([mt.foot[0], mt.foot[1]]), toR([mt.foot[2], mt.foot[3]])].map((a) => a.map((v) => v.toFixed(0))).join(' to ')} proxy ext ${g.ext.map((v) => v.toFixed(0))}`);
        for (const [k, v] of g.plugs) { const q = pr.plugs?.[k]; const v2 = g2.plugs.get(k)!; out.push(`    ${k.slice(-6)} proxy+ u=${v.u.toFixed(1)} v=${v.v.toFixed(1)} proxy- u=${v2.u.toFixed(1)} v=${v2.v.toFixed(1)} real u=${q ? (q[0] - rail.x - mt.at).toFixed(1) : '-'} v=${q ? (q[1] - rail.y).toFixed(1) : '-'}`); }
        continue;
      }
      mt.slots.forEach((sl, i) => {
        if (!sl.module) return;
        const m = p.modules.find((x) => x.id === sl.module)!, ms = pr.modules.find((x) => x.id === sl.module)!;
        out.push(`  slot ${i} ${m.board.name} edge ${ms.edge} lie ${ms.lie} foot ${ms.foot.map((v) => v.toFixed(0))}`);
        const g = seatGeo(p, m, i, ms.edge, mt.turn, ms.lie, p.panel.rowDir);
        for (const [k, v] of g.plugs) { const q = pr.plugs?.[k]; out.push(`    ${k.slice(-6)} proxy u=${v.u.toFixed(1)} v=${v.v.toFixed(1)}  real u=${q ? (q[0] - rail.x - mt.at).toFixed(1) : '-'} v=${q ? (q[1] - rail.y).toFixed(1) : '-'}`); }
        out.push(`    ext ${g.ext.map((v) => v.toFixed(0))}`);
      });
    }
    writeFileSync(process.env.CAL_OUT!, out.join('\n') + '\n');
  }, 600_000);
});
