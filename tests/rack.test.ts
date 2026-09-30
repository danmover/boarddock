import { describe, it, expect } from 'vitest';
import { initKernel } from '../src/cad/kernel';
import { generate } from '../src/cad/assembly';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { autoLinks, plugRole, portBudget } from '../src/model/links';
import { applyBox, boxProblems, inferBox, layoutPorts, makeBox } from '../src/model/boxes';
import { bestRoute, hits, segInBox, type CableEnd, type Obstacle } from '../src/cad/cableroute';
import { delta, partSig, partsFor, snapshot } from '../src/model/built';
import { appendDock } from '../src/cad/dockplan';
import type { GenResult, Project } from '../src/model/types';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();

describe('boxes', () => {
  it('builds a hub from its spec, with a role on every port', () => {
    const b = makeBox('hub7');
    const ports = b.comps.filter((c) => c.conn);
    expect(ports.filter((c) => c.role === 'hub-down').map((c) => c.ref)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']);
    expect(ports.filter((c) => c.conn!.entry === 'top').length).toBe(7);
    expect(ports.find((c) => c.role === 'hub-up')!.ref).toBe('UP');
    expect(boxProblems(b.box!)).toEqual([]);
    for (const q of layoutPorts(b.box!)) expect(q.along).toBeGreaterThan(0);
    // fewer ports keep the first refs, so cables to them stay
    const s = structuredClone(b.box!); s.groups[0].count = 3;
    applyBox(b, s);
    expect(b.comps.filter((c) => c.role === 'hub-down').map((c) => c.ref)).toEqual(['P1', 'P2', 'P3']);
    // too many ports for a face is reported
    s.groups[0].count = 20; s.groups[0].face = 'left';
    expect(boxProblems(s).length).toBeGreaterThan(0);
  });

  it('turns a hand-made box back into a spec', () => {
    const b = makeBox('hub4');
    const m = newModule(b);
    const s = inferBox(b, (c) => plugRole(m, c));
    expect(s.groups.map((g) => `${g.count} ${g.type} ${g.face} ${g.role}`).sort()).toEqual(['1 usb_micro_b left hub-up', '4 usb_a front hub-down']);
  });

  it('counts devices waiting for a port against free ports', () => {
    const p = newProject(T('rpi4'));
    p.modules.push(newModule(T('uno')), newModule(T('pico')), newModule(T('nano')));
    let b = portBudget(p);
    expect(b.devices.length).toBe(3); // Uno, Pico, Nano USB
    expect(b.usbPorts.length).toBe(4); // the Pi's four USB-A
    p.links = autoLinks(p);
    b = portBudget(p);
    expect(b.devices.length).toBe(0);
    expect(b.usbPorts.length).toBe(1);
  });
});

describe('cable routes', () => {
  it('finds where a segment runs through a box', () => {
    expect(segInBox([0, 0, 0], [10, 0, 0], [2, -1, -1, 4, 1, 1], 0)).toEqual([0.2, 0.4]);
    expect(segInBox([0, 5, 0], [10, 5, 0], [2, -1, -1, 4, 1, 1], 0)).toBeNull();
  });

  it('steps a plug that points up off its own board before going down', () => {
    // a board standing on edge (thin in v), its plug pointing up out of its top edge
    const board: Obstacle = { box: [0, -2, 0, 80, 2, 60], label: 'the board', module: 'm1' };
    const A: CableEnd = { p: [40, 0, 75], d: [0, 0, 1], module: 'm1', plug: 'm1/J1' };
    const B: CableEnd = { p: [200, 60, 20], d: [0, -1, 0], module: 'm2', plug: 'm2/J2' };
    const ch = bestRoute(A, B, [-40, 40], -5, 2, [board], board.box, null, [])!;
    expect(ch.hits).toEqual([]);
    // straight down would have gone through it
    const straight = { pts: [A.p, [40, 0, 89], [40, 0, -5], [40, 40, -5], [200, 40, -5], [200, 46, -5], [200, 46, 20], B.p], kinds: ['exit', 'escape', 'cross', 'street', 'cross', 'escape', 'exit'] as const };
    expect(hits({ pts: straight.pts, kinds: [...straight.kinds] }, [board], [A, B], 2).length).toBe(1);
  });
});

/** Freeze a laid-out rack the way "Mark as built" does. */
function freeze(p: Project, r: GenResult) {
  const pr = r.report.panel!;
  p.panel.rails = pr.rails.map((x) => ({ id: x.id, x: x.x, y: x.y, dir: x.dir, length: x.length }));
  p.panel.mounts = pr.mounts.map((m) => ({ id: m.id, rail: m.rail, at: m.at, kind: m.kind, turn: m.turn, lever: m.leverSide > 0 ? 'pos' : 'neg', slots: m.slots.map((s, k) => ({ module: s.module, edge: s.module ? pr.modules.find((x) => x.id === s.module && x.mount === m.id && x.slot === k)?.edge ?? s.edge : s.edge })) }));
  p.panel.auto = false;
  p.built = snapshot(p, r);
}

describe('a rack you come back to', () => {
  it('assembles in steps that all have instructions', async () => {
    await initKernel();
    const p = newProject(T('rpi4'));
    p.modules.push(newModule(T('uno')), newModule(T('usb_hub')), newModule(T('usb_charger')));
    p.links = autoLinks(p);
    const r = generate(p);
    const seqs = new Set<number>();
    for (const x of [...r.parts, ...r.ghosts, ...(r.display ?? [])]) for (const a of [x.anim, ...(('anims' in x && x.anims) || [])]) {
      if (!a) continue;
      seqs.add(a.seq); if (a.show != null) seqs.add(a.show); for (const m of a.pre ?? []) seqs.add(m.seq);
    }
    const captioned = new Set((r.steps ?? []).map((s) => s.seq));
    expect([...seqs].filter((s) => !captioned.has(s))).toEqual([]);
    const text = (r.steps ?? []).sort((a, b) => a.seq - b.seq).map((s) => s.text);
    const at = (re: RegExp) => text.findIndex((t) => re.test(t));
    expect(at(/saddles/)).toBeLessThan(at(/rail shoe/));
    expect(at(/Snap the Raspberry Pi 4B into its holder/)).toBeLessThan(at(/Push the Raspberry Pi 4B holder/));
    expect(at(/Push the Raspberry Pi 4B holder/)).toBeLessThan(at(/^Plug in the/));
  });

  it('keeps every board where it is and lists only the new parts after adding one', async () => {
    await initKernel();
    const p = newProject(T('rpi4'));
    p.modules.push(newModule(T('uno')), newModule(T('pico')), newModule(T('usb_hub')));
    p.links = autoLinks(p);
    const r0 = generate(p);
    freeze(p, r0);
    const r1 = generate(p);
    expect(delta(p, r1)!.any).toBe(false);
    const before = new Map(r1.report.panel!.mounts.map((m) => [m.id, `${m.rail}@${m.at}`]));
    // a new board, added the way the app adds one to a laid-out rack
    const m = newModule(T('rpi_zero'));
    p.modules.push(m);
    appendDock(p, m.id);
    const r2 = generate(p);
    for (const mt of r2.report.panel!.mounts) if (before.has(mt.id)) expect(`${mt.rail}@${mt.at}`).toBe(before.get(mt.id));
    const d = delta(p, r2)!;
    expect(d.boards).toEqual(['Raspberry Pi Zero 2 W']);
    const names = d.parts.map((x) => x.name).join(' | ');
    expect(names).toMatch(/Holder: Raspberry Pi Zero/);
    expect(names).not.toMatch(/Holder: Raspberry Pi 4B/);
    expect(r2.report.panel!.collisions).toEqual([]);
    // the new shoe is the new dock's, not one that was already printed
    const shoe = d.parts.find((x) => /Rail shoe/.test(x.name));
    if (shoe) {
      const old = r1.parts.find((x) => /Rail shoe/.test(x.name))!;
      const was = [old.toAssembly, ...(old.instances ?? [])];
      expect(was.some((T) => Math.hypot(T[12] - shoe.toAssembly[12], T[13] - shoe.toAssembly[13]) < 1)).toBe(false);
    }
    // renaming a board does not make its cables new
    p.modules[1].board.name = 'Uno, renamed';
    expect(delta(p, generate(p))!.cables).toEqual([]);
  });

  it('puts a new board in the empty slot of a dock when it fits, so no new shoe or socket', async () => {
    await initKernel();
    const p = newProject(T('uno'));
    p.panel.pairs = false; // one board per dock, so every dock has a free back slot
    p.modules.push(newModule(T('pico')));
    const r0 = generate(p);
    freeze(p, r0);
    const n0 = r0.report.panel!.mounts.length;
    const m = newModule(T('pico'));
    p.modules.push(m);
    appendDock(p, m.id);
    const r2 = generate(p);
    const pr = r2.report.panel!;
    expect(pr.mounts.length).toBe(n0);
    expect(pr.mounts.some((mt) => mt.slots.some((s) => s.module === m.id))).toBe(true);
    expect(pr.collisions).toEqual([]);
    const names = delta(p, r2)!.parts.map((x) => x.name).join(' | ');
    expect(names).not.toMatch(/Rail shoe|Dock socket/);
  });

  it('prints just the boards you pick, with or without their docks', async () => {
    await initKernel();
    const p = newProject(T('rpi4'));
    p.modules.push(newModule(T('uno')), newModule(T('usb_hub')));
    const r = generate(p);
    const pi = p.modules[0].id;
    const only = partsFor(r, new Set([pi]), { docks: false, stands: false });
    expect(only.every((x) => x.tag?.module === pi)).toBe(true);
    expect(only.some((x) => /Holder: Raspberry Pi 4B/.test(x.name))).toBe(true);
    const withDock = partsFor(r, new Set([pi]), { docks: true, stands: false });
    const shoes = withDock.find((x) => /Rail shoe/.test(x.name));
    expect(shoes?.qty).toBe(1);
    expect(withDock.some((x) => x.tag?.kind === 'railstand')).toBe(false);
    expect(partsFor(r, new Set([pi]), { docks: false, stands: true }).some((x) => x.tag?.kind === 'railstand')).toBe(true);
  });
});

describe('fixes from review', () => {
  it('a board dropped into an empty dock slot stays on the rail, clear of the stand end blocks', async () => {
    await initKernel();
    const p = newProject(T('rpi4'));
    p.modules.push(newModule(T('uno')), newModule(T('usb_hub')));
    freeze(p, generate(p));
    for (const id of ['nano', 'relay4']) {
      if (!TEMPLATES.some((t) => t.id === id)) continue;
      const m = newModule(T(id));
      p.modules.push(m);
      appendDock(p, m.id);
      const r = generate(p);
      const w = r.report.warnings.join(' | ');
      expect(w).not.toMatch(/within \d+ mm of a rail end|hangs .* off the start|run past the end/);
      expect(r.report.panel!.collisions).toEqual([]);
    }
  });

  it('a fresh one-board rack on stands has no end-block warning', async () => {
    await initKernel();
    const r = generate(newProject(T('pico')));
    expect(r.report.warnings.join(' | ')).not.toMatch(/rail end/);
  });

  it('a part that moved without changing size still counts as changed', () => {
    const n = 5000, pos = new Float32Array(n * 3).map((_, i) => (i % 7) * 3.1), idx = new Uint32Array([0, 1, 2]);
    const moved = pos.map((v, i) => (i % 3 === 1 ? v + 5 : v));
    const pt = (q: Float32Array) => ({ name: 'Holder', size: [10, 10, 10], mesh: { pos: q, idx } } as any);
    expect(partSig(pt(pos))).not.toBe(partSig(pt(moved)));
    expect(partSig(pt(pos))).toBe(partSig(pt(pos.slice())));
  });

  it("hub ports keep their names when another group grows, so cables don't move", () => {
    const b = makeBox('hubc');
    const before = new Map(b.comps.filter((c) => c.conn).map((c) => [c.ref, c.conn!.type]));
    expect(before.get('P4')).toBe('usb_c');
    const s = structuredClone(b.box!);
    s.groups[0].count = 4; // one more USB-A
    applyBox(b, s);
    const after = new Map(b.comps.filter((c) => c.conn).map((c) => [c.ref, c.conn!.type]));
    expect(after.get('P4')).toBe('usb_c'); // the USB-C port is still P4
    expect([...after.entries()].filter(([, t]) => t === 'usb_a').length).toBe(4);
    expect(new Set(after.keys()).size).toBe(b.comps.filter((c) => c.conn).length);
  });

  it('a cable to a board that is off the rack leaves no uncaptioned step', async () => {
    await initKernel();
    const p = newProject(T('rpi4'));
    p.modules.push(newModule(T('uno')));
    p.links = autoLinks(p);
    freeze(p, generate(p));
    const uno = p.modules[1].id;
    for (const mt of p.panel.mounts) for (const sl of mt.slots) if (sl.module === uno) sl.module = null;
    const r = generate(p);
    const seqs = new Set<number>();
    for (const x of [...r.parts, ...r.ghosts, ...(r.display ?? [])]) for (const a of [x.anim, ...(('anims' in x && x.anims) || [])]) if (a) { seqs.add(a.seq); if (a.show != null) seqs.add(a.show); for (const m of a.pre ?? []) seqs.add(m.seq); }
    const captioned = new Set((r.steps ?? []).map((s) => s.seq));
    expect([...seqs].filter((s) => !captioned.has(s))).toEqual([]);
  });
});

describe('cable clashes', () => {
  it('warns only where a cable really runs into something, checked against the parts themselves', async () => {
    const { RACKS } = await import('./collide/racks');
    const { initKernel } = await import('../src/cad/kernel');
    await initKernel();
    const warns = (name: string) => generate(RACKS.find((r) => r.name === name)!.make()).report.warnings.filter((w) => /runs into/.test(w));
    // (the route check uses bounding boxes: this one was only a close shave, the cable clear of the charger's holder)
    expect(warns('rows of rails')).toEqual([]);
    // and the Mega's cable no longer goes into the Nano's plug beside it: it settles clear of a plug and its lead
    expect(warns('rails along (columns)')).toEqual([]);
  }, 300_000);
});
