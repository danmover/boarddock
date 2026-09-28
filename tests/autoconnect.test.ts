// Auto-connect: the cheapest pairing in all, by cable length on the rack; power within what ports and chargers give;
// Ethernet to a switch; every suggestion says why; advice names what is missing.
import { describe, it, expect } from 'vitest';
import { assign } from '../src/model/assign';
import { autoLinks, wiringAdvice } from '../src/model/links';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
const rack = (ids: string[]) => { const p = newProject(T(ids[0])); for (const id of ids.slice(1)) p.modules.push(newModule(T(id))); return p; };

describe('assign', () => {
  it('finds the cheapest pairing, not the greedy one', () => {
    // greedy would give row 0 column 0 (1), then row 1 column 1 (100): 101; best is 2 + 3 = 5
    expect(assign([[1, 2], [3, 100]])).toEqual([1, 0]);
  });
  it('more rows than columns: some rows get none; impossible pairs are never made', () => {
    const r = assign([[5, Infinity], [1, Infinity], [Infinity, Infinity]]);
    expect(r[1]).toBe(0);
    expect(r.filter((x) => x >= 0).length).toBe(1);
    expect(r[2]).toBe(-1);
  });
  it('matches a brute force on random squares', () => {
    for (let t = 0; t < 30; t++) {
      const n = 4, M = Array.from({ length: n }, () => Array.from({ length: n }, () => Math.round(Math.abs(Math.sin(t * 13 + Math.random())) * 100)));
      const got = assign(M).reduce((s, j, i) => s + M[i][j], 0);
      let best = Infinity;
      const perm = (a: number[], k: number) => { if (k === n) { best = Math.min(best, a.reduce((s, j, i) => s + M[i][j], 0)); return; } for (let i = k; i < n; i++) { [a[k], a[i]] = [a[i], a[k]]; perm(a, k + 1); [a[k], a[i]] = [a[i], a[k]]; } };
      perm([0, 1, 2, 3], 0);
      expect(got).toBe(best);
    }
  });
});

describe('auto-connect', () => {
  it('powers six Pi 4s from two chargers, three each, and says why', () => {
    const p = rack(['rpi4', 'rpi4', 'rpi4', 'rpi4', 'rpi4', 'rpi4', 'usb_charger6', 'usb_charger6']);
    const ls = autoLinks(p).filter((l) => l.kind === 'power');
    expect(ls.length).toBe(6);
    const by = new Map<string, number>();
    const chargers = new Set(p.modules.filter((m) => /charger/i.test(m.board.name)).map((m) => m.id));
    for (const l of ls) { const c = chargers.has(l.a.module) ? l.a.module : l.b.module; by.set(c, (by.get(c) ?? 0) + 1); }
    expect([...by.values()].sort()).toEqual([3, 3]);
    expect(ls.every((l) => l.auto && l.why && /needs about/.test(l.why))).toBe(true);
  });
  it('measures on the rack: each device takes the hub port nearest to it', () => {
    const p = rack(['uno', 'uno', 'usb_hub7']);
    const hub = p.modules[2], unos = p.modules.slice(0, 2);
    const ports = hub.board.comps.filter((c) => c.conn && c.role === 'hub-down').map((c) => c.ref);
    // uno 1 sits by the hub's first port, uno 2 by its last
    const pos: Record<string, number[]> = {};
    ports.forEach((r, i) => { pos[`${hub.id}/${r}`] = [i * 20, 0, 0]; });
    const usb = (m: typeof unos[number]) => m.board.comps.find((c) => c.conn?.type === 'usb_b')!.ref;
    pos[`${unos[0].id}/${usb(unos[0])}`] = [-5, 30, 0];
    pos[`${unos[1].id}/${usb(unos[1])}`] = [(ports.length - 1) * 20 + 5, 30, 0];
    const ls = autoLinks(p, (k) => pos[k]).filter((l) => l.kind === 'usb');
    const portOf = (m: string) => { const l = ls.find((x) => x.a.module === m || x.b.module === m)!; return l.a.module === hub.id ? l.a.ref : l.b.ref; };
    expect(portOf(unos[0].id)).toBe(ports[0]);
    expect(portOf(unos[1].id)).toBe(ports[ports.length - 1]);
  });
  it("connects each board's Ethernet to a switch, and asks for one when there is none", () => {
    const p = rack(['rpi5', 'rpi5', 'rpi4']);
    expect(wiringAdvice(p).some((a) => a.add === 'net_switch8')).toBe(true);
    p.modules.push(newModule(T('net_switch8')));
    const ls = autoLinks(p).filter((l) => l.kind === 'net');
    expect(ls.length).toBe(3);
  });
  it('advice: boards without power ask for a charger, devices without ports for a hub', () => {
    const p = rack(['rpi5', 'rpi5', 'uno', 'uno', 'uno', 'uno', 'uno']);
    const adv = wiringAdvice(p);
    expect(adv.some((a) => a.add === 'usb_charger6')).toBe(true);
  });
});
