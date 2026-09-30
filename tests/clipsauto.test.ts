// Spring clips are how a holder grips its board (Auto: pins only where the edges leave no room for clips), sized by the
// board: how long a leaf, how deep a catch, how hard a push, how many. Each design is a beam sum (grip.ts) checked
// against the FEA in springfea.test.ts; here the boards themselves: Pico, Nano, ESP32, Uno, Pi Zero, Pi 4, Pi 5, Mega, a
// 16-port hub board and a big imported board, loose, docked upright and lying flat.
import { describe, it, expect, beforeAll } from 'vitest';
import { freeAll, initKernel } from '../src/cad/kernel';
import { generate } from '../src/cad/assembly';
import { layerCheck, verdict } from '../src/cad/printcheck';
import { boardMass, HOLD_SHARE, holdNeed, pushTarget, spanFor, tipFor, TOTAL_PUSH } from '../src/cad/grip';
import { TEMPLATES, edgeConn } from '../src/model/templates';
import { newProject } from '../src/model/library';
import { measure } from './collide/measure';
import type { Board, GenResult, Project } from '../src/model/types';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();

/** A bare board with `usb` USB-A sockets along its top edge, like a hub's. */
function bare(w: number, h: number, name: string, usb: number): Board {
  const b = T('blank');
  b.name = name;
  b.outline = [[0, 0], [w, 0], [w, h], [0, h]];
  b.holes = [];
  b.comps = [];
  for (let i = 0; i < usb; i++) b.comps.push(edgeConn(`J${i + 1}`, 'usb_a', 90, 12 + i * ((w - 24) / Math.max(1, usb - 1)), h, 0.6));
  return b;
}

const SET: [string, () => Board][] = [
  ['pico', () => T('pico')], ['nano', () => T('nano')], ['esp32', () => T('esp32')], ['uno', () => T('uno')], ['rpi_zero', () => T('rpi_zero')],
  ['rpi4', () => T('rpi4')], ['rpi5', () => T('rpi5')], ['mega', () => T('mega')],
  ['hub16', () => bare(220, 70, '16-port hub board', 16)], ['imported250', () => bare(250, 150, 'Big imported board', 4)],
];

type Layout = 'loose' | 'docked' | 'flat';
const LAYOUTS: Record<Layout, (p: Project) => void> = {
  loose: (p) => { p.layout = 'loose'; p.mount.kind = 'none'; },
  docked: () => {},
  flat: (p) => { p.panel.lie = 'flat'; },
};

const build = (id: string, lay: Layout): { g: GenResult; p: Project } => {
  const p = newProject(SET.find((s) => s[0] === id)![1]());
  LAYOUTS[lay](p);
  return { g: generate(p), p };
};

/** What the Check step says about the clips: how many, how long, the catch, the weight it sized for, the forces. */
function clipsOf(g: GenResult) {
  const c = g.report.checks.find((x) => /^Spring clips \(/.test(x.name));
  if (!c) return null;
  const detail = c.detail ?? '';
  const groups = [...detail.matchAll(/(\d+) × (\d+) mm (hairpin|tapered leaf)/g)].map((m) => ({ n: +m[1], L: +m[2], kind: m[3] === 'hairpin' ? 'u' : 'straight' }));
  const num = (re: RegExp) => Number(re.exec(detail)![1]);
  return {
    n: +/\((\d+)\)/.exec(c.name)![1], groups, longest: Math.max(...groups.map((x) => x.L)), mass: num(/board of about (\d+) g/), tip: num(/lip reaches ([\d.]+) mm/),
    margin: num(/([\d.]+)× under/), fatigue: num(/([\d.]+)× margin for many/), held: num(/hold a lift of (\d+) N/), need: num(/against the ([\d.]+) N/),
    press: Number(/about (\d+) N/.exec(g.report.checks.find((x) => x.name === 'Press-in force')!.value)![1]), status: c.status,
  };
}
const pinsInstead = (g: GenResult) => g.report.checks.some((c) => /^Snap pins/.test(c.name)) && !clipsOf(g);

describe('the sizes follow the board', () => {
  it('a longer leaf, a deeper catch and a harder push for a bigger and heavier board, and never more than 30 N in all', () => {
    const load = (long: number, short: number, mass: number) => ({ mass, long, short, thick: 1.6 });
    // Pico, Uno, Mega, Pi 4, a 16-port hub board, a 250 x 150 board: by size, and (Pi 4 over Mega) by weight
    const boards = [load(51, 21, 3), load(68.6, 53.3, 25), load(101.6, 53.3, 37), load(85, 56, 46), load(220, 70, 200), load(250, 150, 300)];
    const spans = boards.map(spanFor), tips = boards.map(tipFor), pushes = boards.map((l) => pushTarget(l, true, 2));
    for (let i = 1; i < boards.length; i++) {
      expect(tips[i]).toBeGreaterThanOrEqual(tips[i - 1]);
      expect(pushes[i]).toBeGreaterThanOrEqual(pushes[i - 1]);
    }
    for (const [a, b] of [[0, 1], [1, 3], [3, 2], [2, 4], [4, 5]]) expect(spans[b], `span ${b} over ${a}`).toBeGreaterThanOrEqual(spans[a]);
    expect(spans[0]).toBe(10); expect(spans[5]).toBe(16);
    expect(tips[0]).toBe(0.5); expect(tips[5]).toBeGreaterThanOrEqual(0.9); expect(tips[5]).toBeLessThanOrEqual(1);
    expect(pushes[5]).toBeGreaterThan(pushes[0]);
    // between n clips, never more than TOTAL_PUSH: a big board's many clips are softer each
    for (const n of [2, 4, 8, 12]) expect(n * pushTarget(boards[5], true, n)).toBeLessThanOrEqual(TOTAL_PUSH + 1e-9);
    expect(pushTarget(boards[5], true, 12)).toBeLessThan(pushTarget(boards[5], true, 2));
    // gentle is under half of firm
    expect(pushTarget(boards[2], false, 2)).toBeLessThan(0.5 * pushTarget(boards[2], true, 2));
  });

  it('a board weighs about what it should, and a 9 g shake asks 4 N at least', () => {
    // FR-4 1.85 g/cm3: an Uno's 68.6 x 53.3 x 1.6 mm is 10.8 g bare
    expect(boardMass(68.6 * 53.3, 1.6)).toBeCloseTo(10.8, 0);
    expect(holdNeed(10)).toBe(4);
    expect(holdNeed(200)).toBeCloseTo(17.6, 1);
  });

  it('as built: the length, catch, count and weight rise with the board (Pico to a 250 mm one), each clip inside half the strain limit, the hold 1.5 times what a shake asks', () => {
    const ids = ['pico', 'uno', 'rpi4', 'mega', 'hub16', 'imported250'];
    const got = ids.map((id) => { const r = clipsOf(build(id, 'loose').g); freeAll(); return r!; });
    expect(got.every(Boolean)).toBe(true);
    for (let i = 1; i < ids.length; i++) {
      expect(got[i].longest, `${ids[i]}: longest leaf`).toBeGreaterThanOrEqual(got[i - 1].longest);
      expect(got[i].tip, `${ids[i]}: catch`).toBeGreaterThanOrEqual(got[i - 1].tip);
      expect(got[i].n, `${ids[i]}: clips`).toBeGreaterThanOrEqual(got[i - 1].n);
    }
    // (the estimated weights, g: a Pi 4 is heavier than a Mega for its size, its connectors being big)
    const w = Object.fromEntries(ids.map((id, i) => [id, got[i].mass]));
    expect(w.pico).toBeLessThan(w.uno); expect(w.uno).toBeLessThan(w.rpi4); expect(w.uno).toBeLessThan(w.mega); expect(w.mega).toBeLessThan(w.hub16); expect(w.hub16).toBeLessThan(w.imported250);
    // small boards: hairpins in 10 mm, and a pair; the Mega, the hub and the big board: full 16 mm leaves, a clip every 130 mm or so
    expect(got[0]).toMatchObject({ n: 2, longest: 10 }); expect(got[0].groups.every((x) => x.kind === 'u')).toBe(true);
    expect(got[3].n).toBeGreaterThanOrEqual(3); expect(got[3].longest).toBe(16);
    expect(got[5].n).toBeGreaterThanOrEqual(8); expect(got[5].longest).toBe(16); expect(got[5].tip).toBeGreaterThanOrEqual(0.9);
    for (const [i, x] of got.entries()) {
      expect(x.fatigue, ids[i]).toBeGreaterThanOrEqual(1);
      expect(x.margin, ids[i]).toBeGreaterThanOrEqual(1.9);
      expect(x.held, `${ids[i]}: hold`).toBeGreaterThanOrEqual(HOLD_SHARE * x.need);
      expect(x.press, `${ids[i]}: press-in force`).toBeLessThanOrEqual(TOTAL_PUSH + 5); // (and the anti-rattle springs)
      expect(x.status, ids[i]).toBe('ok');
    }
  }, 300000);
});

describe('Auto grips with clips', () => {
  // (a stretch of edge the board is not going to tip out over: a clip on two facing edges, or three round it)
  for (const [id] of SET) for (const lay of ['loose', 'flat'] as Layout[]) it(`${id}, ${lay}`, () => {
    const { g } = build(id, lay);
    const c = clipsOf(g), pins = pinsInstead(g);
    freeAll();
    if (id === 'rpi_zero') {
      // three of its four edges are taken by plugs and a socket, and the fourth alone cannot keep it from tipping out
      expect(c).toBeNull();
      expect(pins).toBe(true);
      expect(g.report.checks.find((x) => x.name === 'Spring clips')?.detail).toMatch(/all on the same sides of the board/);
      return;
    }
    expect(c, `${id} ${lay}`).not.toBeNull();
    expect(c!.n).toBeGreaterThanOrEqual(2);
    expect(g.report.warnings.filter((w) => /Nothing clips/.test(w))).toEqual([]);
  }, 120000);

  it('docked upright: clips where the dock leaves room; snap pins, with the reason, where its spine takes the edges', () => {
    const inPins: string[] = [];
    for (const [id] of SET) {
      const { g } = build(id, 'docked');
      const c = clipsOf(g);
      if (!c) { inPins.push(`${id}: ${pinsInstead(g) ? 'pins' : 'nothing'}`); expect(g.report.checks.find((x) => x.name === 'Spring clips')?.detail ?? '', id).toMatch(/snap pins in the mounting holes hold the board instead/); }
      freeAll();
    }
    // (the Pico and the Zero are small enough that the dock takes what they have)
    expect(inPins).toEqual(['pico: pins', 'rpi_zero: pins']);
  }, 300000);

  it('Pins still means pins, and Clips still clips', () => {
    const p = newProject(T('pico')); LAYOUTS.loose(p); p.modules[0].holder.hold = 'pins';
    const a = generate(p); expect(clipsOf(a)).toBeNull(); expect(pinsInstead(a)).toBe(true); freeAll();
    const q = newProject(T('pico')); LAYOUTS.loose(q); q.modules[0].holder.hold = 'clips';
    const b = generate(q); expect(clipsOf(b)!.n).toBe(2); freeAll();
  }, 60000);

  it('a small round board gets a pair of hairpins on its opposite sides (its edge curves gently under a 10 mm leaf)', () => {
    const b = T('blank'); b.comps = []; b.name = 'Tiny round board';
    b.outline = Array.from({ length: 48 }, (_, i) => [10 + 10 * Math.cos((i / 48) * 2 * Math.PI), 10 + 10 * Math.sin((i / 48) * 2 * Math.PI)] as [number, number]);
    b.holes = b.holes.map((h, i) => ({ ...h, x: 10 + 6 * Math.cos((i * Math.PI) / 2 + 0.6), y: 10 + 6 * Math.sin((i * Math.PI) / 2 + 0.6) }));
    const p = newProject(b); LAYOUTS.loose(p);
    const g = generate(p);
    const c = clipsOf(g);
    freeAll();
    expect(c).toMatchObject({ n: 2, longest: 10 });
    expect(c!.groups.every((x) => x.kind === 'u')).toBe(true);
  }, 60000);
});

describe('hairpin holders print with no supports, standing on the bed, loose and docked flat, and touch nothing they should not', () => {
  for (const id of ['pico', 'nano', 'esp32', 'uno']) for (const lay of ['loose', 'flat'] as Layout[]) for (const style of ['frame', 'tray'] as const) it(`${id}, ${lay}, ${style}`, () => {
    const p = newProject(SET.find((s) => s[0] === id)![1]());
    LAYOUTS[lay](p);
    p.modules[0].holder.style = style;
    const g = generate(p);
    const c = clipsOf(g)!;
    expect(c.groups.some((x) => x.kind === 'u'), `${id} ${lay}: a hairpin`).toBe(true);
    const holder = g.parts.find((x) => x.tag?.kind === 'holder')!;
    const r = layerCheck(holder.mesh)!;
    freeAll();
    expect(r.islands, 'no piece in mid-air').toEqual([]);
    expect(r.cantilever?.reach ?? 0, 'the only overhang the lip ledge').toBeLessThan(1.3);
    expect(verdict(r).status).toBe('ok');
    expect(g.report.checks.find((x) => x.name === 'Clips print')?.value).toBe('no supports');
  }, 120000);

  it('no clip touches the board or its plugs: what a hairpin holder overlaps of them is what the anti-rattle springs press, a fraction of a mm3', () => {
    for (const id of ['pico', 'nano', 'esp32', 'uno', 'rpi4', 'mega']) for (const lay of ['loose', 'flat'] as Layout[]) {
      const { g, p } = build(id, lay);
      const m = measure(p, g);
      freeAll();
      expect(m.cats['holder-board'].vol, `${id} ${lay}: board`).toBeLessThan(0.5);
      expect(m.cats['holder-plug'].vol, `${id} ${lay}: plugs`).toBeLessThan(0.5);
      expect(m.cats['holder-holder'].vol, `${id} ${lay}: neighbours`).toBeLessThan(0.5);
    }
  }, 300000);
});

beforeAll(async () => { await initKernel(); });
