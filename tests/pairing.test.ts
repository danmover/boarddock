// Pairing boards back to back without dragging: who could share a dock, and who could go behind a board.
import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { putBehindOptions, shareDockOptions } from '../src/ui/panelOps';
import type { PanelReport } from '../src/model/types';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();

describe('sharing a dock', () => {
  const p = newProject(T('rpi4'));
  p.modules.push(newModule(T('uno')), newModule(T('pico')), newModule(T('psu_pi5')));
  const [pi, uno, pico, psu] = p.modules.map((m) => m.id);
  // d1: the Pi in front, the back free; d2: the Uno and the Pico back to back; the plug pack has no dock
  const pr = {
    rails: [{ id: 'r1' }],
    mounts: [
      { id: 'd1', rail: 'r1', at: 0, kind: 'dock', slots: [{ module: pi }, { module: null }] },
      { id: 'd2', rail: 'r1', at: 100, kind: 'dock', slots: [{ module: uno }, { module: pico }] },
    ],
  } as unknown as PanelReport;

  it("offers a board another's dock with a free slot, never its own or a full one", () => {
    expect(shareDockOptions(p, pr, uno).map((o) => [o.name, o.mount, o.slot])).toEqual([['Raspberry Pi 4B', 'd1', 1]]);
    expect(shareDockOptions(p, pr, pi)).toEqual([]);
  });

  it('offers a free slot every board that is not in that dock, those off the rails first, never a plug pack', () => {
    const names = putBehindOptions(p, pr, 'd1').map((o) => [o.id, o.where ?? '']);
    expect(names.map((x) => x[0]).sort()).toEqual([uno, pico].sort());
    expect(names.find((x) => x[0] === uno)![1]).toMatch(/^dock /);
    expect(putBehindOptions(p, pr, 'nope')).toEqual([]);
    expect(names.some((x) => x[0] === psu)).toBe(false);
  });
});
