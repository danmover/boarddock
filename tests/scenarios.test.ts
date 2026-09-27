// Fixes from walking through big racks as a user would: power budget, boxes next to what they feed, what undo says,
// what changed since the rack was built, names.
import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { autoLinks, portBudget, refText } from '../src/model/links';
import { powerBudget } from '../src/model/power';
import { needOf } from '../src/model/powerdata';
import { autoAssign, byBoxes } from '../src/cad/dockplan';
import { describeChange, kindName, rackName, sameKind } from '../src/model/diff';
import { delta, seatLabels, snapshot } from '../src/model/built';
import { niceName } from '../src/import';
import { putBoards, loadProject, store, uniqueName, undo } from '../src/state';
import type { GenResult, Project } from '../src/model/types';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
const rack = (ids: string[]) => { const p = newProject(T(ids[0])); for (const id of ids.slice(1)) p.modules.push(newModule(T(id))); return p; };

describe('power budget', () => {
  it('spreads six Pi 4s over two chargers and puts them on USB-C ports first', () => {
    const p = rack(['rpi4', 'rpi4', 'rpi4', 'rpi4', 'rpi4', 'rpi4', 'usb_charger6', 'usb_charger6']);
    p.links = autoLinks(p);
    const on = (i: number) => p.links!.filter((l) => l.a.module === p.modules[i].id || l.b.module === p.modules[i].id).length;
    expect(on(6)).toBe(3);
    expect(on(7)).toBe(3);
    const srcs = powerBudget(p);
    expect(srcs.map((s) => s.kind)).toEqual(['charger', 'charger']);
    // 3 × 1.5 A on a charger that gives about 9.4 A: fine in total, but 1 of the 3 Pis is on a 2.4 A USB-A port
    for (const s of srcs) { expect(s.load).toBeCloseTo(4.5, 5); expect(s.ports.length).toBe(1); expect(s.status).toBe('warn'); }
  });

  it('flags one charger asked for far more than it gives', () => {
    const p = rack(['rpi4', 'rpi4', 'rpi4', 'rpi4', 'rpi4', 'rpi4', 'rpi4', 'rpi4', 'usb_charger']);
    p.links = autoLinks(p);
    const [s] = powerBudget(p);
    expect(s.takers.length).toBe(4); // four ports
    expect(s.load).toBeCloseTo(6, 5);
    p.modules[8].board.box!.supply = 4;
    expect(powerBudget(p)[0].status).toBe('bad');
  });

  it('adds up what hangs off a bus-powered hub against the Pi port it is on', () => {
    const p = rack(['rpi4', 'usb_hub', 'uno', 'uno', 'nano', 'pico']);
    p.links = autoLinks(p);
    const s = powerBudget(p);
    const hub = s.find((x) => x.kind === 'hub')!, host = s.find((x) => x.kind === 'host')!;
    expect(hub.load).toBeCloseTo(0.2 + 0.2 + 0.1 + 0.1, 5);
    expect(host.load).toBeCloseTo(hub.load + 0.1, 5); // the hub itself takes 0.1
    expect(host.total).toBe(1.2);
  });

  it("uses a board's own figure", () => {
    const b = T('pico');
    expect(needOf(b, false).load).toBe(0.1);
    b.draw = 0.4;
    expect(needOf(b, false).load).toBe(0.4);
  });

  it('lists boards with wires and none connected', () => {
    const p = rack(['rpi4', 'relay4', 'power_dist', 'usb_charger']);
    p.links = autoLinks(p);
    expect(portBudget(p).unwired.map((u) => u.name).sort()).toEqual(['Power distribution', 'Relay board']);
  });
});

describe('layout', () => {
  it('puts each box right after the boards it feeds', () => {
    const p = rack(['rpi4', 'rpi4', 'usb_charger', 'pico', 'pico', 'usb_hub']);
    p.links = autoLinks(p);
    const segs = byBoxes(p, p.modules.filter((m) => m.board.kind !== 'box'), p.modules.filter((m) => m.board.kind === 'box'));
    const names = segs.map((s) => [...s.boards.map((m) => m.board.name), '|', ...s.boxes.map((m) => m.board.name)].join(' '));
    // the charger goes after the two Pis; the hub (on a Pi) after the Picos it feeds
    expect(names.some((n) => /Raspberry Pi 4B.*\| USB charger/.test(n))).toBe(true);
    expect(names.some((n) => /Pico.*Pico.*\| USB hub/.test(n))).toBe(true);
    const order = autoAssign(p).map((m) => m.kind);
    expect(order.filter((k) => k === 'flat').length).toBe(2);
    expect(order.indexOf('flat')).toBeLessThan(order.lastIndexOf('dock'));
  });
});

describe('names and history', () => {
  it('numbers copies and keeps the kind', () => {
    expect(uniqueName(['Raspberry Pi 5'], 'Raspberry Pi 5')).toBe('Raspberry Pi 5 2');
    const p = rack(['rpi4', 'pico']);
    p.modules.push(newModule({ ...T('rpi4'), name: 'Raspberry Pi 4B 2' }));
    expect(kindName(p, 'Raspberry Pi 4B 2')).toBe('Raspberry Pi 4B');
    expect(kindName(p, 'Raspberry Pi 5')).toBe('Raspberry Pi 5');
    expect(sameKind(p, 'Raspberry Pi 4B').length).toBe(2);
    expect(rackName(p)).toBe('Rack, 3 boards');
    p.name = 'Lab bench';
    expect(rackName(p)).toBe('Lab bench');
  });

  it('says what an undo took back', () => {
    const p = rack(['rpi4', 'pico']);
    const q = structuredClone(p);
    q.modules.push(newModule(T('uno')));
    expect(describeChange(p, q)).toBe('added Arduino Uno R3');
    const r = structuredClone(p);
    r.modules[1].holder.color = '#ff0000';
    expect(describeChange(p, r)).toBe('holder settings of Raspberry Pi Pico');
    loadProject(p);
    putBoards([T('nano')], false, { stay: true });
    undo();
    expect(store.get().toast).toMatch(/^Undid: added Arduino Nano\./);
  });

  it('keeps a replaced board’s number and names stacked USB sockets', () => {
    const p = rack(['rpi4', 'rpi4']);
    p.modules[1].board.name = 'Raspberry Pi 4B 2';
    p.active = 1;
    loadProject(p);
    putBoards([T('rpi4')], true);
    expect(store.get().project!.modules.map((m) => m.board.name)).toEqual(['Raspberry Pi 4B', 'Raspberry Pi 4B 2']);
    expect(refText(p.modules[0], 'USB2:2')).toBe('USB2 upper');
    expect(refText(p.modules[0], 'USB2')).toBe('USB2 lower');
    expect(refText(p.modules[0], 'ETH')).toBe('ETH');
  });

  it('reads file names as names', () => {
    expect(niceName('psu_plate')).toBe('Psu plate');
    expect(niceName('lora-Edge_Cuts')).toBe('Lora');
    expect(niceName('Sensor-Node')).toBe('Sensor Node');
  });
});

describe('since the rack was built', () => {
  it('lists boards taken off and moved, and spare parts', () => {
    const p: Project = rack(['rpi4', 'pico', 'uno']);
    const part = (name: string, module: string, x: number) => ({ id: name, name, qty: 1, size: [10, 10, 10] as [number, number, number], mesh: { pos: new Float32Array([x, 0, 0, 1, 0, 0, 0, 1, 0]), idx: new Uint32Array([0, 1, 2]) }, toAssembly: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1], tag: { kind: 'holder' as const, module }, volume: 1 });
    const res = (mods: Project['modules'], seats: [string, string, number][]): GenResult => ({
      parts: mods.map((m, i) => part(`Holder: ${m.board.name}`, m.id, i)) as any, ghosts: [],
      report: {
        warnings: [], checks: [], levels: { base: 0, boardBottom: 0, boardTop: 0, wallTop: 0 }, timeMs: 0,
        panel: { rails: [{ id: 'r1', x: 0, y: 0, dir: 'h', length: 300 }], mounts: seats.map(([id, , at]) => ({ id, rail: 'r1', at, kind: 'dock', turn: 90, slots: [{ module: null, edge: 'auto' }, { module: null, edge: 'auto' }], x: 0, y: 0, foot: [0, 0, 0, 0], leverSide: 1 })) as any, modules: seats.map(([mt, mod]) => ({ id: mod, mount: mt, slot: 0, edge: 'bottom', turn: 90, foot: [0, 0, 0, 0], z1: 0, access: [] })) as any, unplaced: [], depth: 0, collisions: [] },
      } as any,
    });
    const [pi, pico, uno] = p.modules.map((m) => m.id);
    const before = res(p.modules, [['a', pi, 10], ['b', pico, 100], ['c', uno, 200]]);
    expect(seatLabels(before.report.panel).get(uno)).toBe('dock 1.3 front');
    p.built = snapshot(p, before);
    const q = structuredClone(p);
    q.modules = q.modules.filter((m) => m.id !== pico);
    const after = res(q.modules, [['a', pi, 10], ['b', uno, 100]]);
    const d = delta(q, after)!;
    expect(d.removed).toEqual(['Raspberry Pi Pico']);
    expect(d.moved).toEqual([{ name: 'Arduino Uno R3', from: 'dock 1.3 front', to: 'dock 1.2 front' }]);
    expect(d.spare.map((x) => x.name)).toContain('Holder: Raspberry Pi Pico');
    expect(d.any).toBe(true);
  });
});

describe('tipping', () => {
  it('warns about a tall board standing on one short rail, not about a Pi', async () => {
    const { initKernel } = await import('../src/cad/kernel');
    const { generate } = await import('../src/cad/assembly');
    await initKernel();
    const big = T('blank');
    big.name = 'Big board';
    big.outline = [[0, 0], [260, 0], [260, 180], [0, 180]];
    big.holes = big.holes.map((h, i) => ({ ...h, x: i % 2 ? 256 : 4, y: i < 2 ? 4 : 176 }));
    const tip = (p: Project) => generate(p).report.checks.find((c) => c.name === 'Tipping');
    const pi = tip(newProject(T('rpi4')));
    expect(pi == null || pi.status === 'info').toBe(true); // a lone Pi: at most "hold it while plugging in"
    const t = tip(newProject(big));
    expect(t?.status).toBe('warn');
    expect(t?.detail).toMatch(/Big board/);
    process.stdout.write(`TIP pi ${pi?.value ?? 'none'} big ${t?.value}\n`);
  }, 300000);
});

// a terminal block whose wire mouth sits past the board edge: its cable-tie anchor used to float clear of the rim
const MOTOR = `(kicad_pcb (version 20240108) (generator "pcbnew")
  (general (thickness 1.6))
  (title_block (title "Motor driver"))
  (gr_line (start 104 100) (end 176 100) (layer "Edge.Cuts"))
  (gr_arc (start 176 100) (mid 178.828 101.172) (end 180 104) (layer "Edge.Cuts"))
  (gr_line (start 180 104) (end 180 156) (layer "Edge.Cuts"))
  (gr_arc (start 180 156) (mid 178.828 158.828) (end 176 160) (layer "Edge.Cuts"))
  (gr_line (start 176 160) (end 104 160) (layer "Edge.Cuts"))
  (gr_arc (start 104 160) (mid 101.172 158.828) (end 100 156) (layer "Edge.Cuts"))
  (gr_line (start 100 156) (end 100 104) (layer "Edge.Cuts"))
  (gr_arc (start 100 104) (mid 101.172 101.172) (end 104 100) (layer "Edge.Cuts"))
  (footprint "MountingHole:MountingHole_3.2mm_M3" (layer "F.Cu") (at 104 104)
    (property "Reference" "H1")
    (pad "" np_thru_hole circle (at 0 0) (size 3.2 3.2) (drill 3.2) (layers "*.Cu" "*.Mask")))
  (footprint "MountingHole:MountingHole_3.2mm_M3" (layer "F.Cu") (at 176 104)
    (property "Reference" "H2")
    (pad "" np_thru_hole circle (at 0 0) (size 3.2 3.2) (drill 3.2) (layers "*.Cu" "*.Mask")))
  (footprint "MountingHole:MountingHole_3.2mm_M3" (layer "F.Cu") (at 104 156)
    (property "Reference" "H3")
    (pad "" np_thru_hole circle (at 0 0) (size 3.2 3.2) (drill 3.2) (layers "*.Cu" "*.Mask")))
  (footprint "MountingHole:MountingHole_3.2mm_M3" (layer "F.Cu") (at 176 156)
    (property "Reference" "H4")
    (pad "" np_thru_hole circle (at 0 0) (size 3.2 3.2) (drill 3.2) (layers "*.Cu" "*.Mask")))
  (footprint "Connector_BarrelJack:BarrelJack_Horizontal" (layer "F.Cu") (at 107 130 90)
    (property "Reference" "J1")
    (fp_rect (start -7.0 -4.75) (end 7.0 4.75) (layer "F.CrtYd"))
)
  (footprint "Connector_USB:USB_C_Receptacle_GCT_USB4085" (layer "F.Cu") (at 140 103.5 180)
    (property "Reference" "J2")
    (fp_rect (start -4.7 -3.9) (end 4.7 3.9) (layer "F.CrtYd"))
)
  (footprint "TerminalBlock_Phoenix:TerminalBlock_Phoenix_MKDS-1,5-4_1x04_P5.00mm_Horizontal" (layer "F.Cu") (at 175 130 90)
    (property "Reference" "J3")
    (fp_rect (start -4.0 -10.0) (end 4.0 10.0) (layer "F.CrtYd"))
    (pad "1" thru_hole rect (at 0 0) (size 2.6 2.6) (drill 1.3) (layers "*.Cu"))
)
  (footprint "Package_TO_SOT_THT:TO-220-3_Vertical" (layer "F.Cu") (at 140 140)
    (property "Reference" "U1")
    (fp_rect (start -5.25 -2.3) (end 5.25 2.3) (layer "F.CrtYd"))
)
)
`;

describe('holders come out in one piece', () => {
  it('drops nothing for an imported board or any template', async () => {
    const { initKernel } = await import('../src/cad/kernel');
    const { generate } = await import('../src/cad/assembly');
    const { importKicad } = await import('../src/import/kicad');
    await initKernel();
    const loose = (p: Project) => generate(p).report.warnings.filter((w) => /loose piece/.test(w));
    expect(loose(newProject(importKicad(MOTOR, 'motor_driver.kicad_pcb')))).toEqual([]);
    for (const t of TEMPLATES) expect([t.id, ...loose(newProject(t.make()))]).toEqual([t.id]);
  }, 600000);
});

describe('a new version of a board', () => {
  it('says what changed and keeps the choices made on the old one', async () => {
    const { compareBoards, carryOver } = await import('../src/model/revision');
    const { importKicad } = await import('../src/import/kicad');
    const v1 = importKicad(MOTOR, 'motor_driver.kicad_pcb');
    const v2 = importKicad(MOTOR.replace('(at 140 103.5 180)', '(at 142 103.5 180)').replace('(at 176 156)', '(at 176.8 156)').replace('(title "Motor driver")', '(title "Motor driver v2")'), 'motor_driver_v2.kicad_pcb');
    const ch = compareBoards(v1, v2);
    expect(ch.some((c) => /J2 moved 2 mm/.test(c))).toBe(true);
    expect(ch.some((c) => /Holes: 1 moved \(up to 0\.8 mm\)/.test(c))).toBe(true);
    expect(compareBoards(v1, v1)).toEqual([]);
    // the user switched off J1's cap and hid U1 on the old one: the new one keeps that
    v1.comps.find((c) => c.ref === 'J1')!.conn!.cap = false;
    v1.comps.find((c) => c.ref === 'U1')!.hidden = true;
    const kept = carryOver(v1, v2);
    expect(kept.comps.find((c) => c.ref === 'J1')!.conn!.cap).toBe(false);
    expect(kept.comps.find((c) => c.ref === 'U1')!.hidden).toBe(true);
  });

  it('takes the old one’s place: same id, name, dock and cables', async () => {
    const { reviseBoard } = await import('../src/state');
    const { importKicad } = await import('../src/import/kicad');
    const p = newProject(importKicad(MOTOR, 'motor_driver.kicad_pcb'));
    p.modules.push(newModule(T('usb_charger6')));
    p.links = autoLinks(p);
    loadProject(p);
    const id = store.get().project!.modules[0].id, n = store.get().project!.links!.length;
    const v2 = importKicad(MOTOR.replace('(at 140 103.5 180)', '(at 142 103.5 180)').replace('(title "Motor driver")', '(title "Motor driver v2")'), 'motor_driver_v2.kicad_pcb');
    const r = reviseBoard(id, v2)!;
    const q = store.get().project!;
    expect(q.modules[0].id).toBe(id);
    expect(q.modules[0].board.name).toBe('Motor driver');
    expect(q.links!.length).toBe(n);
    expect(r.kept).toBe(n);
    expect(q.modules[0].revision?.changes.some((c) => /J2 moved/.test(c))).toBe(true);
    expect(q.modules[0].board.comps.find((c) => c.ref === 'J2')!.x).toBeCloseTo(42, 1);
  });
});
