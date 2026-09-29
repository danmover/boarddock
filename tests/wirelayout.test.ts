// The Wiring view's layouts: by flow (sources left, what they feed to the right) and as on the rails, each shaped to
// the room it has on screen, so a 16-board rack is readable; where a dropped card goes, and where cable badges go.
import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { allPlugs, autoLinks, numberLinks, PC, pcModule, ROUTER, routerModule } from '../src/model/links';
import { addAdapters, addProbes, fillWires } from '../src/model/probes';
import { autoAssign } from '../src/cad/dockplan';
import { badgeSpots, boundsOf, cardSize, fitZoom, flowLayout, freeSpot, rackLayout, railRows, ROOM, type Pos, type Size } from '../src/model/wirelayout';
import type { Project } from '../src/model/types';
import { seeded } from './collide/racks';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();

describe('wiring layout', () => {
  const p = newProject(T('example_dual_swd'));
  p.modules.push(newModule(T('usb_hub7')));
  addProbes(p, p.modules[0].id);
  addAdapters(p, p.modules[0].id);
  p.links = numberLinks([...(p.links ?? []), ...autoLinks(p)]).map((l) => fillWires(p, l));
  const size = new Map(p.modules.map((m) => [m.id, { w: 200, h: 120 }]));
  const name = (id: string) => p.modules.find((m) => m.id === id)!.board.name.replace(/ \(.*$/, '');

  it('puts the hub first, then the probes and the adapter, then the board they serve, without overlaps', () => {
    const pos = flowLayout(p, size);
    const col = (n: string) => [...pos].filter(([id]) => name(id) === n).map(([, q]) => q[0]);
    const hub = col('Powered USB hub')[0], board = col('Dual-MCU controller')[0];
    expect(hub).toBeLessThan(Math.min(...col('J-Link'), ...col('USB-serial adapter')));
    expect(board).toBeGreaterThan(Math.max(...col('J-Link'), ...col('USB-serial adapter')));
    const boxes = [...pos.values()];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      expect(Math.abs(a[0] - b[0]) >= 200 || Math.abs(a[1] - b[1]) >= 120).toBe(true);
    }
  });

  it('as on the rack: a row per rail in order, the rest after', () => {
    const ids = p.modules.map((m) => m.id);
    const pos = rackLayout(p, [[ids[0], ids[1]]], size);
    expect(pos.get(ids[0])![1]).toBe(pos.get(ids[1])![1]);
    expect(pos.get(ids[1])![0]).toBeGreaterThan(pos.get(ids[0])![0]);
    expect(Math.min(...ids.slice(2).map((id) => pos.get(id)![1]))).toBeGreaterThan(pos.get(ids[0])![1]);
  });
});

// ---- big racks: the drawing takes the shape of the room it has ----

/** The Wiring view's cards for a rack, sized as it draws them: every board and box, your computer and router when a cable goes (or might go) to them. */
function cards(p: Project): Map<string, Size> {
  const plugs = allPlugs(p), links = p.links ?? [];
  const mods = [...p.modules, ...(links.some((l) => l.a.module === PC || l.b.module === PC) || plugs.some((q) => q.role === 'device' || q.role === 'hub-up') ? [pcModule(p)] : []), ...(links.some((l) => l.a.module === ROUTER || l.b.module === ROUTER) ? [routerModule(p)] : [])];
  return new Map(mods.map((m) => [m.id, cardSize(plugs.filter((q) => q.module.id === m.id).length)]));
}
/** Auto-arrange's docks, four to a rail (as it lays out a rack this size on its default rails), as the view reads them. */
function rails(p: Project, perRail = 4): string[][] {
  const mounts = autoAssign(p).map((m, i) => ({ ...m, rail: `r${Math.floor(i / perRail)}`, at: i }));
  return railRows(p, { rails: [...new Set(mounts.map((m) => m.rail))].map((id) => ({ id })), mounts });
}
const overlaps = (pos: Pos, size: Map<string, Size>) => {
  const r = [...pos].map(([id, q]) => ({ x: q[0], y: q[1], ...size.get(id)! }));
  return r.some((a, i) => r.slice(i + 1).some((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));
};

describe('the Wiring view on a big rack', () => {
  // 16 boards and what powers and connects them, with Auto-connect (like the collision test's busy mixed rack, bigger)
  const BOARDS = ['rpi5', 'rpi5', 'rpi5', 'rpi4', 'rpi4', 'rpi4', 'rpi_zero', 'uno', 'uno', 'mega', 'nano', 'nano', 'pico', 'pico', 'esp32', 'esp32'];
  const p = seeded(517, () => {
    const q = newProject(T(BOARDS[0]));
    for (const id of [...BOARDS.slice(1), 'usb_hub7', 'usb_charger6', 'usb_charger6', 'net_switch8', 'pb6', 'psu_pi5', 'psu_pi5', 'psu_pi5']) q.modules.push(newModule(T(id)));
    q.links = numberLinks(autoLinks(q)).map((l) => fillWires(q, l));
    return q;
  });
  const size = cards(p);
  // the most any layout could show: the cards and their gaps filling the room with nothing to spare (about 50 %)
  const area = [...size.values()].reduce((s, c) => s + (c.w + 60) * (c.h + 46), 0), most = Math.sqrt((ROOM.w * ROOM.h) / area);

  it('fits it in a 1400 × 900 window at a third of full size or more, not in long rows', () => {
    expect(size.size).toBe(26); // 16 boards, 8 boxes and supplies, your computer and your router
    for (const rows of [rails(p), rails(p, 99)]) {
      const pos = rackLayout(p, rows, size);
      expect(pos.size).toBe(size.size);
      expect(overlaps(pos, size)).toBe(false);
      const k = fitZoom(boundsOf(pos, size), ROOM);
      // It fitted at 20 to 27 % (a row of cards per rail, and every supply in one more), the cards' words 3 px tall.
      // Filled with no room to spare, the cards and their gaps would show at about 50 %; rows of cards of different
      // heights lose some of that, and two thirds of it (33 %) is the least a layout should keep.
      expect(k).toBeGreaterThanOrEqual(0.33);
      expect(k).toBeGreaterThanOrEqual(most * 0.65);
    }
  });

  it('puts a plug pack beside the rail of the board it powers', () => {
    const rows = rails(p), pos = rackLayout(p, rows, size);
    const packs = p.modules.filter((m) => m.board.name.startsWith('USB-C supply'));
    expect(packs.length).toBe(3);
    for (const m of packs) {
      const l = p.links!.find((x) => x.a.module === m.id || x.b.module === m.id)!, to = l.a.module === m.id ? l.b.module : l.a.module;
      const r = rows.findIndex((row) => row.includes(to)), top = (i: number) => Math.min(...rows[i].map((id) => pos.get(id)![1]));
      // between the top of that rail's cards and the top of the next rail's
      expect(pos.get(m.id)![1]).toBeGreaterThanOrEqual(top(r));
      if (r + 1 < rows.length) expect(pos.get(m.id)![1]).toBeLessThan(top(r + 1));
    }
  });

  it('as the cables flow: your computer and router have cards too, and a tall column goes on beside it', () => {
    // (a cable to your router used to stop Arrange… As the cables flow from doing anything)
    expect(p.links!.some((l) => l.a.module === ROUTER || l.b.module === ROUTER)).toBe(true);
    const pos = flowLayout(p, size);
    expect(pos.size).toBe(size.size);
    expect(overlaps(pos, size)).toBe(false);
    // two hubs with 14 boards on them: one column of 14 cards would fit at 30 %
    const hubs = seeded(518, () => {
      const q = newProject(T('usb_hub7'));
      for (const id of ['usb_hub7', 'pico', 'pico', 'pico', 'pico', 'pico', 'pico', 'uno', 'uno', 'uno', 'nano', 'nano', 'nano', 'esp32', 'esp32']) q.modules.push(newModule(T(id)));
      q.links = numberLinks(autoLinks(q));
      return q;
    });
    const hs = cards(hubs), hp = flowLayout(hubs, hs);
    expect(overlaps(hp, hs)).toBe(false);
    expect(fitZoom(boundsOf(hp, hs), ROOM)).toBeGreaterThan(0.38);
  });
});

describe('the Wiring view on a small rack', () => {
  const p = newProject(T('rpi4'));
  p.modules.push(newModule(T('uno')), newModule(T('pico')));
  p.links = numberLinks(autoLinks(p));
  const size = cards(p), ids = p.modules.map((m) => m.id);
  it('keeps a rail on one line when the room is wide enough for it', () => {
    const pos = rackLayout(p, [ids], size, { w: 1300, h: 674 });
    expect(new Set(ids.map((id) => pos.get(id)![1])).size).toBe(1);
  });
  it('wraps it only when that shows it bigger', () => {
    const line = rackLayout(p, [ids], size, { w: 1300, h: 674 }), pos = rackLayout(p, [ids], size);
    expect(fitZoom(boundsOf(pos, size), ROOM)).toBeGreaterThan(fitZoom(boundsOf(line, size), ROOM) * 1.03);
  });
});

describe('a dropped card and the cable badges', () => {
  const card = { w: 236, h: 200 };
  it('a card dropped on another goes to the nearest free spot; dropped in the clear, it stays', () => {
    const others = [{ x: 0, y: 0, ...card }, { x: 296, y: 0, ...card }];
    expect(freeSpot([0, 260], card, others)).toEqual([0, 260]);
    // mostly over the first card: beside it would be on the second, so under it
    expect(freeSpot([100, 50], card, others)).toEqual([100, 224]);
    const [x, y] = freeSpot([150, 20], card, others);
    expect(others.some((o) => x < o.x + o.w + 23 && x + card.w + 23 > o.x && y < o.y + o.h + 23 && y + card.h + 23 > o.y)).toBe(false);
  });

  it('a badge whose cable runs under a card sits on the cable clear of it, and badges keep off each other', () => {
    // a cable along y = 100 from x = 0 to 600, with a card over its middle
    const line = (y: number) => [{ x: 0, y }, { x: 200, y }, { x: 400, y }, { x: 600, y }];
    const over = { x: 220, y: 20, w: 160, h: 160 };
    const [a, b] = badgeSpots([line(100), line(100)], [over]);
    for (const s of [a, b]) {
      expect(s.at.x + 40 <= over.x - 4 || s.at.x - 40 >= over.x + over.w + 4).toBe(true);
      expect(s.at.y).toBeCloseTo(100);
    }
    expect(Math.abs(a.at.x - b.at.x) >= 80 || Math.abs(a.at.y - b.at.y) >= 22).toBe(true);
  });
});
