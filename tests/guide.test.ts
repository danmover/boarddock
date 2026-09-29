// The build guide: a step for each step of the assembly animation, each with its own words, and the printed guide
// (each step with its picture, the bill of materials at the end) safe for any board name.
import { describe, it, expect, beforeAll } from 'vitest';
import { initKernel } from '../src/cad/kernel';
import { generate } from '../src/cad/assembly';
import { billOfMaterials } from '../src/model/bom';
import { assemblyAnims, guideHtml, guideSteps, NO_TEXT, stepSeqs } from '../src/ui/guide';
import { RACKS } from './collide/racks';

beforeAll(async () => { await initKernel(); });

describe('build guide', () => {
  it('has words for every step, on racks of every kind', () => {
    for (const name of ['rpi4 standing', 'uno lying flat', 'pico loose', 'esp32 DIN flat clip', 'busy mixed rack']) {
      const p = RACKS.find((r) => r.name === name)!.make(), r = generate(p);
      const steps = guideSteps(stepSeqs(assemblyAnims(r)), r.steps);
      expect(steps.length, name).toBeGreaterThan(1);
      expect(steps.filter((s) => s.text === NO_TEXT).map((s) => s.n), `${name}: steps without words`).toEqual([]);
      expect(steps.map((s) => s.n)).toEqual(steps.map((_, i) => i + 1));
    }
  }, 240_000);

  it('prints each step with its picture, then the bill of materials', () => {
    const p = RACKS.find((r) => r.name === 'rpi4 standing')!.make(), r = generate(p);
    const bom = billOfMaterials(p, r);
    const steps = guideSteps(stepSeqs(assemblyAnims(r)), r.steps).map((s) => ({ ...s, img: `data:image/jpeg;base64,${s.n}` }));
    const html = guideHtml('Bench <rack> & "co"', steps, bom);
    expect(html.match(/<section class="g-step">/g)?.length).toBe(steps.length);
    expect(html.match(/<img /g)?.length).toBe(steps.length);
    expect(html).toContain(`Step ${steps.length} of ${steps.length}`);
    expect(html.match(/<table>/g)?.length).toBe(bom.length);
    // the bill of materials comes after the last step
    expect(html.indexOf('Bill of materials')).toBeGreaterThan(html.lastIndexOf('g-step'));
    // names are text, never markup
    expect(html).toContain('Bench &lt;rack&gt; &amp; &quot;co&quot;: build guide');
    expect(html).not.toContain('<rack>');
  }, 120_000);
});
