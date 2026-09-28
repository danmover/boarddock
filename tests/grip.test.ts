// How holders grip their boards: the spring sums behind the clips, the clips' geometry as printed, and a survey that
// every template (and a few odd shapes) ends up held, or says clearly why not and what to do.
import { describe, it, expect, beforeAll } from 'vitest';
import { initKernel, freeAll, K } from '../src/cad/kernel';
import { generate } from '../src/cad/assembly';
import { layerCheck, verdict } from '../src/cad/printcheck';
import { designBow, designClip, holdOf, leafMech, leafT } from '../src/cad/grip';
import { TEMPLATES, edgeConn } from '../src/model/templates';
import { MATERIALS, newProject } from '../src/model/library';
import type { Board, GenResult, Project } from '../src/model/types';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();

describe('spring sums', () => {
  it('a tapered leaf spreads the strain: less peak strain than a straight one for the same push', () => {
    const straight = leafMech({ L: 14, t0: 1.2, tMin: 1.2, h: 9, lipLen: 5 }, 2100, 0.9);
    const tapered = leafMech({ L: 14, t0: 1.2, tMin: 0.7, h: 9, lipLen: 5 }, 2100, 0.9);
    expect(tapered.eps).toBeLessThan(0.75 * straight.eps);
    // textbook check: a straight cantilever, 3 t d / (2 L^2) at the root
    const sc = 14 - 0.3 - 2.5;
    expect(straight.eps).toBeCloseTo((3 * 1.2 * 0.9) / (2 * sc * sc), 4);
    expect(leafT({ L: 14, t0: 1.2, tMin: 0.7, h: 9, lipLen: 5 }, 0)).toBeCloseTo(1.2, 6);
  });

  it('clips stay well inside the limit going in and carry nothing at rest, in every material and length', () => {
    for (const [name, mat] of Object.entries(MATERIALS)) for (const L of [10, 12, 14]) for (const firm of [false, true]) {
      const c = designClip({ L, h: 9, mat, gap: 0.3, firm });
      // full-length clips at most 60% of the limit; short ones (between plugs) 85%, where the report says ok
      expect(c.eps, `${name} L${L}`).toBeLessThanOrEqual((L >= 12 ? 0.6 : 0.85) * mat.strainAllow);
      expect(c.epsRest).toBe(0);
      expect(c.tip, `${name} L${L}: lip over the board`).toBeGreaterThanOrEqual(0.45);
      expect(c.ledge, 'the ledge is the one overhang: short').toBeLessThan(1.1);
      expect(c.push).toBeGreaterThan(0.5);
    }
    // the same feel on a low holder and a tall one (a docked board stands higher): firm about twice gentle
    for (const h of [9, 20]) {
      const g = designClip({ L: 14, h, mat: MATERIALS.PETG, gap: 0.3, firm: false }), f = designClip({ L: 14, h, mat: MATERIALS.PETG, gap: 0.3, firm: true });
      expect(f.push, `h ${h}`).toBeGreaterThan(3); expect(f.push).toBeLessThan(4.5);
      expect(g.push, `h ${h}`).toBeGreaterThan(1.3); expect(g.push).toBeLessThan(2.2);
    }
  });

  it('anti-rattle springs preload the board with a small, steady strain', () => {
    for (const L of [14, 16]) {
      const b = designBow({ L, h: 9, mat: MATERIALS.PETG, gap: 0.3, stop: 0.3 });
      expect(b.epsRest).toBeLessThan(0.002);
      expect(b.epsRestMax).toBeLessThan(0.003);
      expect(b.F).toBeGreaterThan(0.1);
    }
  });

  it('older projects keep working: fingers auto / always / off read as auto / clips / pins', () => {
    expect(holdOf({ tabs: 'auto' })).toBe('auto');
    expect(holdOf({ tabs: 'on' })).toBe('clips');
    expect(holdOf({ tabs: 'off' })).toBe('pins');
    expect(holdOf({ tabs: 'off', hold: 'both' })).toBe('both');
  });
});

// ---- boards held ----
const odd = (): { name: string; b: Board }[] => {
  const blank = () => { const b = T('blank'); b.comps = []; return b; };
  const round = blank(); round.name = 'Round board';
  round.outline = Array.from({ length: 64 }, (_, i) => [25 + 25 * Math.cos((i / 64) * 2 * Math.PI), 25 + 25 * Math.sin((i / 64) * 2 * Math.PI)] as [number, number]);
  round.holes = round.holes.map((h, i) => ({ ...h, x: 25 + 17 * Math.cos((i * Math.PI) / 2 + 0.6), y: 25 + 17 * Math.sin((i * Math.PI) / 2 + 0.6) }));
  const ell = blank(); ell.name = 'L-shaped board';
  ell.outline = [[0, 0], [60, 0], [60, 20], [25, 20], [25, 50], [0, 50]];
  ell.holes = [];
  const tiny = blank(); tiny.name = 'Tiny board';
  tiny.outline = [[0, 0], [18, 0], [18, 18], [0, 18]]; tiny.holes = [];
  const bare = blank(); bare.name = 'No holes'; bare.holes = [];
  const plugs = blank(); plugs.name = 'Plugs all round'; plugs.holes = [];
  plugs.comps = [edgeConn('J1', 'usb_c', -90, 30, 0, 0.6), edgeConn('J2', 'usb_c', 90, 30, 40, 0.6), edgeConn('J3', 'barrel', 180, 20, 0, 1.5), edgeConn('J4', 'usb_c', 0, 20, 60, 0.6)];
  return [{ name: 'round', b: round }, { name: 'L', b: ell }, { name: 'tiny', b: tiny }, { name: 'no holes', b: bare }, { name: 'plugs all round', b: plugs }];
};

function held(g: GenResult): { how: string; ok: boolean; warned: boolean } {
  const clips = g.report.checks.map((c) => /^Spring clips \((\d+)\)/.exec(c.name)).find(Boolean);
  const pins = g.report.checks.map((c) => /^Snap pins \((\d+),/.exec(c.name)).find(Boolean);
  const nc = clips ? +clips[1] : 0, np = pins ? +pins[1] : 0;
  const warned = g.report.warnings.some((w) => /Nothing clips this board in: .*(Free an edge|set two holes|Hold the board with)/.test(w));
  return { how: `${nc} clips, ${np} snap pins`, ok: nc >= 2 || np >= 2, warned };
}

describe('every board is held', () => {
  beforeAll(async () => { await initKernel(); });
  const boards = [...TEMPLATES.filter((t) => !t.accessory).map((t) => ({ name: t.id, b: t.make() })), ...odd()];
  const layouts: [string, (p: Project) => void][] = [
    ['loose frame', (p) => { p.layout = 'loose'; p.mount.kind = 'none'; }],
    ['loose tray', (p) => { p.layout = 'loose'; p.mount.kind = 'none'; p.modules[0].holder.style = 'tray'; }],
    ['docked upright', () => {}],
    ['docked lying flat', (p) => { p.panel.lie = 'flat'; }],
  ];
  for (const [lay, mk] of layouts) it(lay, () => {
    const loose: string[] = [];
    for (const { name, b } of boards) {
      const p = newProject(structuredClone(b)); mk(p);
      const g = generate(p);
      freeAll();
      const h = held(g);
      if (!h.ok && !h.warned) loose.push(`${name}: ${h.how}, no warning`);
      // the library's boards are all held; only a tiny board standing in a dock is short of edges (and says so)
      if (!h.ok && h.warned && !(name === 'tiny' && lay === 'docked upright')) loose.push(`${name}: ${h.how} (warned)`);
    }
    expect(loose).toEqual([]);
  }, 300000);

  it('clips go on opposite sides, and odd shapes get them too', () => {
    for (const { name, b } of odd()) {
      if (name === 'plugs all round') continue;
      const p = newProject(structuredClone(b)); p.layout = 'loose'; p.mount.kind = 'none';
      const g = generate(p);
      freeAll();
      const f = g.report.features!.filter((x) => x.kind === 'spring');
      expect(held(g).how, name).toMatch(/^[2-4] clips/);
      expect(f.length, name).toBeGreaterThanOrEqual(2);
    }
  }, 120000);

  it('a board with plugs on every edge gets short clips in the gaps, pins, or a clear warning', () => {
    const b = odd().find((x) => x.name === 'plugs all round')!.b;
    const p = newProject(b); p.layout = 'loose'; p.mount.kind = 'none';
    const g = generate(p);
    freeAll();
    const h = held(g);
    expect(h.ok || h.warned).toBe(true);
    // the clips go between the plugs: none of them in a plug's opening
    const springs = g.report.features!.filter((f) => f.kind === 'spring');
    const guards = g.report.features!.filter((f) => f.kind === 'cradle' || f.kind === 'guard');
    for (const s of springs) for (const q of guards) expect(s.box[3] < q.box[0] || q.box[3] < s.box[0] || s.box[4] < q.box[1] || q.box[4] < s.box[1]).toBe(true);
  }, 60000);
});

describe('clips as printed', () => {
  beforeAll(async () => { await initKernel(); });
  it('print with no supports: nothing in mid-air, the only overhang the lip ledge, slits open', () => {
    for (const id of ['blank', 'nano', 'pico']) for (const style of ['frame', 'tray'] as const) {
      const p = newProject(T(id)); p.layout = 'loose'; p.mount.kind = 'none'; p.modules[0].holder.style = style;
      const g = generate(p);
      const h = g.parts.find((x) => x.tag?.kind === 'holder')!;
      const r = layerCheck(h.mesh)!;
      freeAll();
      expect(r.islands, `${id} ${style}`).toEqual([]);
      expect(r.cantilever?.reach ?? 0, `${id} ${style}`).toBeLessThan(1.3);
      expect(verdict(r).status, `${id} ${style}`).toBe('ok');
      expect(g.report.checks.find((c) => c.name === 'Clips print')?.value).toBe('no supports');
    }
  }, 120000);

  it('each leaf stands free: a slit at least 0.5 mm all round it but its root, from the bed up', () => {
    const p = newProject(T('blank')); p.layout = 'loose'; p.mount.kind = 'none';
    const g = generate(p);
    const h = g.parts.find((x) => x.tag?.kind === 'holder')!;
    const zones = g.report.features!.filter((f) => f.kind === 'spring');
    expect(zones.length).toBeGreaterThanOrEqual(2);
    // slice the holder low down and high up: inside each spring's zone the leaf is its own piece but for its root
    const W = K();
    const mf = W.Manifold.ofMesh(new W.Mesh({ numProp: 3, vertProperties: new Float32Array(h.mesh.pos), triVerts: new Uint32Array(h.mesh.idx) }));
    const gain = (cs: any, r: number) => cs.offset(r, 'Round').offset(-r, 'Round').area() - cs.area();
    for (const z of [0.5, 1.5, 2.5]) { // (below the rim, where the leaf has neighbours on both sides)
      const cs = mf.slice(z);
      // closing the slice by just under half a 0.5 mm slit fills nothing of the slits; by a little over half of 0.6
      // mm it fills them all: so every slit is between 0.5 and 0.7 mm wide, the whole height
      expect(gain(cs, 0.24), `z ${z}`).toBeLessThan(1.5 * zones.length);
      expect(gain(cs, 0.36) - gain(cs, 0.24), `z ${z}`).toBeGreaterThan(4 * zones.length);
    }
    freeAll();
  }, 60000);
});
