// A board below the top of a column must not have a plug pointing up it: the plug and its cradle stand where the
// holder above sits (they rose 3.3 mm past the landing, and the holder above sat 3.4 to 4.3 mm deep in the one below).
// A column's base stands on a long edge like the rest of the column, with its plugs to the side; a board that can't
// (a Pi Zero, all its plugs on one long edge) is flagged.
import { describe, it, expect, beforeAll } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { generatePanel } from '../src/cad/panelgen';
import { initKernel } from '../src/cad/kernel';
import { longEdges } from '../src/cad/dockplan';
import { measure } from './collide/measure';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
beforeAll(async () => { await initKernel(); });

/** A column of these boards, the first in the dock and each on the one before. */
function column(ids: string[]) {
  const p = newProject(T(ids[0]));
  for (const id of ids.slice(1)) p.modules.push(newModule(T(id)));
  p.modules.forEach((m, k) => { if (k) { m.on = p.modules[k - 1].id; m.onMode = 'column'; } });
  return p;
}

describe('plugs up a column', () => {
  for (const ids of [['pico', 'pico', 'pico'], ['esp32', 'pico'], ['nano', 'ftdi']]) {
    it(`${ids.join(' + ')}: the base stands on a long edge, its plugs to the side, and the holders sit on each other`, () => {
      const p = column(ids), r = generatePanel(p), base = p.modules[0];
      const slot = r.report.panel!.mounts.flatMap((m) => m.slots).find((s) => s.module === base.id)!;
      expect(slot.edge).not.toBe('auto');
      expect(longEdges(base.board)).toContain(slot.edge);
      expect(r.report.checks.filter((c) => c.name === 'Plug up the column')).toEqual([]);
      expect(r.report.warnings.filter((w) => /up the column|overlap on the panel/.test(w))).toEqual([]);
      // (only the pegs' crush ribs touch, about 1 mm³ a joint)
      expect(measure(p, r).cats['holder-holder'].vol).toBeLessThan(1.5 * (ids.length - 1) + 0.5);
    }, 240_000);
  }

  it('a Pi Zero under a J-Link can only point its plugs up the column: the Check says so, and to put it on top', () => {
    const p = column(['rpi_zero', 'jlink']), r = generatePanel(p);
    const c = r.report.checks.find((x) => x.name === 'Plug up the column');
    expect(c?.status).toBe('bad');
    expect(c?.detail).toMatch(/top of its column/);
    // on top, nothing is above its plugs
    const q = column(['jlink', 'rpi_zero']), rq = generatePanel(q);
    expect(rq.report.checks.filter((x) => x.name === 'Plug up the column')).toEqual([]);
  }, 240_000);
});
