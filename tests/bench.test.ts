// The debug bench and racks laid out by hand or built: probe names, one J-Link on one header, where probes go (and
// saying so), a J-Link from the library going behind its board, docks that never end up on top of each other, the
// tongue check kept in mind when docking, and What's new as the steps to take at the rack.
import { describe, it, expect, beforeAll } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { autoLinks, numberLinks } from '../src/model/links';
import { addAdapters, addProbes, companionLabel, fillWires, stackProbes } from '../src/model/probes';
import { appendDock, seatBoard, autoAssign, bestDock, dropEmptied, nearestFree, seatCompanion, seatCompanions, shorterLever, spreadOut, spreadRails, tongueStress } from '../src/cad/dockplan';
import { generatePanel } from '../src/cad/panelgen';
import { initKernel } from '../src/cad/kernel';
import { delta, snapshot } from '../src/model/built';
import { rackCount } from '../src/model/diff';
import { PALETTE } from '../src/model/palette';
import { uartPins } from '../src/model/probes';
import type { PanelReport, Project } from '../src/model/types';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
const rack = (ids: string[]) => { const p = newProject(T(ids[0])); for (const id of ids.slice(1)) p.modules.push(newModule(T(id))); return p; };

/** What Mark as built does: freeze the layout, remember what was printed. */
function build(p: Project) {
  const r = generatePanel(p), pr = r.report.panel!;
  p.panel.rails = pr.rails.map((x) => ({ id: x.id, x: x.x, y: x.y, dir: x.dir, length: x.length }));
  p.panel.mounts = pr.mounts.map((m) => ({ id: m.id, rail: m.rail, at: m.at, kind: m.kind, turn: m.turn, lever: m.leverSide > 0 ? 'pos' as const : 'neg' as const, slots: m.slots.map((s, k) => ({ module: s.module, edge: s.module ? pr.modules.find((x) => x.id === s.module && x.mount === m.id && x.slot === k)?.edge ?? s.edge : s.edge })) }));
  p.panel.auto = false;
  p.built = snapshot(p, r);
}

describe('probe names and counts', () => {
  it('names a probe after its board in full, with no cut-off', () => {
    const p = rack(['example_dual_swd']);
    const [a, b] = addProbes(p, p.modules[0].id);
    expect(a.board.name).toBe('J-Link (Dual-MCU controller J_SWD1)');
    expect(b.board.name).toBe('J-Link (Dual-MCU controller J_SWD2)');
    expect(p.modules.some((m) => m.board.name.includes('…'))).toBe(false);
    expect(companionLabel(p, a)).toBe('J-Link → J_SWD1');
    const [u] = addAdapters(p, p.modules[0].id);
    expect(u.board.name).toBe('USB-serial adapter (Dual-MCU controller J_UART)');
    // a maker's name in front is left off
    const q = rack(['uno']);
    q.modules[0].board.comps.push({ ...p.modules[0].board.comps.find((c) => c.ref === 'J_SWD1')! });
    expect(addProbes(q, q.modules[0].id)[0].board.name).toBe('J-Link (Uno R3 J_SWD1)');
  });

  it('counts probes apart from boards', () => {
    const p = rack(['example_dual_swd', 'rpi4']);
    addProbes(p, p.modules[0].id);
    expect(rackCount(p)).toBe('2 boards + 2 probes');
  });

  it('adds one J-Link to one header', () => {
    const p = rack(['example_dual_swd']);
    const one = addProbes(p, p.modules[0].id, ['J_SWD2']);
    expect(one.map((m) => m.board.name)).toEqual(['J-Link (Dual-MCU controller J_SWD2)']);
    expect(addProbes(p, p.modules[0].id, ['J_SWD2'])).toEqual([]); // that header has one now
    expect(addProbes(p, p.modules[0].id).length).toBe(1); // the other one is still free
  });

  it('gives a toolbox FTDI header its pins, so they are not a guess', () => {
    const b = T('blank'), item = PALETTE.find((x) => x.id === 'uart6')!;
    const c = item.make(b, [10, 10]).comp!;
    const u = uartPins(c)!;
    expect(u.from).toBe('set');
    expect([u.gnd.n, u.rx.n, u.tx.n]).toEqual(['1', '4', '5']);
  });
});

describe('docking', () => {
  it('works out the tongue stress the way Check does', () => {
    // 20 N on a 106 mm lever onto a 14 × 4.5 mm tongue: about 45 MPa, PETG's yield
    expect(tongueStress(106)).toBeCloseTo(44.9, 0);
  });

  it('docks a long board by an edge that keeps its tongue off its limit', () => {
    const p = rack(['mega']), m = p.modules[0];
    const o = bestDock(m, 'h', 0);
    expect(['top', 'bottom']).toContain(o.edge);
    expect(o.access.some((a) => a.ok === 'blocked')).toBe(false);
    // docked by its short edge it would be at the limit: the fix offered keeps the turn and shortens the lever
    const fix = shorterLever(m, 'h', 180, 0)!;
    expect(fix).not.toBeNull();
    expect(['top', 'bottom']).toContain(fix.edge);
  });

  it('never lays a rack out with a tongue over its limit when another way of docking holds it', async () => {
    await initKernel();
    // a Pi-sized board of your own with plugs on its long edges too: standing on its short edge its lever is ~91 mm
    // (38 MPa, over Check's limit); lying flat by a long edge it holds, with nothing blocked
    const b = T('rpi4'), eth = b.comps.find((c) => c.conn?.type === 'rj45')!;
    b.name = 'My board';
    for (const x of [20, 45, 65]) b.comps.push({ ...structuredClone(eth), id: `e${x}`, ref: `ETH${x}`, x, y: 56 - eth.l / 2 + 2.5, rot: 90, conn: { ...structuredClone(eth.conn!), angle: 90 } });
    const p = rack(['uno', 'pico']);
    p.modules.push(newModule(b));
    const r = generatePanel(p);
    expect(r.report.checks.filter((c) => /^Tongue root/.test(c.name) && c.status === 'bad')).toEqual([]);
    expect(r.report.panel!.mounts.flatMap((m) => m.slots).find((s) => s.module === p.modules[2].id)?.lie).toBe('flat');
    expect(r.report.panel!.collisions).toEqual([]);
  }, 600000);

  it('makes room along the rail when a board is laid flat to shorten its lever', async () => {
    await initKernel();
    const p = rack(['uno', 'rpi4', 'uno', 'pico', 'rpi4']);
    const pr = generatePanel(p).report.panel!;
    p.panel.rails = pr.rails.map((x) => ({ id: x.id, x: x.x, y: x.y, dir: x.dir, length: null }));
    p.panel.mounts = pr.mounts.map((m) => ({ id: m.id, rail: m.rail, at: m.at, kind: m.kind, turn: m.turn, lever: m.lever, slots: m.slots.map((s) => ({ ...s })) }));
    p.panel.auto = false;
    // the first Pi, docked by its short edge and then laid flat by its long one (the fix a board with plugs on its
    // other edges gets): lying flat, it hangs along the rail into the next dock
    const pi = p.modules[1].id, mt = p.panel.mounts.find((m) => m.slots.some((s) => s.module === pi))!, k = mt.slots.findIndex((s) => s.module === pi);
    mt.slots[k] = { module: pi, edge: 'bottom', lie: 'flat' };
    const before = generatePanel(p).report.panel!;
    expect(before.collisions.length).toBeGreaterThan(0);
    expect(spreadOut(p, before, 2).length).toBeGreaterThan(0);
    expect(generatePanel(p).report.panel!.collisions).toEqual([]);
  }, 600000);

  it('slides the next rails across when a board laid flat reaches over them', async () => {
    await initKernel();
    // small boards on three rails 83 and 110 mm apart; the Mega on the first, laid flat, reaches 73 to 168 mm across
    const p = rack(['mega', 'uno', 'pico', 'nano', 'esp32', 'pico', 'nano', 'uno']);
    p.panel.maxRail = 200;
    const pr = generatePanel(p).report.panel!;
    p.panel.rails = pr.rails.map((x) => ({ id: x.id, x: x.x, y: x.y, dir: x.dir, length: null }));
    p.panel.mounts = pr.mounts.map((m) => ({ id: m.id, rail: m.rail, at: m.at, kind: m.kind, turn: m.turn, lever: m.leverSide > 0 ? 'pos' as const : 'neg' as const, slots: m.slots.map((s) => ({ ...s })) }));
    p.panel.auto = false;
    expect(p.panel.rails.length).toBe(3);
    const railOf = (rep: PanelReport, id: string) => rep.mounts.find((m) => m.id === id)?.rail ?? rep.mounts.find((m) => m.id === rep.modules.find((q) => q.id === id)?.mount)?.rail;
    const mega = p.modules[0].id, mt = p.panel.mounts.find((m) => m.slots.some((s) => s.module === mega))!, k = mt.slots.findIndex((s) => s.module === mega);
    expect(mt.rail).toBe(p.panel.rails[0].id);
    for (const edge of ['bottom', 'right'] as const) {
      const q = structuredClone(p), y0 = q.panel.rails.map((r) => r.y);
      q.panel.mounts.find((m) => m.id === mt.id)!.slots[k] = { module: mega, edge, lie: 'flat' };
      const before = generatePanel(q).report.panel!;
      expect(before.collisions.filter((c) => railOf(before, c[0]) !== railOf(before, c[1])).length, edge).toBeGreaterThan(0);
      expect(spreadRails(q, before, 2), edge).toEqual([q.panel.rails[1].id, q.panel.rails[2].id]);
      expect(generatePanel(q).report.panel!.collisions, edge).toEqual([]);
      // the first rail stays; the ones beyond keep their gap to each other
      expect(q.panel.rails[0].y).toBe(y0[0]);
      expect(q.panel.rails[1].y).toBeLessThan(y0[1]);
      expect(q.panel.rails[2].y - q.panel.rails[1].y).toBeCloseTo(y0[2] - y0[1], 5);
    }
  }, 600000);

  it('gives probes taken off their stack a dock right beside their board', () => {
    const p = rack(['example_dual_swd', 'rpi4', 'usb_hub7', 'uno']);
    addProbes(p, p.modules[0].id);
    for (const m of p.modules) m.on = null; // taken off the stack by hand
    p.links = numberLinks([...(p.links ?? []), ...autoLinks(p)]);
    const mounts = autoAssign(p);
    const i = mounts.findIndex((mt) => mt.slots[0].module === p.modules[0].id);
    expect(mounts[i].slots[1].module).toBe(p.modules[1].id); // the first in the back slot
    expect(mounts[i + 1].slots[0].module).toBe(p.modules[2].id); // the second in the very next dock
  });
});

describe('racks laid out by hand or built', () => {
  beforeAll(async () => { await initKernel(); });

  it('says where a probe went, and when there is no slot behind its board', () => {
    const p = rack(['example_dual_swd', 'usb_hub7', 'uno']);
    p.panel.pairs = false;
    p.links = numberLinks(autoLinks(p));
    build(p);
    const home = p.panel.mounts.find((m) => m.slots.some((s) => s.module === p.modules[0].id))!;
    expect(home.slots.some((s) => !s.module)).toBe(true);
    const [pb] = addProbes(p, p.modules[0].id, ['J_SWD1']);
    expect(seatCompanion(p, pb.id)).toMatchObject({ where: 'home', mount: home.id });
    // with both slots taken, the next goes in a new dock
    const [pb2] = addProbes(p, p.modules[0].id, ['J_SWD2']);
    pb2.on = null;
    for (const s of home.slots) if (!s.module) s.module = p.modules.find((m) => m.board.name.startsWith('Arduino'))!.id;
    expect(seatCompanion(p, pb2.id).where).not.toBe('home');
  }, 120_000);

  it('moves a J-Link from the library behind the board it is cabled to, and its own dock goes', () => {
    const p = rack(['example_dual_swd', 'usb_hub7', 'uno']);
    p.panel.pairs = false;
    p.links = numberLinks(autoLinks(p));
    build(p);
    const j = newModule(T('jlink'));
    p.modules.push(j);
    appendDock(p, j.id);
    const docks = p.panel.mounts.length;
    p.links = numberLinks([...(p.links ?? []), ...autoLinks(p)]).map((l) => fillWires(p, l));
    stackProbes(p);
    expect(seatCompanions(p)).toEqual([j.id]);
    expect(p.panel.mounts.length).toBe(docks - 1);
    const r = generatePanel(p);
    const dock = r.report.panel!.mounts.find((m) => m.slots.some((s) => s.module === p.modules[0].id))!;
    expect(dock.slots.map((s) => s.module)).toContain(j.id);
    expect(r.report.warnings.filter((w) => /no room on the rails|ribbon is/.test(w))).toEqual([]);
  }, 120_000);

  it('slides a dropped dock to the nearest gap, and tidies overlaps without moving what is clear', () => {
    const rep: PanelReport = {
      rails: [{ id: 'r1', x: 0, y: 0, dir: 'h', length: 400 }],
      mounts: [
        { id: 'a', rail: 'r1', at: 50, x: 50, y: 0, foot: [20, -30, 80, 30], leverSide: 1, kind: 'dock', turn: 0, slots: [] },
        { id: 'b', rail: 'r1', at: 150, x: 150, y: 0, foot: [120, -30, 180, 30], leverSide: 1, kind: 'dock', turn: 0, slots: [] },
        { id: 'c', rail: 'r1', at: 300, x: 300, y: 0, foot: [270, -30, 330, 30], leverSide: 1, kind: 'dock', turn: 0, slots: [] },
      ],
      modules: [], unplaced: [], depth: 0, collisions: [],
    };
    // c dropped at 160, right on b: the nearest gap is just past b
    expect(nearestFree(rep, 'c', 'r1', 160)).toBeCloseTo(212, 5);
    // a clear spot stays as it is
    expect(nearestFree(rep, 'c', 'r1', 260)).toBe(260);
    const p = rack(['rpi4']);
    p.panel.auto = false;
    p.panel.rails = [{ id: 'r1', x: 0, y: 0, dir: 'h', length: 400 }];
    p.panel.mounts = [
      { id: 'a', rail: 'r1', at: 50, kind: 'dock', turn: 0, slots: [] },
      { id: 'b', rail: 'r1', at: 70, kind: 'dock', turn: 0, slots: [] },
      { id: 'c', rail: 'r1', at: 300, kind: 'dock', turn: 0, slots: [] },
    ];
    const r2 = { ...rep, mounts: rep.mounts.map((m) => (m.id === 'b' ? { ...m, at: 70, x: 70, foot: [40, -30, 100, 30] as [number, number, number, number] } : m)) };
    expect(spreadOut(p, r2, 2)).toEqual(['b']);
    expect(p.panel.mounts.find((m) => m.id === 'b')!.at).toBeCloseTo(112, 5);
    expect(p.panel.mounts.find((m) => m.id === 'c')!.at).toBe(300);
  });

  it('takes out only the docks a move left empty', () => {
    const p = rack(['rpi4', 'uno']);
    p.panel.auto = false;
    p.panel.rails = [{ id: 'r1', x: 0, y: 0, dir: 'h', length: 400 }];
    p.panel.mounts = [
      { id: 'a', rail: 'r1', at: 50, kind: 'dock', turn: 0, slots: [{ module: p.modules[0].id, edge: 'auto' }, { module: null, edge: 'auto' }] },
      { id: 'b', rail: 'r1', at: 150, kind: 'dock', turn: 0, slots: [{ module: p.modules[1].id, edge: 'auto' }, { module: null, edge: 'auto' }] },
      { id: 'e', rail: 'r1', at: 250, kind: 'dock', turn: 0, slots: [{ module: null, edge: 'auto' }, { module: null, edge: 'auto' }] },
    ];
    const before = structuredClone(p);
    // the Uno goes into the Pi's back slot
    p.panel.mounts[1].slots[0].module = null;
    p.panel.mounts[0].slots[1].module = p.modules[1].id;
    dropEmptied(p, before);
    expect(p.panel.mounts.map((m) => m.id)).toEqual(['a', 'e']); // the empty dock you added stays
  });

  it("lists what's new as steps: a new dock with its position, the board seated in it", () => {
    const p = rack(['rpi4', 'usb_hub']);
    p.links = numberLinks(autoLinks(p));
    build(p);
    const pi = newModule(T('rpi4'));
    pi.board = { ...pi.board, name: 'Raspberry Pi 4B 2' };
    p.modules.push(pi);
    appendDock(p, pi.id);
    const r = generatePanel(p);
    const d = delta(p, r)!;
    const kinds = d.plan.map((s) => s.kind);
    expect(kinds).toContain('seat');
    const seat = d.plan.find((s) => s.kind === 'seat')!;
    expect(seat.text).toMatch(/Raspberry Pi 4B 2/);
    expect(seat.parts!.some((x) => /Holder/.test(x.name))).toBe(true);
    const dock = d.plan.find((s) => s.kind === 'dock');
    if (dock) expect(dock.text).toMatch(/at \d+ mm from its start/);
    // steps come in the order you would do them
    const order = ['off', 'swap', 'cut', 'ends', 'move', 'dock', 'seat', 'print', 'cable'];
    const idx = kinds.filter((k) => k !== 'off').map((k) => order.indexOf(k));
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  }, 120_000);

  it("calls a board replaced in its place a swap in What's new", () => {
    const p = rack(['uno', 'usb_hub']);
    p.links = numberLinks(autoLinks(p));
    build(p);
    // what "Replace with…" does: the new board takes the old one's id and place
    const id = p.modules[0].id;
    p.modules[0] = { ...newModule(T('mega'), p.modules[0].holder), id };
    const d = delta(p, generatePanel(p))!;
    const swap = d.plan.find((s) => s.kind === 'swap');
    expect(swap?.text).toMatch(/Swap Arduino Uno R3 for Arduino Mega 2560/);
    expect(swap?.parts?.length).toBeGreaterThan(0);
  }, 120_000);

  it('puts a new board on a built rack into a free dock slot before a new dock, and a hub in a dock of its own', () => {
    const p = rack(['rpi4', 'uno']);
    p.panel.pairs = false;
    build(p);
    const docks = p.panel.mounts.length;
    const pi = newModule(T('rpi4'));
    p.modules.push(pi);
    const r = seatBoard(p, pi.id);
    expect(r.where).toBe('slot');
    expect(p.panel.mounts.length).toBe(docks);
    expect(p.panel.mounts.find((m) => m.id === r.mount)!.slots.some((s) => s.module === pi.id)).toBe(true);
    const hub = newModule(T('usb_hub'));
    p.modules.push(hub);
    expect(seatBoard(p, hub.id).where).toBe('new');
    expect(p.panel.mounts.length).toBe(docks + 1);
  }, 120_000);
});
