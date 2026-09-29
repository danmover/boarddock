// The cluster preset: which boards a cluster is, and that building one on the rack leaves every board powered and on the
// network, with the switch's own supply, in a single undo step.
import { describe, it, expect, beforeEach } from 'vitest';
import { clusterBoards, clusterCount, clusterName, clusterParts } from '../src/model/cluster';
import { plugsOf, portBudget, wiringAdvice, ROUTER } from '../src/model/links';
import { poeBudget, poeFedIds } from '../src/model/poe';
import { addCluster, completeRack } from '../src/ui/clusterOps';
import { closeProject, loadProject, store, undo } from '../src/state';
import { newProject } from '../src/model/library';
import { TEMPLATES } from '../src/model/templates';
import type { Project } from '../src/model/types';

const kinds = (p: Project) => p.modules.map((m) => m.board.name.replace(/ #\d+$/, '')).reduce<Record<string, number>>((n, k) => ({ ...n, [k]: (n[k] ?? 0) + 1 }), {});
const linksOn = (p: Project, id: string) => (p.links ?? []).filter((l) => l.a.module === id || l.b.module === id);

describe('cluster boards', () => {
  it('four Pi 4s: a small switch, one powerboard, a 15 W supply each', () => {
    const c = clusterParts({ count: 4, pi: 'rpi4', poe: false });
    expect(c.pis).toEqual(['rpi4', 'rpi4', 'rpi4', 'rpi4']);
    expect(c.powerboards).toEqual(['pb6']); // 4 supplies and the switch's: five outlets is more than a 4-way board has
    expect(c.switchId).toBe('net_switch5');
    expect(c.supplies).toEqual(Array(4).fill('psu_pi4'));
  });

  it('a Pi 5 cluster gets the 27 W supply; more than four Pis a bigger switch; too many for one powerboard, two', () => {
    expect(clusterParts({ count: 3, pi: 'rpi5', poe: false })).toMatchObject({ switchId: 'net_switch5', powerboards: ['pb4'], supplies: Array(3).fill('psu_pi5') });
    expect(clusterParts({ count: 5, pi: 'rpi4', poe: false }).switchId).toBe('net_switch8');
    expect(clusterParts({ count: 7, pi: 'rpi4', poe: false }).powerboards).toEqual(['pb6', 'pb6']); // 8 outlets
  });

  it('over PoE: a PoE switch, a PoE HAT on each Pi, no supply for them and an outlet for the switch alone', () => {
    const o = { count: 6, pi: 'rpi5' as const, poe: true };
    const c = clusterParts(o);
    expect(c).toMatchObject({ switchId: 'net_switch8poe', powerboards: ['pb4'], supplies: [] });
    const bs = clusterBoards(o);
    expect(bs).toHaveLength(6 + 1 + 1);
    expect(bs.slice(0, 6).every((b) => b.name === 'Raspberry Pi 5' && b.poe === true)).toBe(true);
    expect(bs[6].name).toMatch(/PoE/);
  });

  it('keeps the count in range and names the rack', () => {
    expect([0, -3, 4.4, 99, NaN].map(clusterCount)).toEqual([1, 1, 4, 7, 1]);
    expect(clusterName({ count: 4, pi: 'rpi4', poe: false })).toBe('4 × Pi 4 cluster');
    expect(clusterName({ count: 2, pi: 'rpi5', poe: true })).toBe('2 × Pi 5 cluster');
  });
});

describe('building a cluster on the rack', () => {
  beforeEach(() => closeProject());

  it('four Pi 4s: every Pi powered from its own supply and on the switch, the switch supplied, nothing left to ask', () => {
    addCluster({ count: 4, pi: 'rpi4', poe: false });
    const p = store.get().project!;
    expect(p.name).toBe('4 × Pi 4 cluster');
    expect(kinds(p)).toMatchObject({ 'Raspberry Pi 4B': 4, 'USB-C supply, 15 W (3 A)': 4, 'Powerboard, 6 outlets': 1, 'Network switch, 5 ports': 1 });
    // the switch's own supply came with the "add its supply" completion
    expect(p.modules.some((m) => m.board.box?.pack?.own)).toBe(true);
    const pis = p.modules.filter((m) => m.board.name.startsWith('Raspberry Pi 4B'));
    for (const m of pis) expect(linksOn(p, m.id).map((l) => l.kind).sort()).toEqual(['net', 'power']);
    expect(portBudget(p).powerIns).toHaveLength(0);
    expect(wiringAdvice(p).filter((a) => a.add)).toEqual([]);
    // every supply plugs into the powerboard, and the switch's uplink goes to your router
    const packs = p.modules.filter((m) => m.board.box?.pack);
    expect(packs).toHaveLength(5);
    for (const m of packs) expect(linksOn(p, m.id).some((l) => l.kind === 'mains')).toBe(true);
    const sw = p.modules.find((m) => m.board.name.startsWith('Network switch'))!;
    expect(linksOn(p, sw.id).some((l) => l.a.module === ROUTER || l.b.module === ROUTER)).toBe(true);
    // stays on Start, where the rack shows
    expect(store.get().step).toBe('import');
  });

  it('over PoE: one cable each, powered by the switch, within its budget, and no supply for a Pi', () => {
    addCluster({ count: 4, pi: 'rpi5', poe: true });
    const p = store.get().project!;
    const pis = p.modules.filter((m) => m.board.name.startsWith('Raspberry Pi 5'));
    expect(pis).toHaveLength(4);
    expect(poeFedIds(p)).toEqual(new Set(pis.map((m) => m.id)));
    for (const m of pis) expect(linksOn(p, m.id).map((l) => l.kind)).toEqual(['net']);
    expect(p.modules.filter((m) => m.board.box?.pack?.own)).toHaveLength(1); // the switch's supply: the only one
    expect(kinds(p)['USB-C supply, 27 W (5 A)']).toBeUndefined();
    const b = poeBudget(p)[0];
    expect(b.takers).toHaveLength(4);
    expect(b.status).toBe('ok');
    expect(portBudget(p).powerIns).toHaveLength(0);
  });

  it('is one undo step on a rack that is open, and joins it', () => {
    loadProject(newProject(TEMPLATES.find((t) => t.id === 'pico')!.make()));
    const before = store.get().project!, past = store.get().past.length;
    addCluster({ count: 2, pi: 'rpi4', poe: false });
    const after = store.get().project!;
    expect(after.modules.length).toBeGreaterThan(before.modules.length + 4);
    expect(after.modules[0].board.name).toBe('Raspberry Pi Pico');
    expect(after.name).toBeUndefined(); // a rack you had keeps its own name
    expect(store.get().past.length).toBe(past + 1);
    undo();
    expect(store.get().project!.modules.map((m) => m.id)).toEqual(before.modules.map((m) => m.id));
  });

  it('a second cluster adds to the first and the wiring stays complete', () => {
    addCluster({ count: 2, pi: 'rpi4', poe: false });
    addCluster({ count: 2, pi: 'rpi4', poe: false });
    const p = store.get().project!;
    expect(kinds(p)['Raspberry Pi 4B']).toBe(4);
    expect(portBudget(p).powerIns).toHaveLength(0);
    // every Pi on a switch, whichever
    for (const m of p.modules.filter((x) => x.board.name.startsWith('Raspberry Pi 4B'))) expect(linksOn(p, m.id).some((l) => l.kind === 'net')).toBe(true);
  });

  it('completing a rack adds nothing when nothing is asked for', () => {
    addCluster({ count: 1, pi: 'rpi4', poe: false });
    const n = store.get().project!.modules.length;
    expect(completeRack()).toBe(0);
    expect(store.get().project!.modules.length).toBe(n);
    expect(plugsOf(store.get().project!).length).toBeGreaterThan(0);
  });
});
