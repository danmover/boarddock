// The board editor's toolbox, and the pictures of things shipped with the app: every toolbox entry is a picture of
// its own 3D model (the one the 3D view draws), at the size its tile says, of the part exactly as it goes on a board;
// and the shipped pictures (public/tiles/, the toolbox's and the Start page's) are of the models as they are now.
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { initKernel, freeAll } from '../src/cad/kernel';
import { pictureOf, pictureSig } from '../src/cad/boardviz';
import { PALETTE, contribOf, demoBoard, paletteFor, partBoard, samePart } from '../src/model/palette';
import { CONNECTORS, connById, connSetup } from '../src/model/library';
import { TEMPLATES } from '../src/model/templates';
import { extentAlong, roundedRectLoop } from '../src/geom/poly';
import TILES from '../src/ui/tiles.json';
import type { Board, Comp, Ghost, V2 } from '../src/model/types';

const SIG: Record<string, string> = TILES;
const HOW = 'Render them again: npm run dev, then PLAYWRIGHT=/path/to/playwright/index.mjs node scripts/render-tiles.mjs http://localhost:5173/ (it renders only what changed, and updates src/ui/tiles.json).';
const blank = (W: number, H: number): Board => ({ name: '', outline: roundedRectLoop(W, H, 1.2, 4).map(([x, y]) => [x + W / 2, y + H / 2] as V2), cutouts: [], thickness: 1.6, holes: [], comps: [], source: 'test', notes: [] });
const sigOf = (b: Board) => { const s = pictureSig(pictureOf(b)); freeAll(); return s; };

/** The box round every mesh of the picture above the board's copper and silkscreen, near (x, y). */
function above(gs: Ghost[], zt: number, x: number, y: number, r: number) {
  const bb = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z1: -Infinity };
  for (const g of gs) for (let i = 0; i < g.mesh.pos.length; i += 3) {
    const px = g.mesh.pos[i], py = g.mesh.pos[i + 1], pz = g.mesh.pos[i + 2];
    if (pz < zt + 0.08 || Math.abs(px - x) > r || Math.abs(py - y) > r) continue;
    bb.x0 = Math.min(bb.x0, px); bb.x1 = Math.max(bb.x1, px); bb.y0 = Math.min(bb.y0, py); bb.y1 = Math.max(bb.y1, py); bb.z1 = Math.max(bb.z1, pz);
  }
  return { w: bb.x1 - bb.x0, l: bb.y1 - bb.y0, h: bb.z1 - zt };
}

describe('toolbox pictures', () => {
  beforeAll(async () => { await initKernel(); });

  it('each picture is of the part exactly as the toolbox puts it on a board', () => {
    const b = blank(120, 80);
    for (const it of PALETTE) {
      const demo = demoBoard(it);
      const pic = demo.comps[0], put = it.make(b, it.edge ? [60, 0] : [60, 40]).comp;
      if (!put) { expect(demo.holes.length, it.id).toBe(1); expect(`Ø${demo.holes[0].d}`, it.id).toBe(it.size); continue; }
      const same = (c: Comp) => ({ w: c.w, l: c.l, h: c.h, rot: c.rot, kind: c.kind, pkg: c.pkg, side: c.side, type: c.conn?.type, angle: c.conn?.angle, value: c.value, role: c.role });
      expect(same(pic), it.id).toEqual(same(put));
      // and a part of that kind on a board gets this picture in its lists
      expect(paletteFor(pic)?.id, it.id).toBe(it.id);
    }
  });

  it('each model is the size the toolbox gives for it', () => {
    for (const it of PALETTE) {
      const demo = demoBoard(it), c = demo.comps[0];
      if (!c) continue;
      const [w, l, h] = it.size.split('×').map(Number);
      const got = above(pictureOf(demo), demo.thickness, c.x, c.y, 80); // (an SO-DIMM socket is 70 mm wide)
      freeAll();
      if (it.id === 'dbg_tag' || it.id === 'pogo') { expect(got.h, 'pads, flat on the board').toBeLessThan(0.1); continue; }
      // (a right-angle header's pins run out past its plastic; an audio jack's collar stands proud of its front)
      const lx = it.id === 'edge_pins_ra' ? 7.5 : it.id === 'edge_audio35' ? 1.7 : 0.3;
      expect(Math.abs(got.w - w), `${it.id} width ${got.w.toFixed(2)} vs ${w}`).toBeLessThan(0.3);
      expect(got.l - l, `${it.id} depth ${got.l.toFixed(2)} vs ${l}`).toBeGreaterThan(-0.3);
      expect(got.l - l, `${it.id} depth ${got.l.toFixed(2)} vs ${l}`).toBeLessThan(lx);
      // (a USB-A's shell tabs stand 0.25 mm proud of it)
      expect(Math.abs(got.h - h), `${it.id} height ${got.h.toFixed(2)} vs ${h}`).toBeLessThan(0.35);
    }
  });

  it("a board's part in its lists: the toolbox's picture only when it is that very part, else a picture of its own", () => {
    // what the toolbox puts down is its own entry's part (so the lists show the shipped picture)
    for (const it of PALETTE) { const c = demoBoard(it).comps[0]; if (c) expect(samePart(c, it), it.id).toBe(true); }
    // the Uno's long sockets and 2 x 3 ICSP header are not the toolbox's 1 x 6 and 2 x 10, nor a J-Link's LEDs its 5 mm
    // one: each gets a scrap of its own with the part as it is, and the model on it is the part's size
    let own = 0;
    for (const t of TEMPLATES) {
      const b = t.make();
      if (b.kind === 'box') continue;
      for (const c of b.comps) {
        const it = paletteFor(c);
        if (!it || samePart(c, it)) continue;
        own++;
        const pb = partBoard(c), q = pb.comps[0];
        expect([q.w, q.l, q.h, q.pkg, q.kind, q.conn?.type, q.pins?.length], `${t.id} ${c.ref}`).toEqual([c.w, c.l, c.h, c.pkg, c.kind, c.conn?.type, c.pins?.length]);
        const ex = extentAlong(q, 0) + extentAlong(q, 180), ey = extentAlong(q, 90) + extentAlong(q, -90);
        if (q.conn?.entry === 'edge') {
          // a plug faces front, its mouth out past the front edge as the toolbox puts one on
          expect(q.conn.angle).toBe(-90);
          expect(q.y - extentAlong(q, -90), `${t.id} ${c.ref} mouth`).toBeCloseTo(-connById(q.conn.type).overhang, 6);
        } else expect(ex, `${t.id} ${c.ref} long side across`).toBeGreaterThanOrEqual(ey / 1.3);
        const got = above(pictureOf(pb), pb.thickness, q.x, q.y, 40);
        freeAll();
        const ly = q.conn?.type === 'pins_ra' ? 7.5 : q.conn?.type === 'audio35' ? 1.7 : 0.3;
        expect(Math.abs(got.w - ex), `${t.id} ${c.ref} across ${got.w.toFixed(2)} vs ${ex}`).toBeLessThan(0.3);
        expect(got.l - ey, `${t.id} ${c.ref} depth ${got.l.toFixed(2)} vs ${ey}`).toBeGreaterThan(-0.3);
        expect(got.l - ey, `${t.id} ${c.ref} depth ${got.l.toFixed(2)} vs ${ey}`).toBeLessThan(ly);
        expect(Math.abs(got.h - q.h), `${t.id} ${c.ref} height ${got.h.toFixed(2)} vs ${q.h}`).toBeLessThan(0.35);
      }
    }
    expect(own).toBeGreaterThan(20);
    const uno = TEMPLATES.find((t) => t.id === 'uno')!.make();
    expect(uno.comps.filter((c) => paletteFor(c)?.id === 'hdr_1x6').every((c) => !samePart(c, PALETTE.find((x) => x.id === 'hdr_1x6')!))).toBe(true);
  });

  it('a picture is the same model every time (so its fingerprint means something)', () => {
    for (const it of PALETTE.filter((_, i) => i % 7 === 0)) expect(sigOf(demoBoard(it)), it.id).toBe(sigOf(demoBoard(it)));
    for (const t of TEMPLATES.slice(0, 3)) expect(sigOf(t.make()), t.id).toBe(sigOf(t.make()));
  });

  it('every shipped picture is of its 3D model as it is now', () => {
    const want: Record<string, string> = {};
    // (a contributed connector (parts/) has a picture only once someone renders one: until then it shows a drawing made from its look)
    for (const it of PALETTE) if (!contribOf(it) || SIG[`pal/${it.id}`]) want[`pal/${it.id}`] = sigOf(demoBoard(it));
    for (const t of TEMPLATES) want[t.id] = sigOf(t.make());
    const stale = Object.keys(want).filter((id) => SIG[id] !== want[id]);
    const missing = Object.keys(want).filter((id) => !existsSync(`public/tiles/${id}.webp`));
    const gone = [...Object.keys(SIG), ...readdirSync('public/tiles').filter((f) => f.endsWith('.webp')).map((f) => f.slice(0, -5)), ...readdirSync('public/tiles/pal').map((f) => `pal/${f.slice(0, -5)}`)].filter((id) => !(id in want));
    expect(stale, `pictures of an older model: ${stale.join(', ')}. ${HOW}`).toEqual([]);
    expect(missing, `no picture: ${missing.join(', ')}. ${HOW}`).toEqual([]);
    expect([...new Set(gone)], `pictures of things that are gone: ${gone.join(', ')}. ${HOW}`).toEqual([]);
  });
});

describe('every connector type is in the toolbox', () => {
  // (the mains outlets and the fixed mains lead belong to a box's housing, and Custom is what has no type: none of them sits on a board as a part)
  const onBoard = CONNECTORS.filter((t) => !t.id.startsWith('ac_') && t.id !== 'mains_lead' && t.id !== 'custom');
  const partOf = (t: (typeof CONNECTORS)[number]): Comp => ({ id: 'x', ref: 'J1', pkg: t.name, side: 'top', x: 0, y: 0, rot: 0, w: t.body.w, l: t.body.l, h: t.body.h, kind: 'connector', tht: false, conn: connSetup(t, 0) });

  it('a part of each type on a board finds its toolbox entry (paletteFor), so its lists show a picture', () => {
    expect(onBoard.length).toBeGreaterThan(50);
    const none = onBoard.filter((t) => !paletteFor(partOf(t))).map((t) => t.id);
    expect(none, `connector types with no toolbox entry: ${none.join(', ')}. Add one in src/model/palette.ts (an upright(...) or debug(...) entry, and its line in paletteFor)`).toEqual([]);
    // (and the entry is that type's: a JST-ZH is not shown as a JST-PH)
    for (const id of ['jst_zh', 'minifit', 'cortex20', 'jst_gh', 'microfit', 'swd10']) expect(paletteFor(partOf(connById(id)))?.id, id).toBe({ jst_zh: 'zh4', minifit: 'mfjr4', cortex20: 'dbg_cortex20', jst_gh: 'gh4', microfit: 'mfit4', swd10: 'dbg_swd10' }[id]);
  });

  it('each new entry is the part its type says (sized as its footprint, on the debug or upright list it belongs to)', () => {
    for (const [id, type, group] of [['zh4', 'jst_zh', 'Headers and wires'], ['mfjr4', 'minifit', 'Headers and wires'], ['dbg_cortex20', 'cortex20', 'Debug and serial']] as const) {
      const it = PALETTE.find((x) => x.id === id)!, c = demoBoard(it).comps[0];
      expect([it.group, c.conn?.type, c.kind]).toEqual([group, type, 'connector']);
      expect(it.size, id).not.toBe('');
    }
    expect(demoBoard(PALETTE.find((x) => x.id === 'dbg_cortex20')!).comps[0].role).toBe('debug');
  });

  it('every toolbox entry has a shipped picture (tiles.json), or, for a contributed connector, the drawing made from its look', () => {
    const none = PALETTE.filter((it) => !SIG[`pal/${it.id}`] && !contribOf(it)).map((it) => it.id);
    expect(none, `no picture: ${none.join(', ')}. ${HOW}`).toEqual([]);
  });
});

describe('3D models of parts', () => {
  beforeAll(async () => { await initKernel(); });
  const put = (ids: string[]) => {
    const b = blank(30 * ids.length + 20, 50);
    ids.forEach((id, i) => { const it = PALETTE.find((x) => x.id === id)!; b.comps.push(it.make(b, it.edge ? [20 + i * 30, 0] : [20 + i * 30, 25]).comp!); });
    return b;
  };

  it('one part that cannot be drawn leaves the others be (a Tag-Connect took every black part off its board)', () => {
    const ids = ['edge_barrel', 'edge_audio35', 'jst_ph3', 'buzzer', 'dbg_swd10', 'button'];
    const alone = put(ids), withTag = put([...ids, 'dbg_tag']), withLow = put([...ids, 'edge_custom']);
    // a connector drawn lower than its opening (0.4 mm): drawn solid, and the rest as they were
    const low = withLow.comps[ids.length];
    low.h = 0.4;
    const a = pictureOf(alone), t = pictureOf(withTag), w = pictureOf(withLow);
    for (const c of alone.comps) {
      const x = above(a, 1.6, c.x, c.y, 5.5);
      expect(above(t, 1.6, c.x, c.y, 5.5), `${c.ref} beside a Tag-Connect`).toEqual(x);
      expect(above(w, 1.6, c.x, c.y, 5.5), `${c.ref} beside a low connector`).toEqual(x);
    }
    expect(above(w, 1.6, low.x, low.y, 5.5).h).toBeCloseTo(0.4, 3);
    freeAll();
  });

  it('a Tag-Connect is its pads, a top-entry JST is open at the top round its pins', () => {
    const b = put(['dbg_tag', 'jst_ph3', 'jst_xh4']);
    const gs = pictureOf(b), gold = gs.find((g) => g.mat === 'gold')!;
    // the pads of a TC2050: which of the ten places on its 1.27 mm grid have gold on them
    const pads = (c: Comp) => { const seen = new Set<string>(); for (let i = 0; i < gold.mesh.pos.length; i += 3) { const px = gold.mesh.pos[i], py = gold.mesh.pos[i + 1]; if (Math.abs(px - c.x) < c.w / 2 && Math.abs(py - c.y) < c.l / 2) seen.add(`${Math.round((px - c.x) / 1.27)},${Math.sign(py - c.y)}`); } return seen.size; };
    const [tag, ph3, xh4] = b.comps;
    expect(pads(tag)).toBe(10);
    // pins stand in the housing: three and four of them, each a little square seen from above
    const pins = (c: Comp) => { const xs = new Set<number>(); for (let i = 0; i < gold.mesh.pos.length; i += 3) { const px = gold.mesh.pos[i], py = gold.mesh.pos[i + 1], pz = gold.mesh.pos[i + 2]; if (Math.abs(px - c.x) < c.w / 2 && Math.abs(py - c.y) < c.l / 2 && pz > 1.6 + 3) xs.add(Math.round((px - c.x) * 4)); } return xs.size / 2; };
    expect(pins(ph3)).toBe(3);
    expect(pins(xh4)).toBe(4);
    // and nothing solid over the middle of the housing between its walls: the plug goes in from above
    const black = gs.find((g) => g.mat === 'black')!;
    for (const c of [ph3, xh4]) {
      let top = 0;
      for (let i = 0; i < black.mesh.pos.length; i += 3) if (Math.abs(black.mesh.pos[i] - c.x) < c.w / 2 - 1 && Math.abs(black.mesh.pos[i + 1] - c.y) < c.l / 2 - 1 && black.mesh.pos[i + 2] > 1.6 + c.h - 0.01) top++;
      expect(top, c.ref).toBe(0);
    }
    freeAll();
  });
});
