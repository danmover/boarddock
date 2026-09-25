import { describe, it, expect } from 'vitest';
import { initKernel } from '../src/cad/kernel';
import { generate } from '../src/cad/assembly';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();

describe('multi-board layouts', () => {
  for (const mode of ['stack', 'side', 'back'] as const) {
    for (const mount of ['flat', 'rack'] as const) {
      it(`${mode} / ${mount}`, async () => {
        await initKernel();
        const p = newProject(T('uno'));
        p.layout = 'loose';
        p.modules.push(newModule(T('blank')), newModule(T('pico')));
        p.arrange.mode = mode;
        p.mount.mode = mount;
        const r = generate(p);
        console.log(mode, mount, r.report.timeMs + 'ms', r.parts.map((x) => `${x.id}x${x.qty}:${(x.volume / 1000).toFixed(1)}`).join(' '), '|', r.report.warnings.filter((w) => /loose|towers|rivet|link|Back/i.test(w)).join(' / '));
        expect(r.parts.filter((x) => x.id.endsWith('holder')).length).toBe(mode === 'back' ? 2 : 3);
        expect(r.report.warnings.some((w) => /loose piece/.test(w))).toBe(false);
      });
    }
  }
});
