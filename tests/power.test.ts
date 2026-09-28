// Power and mains: Auto-connect never powers a board from a port too weak for it, nor a Pi through the hub it hosts;
// the rack keeps offering a charger or supply while power is short, and can move boards to stronger ports; a Pi 5
// wants 5 A (3 A runs it, its USB held back); plug packs go into outlets; powerboards never into one another; mains
// last in the steps; a mains load per powerboard; "Your computer" off the rack; one cable list everywhere.
import { describe, it, expect, beforeAll } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { allPlugs, autoLinks, compatible, numberLinks, PC, plugsOf, portBudget, powerFeeds, powerShort, refusal, strongerPower, wiringAdvice } from '../src/model/links';
import { mainsBudget, powerBudget } from '../src/model/power';
import { hostTotal, needOf } from '../src/model/powerdata';
import { cableLines } from '../src/model/cablelist';
import { autoAssign } from '../src/cad/dockplan';
import { generatePanel } from '../src/cad/panelgen';
import { initKernel } from '../src/cad/kernel';
import type { Link, Project } from '../src/model/types';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
const rack = (ids: string[]) => { const p = newProject(T(ids[0])); for (const id of ids.slice(1)) p.modules.push(newModule(T(id))); return p; };
const byName = (p: Project, re: RegExp) => p.modules.filter((m) => re.test(m.board.name));
const other = (l: Link, id: string) => (l.a.module === id ? l.b : l.a);
const link = (a: { module: string; ref: string }, b: { module: string; ref: string }, kind: Link['kind']): Link => ({ id: `l${Math.random().toString(36).slice(2, 8)}`, a, b, kind });

describe('power from ports that give enough', () => {
  it('never puts a Pi on a port too weak for it, and keeps the offer to add a supply', () => {
    // a Pi 5 wants 5 A (runs on 3 A); a powerboard's USB-A ports give 2.4 A, a powered hub's 0.9 A
    const p = rack(['rpi5', 'rpi5', 'pb4usb', 'usb_hub7', 'rpi4']);
    p.links = numberLinks(autoLinks(p));
    expect(p.links.filter((l) => l.kind === 'power')).toEqual([]);
    expect(powerFeeds(p).filter((f) => f.weak)).toEqual([]);
    const s = powerShort(p);
    expect(s.unserved.length).toBe(3);
    expect(s.add?.id).toBe('usb_charger6'); // a Pi 4 among them: a charger with USB-C ports
    expect(wiringAdvice(p).some((a) => a.add === 'usb_charger6')).toBe(true);
    const q = rack(['rpi5', 'rpi5', 'pb4usb']);
    expect(powerShort(q).add).toEqual({ id: 'psu_pi5', count: 2 }); // only Pi 5s: their own 27 W supplies
  });

  it('never powers a Pi through the hub it hosts, and flags one that is', () => {
    const p = rack(['rpi4', 'usb_hub7', 'pico']);
    const [pi, hub] = p.modules;
    p.links = numberLinks(autoLinks(p));
    const up = p.links.find((l) => l.a.module === hub.id || l.b.module === hub.id)!;
    expect(other(up, hub.id).module).toBe(pi.id);
    expect(p.links.some((l) => l.kind === 'power' && [l.a.module, l.b.module].includes(pi.id))).toBe(false);
    // made by hand from an older rack: a loop, counted as too weak
    const hp = plugsOf(p).find((x) => x.module === hub && x.role === 'hub-down' && !p.links!.some((l) => [l.a, l.b].some((r) => r.module === hub.id && r.ref === x.ref.ref)))!;
    const pin = plugsOf(p).find((x) => x.module === pi && x.role === 'power-in')!;
    expect(refusal(p, pin, hp)).toMatch(/feed it from itself/);
    p.links = numberLinks([...p.links, link(pin.ref, hp.ref, 'power')]);
    const f = powerFeeds(p).find((x) => x.take === pin || x.take.module === pi)!;
    expect(f.loop && f.weak).toBe(true);
    expect(portBudget(p).weak.length).toBe(1);
  });

  it('moves boards to stronger ports in one go, keeping their cable numbers', () => {
    const p = rack(['rpi4', 'usb_charger']);
    const [pi, ch] = p.modules;
    const pin = plugsOf(p).find((x) => x.module === pi && x.role === 'power-in')!, weakOut = plugsOf(p).find((x) => x.module === ch && x.role === 'power-out')!;
    p.links = numberLinks([link(pin.ref, weakOut.ref, 'power')]);
    expect(portBudget(p).weak.length).toBe(1);
    expect(strongerPower(p)).toBeNull(); // nothing stronger is free yet
    expect(powerShort(p).add?.id).toBe('usb_charger6'); // the offer stays while the Pi is on a weak port
    p.modules.push(newModule(T('usb_charger6')));
    const r = strongerPower(p)!;
    expect(r.moved).toBe(1);
    const l = r.links.find((x) => x.kind === 'power')!;
    expect(l.no).toBe(p.links[0].no);
    const to = other(l, pi.id), m = p.modules.find((x) => x.id === to.module)!;
    expect(m.board.comps.find((c) => c.ref === to.ref)?.conn?.type).toBe('usb_c');
  });

  it("a Pi 5 wants 5 A: its own supply gives it, 3 A runs it with its USB held back", () => {
    const n = needOf(T('rpi5'), true);
    expect(n.peak).toBe(5);
    expect(n.min).toBe(3);
    expect(hostTotal(T('rpi5'), 5)).toBe(1.6);
    expect(hostTotal(T('rpi5'), 3)).toBe(0.6);
    const p = rack(['rpi5', 'rpi5', 'psu_pi5', 'usb_charger6']);
    p.links = numberLinks(autoLinks(p));
    const pack = byName(p, /27 W/)[0], ch = byName(p, /charger/)[0];
    const pis = byName(p, /Pi 5/);
    const on = pis.map((pi) => { const l = p.links!.find((x) => x.kind === 'power' && [x.a.module, x.b.module].includes(pi.id))!; return other(l, pi.id).module; });
    expect(on.sort()).toEqual([pack.id, ch.id].sort());
    const b = powerBudget(p);
    expect(b.find((s) => s.module === pack)!.kind).toBe('supply');
    const onCharger = b.find((s) => s.module === ch)!;
    expect(onCharger.ports).toEqual([]); // not too weak
    expect(onCharger.limited.length).toBe(1); // held back
    expect(portBudget(p).limited.length).toBe(1);
    expect(wiringAdvice(p).some((a) => a.add === 'psu_pi5' && /held to 0.6 A/.test(a.text))).toBe(true);
  });
});

describe('plug packs and powerboards', () => {
  it('plug packs go into a powerboard outlet and stay off the rails', () => {
    const p = rack(['rpi5', 'psu_pi5', 'pb4']);
    p.links = numberLinks(autoLinks(p));
    const pack = p.modules[1], pb = p.modules[2];
    const mains = p.links.find((l) => l.kind === 'mains')!;
    expect([mains.a.module, mains.b.module].sort()).toEqual([pack.id, pb.id].sort());
    expect(autoAssign(p).flatMap((m) => m.slots.map((s) => s.module))).not.toContain(pack.id);
    const cl = cableLines(p, []);
    expect(cl.comes.some((x) => /plugs straight into/.test(x))).toBe(true);
    expect(cl.comes.some((x) => /own lead/.test(x))).toBe(true);
    expect(cl.buy).toEqual([]);
  });

  it('refuse a powerboard into another, and a mains outlet onto wires, in plain words', () => {
    const p = rack(['pb4', 'pb6', 'relay4']);
    const pl = plugsOf(p);
    const lead = pl.find((x) => x.module === p.modules[0] && x.role === 'mains-in')!, outlet = pl.find((x) => x.module === p.modules[1] && x.role === 'mains-out')!;
    expect(compatible(lead.role, outlet.role)).toBe(true); // the plugs fit...
    expect(refusal(p, lead, outlet)).toMatch(/never into another powerboard/); // ...but never this way
    const wire = pl.find((x) => x.module === p.modules[2] && x.role === 'wire')!;
    expect(refusal(p, outlet, wire)).toMatch(/only takes a mains plug.*enclosure/);
    expect(autoLinks(p).filter((l) => l.kind === 'mains')).toEqual([]);
  });

  it('adds up the mains load on each powerboard against a typical rating', () => {
    const p = rack(['rpi4', 'usb_charger6', 'psu_pi5', 'pb4']);
    p.links = numberLinks(autoLinks(p));
    const [mb] = mainsBudget(p);
    expect(mb.rating).toBe(10); // an AU powerboard
    expect(mb.guessed).toBe(true);
    expect(mb.takers.length).toBe(2);
    // the charger gives about 60% of 4 × 2.4 + 2 × 3 A at 5 V, the pack 5 A: at 85% from 230 V
    expect(mb.watts).toBeGreaterThan(60);
    expect(mb.amps).toBeLessThan(1);
    expect(mb.status).toBe('ok');
  });
});

describe('your computer', () => {
  it('takes a USB device or a hub with nowhere on the rack to go, and the cable is on the list', () => {
    const p = rack(['uno', 'usb_hub7', 'jlink']);
    p.links = numberLinks(autoLinks(p));
    const toPc = p.links.filter((l) => l.a.module === PC || l.b.module === PC);
    expect(toPc.length).toBe(1); // the hub's uplink; the Uno and the J-Link go on the hub
    expect(allPlugs(p).filter((x) => x.module.id === PC).length).toBe(2); // the one in use, and a spare
    expect(portBudget(p).devices).toEqual([]);
    const cl = cableLines(p, []);
    expect(cl.buy.some((x) => /2 m USB-C to USB-A cable, to your computer/.test(x))).toBe(true);
    const q = rack(['uno']);
    q.links = numberLinks(autoLinks(q));
    expect(q.links.length).toBe(1);
    expect(q.links[0].why).toMatch(/your computer/);
  });

  it("keeps a board's own USB ports within the limit they share, and hubs with fast ports on USB 3", () => {
    const p = rack(['rpi4', 'rpi5', 'uno', 'uno', 'uno', 'uno', 'jlink']);
    p.links = numberLinks(autoLinks(p));
    for (const s of powerBudget(p).filter((x) => x.kind === 'host')) expect(s.load).toBeLessThanOrEqual(s.total + 1e-6);
    const q = rack(['rpi4', 'usb_hubc']);
    q.links = numberLinks(autoLinks(q));
    const up = q.links.find((l) => l.a.module === q.modules[1].id || l.b.module === q.modules[1].id)!;
    expect(other(up, q.modules[1].id).ref).toMatch(/^USB3/);
  });
});

describe('the cable list', () => {
  it('lists ribbons as coming with the probe and jumper wires by the wire', () => {
    const p = rack(['uno']);
    p.links = [{ id: 'a', a: { module: p.modules[0].id, ref: 'X' }, b: { module: p.modules[0].id, ref: 'Y' }, kind: 'jumper', no: 1, wires: [{ a: '1', b: '1' }, { a: '2', b: '3' }, { a: '3', b: '2' }] }, { id: 'b', a: { module: p.modules[0].id, ref: 'X' }, b: { module: p.modules[0].id, ref: 'Y' }, kind: 'debug', no: 2 }];
    const cl = cableLines(p, [{ id: 'a', a: 'A', b: 'B', kind: 'jumper', length: 120, buy: 0.2, no: 1 }, { id: 'b', a: 'A', b: 'B', kind: 'debug', length: 90, buy: 0.1, no: 2, ribbon: 200 }]);
    expect(cl.buy).toEqual(['3 × female–female jumper wire (Dupont), 20 cm (number 1)']);
    expect(cl.comes).toEqual(['#2 debug ribbon: comes with the probe (20 cm)']);
  });
});

describe('assembly', () => {
  beforeAll(async () => { await initKernel(); });
  it('puts the mains last, then a final check and the wall; a powerboard into another fails Check', () => {
    const p = rack(['rpi4', 'usb_charger6', 'pb4']);
    p.links = numberLinks(autoLinks(p));
    const r = generatePanel(p);
    const steps = [...(r.steps ?? [])].sort((a, b) => a.seq - b.seq).map((s) => s.text);
    const iMains = steps.findIndex((s) => /mains leads and plug packs into their outlets/.test(s)), iPower = steps.findIndex((s) => /Plug in the power cable/.test(s));
    expect(iMains).toBeGreaterThan(iPower);
    expect(steps[steps.length - 1]).toMatch(/^Last, the mains\. Check every screw terminal.*Switch the powerboard off, plug the Powerboard, 4 outlets into the wall/);
    expect(r.report.checks.some((c) => /Mains on/.test(c.name))).toBe(true);
    expect(r.report.checks.find((c) => c.name === 'Cable routes')?.detail ?? '').not.toMatch(/really is/);
    // a daisy chain from an older rack
    const q = rack(['pb4', 'pb6']);
    const pl = plugsOf(q);
    q.links = numberLinks([link(pl.find((x) => x.module === q.modules[0] && x.role === 'mains-in')!.ref, pl.find((x) => x.module === q.modules[1] && x.role === 'mains-out')!.ref, 'mains')]);
    const r2 = generatePanel(q);
    expect(r2.report.checks.some((c) => c.name === 'Powerboard into powerboard' && c.status === 'bad')).toBe(true);
  }, 120_000);
});
