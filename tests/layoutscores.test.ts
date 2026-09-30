// Prints the before/after table of layout scores for Auto-arrange, on demand:
//   SCORE_OUT=file.json [SCORE_PLAN=classic|smart] [SCORE_COLLIDE=1] [SCORE_ONLY=name,name] npx vitest run tests/layoutscores.test.ts
// (SCORE_ONLY names racks of the whole collision matrix too; the json has every rack's score; the table goes beside it as file.txt). Skipped unless SCORE_OUT is set.
import { describe, it, beforeAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { initKernel } from '../src/cad/kernel';
import { generate } from '../src/cad/assembly';
import { EXTRA_RACKS, LAYOUT_RACKS } from './collide/layoutracks';
import { RACKS } from './collide/racks';
import { SCORE_HEAD, scoreLayout, scoreLine, type LayoutScore } from './collide/score';

const out = process.env.SCORE_OUT;
describe.skipIf(!out)('layout scores', () => {
  beforeAll(async () => { await initKernel(); });
  it('scores the racks', () => {
    const only = process.env.SCORE_ONLY?.split(',');
    // (SCORE_ONLY may name any rack of the collision matrix)
    const racks = (only ? [...LAYOUT_RACKS, ...EXTRA_RACKS, ...RACKS] : [...LAYOUT_RACKS, ...(process.env.SCORE_EXTRA ? EXTRA_RACKS : [])]).filter((r, i, a) => (!only || only.includes(r.name)) && a.findIndex((x) => x.name === r.name) === i);
    const rows: Record<string, LayoutScore & { ms: number }> = {};
    const lines = [SCORE_HEAD];
    for (const rack of racks) {
      const p = rack.make();
      if (process.env.SCORE_PLAN) p.panel.opts = { ...p.panel.opts, plan: process.env.SCORE_PLAN as 'classic' | 'smart' };
      const t0 = Date.now();
      const r = generate(p);
      const ms = Date.now() - t0;
      const s = scoreLayout(p, r, !!process.env.SCORE_COLLIDE);
      rows[rack.name] = { ...s, ms };
      lines.push(`${scoreLine(rack.name, s)} ${ms}ms`);
      writeFileSync(out!, JSON.stringify(rows, null, 1));
      writeFileSync(out!.replace(/\.json$/, '.txt'), lines.join('\n') + '\n');
    }
  }, 900_000);
});
