import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { initKernel } from '../src/cad/kernel';
import { generate } from '../src/cad/assembly';
import { TEMPLATES } from '../src/model/templates';
import { newProject } from '../src/model/library';
import { writeStl } from '../src/cad/export';
import { isPlugPack } from '../src/model/powerdata';

const OUT = process.env.OUT;

describe('holder generator', () => {
  for (const t of TEMPLATES) {
    for (const mode of ['flat', 'rack'] as const) {
      it(`${t.id} ${mode}`, async () => {
        await initKernel();
        const p = newProject(t.make());
        p.layout = 'loose';
        p.mount.mode = mode;
        if (t.id === 'uno') { p.stand.enabled = true; p.stand.axis = 'edge'; p.stand.edge = 'top'; }
        if (t.id === 'pico') { p.stand.enabled = true; p.stand.shape = 'tripod'; }
        const r = generate(p);
        const vol = r.parts.map((x) => `${x.id}:${(x.volume / 1000).toFixed(2)}cm3`).join(' ');
        console.log(t.id, mode, `${r.report.timeMs}ms`, vol, '| warn:', r.report.warnings.filter((w) => !/drawing|revisions|Pico is|Outline and|Held by|Cheap|GPIO/.test(w)).join(' / '));
        for (const c of r.report.checks) if (c.status === 'bad' || c.status === 'warn') console.log('   check', c.status, c.name, c.value);
        // (a plug pack goes into an outlet and never gets a holder: on its own there is nothing to print, and it says so)
        if (isPlugPack(p.modules[0].board)) {
          expect(r.parts).toEqual([]);
          expect(r.report.warnings.some((w) => /a plug pack goes straight into an outlet and gets no holder, so there is nothing to print/.test(w))).toBe(true);
          return;
        }
        expect(r.parts.length).toBeGreaterThan(0);
        for (const x of r.parts) expect(x.mesh.idx.length).toBeGreaterThan(0);
        if (OUT) { mkdirSync(OUT, { recursive: true }); for (const x of r.parts) writeFileSync(`${OUT}/${t.id}_${mode}_${x.id}.stl`, writeStl([x.mesh])); }
      });
    }
  }
});
