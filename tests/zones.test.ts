// Mains against low-voltage: which boards count as mains, the zone round each, and the Check line when an outlet, inlet,
// mains lead or plug pack sits within 10 mm of a low-voltage board or cable. Built by hand (no holders are generated):
// the report's footprints, plug points and cable meshes are what the check reads.
import { describe, it, expect, beforeAll } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import type { GenResult, Module, Project } from '../src/model/types';
import { autoLinks, numberLinks } from '../src/model/links';
import { generatePanel } from '../src/cad/panelgen';
import { initKernel } from '../src/cad/kernel';
import { addMainsZones, isMainsModule, mainsCheck, mainsZones, NEAR_MM } from '../src/model/zones';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
type Rect = [number, number, number, number];
/** Points along a straight run (a real cable's mesh has a ring of them every millimetre or so). */
const line = (x0: number, x1: number, y: number, z: number) => Array.from({ length: Math.round((x1 - x0) / 2) + 1 }, (_, i) => [x0 + 2 * i, y, z]);
const mesh = (...pts: number[][]) => ({ pos: new Float32Array(pts.flat()), idx: new Uint32Array(0) });

function rack(extra: string[] = []) {
  const p: Project = newProject(T('rpi4'));
  const pi = p.modules[0], pb = newModule(T('pb4'));
  p.modules.push(pb, ...extra.map((id) => newModule(T(id))));
  return { p, pi, pb };
}
/** A build's result with footprints for some boards, plug points, cables (kind, ends, points) and pieces of models. */
function fake(p: Project, foots: Record<string, Rect>, o: { plugs?: Record<string, number[]>; cables?: { id: string; kind: string; ends: string; pts: number[][] }[]; ghosts?: { module: string; pts: number[][] }[] } = {}): GenResult {
  return {
    parts: [],
    ghosts: [
      ...(o.cables ?? []).map((c) => ({ name: 'cable', mesh: mesh(...c.pts), color: '#000', opacity: 1, tag: { kind: 'cable', refs: [c.id] } })),
      ...(o.ghosts ?? []).map((g) => ({ name: 'pack', mesh: mesh(...g.pts), color: '#000', opacity: 1, tag: { kind: 'board', module: g.module } })),
    ],
    report: {
      warnings: [], checks: [],
      panel: { rails: [], mounts: [], modules: Object.entries(foots).map(([id, foot]) => ({ id, mount: 'd1', slot: 0, edge: 'bottom', turn: 0, foot, z1: 30, access: [] })), unplaced: [], depth: 40, collisions: [], plugs: o.plugs },
      cables: (o.cables ?? []).map((c) => ({ id: c.id, a: 'A', b: 'B', ends: c.ends, kind: c.kind, length: 100, buy: 0.5 })),
    },
  } as unknown as GenResult;
}
const PI: Rect = [0, 0, 85, 56];

describe('mains boards', () => {
  it('are the powerboards, chargers with a mains inlet and plug packs, not boards, hubs or the like', () => {
    const yes = ['pb4', 'usb_charger', 'psu_pi5'].map((id) => isMainsModule(newModule(T(id))));
    const no = ['rpi4', 'usb_hub'].map((id) => isMainsModule(newModule(T(id))));
    expect(yes).toEqual([true, true, true]);
    expect(no).toEqual([false, false]);
  });
});

describe('the mains zones and their Check line', () => {
  it('shade a mains board with a margin of NEAR_MM round its footprint, and say what is on it', () => {
    const { p, pi, pb } = rack();
    const z = mainsZones(p, fake(p, { [pi.id]: PI, [pb.id]: [120, 0, 410, 58] }));
    expect(z.zones).toHaveLength(1);
    expect(z.zones[0].module).toBe(pb.id);
    expect(z.zones[0].rect).toEqual([120 - NEAR_MM, -NEAR_MM, 410 + NEAR_MM, 58 + NEAR_MM]);
    expect(z.zones[0].what).toMatch(/outlets/);
    expect(z.zones[0].what).toMatch(/mains lead/);
  });

  it('flag an outlet within 10 mm of a low-voltage board, and clear it once it is 10 mm or more away', () => {
    const { p, pi, pb } = rack();
    const at = (x: number) => ({ [`${pb.id}/AC1`]: [x, 20, 40] });
    // an outlet's box reaches 18 mm each way from its plug point
    const near = mainsZones(p, fake(p, { [pi.id]: PI, [pb.id]: [90, 0, 380, 58] }, { plugs: at(100) }));
    expect(near.issues).toHaveLength(1);
    expect(near.issues[0].mains).toMatch(/outlet AC1/);
    expect(near.issues[0].other).toMatch(/Pi 4B/);
    expect(near.issues[0].gap).toBeLessThan(NEAR_MM);
    const exactly = mainsZones(p, fake(p, { [pi.id]: PI, [pb.id]: [90, 0, 380, 58] }, { plugs: at(85 + NEAR_MM + 18) }));
    expect(exactly.issues).toHaveLength(0);
    const far = mainsZones(p, fake(p, { [pi.id]: PI, [pb.id]: [90, 0, 380, 58] }, { plugs: at(160) }));
    expect(far.issues).toHaveLength(0);
  });

  it('flag a mains lead running within 10 mm of a low-voltage cable, but not one further off or of the same board', () => {
    const { p, pi, pb } = rack(['usb_charger']);
    const ch = p.modules[2];
    const lead = { id: 'l1', kind: 'mains', ends: `${ch.id}/AC1|${pb.id}/AC2`, pts: line(100, 140, 0, 10) };
    const foots = { [pi.id]: PI, [pb.id]: [300, 200, 590, 258] as Rect, [ch.id]: [300, 300, 390, 360] as Rect };
    const usb = (y: number, ends = `${pi.id}/USB1|${pi.id}/USB2`) => ({ id: 'u1', kind: 'usb', ends, pts: line(110, 130, y, 10) });
    const close = mainsZones(p, fake(p, foots, { cables: [lead, usb(6)] }));
    expect(close.issues.some((i) => /mains lead/.test(i.mains) && /cable/.test(i.other) && Math.round(i.gap) === 6)).toBe(true);
    expect(mainsZones(p, fake(p, foots, { cables: [lead, usb(30)] })).issues).toHaveLength(0);
    // a cable of the charger itself lies beside its own lead: that is not a clash
    expect(mainsZones(p, fake(p, foots, { cables: [lead, usb(6, `${ch.id}/USB1|${pi.id}/USB1`)] })).issues).toHaveLength(0);
  });

  it("count a plug pack's body against a low-voltage board", () => {
    const { p, pi } = rack(['psu_pi5']);
    const pack = p.modules[2];
    const z = mainsZones(p, fake(p, { [pi.id]: PI }, { ghosts: [{ module: pack.id, pts: [[90, 10, 0], [130, 40, 30]] }] }));
    expect(z.issues.map((i) => i.other)).toEqual(['the Pi 4B']);
    expect(z.issues[0].gap).toBe(5);
    expect(z.zones[0].what).toMatch(/plug pack/);
  });

  it('say the number is a design choice, in both the passing and the warning line', () => {
    const ok = mainsCheck([]), warn = mainsCheck([{ mains: 'outlet AC1 on the Powerboard', other: 'the Pi 4B', gap: 4, module: 'm1' }]);
    expect(ok.status).toBe('ok');
    expect(warn.status).toBe('warn');
    expect(warn.module).toBe('m1');
    for (const c of [ok, warn]) { expect(c.detail).toMatch(/10 mm/); expect(c.detail).toMatch(/own rule of thumb/); }
    expect(warn.detail).toMatch(/4 mm from the Pi 4B/);
  });

  it('go on the report only for a rack with mains on it, once, as a Power check with the zones beside it', () => {
    const { p, pi, pb } = rack();
    const res = fake(p, { [pi.id]: PI, [pb.id]: [120, 0, 410, 58] });
    addMainsZones(p, res);
    expect(res.report.zones).toHaveLength(1);
    expect(res.report.checks.filter((c) => c.name === 'Mains near low-voltage')).toEqual([expect.objectContaining({ group: 'Power', status: 'ok' })]);
    // no mains: nothing added
    const q: Project = newProject(T('rpi4')), plain = fake(q, { [q.modules[0].id]: PI });
    addMainsZones(q, plain);
    expect(plain.report.zones).toBeUndefined();
    expect(plain.report.checks).toEqual([]);
    // loose layout (no panel report): nothing either
    const loose = { ...res, report: { ...res.report, panel: null, checks: [] } } as unknown as GenResult;
    addMainsZones(p, loose);
    expect(loose.report.checks).toEqual([]);
  });

  it('read a stacked board from the footprint of the board it sits on', () => {
    const { p, pi, pb } = rack(['usb_hub']);
    const hat: Module = p.modules[2];
    hat.on = pi.id;
    const res = fake(p, { [pi.id]: PI, [pb.id]: [90, 0, 380, 58] }, { plugs: { [`${pb.id}/AC1`]: [100, 20, 40] } });
    // (the stacked hub has no footprint of its own, but the Pi under it does: one issue for the Pi, none extra for the hub)
    const z = mainsZones(p, res);
    expect(z.issues.filter((i) => /Pi 4B/.test(i.other))).toHaveLength(1);
    expect(z.issues.filter((i) => /hub/i.test(i.other))).toHaveLength(1);
  });
});

describe('on a real build', () => {
  beforeAll(async () => { await initKernel(); });
  it('a Pi 4, a charger and a powerboard get a zone each for the mains boards, and the Check line', () => {
    const p = newProject(T('rpi4'));
    p.modules.push(newModule(T('usb_charger')), newModule(T('pb4')));
    p.links = numberLinks(autoLinks(p));
    const res = generatePanel(p);
    addMainsZones(p, res);
    const ids = (res.report.zones ?? []).map((z) => z.module).sort();
    expect(ids).toEqual([p.modules[1].id, p.modules[2].id].sort());
    for (const z of res.report.zones!) expect(z.rect[2]).toBeGreaterThan(z.rect[0]);
    const line = res.report.checks.find((c) => c.name === 'Mains near low-voltage');
    expect(line).toBeTruthy();
    expect(line!.group).toBe('Power');
    expect(line!.detail).toMatch(/rule of thumb/);
    // the mains lead's mesh is in the same frame as the boards' footprints: it runs from the charger to the powerboard
    const lead = res.report.cables!.find((c) => c.kind === 'mains')!;
    expect(lead).toBeTruthy();
  }, 120000);
});
