// Loose holders, the stack hardware on the shopping list, and plugs and leads in 3D: boxes never go into a loose
// stack, loose holders start without a DIN clip, a cradled port with nothing in it gets a short tail rather than a
// cable ending in mid-air, and a box's supply lead runs off along the table past the rack.
import { describe, it, expect, beforeAll } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { headlessCradles, makeHeadless, newModule, newProject, setLayout } from '../src/model/library';
import { stackHardware } from '../src/model/holes';
import { autoLinks, numberLinks } from '../src/model/links';
import { badgeText } from '../src/model/cablebadge';
import { buyText } from '../src/model/cablebuy';
import { leadStub } from '../src/cad/boardviz';
import { generate, stackOrder } from '../src/cad/assembly';
import { initKernel } from '../src/cad/kernel';
import type { Ghost, PartOut } from '../src/model/types';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
/** Bounding box of a ghost (already placed) or of a part's every copy. */
function boxOf(x: Ghost | PartOut) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const Ms = 'toAssembly' in x ? [x.toAssembly, ...(x.instances ?? [])] : [[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]];
  for (const M of Ms) for (let k = 0; k < x.mesh.pos.length; k += 3) for (let a = 0; a < 3; a++) {
    const v = M[a] * x.mesh.pos[k] + M[4 + a] * x.mesh.pos[k + 1] + M[8 + a] * x.mesh.pos[k + 2] + M[12 + a];
    lo[a] = Math.min(lo[a], v); hi[a] = Math.max(hi[a], v);
  }
  return { lo, hi };
}

describe('stack hardware', () => {
  it('counts a standoff per shared hole, two screws each, sized from the holes', () => {
    const p = newProject(T('rpi4'));
    const hat = newModule(T('rpi4'));
    hat.on = p.modules[0].id;
    p.modules.push(hat);
    // (a whole Pi on a Pi covers its 16 mm USB jacks: 20 mm standoffs, not a HAT's 11)
    expect(stackHardware(p, hat)).toEqual({ n: 4, screws: 8, size: 'M2.5', gap: 20, shared: true });

    const q = newProject(T('uno'));
    const shield = newModule(T('uno'));
    shield.on = q.modules[0].id; shield.onGap = 15;
    q.modules.push(shield);
    const h = stackHardware(q, shield)!;
    expect(h.size).toBe('M3');
    expect(h.screws).toBe(2 * h.n);
    expect(h.n).toBe(q.modules[0].board.holes.filter((x) => x.d >= 1.5).length);
    expect(h.gap).toBe(15);

    // a Pi Zero on a Pi 4 shares only two holes
    const z = newProject(T('rpi4'));
    const zero = newModule(T('rpi_zero'));
    zero.on = z.modules[0].id; zero.onMode = 'bolted';
    z.modules.push(zero);
    const hz = stackHardware(z, zero)!;
    expect(hz.n).toBeLessThan(4);
    expect(hz.screws).toBe(2 * hz.n);
  });

  it('is nothing for a board on a printed layer or on its own', () => {
    const p = newProject(T('rpi4'));
    const top = newModule(T('proto_5x7'));
    p.modules.push(top);
    expect(stackHardware(p, top)).toBeNull();
    top.on = p.modules[0].id; top.onMode = 'towers';
    expect(stackHardware(p, top)).toBeNull();
  });
});

describe('loose holders', () => {
  beforeAll(async () => { await initKernel(); });

  it('start without a DIN clip, unless it was switched on by hand', () => {
    const p = newProject(T('uno'));
    setLayout(p, 'loose');
    expect(p.mount.kind).toBe('none');
    p.mount.kind = 'din'; p.mount.picked = true;
    setLayout(p, 'panel'); setLayout(p, 'loose');
    expect(p.mount.kind).toBe('din');
  });

  it('never stack a box: a powerboard stands beside the stack with its outlets clear', () => {
    const p = newProject(T('uno'));
    setLayout(p, 'loose');
    p.modules.push(newModule(T('pb4')), newModule(T('esp32')));
    p.arrange.mode = 'stack';
    expect(stackOrder(p)).toEqual([0, 2]);
    const r = generate(p);
    const pb = p.modules[1].id;
    const holder = (id: string) => r.parts.filter((x) => x.tag?.kind === 'holder' && x.tag.module === id).map(boxOf);
    const pbBox = holder(pb)[0];
    for (const id of [p.modules[0].id, p.modules[2].id]) for (const b of holder(id)) {
      // no overlap in plan: nothing stands over the powerboard's top
      const apart = b.hi[0] < pbBox.lo[0] || b.lo[0] > pbBox.hi[0] || b.hi[1] < pbBox.lo[1] || b.lo[1] > pbBox.hi[1];
      expect(apart).toBe(true);
    }
    // the powerboard sits on the table, not up a tower
    expect(pbBox.lo[2]).toBeLessThan(5);
    expect(r.report.features?.some((f) => f.kind === 'tower' && f.module === pb) ?? false).toBe(false);
    expect(r.report.checks.some((c) => /beside the stack/.test(c.name))).toBe(true);
    expect(r.report.warnings.some((w) => /loose piece/.test(w))).toBe(false);
  }, 300_000);

  it("say their cables aren't routed, and draw each lead as a short stub that fades out, saying where it goes", () => {
    const p = newProject(T('rpi4'));
    setLayout(p, 'loose');
    p.modules.push(newModule(T('usb_charger')), newModule(T('pb4')));
    p.arrange.mode = 'side';
    p.links = numberLinks(autoLinks(p));
    const r = generate(p);
    expect(r.report.checks.find((c) => c.name === 'Cables')?.value).toMatch(/not routed/);
    const leads = r.ghosts.filter((g) => g.name.startsWith('off-rack cable'));
    expect(leads.length).toBeGreaterThan(0);
    for (const g of leads) {
      const b = boxOf(g);
      expect(Math.max(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2])).toBeLessThan(60);
      expect(g.fx?.fade?.label).toBeTruthy();
    }
    // the powerboard's own lead: to the wall; a cable between two boards: to the other one
    expect(leads.find((g) => g.tag?.module === p.modules[2].id)?.fx?.fade?.label).toBe('to the wall');
    expect(leads.some((g) => /^to the /.test(g.fx!.fade!.label!) && g.fx!.fade!.label !== 'to the wall')).toBe(true);
  }, 300_000);
});

describe('plugs and leads in 3D', () => {
  beforeAll(async () => { await initKernel(); });

  it('a lead off the rack is a short straight stub along its plug, fading out, with where it goes', () => {
    const g = leadStub('x', [0, 0, 50], [0, 0, 1], 5, 'to a screen', { kind: 'plug' }, { seq: 0, dir: [0, 0, 1] });
    const b = boxOf(g);
    expect(b.hi[2] - 50).toBeGreaterThan(20);
    expect(b.hi[2] - 50).toBeLessThan(60);
    expect(Math.max(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1])).toBeLessThan(6);
    expect(g.fx?.fade).toMatchObject({ label: 'to a screen', d: [0, 0, 1] });
  });

  it("a headless Pi's HDMI cradles go, and in a rack its unused plugs get tails, not cables to the table", () => {
    const p = newProject(T('rpi4'));
    p.modules.push(newModule(T('usb_charger')), newModule(T('pb4')));
    p.links = numberLinks(autoLinks(p));
    const r0 = generate(p);
    const pi = p.modules[0].id;
    // nothing in the Pi's HDMI and audio ports by default: no leads there, and no cradles printed for them
    const leadsOf = (r: typeof r0) => r.ghosts.filter((g) => g.name.startsWith('off-rack cable'));
    expect(leadsOf(r0).filter((g) => g.tag?.module === pi && g.tag.refs?.[0] !== 'J_PWR')).toEqual([]);
    // say a screen and speakers go in them: then they are
    for (const c of p.modules[0].board.comps) if (/HDMI|AUDIO/.test(c.ref) && c.conn) c.conn.use = 'yes';
    const r1 = generate(p);
    const leads = leadsOf(r1);
    const pis = leads.filter((g) => g.tag?.module === pi);
    // (its power socket too, if the charger here is too weak for it: that lead goes to a supply off the rack)
    const av = pis.filter((g) => g.tag?.refs?.[0] !== 'J_PWR');
    expect(av.map((g) => g.tag?.refs?.[0]).sort()).toEqual(['AUDIO', 'HDMI0', 'HDMI1']);
    for (const g of pis) expect(boxOf(g).lo[2]).toBeGreaterThan(20); // up by the board, not down on the table
    expect(av.map((g) => g.fx?.fade?.label).sort()).toEqual(['to a screen', 'to a screen', 'to speakers']);
    for (const g of pis.filter((x) => x.tag?.refs?.[0] === 'J_PWR')) expect(g.fx?.fade?.label).toBe('to its power supply');
    // the powerboard's lead: to the wall
    expect(leads.find((g) => g.tag?.module === p.modules[2].id)?.fx?.fade?.label).toBe('to the wall');

    expect(headlessCradles(p).map((d) => d.ref).sort()).toEqual(['AUDIO', 'HDMI0', 'HDMI1']);
    expect(makeHeadless(p)).toBe(3);
    expect(p.modules[0].board.comps.filter((c) => c.conn?.cradle || (c.conn?.cap && /HDMI|AUDIO/.test(c.ref))).map((c) => c.ref)).toEqual(['J_PWR']);
    const r2 = generate(p);
    expect(r2.ghosts.some((g) => g.tag?.kind === 'plug' && g.tag.module === pi && /HDMI/.test(g.tag.refs?.[0] ?? ''))).toBe(false);
  }, 300_000);

  it('draws no lead from the empty socket of a stacked pair', async () => {
    await initKernel();
    // an Uno on the lower USB2 socket of a Pi 4, nothing in the upper one: the pair counted as in use as a whole, so
    // the empty upper socket got a plug and a lead "to a computer", through the Uno's cable beside it
    const p = newProject(T('rpi4'));
    const uno = newModule(T('uno'));
    p.modules.push(uno);
    const pi = p.modules[0];
    p.links = numberLinks([{ id: 'l1', a: { module: uno.id, ref: 'USB' }, b: { module: pi.id, ref: 'USB2' }, kind: 'usb' }]);
    const r = generate(p);
    const plugs = r.ghosts.filter((g) => g.tag?.kind === 'plug' && g.tag.module === pi.id && g.tag.refs?.[0] === 'USB2');
    expect(plugs.some((g) => /lower/.test(g.name))).toBe(true);
    expect(plugs.filter((g) => /upper/.test(g.name))).toEqual([]);
    expect(r.ghosts.filter((g) => /^off-rack cable/.test(g.name) && /USB2/.test(g.name)).map((g) => g.name)).toEqual([]);
    // the same socket cabled off the rack (to your computer) still gets its lead
    p.links = numberLinks([...p.links, { id: 'l2', a: { module: pi.id, ref: 'USB2:2' }, b: { module: '@pc', ref: 'USB' }, kind: 'usb' }]);
    const r2 = generate(p);
    expect(r2.ghosts.filter((g) => /^off-rack cable/.test(g.name) && /USB2:2/.test(g.name)).length).toBe(1);
  }, 120_000);

  it('cable badges put where the cable goes first', () => {
    expect(badgeText('Power: Powerboard, 4 outlets + USB → Pi 5')).toBe('Power → Pi 5');
    expect(badgeText('Power: Powerboard, 4 outlets + USB → Pi 5 2')).toBe('Power → Pi 5 2');
    expect(badgeText('Hub uplink: Pi 4B → USB hub')).toBe('Hub uplink → USB hub');
    expect(badgeText('Mains')).toBe('Mains');
  });
});

describe('cables to buy', () => {
  it('names hook-up wire, pigtails and mains leads plainly', () => {
    expect(buyText('wire', 0.5, 'wires', 'wires')).toMatch(/^red and black hook-up wire, 0\.5 to 0\.75 mm² .*0\.5 m of each, a ferrule/);
    expect(buyText('power', 1, 'DC barrel', 'wires')).toMatch(/^DC barrel plug to bare wire lead/);
    expect(buyText('mains', 1, 'mains (C7)', 'UK outlet')).toMatch(/C7\) to UK plug, 1 m or longer/);
    expect(buyText('usb', 0.3, 'USB-A', 'USB-C')).toBe('0.3 m USB-A to USB-C cable');
  });
});

describe('each loose holder its own clip', () => {
  beforeAll(async () => { await initKernel(); });
  it('turning one holder\'s clip off leaves the others on; defaults side by side', () => {
    const p = newProject(T('pico'));
    p.modules.push(newModule(T('nano')));
    setLayout(p, 'loose');
    expect(p.arrange.mode).toBe('side');
    p.mount.kind = 'din'; p.mount.picked = true;
    const clips = (r: ReturnType<typeof generate>) => r.parts.filter((x) => x.tag?.kind === 'clip').reduce((a, x) => a + 1 + (x.instances?.length ?? 0), 0);
    const both = clips(generate(p));
    expect(both).toBe(2);
    p.modules[1].clip = { off: true };
    expect(clips(generate(p))).toBe(1);
  }, 300_000);
});
