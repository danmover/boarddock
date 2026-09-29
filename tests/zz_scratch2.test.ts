import { describe, it, beforeAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { initKernel } from '../src/cad/kernel';
import { generatePanel } from '../src/cad/panelgen';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { autoLinks, numberLinks } from '../src/model/links';
import { seeded } from './collide/racks';
import type { Board } from '../src/model/types';

const OUT = '/tmp/claude-0/-home-user-boarddock/9f8d8d26-36fa-584d-87d3-c19a32c74ffd/scratchpad/out2.txt';
const T = (id: string): Board => TEMPLATES.find((t) => t.id === id)!.make();
const IDS = ['rpi4', 'rpi4', 'rpi5', 'uno', 'mega', 'pico', 'nano', 'esp32', 'usb_hub7', 'usb_charger', 'jlink', 'ftdi'];
describe('scratch2', () => {
  beforeAll(async () => { await initKernel(); });
  it('rack', () => {
    const lines: string[] = [];
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) for (const lie of ['auto', 'flat']) {
      seeded(seed * 77, () => {
        const p = newProject(T(IDS[0]));
        for (const id of IDS.slice(1)) p.modules.push(newModule(T(id)));
        p.panel.maxRail = 300;
        if (lie === 'flat') p.panel.lie = 'flat';
        p.links = numberLinks(autoLinks(p));
        const r = generatePanel(p);
        const w = r.report.warnings.filter((x) => /runs into|overlap on/.test(x));
        lines.push(`seed ${seed} ${lie}: ${w.length ? w.join(' || ') : 'clean'}`);
      });
    }
    writeFileSync(OUT, lines.join('\n'));
  }, 300000);
});
