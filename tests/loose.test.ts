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
import { hangingCable, leadRun, stubCable } from '../src/cad/boardviz';
import { generate, stackOrder } from '../src/cad/assembly';
import { initKernel } from '../src/cad/kernel';
import type { Ghost, PartOut } from '../src/model/types';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
const len = (pts: number[][]) => pts.slice(1).reduce((a, q, i) => a + Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1], q[2] - pts[i][2]), 0);
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
    expect(stackHardware(p, hat)).toEqual({ n: 4, screws: 8, size: 'M2.5', gap: 11, shared: true });

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

  it("say their cables aren't routed, and draw them as short tails; a supply lead runs off along the table", () => {
    const p = newProject(T('rpi4'));
    setLayout(p, 'loose');
    p.modules.push(newModule(T('usb_charger')), newModule(T('pb4')));
    p.arrange.mode = 'side';
    p.links = numberLinks(autoLinks(p));
    const r = generate(p);
    expect(r.report.checks.find((c) => c.name === 'Cables')?.value).toMatch(/not routed/);
    const tails = r.ghosts.filter((g) => g.name.startsWith('cable tail')), leads = r.ghosts.filter((g) => g.name.startsWith('off-rack cable'));
    expect(tails.length).toBeGreaterThan(0);
    for (const g of tails) { const b = boxOf(g); expect(Math.max(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2])).toBeLessThan(60); }
    // the powerboard's own lead goes to the wall: off the table past every holder
    expect(leads.map((g) => g.tag?.module)).toEqual([p.modules[2].id]);
    const all = r.parts.filter((x) => x.toAssembly[14] > -300).map(boxOf);
    const floor = Math.min(...all.map((b) => b.lo[2]));
    const lb = boxOf(leads[0]);
    expect(lb.lo[2]).toBeGreaterThan(floor - 1); // on the table, not below it (link bars wait at z = -400)
    const x0 = Math.min(...all.map((b) => b.lo[0])), x1 = Math.max(...all.map((b) => b.hi[0])), y0 = Math.min(...all.map((b) => b.lo[1])), y1 = Math.max(...all.map((b) => b.hi[1]));
    expect(lb.lo[0] < x0 - 40 || lb.hi[0] > x1 + 40 || lb.lo[1] < y0 - 40 || lb.hi[1] > y1 + 40).toBe(true);
  }, 300_000);
});

describe('plugs and leads in 3D', () => {
  beforeAll(async () => { await initKernel(); });

  it('a short tail droops a little and stays short', () => {
    const side = stubCable([0, 0, 50], [1, 0, 0], 5);
    expect(len(side)).toBeLessThan(40);
    expect(side[side.length - 1][2]).toBeLessThan(50);
    const up = stubCable([0, 0, 50], [0, 0, 1], 5);
    expect(up[up.length - 1][2]).toBeGreaterThan(65);
  });

  it('a lead to the wall runs past the rack before it stops', () => {
    expect(leadRun([0, 0, 0], [1, 0, 0])).toBe(45);
    expect(leadRun([0, 0, 0], [1, 0, 0], [-100, -50, 300, 50])).toBe(450);
    expect(leadRun([400, 0, 0], [1, 0, 0], [-100, -50, 300, 50])).toBe(150);
    const pts = hangingCable([0, 0, 40], [-1, 0, 0], 7, 0, [100, 0], [-50, -30, 250, 30]);
    const end = pts[pts.length - 1];
    expect(end[0]).toBeLessThan(-50 - 120);
    expect(end[2]).toBeLessThan(5);
  });

  it("a headless Pi's HDMI cradles go, and in a rack its unused plugs get tails, not cables to the table", () => {
    const p = newProject(T('rpi4'));
    p.modules.push(newModule(T('usb_charger')), newModule(T('pb4')));
    p.links = numberLinks(autoLinks(p));
    const r0 = generate(p);
    const pi = p.modules[0].id;
    const tails = r0.ghosts.filter((g) => g.name.startsWith('cable tail'));
    expect(tails.map((g) => g.tag?.refs?.[0]).sort()).toEqual(['AUDIO', 'HDMI0', 'HDMI1']);
    for (const g of tails) expect(boxOf(g).lo[2]).toBeGreaterThan(20); // up by the board, not down on the table
    // the powerboard's lead runs off along the table
    const lead = r0.ghosts.find((g) => g.name.startsWith('off-rack cable'))!;
    expect(lead.tag?.module).toBe(p.modules[2].id);
    const lb = boxOf(lead);
    expect(Math.max(lb.hi[0] - lb.lo[0], lb.hi[1] - lb.lo[1])).toBeGreaterThan(150);

    expect(headlessCradles(p).map((d) => d.ref).sort()).toEqual(['AUDIO', 'HDMI0', 'HDMI1']);
    expect(makeHeadless(p)).toBe(3);
    expect(p.modules[0].board.comps.filter((c) => c.conn?.cradle || (c.conn?.cap && /HDMI|AUDIO/.test(c.ref))).map((c) => c.ref)).toEqual(['J_PWR']);
    const r1 = generate(p);
    expect(r1.ghosts.some((g) => g.tag?.kind === 'plug' && g.tag.module === pi && /HDMI/.test(g.tag.refs?.[0] ?? ''))).toBe(false);
  }, 300_000);

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
