// Auto-connect: the cheapest pairing in all, by cable length on the rack; power within what ports and chargers give;
// Ethernet to a switch; every suggestion says why; advice names what is missing.
import { describe, it, expect } from 'vitest';
import { assign } from '../src/model/assign';
import { autoLinks, canCable, hubOffer, plugsOf, portBudget, refusal, ROUTER, toComputer, wiringAdvice } from '../src/model/links';
import { dcPack, ownSupply } from '../src/model/boxes';
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
  it('powers Pi 4s from two chargers, spread, only on ports that give them enough, and says why', () => {
    const p = rack(['rpi4', 'rpi4', 'rpi4', 'rpi4', 'rpi4', 'rpi4', 'usb_charger6', 'usb_charger6']);
    const ls = autoLinks(p).filter((l) => l.kind === 'power');
    expect(ls.length).toBe(4); // the four 3 A USB-C ports; the 2.4 A USB-A ones are too weak for a Pi 4
    const by = new Map<string, number>();
    const chargers = new Set(p.modules.filter((m) => /charger/i.test(m.board.name)).map((m) => m.id));
    for (const l of ls) { const c = chargers.has(l.a.module) ? l.a.module : l.b.module; by.set(c, (by.get(c) ?? 0) + 1); }
    expect([...by.values()].sort()).toEqual([2, 2]);
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
    // each board's Ethernet to the switch, and the switch's uplink to your router
    expect(ls.filter((l) => ![l.a.module, l.b.module].includes(ROUTER)).length).toBe(3);
    expect(ls.filter((l) => [l.a.module, l.b.module].includes(ROUTER)).length).toBe(1);
  });
  it('advice: boards without power ask for a charger (a Pi 5 its own 27 W supply)', () => {
    const p = rack(['rpi5', 'rpi5', 'uno', 'uno', 'uno', 'uno', 'uno']);
    expect(wiringAdvice(p).some((a) => a.add === 'psu_pi5' && a.count === 2)).toBe(true);
    expect(wiringAdvice(rack(['rpi4', 'rpi5'])).some((a) => a.add === 'usb_charger6')).toBe(true);
  });

  describe("a plug pack and an Arduino's DC jack (7 to 12 V)", () => {
    const jackOf = (p: ReturnType<typeof rack>, i: number) => plugsOf(p).find((x) => x.module === p.modules[i] && x.comp.conn?.type === 'barrel')!;
    const dcLinks = (p: ReturnType<typeof rack>) => autoLinks(p).filter((l) => l.kind === 'power');
    const otherEnd = (p: ReturnType<typeof rack>, l: { a: { module: string }; b: { module: string } }, id: string) => p.modules.find((m) => m.id === (l.a.module === id ? l.b.module : l.a.module))!;

    it('connects a pack whose voltage is in range, and says what the jack takes', () => {
      const p = rack(['uno', 'mega', 'dc_pack_12v', 'dc_pack_12v', 'pb4']);
      const ls = dcLinks(p);
      expect(ls.length).toBe(2);
      for (const i of [0, 1]) {
        const l = ls.find((x) => [x.a, x.b].some((e) => e.module === p.modules[i].id && e.ref === jackOf(p, i).ref.ref))!;
        expect(l.why).toMatch(/12 V lead to the .* DC jack, which takes 7 to 12 V/);
      }
    });
    it('leaves the jack alone when the pack is out of range, refuses it by hand, and offers a 9 V pack', () => {
      const p = rack(['uno']);
      p.modules.push(newModule(dcPack(24, 1)), newModule(T('pb4')));
      expect(dcLinks(p)).toEqual([]);
      const pack = plugsOf(p).find((x) => x.role === 'dc-out')!;
      expect(canCable(p, pack, jackOf(p, 0))).toBe(false);
      expect(refusal(p, pack, jackOf(p, 0))).toMatch(/puts out 24 V.*takes 7 to 12 V \(9 V is the usual pack\)/);
      const a = wiringAdvice(p).find((x) => x.add === 'dcpack:9')!;
      expect(a.text).toMatch(/^Uno R3: the DC jack takes 7 to 12 V, and the plug pack here gives 24 V\. A 9 V pack is the usual pick\.$/);
      // the 9 V pack that offer adds fits, and Auto-connect uses it
      p.modules.push(newModule(dcPack(9)));
      const ls = dcLinks(p);
      expect(ls.length).toBe(1);
      expect(otherEnd(p, ls[0], p.modules[0].id).board.name).toMatch(/9 V/);
      expect(wiringAdvice(p).some((x) => x.add === 'dcpack:9')).toBe(false);
    });
    it("takes the pack nearest the usual 9 V when two fit; a box's own pack goes to its box, never an Arduino", () => {
      const p = rack(['uno']);
      p.modules.push(newModule(T('dc_pack_12v')), newModule(dcPack(9)), newModule(T('pb4')));
      expect(otherEnd(p, dcLinks(p)[0], p.modules[0].id).board.name).toMatch(/9 V/);
      // a switch's own supply is for the switch alone
      const q = rack(['uno', 'net_switch5']);
      q.modules.push(newModule(ownSupply(q.modules[1])!), newModule(T('pb4')));
      const qs = dcLinks(q);
      expect(qs.length).toBe(1);
      expect([qs[0].a.module, qs[0].b.module]).toContain(q.modules[1].id);
      // and a pack that is left over, with a switch already served, goes to the Arduino
      const r = rack(['uno', 'net_switch5', 'dc_pack_12v', 'dc_pack_12v', 'pb4']);
      const rs = dcLinks(r);
      expect(rs.length).toBe(2);
      expect(rs.some((x) => [x.a.module, x.b.module].includes(r.modules[0].id))).toBe(true);
      expect(rs.some((x) => [x.a.module, x.b.module].includes(r.modules[1].id))).toBe(true);
    });
  });

  it('gives two boards of one kind one advice line, not two the same', () => {
    const p = rack(['relay4', 'relay4', 'net_switch5', 'net_switch5']);
    p.modules[1].board.name += ' #2'; p.modules[3].board.name += ' #2';
    const lines = wiringAdvice(p).map((a) => a.text);
    expect(lines.filter((t) => /wires you connect yourself/.test(t))).toEqual(['Relay board ×2: the X1, X2, X3, 2 more on each are for wires you connect yourself (click a pin, then the pin it goes to).']);
    expect(portBudget(p).unwired).toEqual([{ name: 'Relay board', refs: ['X1', 'X2', 'X3', '2 more'], count: 2 }]);
    // both switches want their supply: one line, one button for both
    const dc = wiringAdvice(p).filter((a) => a.add?.startsWith('own:'));
    expect(dc.length).toBe(1);
    expect(dc[0].text).toMatch(/^Network switch, 5 ports ×2: nothing on their DC inputs\. Add the supplies they came with/);
    expect(dc[0].add).toBe(`own:${p.modules[2].id},${p.modules[3].id}`);
    // one of a kind reads as it did
    expect(wiringAdvice(rack(['relay4'])).map((a) => a.text)).toContain('Relay board: its X1, X2, X3, 2 more are for wires you connect yourself (click a pin, then the pin it goes to).');
  });

  it('sizes the hub offer to the plugs without a port, and says what goes to your computer', () => {
    expect(hubOffer(1)).toEqual({ id: 'usb_hub', count: 1, ports: 4 });
    expect(hubOffer(4)).toEqual({ id: 'usb_hub', count: 1, ports: 4 });
    expect(hubOffer(7)).toEqual({ id: 'usb_hub7', count: 1, ports: 7 });
    expect(hubOffer(9)).toEqual({ id: 'usb_hub7', count: 2, ports: 7 });
    // nine Arduinos and nowhere to plug them: two 7-port hubs (not one, which left two to the computer)
    const p = rack(Array(9).fill('uno'));
    const a = wiringAdvice(p).find((x) => /no free port on the rack/.test(x.text))!;
    expect(a).toMatchObject({ add: 'usb_hub7', count: 2 });
    expect(a.text).toMatch(/^9 USB plugs have no free port on the rack: .*add 2 hubs \(14 ports, each uplink to a free port or your computer\)\.$/);
    expect(wiringAdvice(rack(Array(3).fill('uno'))).find((x) => /no free port/.test(x.text))).toMatchObject({ add: 'usb_hub', count: 1 });
    // with the two hubs on the rack every Arduino has a port on one of them; only the hubs' own uplinks leave the rack, and it says so
    for (let i = 0; i < a.count!; i++) p.modules.push(newModule(T(a.add!)));
    const ls = autoLinks(p), uno = new Set(p.modules.filter((m) => /Uno/.test(m.board.name)).map((m) => m.id));
    expect(ls.filter((l) => [l.a.module, l.b.module].includes('@pc') && [l.a.module, l.b.module].some((id) => uno.has(id)))).toEqual([]);
    const said = toComputer(p, ls);
    expect(said).toBe('2 of them go to your computer, off the rack (a 2 m cable each): Powered USB hub, Powered USB hub.');
    // one plug over what the hubs hold goes to the computer too, and is named
    const q = rack(Array(5).fill('uno'));
    q.modules.push(newModule(T('usb_hub')));
    expect(toComputer(q, autoLinks(q))).toMatch(/^2 of them go to your computer.*: (USB hub|Uno R3), (USB hub|Uno R3)\.$/);
    expect(toComputer(q, [])).toBe('');
  });
});
