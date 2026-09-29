// @vitest-environment happy-dom
// The Export step's shopping list (the real function, the 3D worker stubbed): straps are for boxes that get a holder on a
// rail, so a plug pack, which plugs into an outlet and never gets one, adds none.
import { describe, it, expect, vi, beforeAll } from 'vitest';
vi.mock('../src/worker/client', () => ({ boardPicture: async () => '', holderPicture: async () => '', runClipFea: async () => null, buildTestKit: async () => null }));
import { shopping } from '../src/ui/panels';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { autoLinks, numberLinks } from '../src/model/links';
import { generate } from '../src/cad/assembly';
import { initKernel } from '../src/cad/kernel';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
const tot = { g: 100, m: 60 };
const straps = (l: { head: string; items: string[] }[]) => l.filter((g) => g.head === 'Hardware').flatMap((g) => g.items).filter((x) => /hook-and-loop/.test(x));

describe('the shopping list', () => {
  beforeAll(async () => { await initKernel(); });

  it('counts straps for the boxes on the rack, not for plug packs', () => {
    const p = newProject(T('rpi5'));
    for (const id of ['psu_pi5', 'dc_pack_12v', 'pb4', 'usb_hub7']) p.modules.push(newModule(T(id)));
    p.links = numberLinks(autoLinks(p));
    const r = generate(p);
    const s = straps(shopping(p, r, null, tot));
    // the powerboard and the hub: two straps each; the two plug packs (in outlets, off the rails) none
    expect(s).toHaveLength(1);
    expect(s[0]).toMatch(/^4 × 12 mm hook-and-loop strap/);
    expect(s[0]).toMatch(/2 for each of Powerboard, 4 outlets, Powered USB hub$/);
    expect(s[0]).not.toMatch(/supply|plug pack/i);
    // just the ones picked (Export's "only these"): a strap for the hub, none for the pack
    const pick = new Set(p.modules.filter((m) => /hub|supply/i.test(m.board.name)).map((m) => m.id));
    const picked = straps(shopping(p, r, null, tot, pick));
    expect(picked).toEqual(['12 mm hook-and-loop strap for the Powered USB hub']);
  }, 120_000);

  it('has no strap line at all for a rack of boards and a plug pack', () => {
    const p = newProject(T('rpi5'));
    p.modules.push(newModule(T('psu_pi5')));
    p.links = numberLinks(autoLinks(p));
    expect(straps(shopping(p, generate(p), null, tot))).toEqual([]);
  }, 120_000);
});
