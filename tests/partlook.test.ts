// How parts are drawn (src/cad/boardviz.ts) and what holders keep clear of: round connectors, a socket's bores, the
// relay board's relays, the silkscreen text, and the cards in M.2, PCIe and DIMM sockets.
import { describe, it, expect, beforeAll } from 'vitest';
import { initKernel, freeAll, box, fromMesh } from '../src/cad/kernel';
import { pictureOf } from '../src/cad/boardviz';
import { textWidth } from '../src/cad/font';
import { generate } from '../src/cad/assembly';
import { computeLevels } from '../src/cad/levels';
import { PALETTE, demoBoard } from '../src/model/palette';
import { TEMPLATES } from '../src/model/templates';
import { cardOf, holderParts } from '../src/model/cards';
import { DEFAULT_HOLDER, newProject, setLayout } from '../src/model/library';
import { stackNeed } from '../src/model/holes';
import { roundedRectLoop } from '../src/geom/poly';
import type { Board, Comp, Ghost, V2 } from '../src/model/types';

const blank = (W: number, H: number, name = ''): Board => ({ name, outline: roundedRectLoop(W, H, 1.2, 4).map(([x, y]) => [x + W / 2, y + H / 2] as V2), cutouts: [], thickness: 1.6, holes: [], comps: [], source: 'test', notes: [] });
const item = (id: string) => PALETTE.find((x) => x.id === id)!;
/** The vertices of the picture's meshes of one material inside a box (x, y) and above z. */
function verts(gs: Ghost[], mat: string, x0: number, y0: number, x1: number, y1: number, zmin = -Infinity): number[][] {
  const out: number[][] = [];
  for (const g of gs) if (g.mat === mat) for (let i = 0; i < g.mesh.pos.length; i += 3) {
    const p = g.mesh.pos;
    if (p[i] >= x0 && p[i] <= x1 && p[i + 1] >= y0 && p[i + 1] <= y1 && p[i + 2] >= zmin) out.push([p[i], p[i + 1], p[i + 2]]);
  }
  return out;
}

describe('how parts are drawn', () => {
  beforeAll(async () => { await initKernel(); });

  it('an SMA, XLR, M12 and mini-DIN are round barrels, a figure-8 socket has two round lobes', () => {
    // the mouth's end of each part: metal (black for the figure-8) vertices there lie on a circle, or on the two circles
    for (const [id, mat, lobes] of [['edge_sma', 'metal', 1], ['edge_xlr', 'metal', 1], ['edge_m12', 'metal', 1], ['edge_minidin', 'metal', 1], ['edge_iec_c7', 'black', 2]] as const) {
      const b = demoBoard(item(id)), c = b.comps[0], gs = pictureOf(b);
      const mouth = (c.conn!.angle === -90 ? c.y - c.l / 2 : 0) + 0; // (the demo plug faces the front edge, -y)
      const front = verts(gs, mat, c.x - c.w, mouth - 0.05, c.x + c.w, mouth + 0.05, b.thickness + 0.1);
      expect(front.length, id).toBeGreaterThan(20);
      // every vertex on the mouth's face lies within its half height of the axis (a square would reach the corners)
      const zc = b.thickness + c.h / 2, half = c.h / 2, d = Math.max(0, c.w / 2 - c.h / 2);
      let worst = 0;
      for (const [x, , z] of front) worst = Math.max(worst, Math.min(...(lobes === 2 ? [-d, d] : [0]).map((cx) => Math.hypot(x - c.x - cx, z - zc))));
      expect(worst, `${id} reaches ${worst.toFixed(2)} from its axis`).toBeLessThan(half + 0.01);
      // and it really goes round: vertices all round the rim, not just at the corners of a box
      const near = front.filter(([x, , z]) => Math.min(...(lobes === 2 ? [-d, d] : [0]).map((cx) => Math.hypot(x - c.x - cx, z - zc))) > half * 0.6).length;
      expect(near, id).toBeGreaterThan(24);
    }
    freeAll();
  });

  it("a socket's holes show: bores in the black, gold rings round them", () => {
    const b = blank(40, 20);
    const c: Comp = { id: 'c1', ref: 'J1', pkg: 'PinSocket_1x04_P2.54mm_Vertical', side: 'top', x: 20, y: 10, rot: 0, w: 10.16, l: 2.54, h: 8.5, kind: 'header', tht: true };
    b.comps.push(c);
    const gs = pictureOf(b), top = b.thickness + c.h;
    for (let i = 0; i < 4; i++) {
      const px = 20 + (i - 1.5) * 2.54;
      // the bore's wall in the black body, at the top face, and the gold collar round it
      const wall = verts(gs, 'black', px - 0.7, 8.7, px + 0.7, 11.3, top - 0.01).filter(([x, y]) => Math.abs(Math.hypot(x - px, y - 10) - 0.55) < 0.02);
      expect(wall.length, `pin ${i + 1} bore`).toBeGreaterThan(10);
      const ring = verts(gs, 'gold', px - 1.2, 8.3, px + 1.2, 11.7, top - 0.05).filter(([x, y]) => Math.hypot(x - px, y - 10) > 0.8);
      expect(ring.length, `pin ${i + 1} ring`).toBeGreaterThan(10);
    }
    freeAll();
  });

  it("the relay board's relays are the blue relays of the toolbox, not a metal can on a green slab", () => {
    const b = TEMPLATES.find((t) => t.id === 'relay4')!.make(), gs = pictureOf(b);
    for (const k of b.comps.filter((c) => /^K\d/.test(c.ref))) {
      const top = b.thickness + k.h;
      expect(verts(gs, 'blue', k.x - k.w / 2 - 0.1, k.y - k.l / 2 - 0.1, k.x + k.w / 2 + 0.1, k.y + k.l / 2 + 0.1, top - 0.01).length, k.ref).toBeGreaterThan(3);
      expect(verts(gs, 'metal', k.x - k.w / 2 + 1, k.y - k.l / 2 + 1, k.x + k.w / 2 - 1, k.y + k.l / 2 - 1, b.thickness + 0.5).length, `${k.ref} has no can`).toBe(0);
    }
    freeAll();
  });

  it("a header's pin names are turned 90 degrees (four letters are wider than the pitch) and keep clear of each other", () => {
    const b = blank(50, 30);
    const nets = ['GND', 'CTS', '3V3', 'RXI', 'TXO', 'DTR'];
    const c: Comp = { id: 'c1', ref: 'J_UART', pkg: 'PinHeader_1x06_P2.54mm_Vertical', side: 'top', x: 25, y: 20, rot: 0, w: 15.24, l: 2.54, h: 8.5, kind: 'header', tht: true, conn: { type: 'header', entry: 'top', angle: 0, zc: 0, plug: { w: 15.2, h: 2.54, len: 14, cable: 1.5 }, cradle: false, cap: false, guard: false, tie: true },
      pins: nets.map((net, i) => ({ n: String(i + 1), x: 25 + (i - 2.5) * 2.54, y: 20, net })) };
    b.comps.push(c);
    const gs = pictureOf(b), zt = b.thickness;
    // (the names are all under the header: nothing else printed there, the part's own label is above it)
    const under = verts(gs, 'silk', 0, 0, 50, 20 - 1.27, zt + 0.045); // (the tops of the letters, not the part's outline)
    expect(under.length).toBeGreaterThan(50);
    for (const [x] of under) expect(Math.min(...c.pins!.map((q) => Math.abs(x - q.x))), `a stroke at x = ${x.toFixed(2)}`).toBeLessThan(0.7);
    // and each name stands out along y for its width, as text turned 90 degrees does
    const ys = under.map((v) => v[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(textWidth('3V3', 0.95) - 0.1);
    freeAll();
  });

  it("the board's name keeps clear of a part's label", () => {
    // a board with one part and no room for its name between the part and the edge but by the label (which stood
    // at the part's top left corner, where the name would be put)
    const mk = (name: string) => {
      const b = blank(16, 14, name);
      b.comps.push({ id: 'c1', ref: 'U1', pkg: 'QFN-16', value: '', side: 'top', x: 8, y: 5, rot: 0, w: 10, l: 6, h: 1, kind: 'generic', tht: false });
      return b;
    };
    const lab = { x0: 2.1, x1: 2.2 + textWidth('U1', 1.4) + 0.1, y0: 9.0, y1: 9.1 + 1.4 + 0.1 };
    const count = (b: Board) => { const n = verts(pictureOf(b), 'silk', lab.x0, lab.y0, lab.x1, lab.y1, b.thickness).length; freeAll(); return n; };
    const alone = count(mk(''));
    expect(alone, 'the label is printed there').toBeGreaterThan(5);
    expect(count(mk('ZZ')), 'the name is not printed over it').toBe(alone);
  });
});

describe('the card in an M.2, PCIe or DIMM socket', () => {
  beforeAll(async () => { await initKernel(); });
  const socket = (id: string, x: number, y: number, extra: Partial<Comp> = {}): Comp => ({ ...item(id).make(blank(90, 60), [x, y]).comp!, ...extra });

  it('lies over the board for M.2, mini PCIe and SO-DIMM, towards the middle; stands up for PCIe and a full DIMM', () => {
    const b = blank(100, 60);
    const m2 = socket('m2', 12, 30, { rot: 90 }), mini = socket('m2', 50, 8, { pkg: 'Mini_PCIe_Socket', w: 30 }), so = socket('sodimm', 60, 50), pcie = socket('pcie4', 20, 20);
    b.comps.push(m2, mini, so, pcie);
    // an M.2 2280 turned along y at x = 12: its card runs along x, in over the board
    const k = cardOf(m2, b)!;
    expect(k.x - m2.x).toBeGreaterThan(30);
    expect(Math.max(k.w, k.l)).toBeCloseTo(80, 6);
    expect(k.h).toBeCloseTo(m2.h + 2, 6);
    // a mini PCIe card is 51 mm and comes up the board from a socket at the bottom edge; an SO-DIMM's 30 mm hangs down from the top
    expect(cardOf(mini, b)!.y - mini.y).toBeGreaterThan(20);
    expect(cardOf(so, b)!.y - so.y).toBeLessThan(-10);
    expect(Math.max(cardOf(so, b)!.w, cardOf(so, b)!.l)).toBe(so.w);
    // a PCIe card stands over its slot, 107 mm tall
    const p = cardOf(pcie, b)!;
    expect([p.x, p.y, p.w, p.l, p.h]).toEqual([pcie.x, pcie.y, pcie.w, pcie.l, 107]);
    expect(holderParts(b).length).toBe(b.comps.length + 4);
    // nothing to add for a board without card sockets
    expect(holderParts(blank(20, 20))).toEqual([]);
  });

  it('sets how tall the holder has to be (a stack layer, a board bolted on top)', () => {
    const b = blank(60, 40);
    const so = socket('sodimm', 30, 6); // 6 mm deep: a module along the board, over the socket's side
    b.comps.push(so);
    const lv = computeLevels(b, DEFAULT_HOLDER);
    expect(lv.topMax).toBeGreaterThanOrEqual(lv.zt + so.h + 2 - 1e-9);
    // a board bolted on top clears the card over the first one (the card's box is 2 mm above the socket), not just the socket
    const up = blank(30, 20);
    const need = stackNeed(b, up);
    expect(need.need).toBeGreaterThanOrEqual(so.h + 3 - 1e-6);
    expect(need.under?.ref).toBe(`${so.ref} card`);
  });

  it('gets a wall opening where it hangs out past the holder (the holder is cut away round it)', async () => {
    // an M.2 near the bottom edge, its 80 mm card running up the board and out past the top edge, over the socket's width
    const b = blank(40, 30, 'Card board');
    const m2 = socket('m2', 20, 4);
    b.comps.push(m2);
    const k2 = cardOf(m2, b)!;
    expect(k2.y + k2.l / 2).toBeGreaterThan(30);
    const p = newProject(b);
    setLayout(p, 'loose');
    p.mount.kind = 'none';
    const r = generate(p);
    const zt = r.report.levels.boardTop;
    const holder = fromMesh(r.parts.find((x) => x.id === 'm0_holder')!.mesh)!;
    // the card's box past the board's edge, above the board: the holder's wall must not stand in it
    const out = box(k2.x - k2.w / 2 + 0.5, 30.2, zt + 0.05, k2.x + k2.w / 2 - 0.5, k2.y + k2.l / 2, zt + k2.h - 0.05);
    const cut = holder.intersect(out).volume();
    expect(cut, `${cut.toFixed(1)} mm³ of the holder inside the card`).toBeLessThan(0.5);
    freeAll();
  });
});
