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
