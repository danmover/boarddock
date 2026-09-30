// The board cannot tip out: proved on the holders as built. A board rests on its seats and can only tip about a line
// along their edge, the side towards the middle lifting. So (1) tilt the seated board about each of 24 such lines, the
// lifting part of it only, and see how far it gets before a clip's lip or a fixed ledge is in its way; (2) the same by
// the sums on every board of the wide set, docked and lying flat too; (3) and where a fixed ledge does one side, the
// board goes in: tilted, its edge slid under the ledge, without meeting anything rigid on the way.
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { box, cyl, ext, freeAll, fromMesh, initKernel, poly, unionMF } from '../src/cad/kernel';
import { generate } from '../src/cad/assembly';
import { computeLevels } from '../src/cad/levels';
import { N_DIR, SEAT_IN, TIP_FULL, tipCover, tipFrame } from '../src/cad/grip';
import { TEMPLATES, edgeConn } from '../src/model/templates';
import { newProject } from '../src/model/library';
import { buildBoard } from '../scripts/boards-lib';
import type { Board, GenResult, Project, V2 } from '../src/model/types';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
beforeAll(async () => { await initKernel(); });

const loose = (b: Board, mk: (p: Project) => void = () => {}) => { const p = newProject(JSON.parse(JSON.stringify(b)) as Board); p.layout = 'loose'; p.mount.kind = 'none'; mk(p); return p; };

/** Rotation about the axis (a, 0) through the origin by `deg`, as a column-major 4 x 4. */
function about(a: V2, deg: number) {
  const th = (deg * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th), [x, y] = a, C1 = 1 - c;
  return [c + x * x * C1, y * x * C1, -y * s, 0, x * y * C1, c + y * y * C1, x * s, 0, y * s, -x * s, c, 0, 0, 0, 0, 1];
}

/** +1 if a positive turn about the axis `a` raises the point `p` (in from the axis), else -1. */
const lifts = (a: V2, p: V2) => { const R = about(a, 1); return R[2] * p[0] + R[6] * p[1] > 0 ? 1 : -1; };

/** The holder of a loose board as a solid, without its locating pins, and the slab of the board seated on it. */
function solids(p: Project, g: GenResult, without: (f: { refs?: string[] }) => boolean = () => false) {
  const b = p.modules[0].board, lv = computeLevels(b, p.modules[0].holder);
  let holder = fromMesh(g.parts.find((x) => x.tag?.kind === 'holder')!.mesh)!;
  const pins = b.holes.filter((h) => (h.role ?? 'mount') === 'mount' && h.use !== 'none').map((h) => cyl(h.x, h.y, lv.zb - 0.005, lv.zt + 2, h.d / 2 + 0.3));
  const gone = g.report.features!.filter((f) => f.kind === 'spring' && without(f)).map((f) => box(f.box[0], f.box[1], f.box[2] - 0.5, f.box[3], f.box[4], f.box[5] + 0.5));
  if (pins.length || gone.length) holder = holder.subtract(unionMF([...pins, ...gone]));
  return { b, lv, holder, slab: ext(poly(b.outline), lv.zb, lv.zt) };
}

/** A round board (the mounting holes kept, on a circle inside it). */
const round = (r: number): Board => {
  const b = T('blank'); b.comps = [];
  b.outline = Array.from({ length: 64 }, (_, i) => [r + r * Math.cos((i / 64) * 2 * Math.PI), r + r * Math.sin((i / 64) * 2 * Math.PI)] as V2);
  b.holes = b.holes.map((h, i) => ({ ...h, x: r + 0.68 * r * Math.cos((i * Math.PI) / 2 + 0.6), y: r + 0.68 * r * Math.sin((i * Math.PI) / 2 + 0.6) }));
  return b;
};

const BOARDS: [string, Board][] = [
  ...['pico', 'nano', 'esp32', 'uno', 'rpi_zero', 'rpi4', 'rpi5', 'mega', 'blank'].map((id) => [id, T(id)] as [string, Board]),
  ['L', (() => { const b = T('blank'); b.comps = []; b.outline = [[0, 0], [60, 0], [60, 20], [25, 20], [25, 50], [0, 50]]; b.holes = []; return b; })()],
  ['round 50', round(25)], ['round 20', round(10)],
  ['plugs all round', (() => { const b = T('blank'); b.holes = []; b.comps = [edgeConn('J1', 'usb_c', -90, 30, 0, 0.6), edgeConn('J2', 'usb_c', 90, 30, 40, 0.6), edgeConn('J3', 'barrel', 180, 20, 0, 1.5), edgeConn('J4', 'usb_c', 0, 20, 60, 0.6)]; return b; })()],
];

describe('tilting the seated board', () => {
  it('about every line along its seats\' edge, the lifting part meets a clip lip or a fixed ledge within 4 degrees (the far side of a 56 mm board 4 mm up at most)', () => {
    const worst: string[] = [];
    for (const [id, b0] of BOARDS) {
      const p = loose(b0);
      const g = generate(p);
      // (the anti-rattle springs press the board and give way: leave them out, and the pins)
      const { lv, holder, slab } = solids(p, g, (f) => !!f.refs?.includes('anti-rattle'));
      const f = tipFrame(p.modules[0].board.outline);
      expect(slab.intersect(holder).volume(), `${id}: seated, the board touches nothing`).toBeLessThan(0.05);
      for (let k = 0; k < N_DIR; k++) {
        const n = f.dirs[k], d = f.hi[k] - SEAT_IN, t: V2 = [-n[1], n[0]], o = [n[0] * d, n[1] * d], big = 400;
        const half = ext(poly([[o[0] + t[0] * big, o[1] + t[1] * big], [o[0] + t[0] * big - n[0] * big, o[1] + t[1] * big - n[1] * big], [o[0] - t[0] * big - n[0] * big, o[1] - t[1] * big - n[1] * big], [o[0] - t[0] * big, o[1] - t[1] * big]]), lv.zb - 1, lv.zt + 1);
        const lifting = slab.intersect(half);
        const way = lifts(t, [-n[0], -n[1]]); // (the way round that raises the middle of the board)
        let stop = 99;
        for (const deg of [1, 2, 3, 4, 6, 8, 12]) {
          const sg = way * deg;
          const tilted = lifting.translate([-o[0], -o[1], -lv.zb]).transform(about(t, sg) as any).translate([o[0], o[1], lv.zb]);
          if (tilted.intersect(holder).volume() > 0.002) { stop = deg; break; }
        }
        if (stop > 4) worst.push(`${id}: about the ${Math.round((k * 360) / N_DIR)} degree line it tilts ${stop} degrees`);
      }
      freeAll();
    }
    expect(worst).toEqual([]);
  }, 300000);
});

describe('the built arrangements, by the sums', () => {
  /** Every spring clip and fixed ledge of a build: where its lip grips, and the way in there. */
  const grips = (g: GenResult) => g.report.features!.filter((f) => f.kind === 'spring' && f.at && !f.refs?.includes('anti-rattle')).map((f) => ({ at: f.at!, n: f.n!, ledge: !!f.refs?.includes('ledge') }));
  const width = (b: Board, m: V2) => { const v = b.outline.map((q) => q[0] * m[0] + q[1] * m[1]); return Math.max(...v) - Math.min(...v); };

  it('every board of the wide set, loose, docked and lying flat: no side to tip out over, and a ledge only with clips well across from it', async () => {
    const boards: [string, Board][] = [...BOARDS];
    boards.push(['imported_kicad', (await buildBoard(path.resolve(__dirname, '..', 'boards', 'example-sensor-jtag'))).board!]);
    for (const t of TEMPLATES) if (!boards.some(([id]) => id === t.id) && t.make().kind !== 'box') boards.push([t.id, t.make()]);
    const lays: [string, (p: Project) => void][] = [['loose', (p) => { p.layout = 'loose'; p.mount.kind = 'none'; }], ['docked', () => {}], ['flat', (p) => { p.panel.lie = 'flat'; }]];
    const bad: string[] = [], none: string[] = [];
    let ledges = 0;
    for (const [id, b0] of boards) for (const [lay, mk] of lays) {
      const p = newProject(JSON.parse(JSON.stringify(b0)) as Board); mk(p);
      const g = generate(p);
      freeAll();
      if (g.report.warnings.some((w) => /Nothing clips/.test(w))) { none.push(`${id} ${lay}`); continue; } // (said so: below)
      if (g.report.checks.some((c) => c.name === 'Slot')) continue; // (a column's slot)
      const b = p.modules[0].board, f = tipFrame(b.outline), gs = grips(g);
      let m = 0;
      for (const x of gs) m |= tipCover(f, x.at);
      if (m !== TIP_FULL) bad.push(`${id} ${lay}: tips out towards ${Array.from({ length: N_DIR }, (_, k) => k).filter((k) => !((m >> k) & 1)).map((k) => k * 15).join(', ')} degrees`);
      const L = gs.filter((x) => x.ledge), C = gs.filter((x) => !x.ledge);
      ledges += L.length;
      if (!C.length || (C.length < 2 && !L.length)) bad.push(`${id} ${lay}: ${C.length} clips and ${L.length} ledges`);
      for (const l of L) {
        for (const l2 of L) if (l.n[0] * l2.n[0] + l.n[1] * l2.n[1] < 0.9) bad.push(`${id} ${lay}: ledges on different sides`);
        for (const c of C) if ((c.at[0] - l.at[0]) * l.n[0] + (c.at[1] - l.at[1]) * l.n[1] < 0.45 * width(b, l.n) - 0.01) bad.push(`${id} ${lay}: a clip in the near half of a ledge's board`);
      }
    }
    expect(bad).toEqual([]);
    // (the only ones with no room: a 36 x 18 adapter with the dock on one long edge and the release on the other, and a 20 mm
    // round board lying flat, the dock's ear taking half its rim)
    expect(none.sort()).toEqual(['ftdi docked', 'ftdi flat', 'round 20 flat']);
    expect(ledges).toBeGreaterThan(3); // (the Pi Zero, and the Pico and Nano in a dock, at least)
  }, 900000);
});

describe('going in under a fixed ledge', () => {
  for (const id of ['rpi_zero']) it(`${id}: tilted 6 degrees with its edge under the ledge, slid in the last 1.2 mm, then pressed flat, the board meets nothing rigid`, () => {
    const p = loose(T(id));
    const g = generate(p);
    const ledge = g.report.features!.find((f) => f.refs?.includes('ledge'))!;
    // (what gives way as the board goes in: the clips, and the anti-rattle springs; a ledge and the walls stay)
    const { lv, holder, slab } = solids(p, g, (f) => !f.refs?.includes('ledge'));
    const n = ledge.n!, t: V2 = [-n[1], n[0]], at = ledge.at!, way = lifts(t, n); // (n points into the board: the way that lifts its middle)
    // the poses: turned about the board's edge at the ledge (the axis along it, at the seat), then slid in towards the
    // ledge to 1.2, 0.8, 0.4 and 0 mm off it, then turned down about that edge to lie on the seats
    const poses: [number, number][] = [[6, 1.2], [6, 0.8], [6, 0.4], [6, 0], [4, 0], [2, 0], [1, 0], [0, 0]];
    const clear = poses.map(([deg, d]) => slab.translate([-at[0], -at[1], -lv.zb]).transform(about(t, way * deg) as any).translate([at[0] + n[0] * d, at[1] + n[1] * d, lv.zb]).intersect(holder).volume());
    // (and the poses have teeth: laid flat and slid in, the board hits the ledge)
    const flat = slab.translate([-at[0], -at[1], -lv.zb]).translate([at[0] + n[0] * 0.4, at[1] + n[1] * 0.4, lv.zb]).intersect(holder).volume();
    freeAll();
    expect(Math.max(...clear), `overlap at ${poses.map((q) => q.join('/')).join(' ')}: ${clear.map((v) => v.toFixed(3)).join(', ')}`).toBeLessThan(0.02);
    expect(flat).toBeGreaterThan(0.2);
  }, 120000);
});
