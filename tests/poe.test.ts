// Power over Ethernet: the PoE switch, a PoE HAT on a Pi, Auto-connect (no supply cable for a board on a PoE port, never
// more than the switch gives), the power budget, the shopping list and the BOM.
import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { autoLinks, isSwitch, numberLinks, plugsOf, portBudget, powerShort, wiringAdvice } from '../src/model/links';
import { cableLines } from '../src/model/cablelist';
import { billOfMaterials } from '../src/model/bom';
import { canFitPoe, isPoePort, isPoeSwitch, poeAdvice, poeBudget, poeFeeds, poeFedIds, poeHats, poeText, poeTotal, poeWatts, takesPoe } from '../src/model/poe';
import type { GenResult, Project } from '../src/model/types';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
/** A rack of these templates; a Pi named "Pi ... #n" keeps its number, and `hat` says which boards have a PoE HAT. */
function rack(ids: string[], hat: number[] = []): Project {
  const p = newProject(T(ids[0]));
  for (const id of ids.slice(1)) p.modules.push(newModule(T(id)));
  p.modules.forEach((m, i) => { const n = ids.slice(0, i + 1).filter((x) => x === ids[i]).length; if (n > 1) m.board.name += ` #${n}`; if (hat.includes(i)) m.board.poe = true; });
  return p;
}
const withLinks = (p: Project) => { p.links = numberLinks(autoLinks(p)); return p; };
const linksOf = (p: Project, id: string) => (p.links ?? []).filter((l) => l.a.module === id || l.b.module === id);

describe('the PoE switch', () => {
  it('is a template: eight Ethernet ports that give power, a budget and a 52 V supply of its own', () => {
    const t = TEMPLATES.find((x) => x.id === 'net_switch8poe')!;
    expect(t.accessory).toBe(true);
    const b = t.make();
    expect(isPoeSwitch(b)).toBe(true);
    expect(isSwitch(b)).toBe(true); // Auto-connect treats it as a switch
    const ports = b.comps.filter((c) => c.conn?.type === 'rj45');
    expect(ports).toHaveLength(8);
    expect(ports.every((c) => isPoePort(b, c))).toBe(true);
    expect(poeTotal(b)).toEqual({ total: 120, guessed: false });
    const dc = b.box!.groups.find((g) => g.role === 'power-in-dc')!;
    expect([dc.volts, dc.amps]).toEqual([52, 2.5]);
    // the plain switch gives nothing
    const plain = T('net_switch8');
    expect(isPoeSwitch(plain)).toBe(false);
  });

  it('a switch with no figure of its own gives about 60% of its ports at 15.4 W', () => {
    const b = T('net_switch8poe');
    delete b.box!.poe;
    expect(poeTotal(b)).toEqual({ total: Math.round(8 * 15.4 * 0.6), guessed: true });
  });

  it('only the ports of a row marked PoE give power', () => {
    const b = T('net_switch8poe');
    b.box!.groups[0].poe = false;
    expect(isPoeSwitch(b)).toBe(false);
  });
});

describe('a PoE HAT on a board', () => {
  it('can go on a board with an Ethernet port, not on a box or a board without one', () => {
    expect(canFitPoe(T('rpi4'))).toBe(true);
    expect(canFitPoe(T('rpi5'))).toBe(true);
    expect(canFitPoe(T('uno'))).toBe(false);
    expect(canFitPoe(T('net_switch8'))).toBe(false);
    const pi = T('rpi4');
    expect(takesPoe(pi)).toBe(false);
    pi.poe = true;
    expect(takesPoe(pi)).toBe(true);
    const uno = T('uno');
    uno.poe = true;
    expect(takesPoe(uno)).toBe(false);
  });

  it('takes what its 5 V load is, plus what the HAT loses', () => {
    const pi4 = T('rpi4'), pi5 = T('rpi5');
    expect(poeWatts(pi4)).toBe(Math.round(((1.5 * 5) / 0.85) * 10) / 10); // 8.8 W
    expect(poeWatts(pi5)).toBe(Math.round(((2.5 * 5) / 0.85) * 10) / 10); // 14.7 W
    pi4.draw = 1;
    expect(poeWatts(pi4)).toBe(5.9); // its own figure
  });
});

describe('Auto-connect with PoE', () => {
  it('puts a board with a HAT on a PoE port and gives it no supply cable; boards without one get a supply as before', () => {
    const p = withLinks(rack(['rpi4', 'rpi4', 'rpi4', 'net_switch8poe', 'usb_charger6'], [0, 1]));
    const [a, b, c, sw] = p.modules;
    const feeds = poeFeeds(p);
    expect(feeds.map((f) => f.take.module.id).sort()).toEqual([a.id, b.id].sort());
    expect(feeds.every((f) => f.src.module.id === sw.id && isPoePort(sw.board, f.src.comp))).toBe(true);
    // the two HAT boards: an Ethernet cable and no power cable; the third: both
    for (const m of [a, b]) {
      expect(linksOf(p, m.id).map((l) => l.kind)).toEqual(['net']);
      expect(linksOf(p, m.id)[0].why).toMatch(/PoE HAT.*PoE port.*needs no supply/);
    }
    expect(linksOf(p, c.id).map((l) => l.kind).sort()).toEqual(['net', 'power']);
    expect(poeFedIds(p)).toEqual(new Set([a.id, b.id]));
  });

  it('a board with a HAT and no PoE switch is still powered from a charger, and advice asks for a switch', () => {
    const p = withLinks(rack(['rpi4', 'net_switch8', 'usb_charger6'], [0]));
    expect(poeFeeds(p)).toEqual([]);
    expect(linksOf(p, p.modules[0].id).map((l) => l.kind).sort()).toEqual(['net', 'power']);
    const adv = wiringAdvice(p).find((a) => a.add === 'net_switch8poe');
    expect(adv?.text).toMatch(/PoE HAT and there is no PoE switch in the rack/);
  });

  it('never asks a switch for more than it gives: the rest of the boards keep their supply cable', () => {
    // six Pi 5s (14.7 W each) on a switch that gives 40 W: two fit; a charger takes the others
    const p = rack(['rpi5', 'rpi5', 'rpi5', 'rpi5', 'rpi5', 'rpi5', 'net_switch8poe', 'psu_pi5', 'psu_pi5', 'psu_pi5', 'psu_pi5'], [0, 1, 2, 3, 4, 5]);
    p.modules[6].board.box!.poe = 40;
    withLinks(p);
    const fed = poeFeeds(p);
    expect(fed).toHaveLength(2);
    const load = poeBudget(p)[0];
    expect(load.load).toBeLessThanOrEqual(40);
    expect(load.status).not.toBe('bad');
    const pis = p.modules.slice(0, 6);
    const powered = (id: string) => linksOf(p, id).some((l) => l.kind === 'power');
    expect(pis.filter((m) => fed.some((f) => f.take.module.id === m.id))).toHaveLength(2);
    expect(pis.filter((m) => !poeFedIds(p).has(m.id)).every((m) => powered(m.id))).toBe(true);
    // the four left out are not put on PoE ports (they would draw from them): their Ethernet waits, and the advice says why
    const left = pis.filter((m) => !poeFedIds(p).has(m.id));
    expect(left.every((m) => !linksOf(p, m.id).some((l) => l.kind === 'net'))).toBe(true);
    expect(wiringAdvice(p).find((a) => /can power only 0 of 4: 5 PoE ports free, and 11 W to give of the 59 W they need/.test(a.text))?.add).toBe('net_switch8poe'); // (5: the switch's uplink to your router has one)
  });

  it('takes the ports nearest the boards (the cheapest pairing in all)', () => {
    const p = rack(['rpi4', 'rpi4', 'net_switch8poe'], [0, 1]);
    const sw = p.modules[2], ports = plugsOf(p).filter((x) => x.module === sw && x.role === 'net').map((x) => x.ref.ref);
    const eth = (i: number) => `${p.modules[i].id}/ETH`;
    const pos: Record<string, number[]> = { [eth(0)]: [0, 0, 0], [eth(1)]: [200, 0, 0] };
    ports.forEach((r, i) => { pos[`${sw.id}/${r}`] = [i * 30, 40, 0]; });
    const ls = autoLinks(p, (k) => pos[k]).filter((l) => l.kind === 'net');
    const portOf = (m: number) => { const l = ls.find((x) => x.a.module === p.modules[m].id || x.b.module === p.modules[m].id)!; return l.a.module === sw.id ? l.a.ref : l.b.ref; };
    expect(portOf(0)).toBe(ports[0]);
    expect(portOf(1)).toBe(ports[7]); // 200 mm along: the port at 210 is nearer than the one at 180
  });

  it('a board on a PoE port needs no supply: the port budget and the power advice leave it out', () => {
    const p = withLinks(rack(['rpi4', 'rpi4', 'net_switch8poe'], [0, 1]));
    expect(portBudget(p).powerIns).toHaveLength(0);
    expect(powerShort(p).unserved).toHaveLength(0);
    // without the HAT flag the same boards want a supply
    const q = rack(['rpi4', 'rpi4', 'net_switch8poe']);
    expect(portBudget(q).powerIns).toHaveLength(2);
  });

  it('a cable by hand to a plain switch, or a board with no HAT on a PoE port, is not a PoE feed', () => {
    const q = withLinks(rack(['rpi4', 'net_switch8poe']));
    expect(poeFeeds(q)).toEqual([]); // no HAT: it is on a PoE port and gets nothing
    const adv = poeAdvice(q);
    expect(adv.map((a) => a.text).join(' ')).toMatch(/Pi 4B is on a PoE port of the Network switch, 8 ports, PoE but has no PoE HAT/);
    q.modules[0].board.poe = true;
    expect(poeFeeds(q)).toHaveLength(1); // now it is
    expect(poeAdvice(q)).toEqual([]);
    const r = withLinks(rack(['rpi4', 'net_switch8'], [0]));
    expect(poeFeeds(r)).toEqual([]);
  });
});

describe('the PoE budget', () => {
  it('counts every board on the switch against what it gives', () => {
    const p = withLinks(rack(['rpi5', 'rpi5', 'rpi4', 'net_switch8poe'], [0, 1, 2]));
    const [s] = poeBudget(p);
    expect(s.takers).toHaveLength(3);
    expect(s.load).toBeCloseTo(2 * poeWatts(T('rpi5')) + poeWatts(T('rpi4')), 1);
    expect(s.total).toBe(120);
    expect(s.status).toBe('ok');
    expect(poeText(s).value).toBe(`${Math.round(s.load * 10) / 10} W of 120 W`);
  });

  it('warns near the limit, fails over it, and a board hungrier than one port gives is named', () => {
    const p = withLinks(rack(['rpi5', 'rpi5', 'net_switch8poe'], [0, 1]));
    const sw = p.modules[2];
    sw.board.box!.poe = 30;
    expect(poeBudget(p)[0].status).toBe('warn'); // 29.4 W of 30 W
    sw.board.box!.poe = 25;
    expect(poeBudget(p)[0].status).toBe('bad');
    expect(poeText(poeBudget(p)[0]).detail).toMatch(/more than it gives/);
    sw.board.box!.poe = 120;
    p.modules[0].board.draw = 6; // 6 A at 5 V: 35 W from the switch, over one PoE+ port
    const b = poeBudget(p)[0];
    expect(b.over.map((o) => o.name)).toEqual(['Raspberry Pi 5']);
    expect(b.status).toBe('warn');
    expect(poeText(b).detail).toMatch(/more than one PoE\+ port gives \(30 W\)/);
  });

  it('a rack with no PoE cable has no PoE line', () => {
    expect(poeBudget(withLinks(rack(['rpi4', 'net_switch8poe'])))).toEqual([]);
  });
});

describe('PoE on the shopping list', () => {
  const res = { parts: [], ghosts: [], report: { warnings: [], checks: [], cables: [], features: [], panel: { rails: [], mounts: [], modules: [], unplaced: [], depth: 0, collisions: [] } } } as unknown as GenResult;

  it('one PoE HAT for each board that has one, by kind, and the Ethernet lead says it carries power', () => {
    const p = withLinks(rack(['rpi4', 'rpi4', 'rpi5', 'net_switch8poe'], [0, 1, 2]));
    const hats = poeHats(p);
    expect(hats.map((h) => [h.qty, h.item])).toEqual([[2, 'PoE HAT for the Raspberry Pi 4B (802.3at, fits its 4-pin PoE header)'], [1, 'PoE HAT for the Raspberry Pi 5 (802.3at, fits its 4-pin PoE header)']]);
    const cables = poeFeeds(p).map((f) => ({ id: f.link.id, a: '', b: '', kind: 'net' as const, length: 300, buy: 0.5 }));
    const lines = cableLines(p, cables).buy;
    expect(lines.filter((x) => /RJ45 to RJ45/.test(x)).every((x) => /Cat5e or better: it carries the board's power over PoE/.test(x))).toBe(true);
    // no USB-C power cable for them
    expect(lines.some((x) => /USB-C/.test(x))).toBe(false);
    const hw = billOfMaterials(p, res).find((g) => g.head === 'Hardware')!;
    expect(hw.rows.filter((r) => /PoE HAT/.test(r.item)).map((r) => r.qty)).toEqual([2, 1]);
  });

  it('a board that is not on a PoE port keeps its plain lead', () => {
    const p = withLinks(rack(['rpi4', 'net_switch8poe']));
    const l = (p.links ?? []).find((x) => x.kind === 'net')!;
    const lines = cableLines(p, [{ id: l.id, a: '', b: '', kind: 'net', length: 300, buy: 0.5 }]).buy;
    expect(lines[0]).toMatch(/RJ45 to RJ45 cable/);
    expect(lines[0]).not.toMatch(/PoE/);
    expect(poeHats(p)).toEqual([]);
  });
});
