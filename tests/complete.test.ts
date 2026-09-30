// "Complete this rack": what a rack lacks, and one undo step that puts it on and connects it.
import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { autoLinks, ROUTER } from '../src/model/links';
import { completeRack } from '../src/model/complete';
import { completeThisRack } from '../src/ui/linkOps';
import { loadProject, store, undo } from '../src/state';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
const rack = (ids: string[]) => { const p = newProject(T(ids[0])); for (const id of ids.slice(1)) p.modules.push(newModule(T(id))); return p; };

describe('complete this rack', () => {
  it('names a supply for each Pi, a switch for two Ethernet boards, outlets against the powerboard, and the uplink', () => {
    const p = rack(['rpi5', 'rpi4']);
    p.links = autoLinks(p);
    const g = completeRack(p);
    expect(g.map((x) => x.kind)).toEqual(['supply', 'switch', 'outlets', 'uplink']);
    expect(g[0].add).toEqual(['psu_pi5', 'psu_pi4']); // a Pi 5 wants 27 W, a Pi 4 15 W
    expect(g[1].add).toEqual(['net_switch5']);
    expect(g[2].text).toMatch(/^3 things need a mains outlet and there is no powerboard: add a 4-outlet powerboard/);
    // with a 4-outlet powerboard and only two loads, no more outlets are asked for
    const q = rack(['rpi5', 'rpi4', 'pb4']);
    q.links = autoLinks(q);
    expect(completeRack(q).some((x) => x.kind === 'outlets')).toBe(false);
    // one Pi and nothing else: a supply, nothing more
    expect(completeRack(rack(['rpi5'])).map((x) => x.kind)).toEqual(['supply']);
  });

  it('puts it all on in one undo step, and the rack is complete after it', () => {
    const p = rack(['rpi5', 'rpi4']);
    p.links = autoLinks(p);
    loadProject(p);
    const before = store.get().past.length;
    completeThisRack();
    const q = store.get().project!;
    expect(store.get().past.length).toBe(before + 1); // one step for the boards, the switch's own supply and every cable
    expect(q.modules.map((m) => m.board.name)).toEqual(expect.arrayContaining(['USB-C supply, 27 W (5 A)', 'USB-C supply, 15 W (3 A)', 'Network switch, 5 ports']));
    expect(q.modules.some((m) => /^Powerboard/.test(m.board.name))).toBe(true);
    expect((q.links ?? []).some((l) => l.a.module === ROUTER || l.b.module === ROUTER)).toBe(true); // the switch's uplink
    expect(completeRack(q)).toEqual([]);
    undo();
    expect(store.get().project!.modules.length).toBe(2);
  });
});
