// Boxes you can make match your own: rows placed from an end with their own spacing, ports one by one, sockets on
// their side or upside down, set heights up the side, corners, and what is done in the board editor (a dragged
// port, a dimension typed) written back into the box so it stays. Older boxes lay out exactly as they always did.
import { describe, it, expect, beforeAll } from 'vitest';
import { initKernel } from '../src/cad/kernel';
import { buildModule } from '../src/cad/generate';
import { generate } from '../src/cad/assembly';
import { applyBox, BOX_PRESETS, boxFromEdits, boxOutline, boxPorts, boxProblems, FACE_NAME, layoutPorts, makeBox, newBox } from '../src/model/boxes';
import { connById, newProject } from '../src/model/library';
import { setDim } from '../src/model/dims';
import { copyOf } from '../src/model/myboards';
import { roundedRectLoop } from '../src/geom/poly';
import type { Board, BoxFace, BoxPortGroup, BoxSpec } from '../src/model/types';

// ---- the layout as it was before rows could be placed by hand (copied from the previous version) ----
const oldFaceLen = (s: BoxSpec, f: BoxFace) => (f === 'left' || f === 'right' ? s.w : s.l);
const oldWidth = (type: string, g?: BoxPortGroup) => (type === 'pins_ra' ? (g?.pins?.length ?? 6) * 2.54 : connById(type).body.w);
function oldLayout(s: BoxSpec) {
  const out: { group: BoxPortGroup; i: number; along: number }[] = [];
  for (const face of Object.keys(FACE_NAME) as BoxFace[]) {
    const gs = s.groups.filter((x) => x.face === face && x.count > 0);
    if (!gs.length) continue;
    const L = oldFaceLen(s, face);
    const span = (gap: number, between: number) => gs.reduce((a, x) => a + x.count * oldWidth(x.type, x) + (x.count - 1) * gap, 0) + (gs.length - 1) * between;
    let gap = 5, between = 9;
    if (span(gap, between) > L - 6) { gap = 1.5; between = 3; }
    const spread = gs.every((x) => x.type.startsWith('ac_'));
    if (spread) { const n = gs.reduce((a, x) => a + x.count, 0), w = gs.reduce((a, x) => a + x.count * oldWidth(x.type, x), 0); gap = between = Math.max(1.5, (L - 20 - w) / Math.max(1, n)); }
    let at = spread ? 10 + gap / 2 : (L - span(gap, between)) / 2;
    for (const x of gs) for (let i = 0; i < x.count; i++) {
      const w = oldWidth(x.type, x);
      out.push({ group: x, i, along: at + w / 2 });
      at += w + (i < x.count - 1 ? gap : between);
    }
  }
  return out;
}

const spec = (groups: Partial<BoxPortGroup>[], size: Partial<BoxSpec> = {}): BoxSpec => ({ l: 120, w: 40, h: 24, ...size, groups: groups.map((g, k) => ({ id: `g${k}`, type: 'usb_a', count: 1, face: 'front', role: 'hub-down', ...g })) });
const boxOf = (s: BoxSpec): Board => { const b = makeBox('hub4'); applyBox(b, s); return b; };
const port = (b: Board, ref: string) => b.comps.find((c) => c.ref === ref && c.conn)!;

describe('custom boxes: layout', () => {
  it('old boxes (no new fields) lay out exactly as before: every preset, and a project saved by the old version', () => {
    for (const [k, P] of Object.entries(BOX_PRESETS)) {
      const s = P.spec();
      const now = layoutPorts(s).map((q) => [q.group.id, q.i, q.along]), then = oldLayout(s).map((q) => [q.group.id, q.i, q.along]);
      expect(now, k).toEqual(then);
      // their ports: same places and sizes, halfway up the side, not turned
      for (const c of boxPorts(structuredClone(s))) {
        if (c.conn!.entry === 'edge' && s.h >= 5) { expect(c.conn!.zc).toBe(-s.h / 2); expect(c.conn!.roll).toBeUndefined(); }
        expect(c.conn!.plug).toEqual(connById(c.conn!.type).plug);
      }
      // (the USB-C hub's Ethernet socket was always too tall for its 14 mm: said the same way)
      // (the USB-C hub was 14 mm tall, under its 13.5 mm Ethernet jack and the 1 mm the check wants: now 16 mm)
      expect(boxProblems(s), k).toEqual([]);
      expect(boxOutline(s)).toEqual(roundedRectLoop(s.l, s.w, Math.min(4, s.w / 6), 6).map(([x, y]) => [x + s.l / 2, y + s.w / 2]));
    }
    // an old project's box, as JSON: no refs, no placement fields
    const old = JSON.parse('{"l":110,"w":32,"h":14,"groups":[{"id":"a","type":"usb_a","count":3,"face":"front","role":"hub-down"},{"id":"b","type":"usb_c","count":1,"face":"front","role":"hub-down"},{"id":"c","type":"usb_c","count":1,"face":"left","role":"hub-up"},{"id":"d","type":"rj45","count":1,"face":"right","role":"net"}]}') as BoxSpec;
    const ref = oldLayout(structuredClone(old));
    const b = boxOf(structuredClone(old));
    expect(b.comps.filter((c) => c.conn).map((c) => c.ref)).toEqual(['P1', 'P2', 'P3', 'P4', 'UP', 'LAN']);
    expect(port(b, 'P2').x).toBe(ref[1].along);
    expect(port(b, 'UP').y).toBe(ref[4].along);
    // nothing was moved, so writing back the editor's changes keeps it as it is
    expect(boxFromEdits(b)).toBe(false);
  });

  it('places a row from either end with its own spacing, and ports one by one', () => {
    const s = spec([{ count: 3, from: 'start', edge: 10, pitch: 20 }, { type: 'usb_c', count: 2, from: 'end', edge: 6, pitch: 12 }]);
    const lay = layoutPorts(s), w = connById('usb_a').body.w, wc = connById('usb_c').body.w;
    expect(lay.filter((q) => q.group.id === 'g0').map((q) => q.along)).toEqual([10 + w / 2, 30 + w / 2, 50 + w / 2]);
    const c = lay.filter((q) => q.group.id === 'g1').map((q) => q.along);
    expect(c[1] + wc / 2).toBeCloseTo(120 - 6, 6); // the last one's far side 6 mm from the right end
    expect(c[1] - c[0]).toBeCloseTo(12, 6);
    // a port with its own place is there; the next follows at the row's spacing
    s.groups[0].at = [undefined as unknown as number, 60];
    const lay2 = layoutPorts(s).filter((q) => q.group.id === 'g0').map((q) => q.along);
    expect(lay2).toEqual([10 + w / 2, 60, 80]);
    expect(boxProblems(s)).toEqual([]);
    // overlapping and past the end are reported
    s.groups[0].at = [20, 25];
    expect(boxProblems(s).some((x) => /overlap/.test(x))).toBe(true);
    s.groups[0].at = [5];
    expect(boxProblems(s).some((x) => /runs past the left end/.test(x))).toBe(true);
  });

  it('a spacing on an automatic row keeps it centred with the others', () => {
    const s = spec([{ count: 4, pitch: 18 }]);
    const a = layoutPorts(s).map((q) => q.along);
    expect(a[1] - a[0]).toBeCloseTo(18, 6);
    expect((a[0] + a[3]) / 2).toBeCloseTo(60, 6);
  });

  it('turns a socket on its side or upside down: its size, its angle, its plug, its height up the side', () => {
    const t = connById('usb_a');
    const up = boxPorts(spec([{ turn: 90, up: 9 }]))[0];
    expect(up.w).toBe(t.body.h); // along the face it takes its height
    expect(up.conn!.roll).toBe(90);
    expect(up.conn!.plug.w).toBe(t.plug.h); // the plug as it sits: narrow across, tall up
    expect(up.conn!.plug.h).toBe(t.plug.w);
    expect(up.conn!.zc).toBe(9 - 24); // 9 mm up a 24 mm box, from its top
    const flip = boxPorts(spec([{ turn: 180 }]))[0];
    expect(flip.conn!.roll).toBe(180);
    expect(flip.w).toBe(t.body.w);
    expect(flip.conn!.plug).toEqual(t.plug);
    // on an end face the port runs along y
    const end = boxPorts(spec([{ face: 'left', turn: 270 }]))[0];
    expect(end.l).toBe(t.body.h);
    expect(end.conn!.angle).toBe(180);
    // a round socket has no turn, nor a bare board's ports
    expect(boxPorts(spec([{ type: 'barrel', turn: 90 }]))[0].conn!.roll).toBeUndefined();
    expect(boxPorts(spec([{ turn: 90 }], { h: 3 }))[0].conn!.roll).toBeUndefined();
    // too low for its height, and on its side too tall for a slim box
    expect(boxProblems(spec([{ turn: 90, up: 3 }])).some((x) => /below the bottom/.test(x))).toBe(true);
    expect(boxProblems(spec([{ turn: 90 }], { h: 12 })).some((x) => /on its side is taller than the box/.test(x))).toBe(true);
  });

  it('top rows: across the box by mm, and turned', () => {
    const b = boxOf(spec([{ face: 'top', count: 2, across: 12, rot: 90 }]));
    const ps = b.comps.filter((c) => c.conn);
    expect(ps.every((c) => c.y === 12 && c.rot === 90)).toBe(true);
  });

  it('corners: square, rounded, fully rounded or cut straight across', () => {
    expect(boxOutline({ ...spec([]), corner: 0 }).length).toBe(4);
    const ch = boxOutline({ ...spec([]), corner: 5, chamfer: true });
    expect(ch.length).toBe(8);
    expect(ch[0]).toEqual([5, 0]);
    const full = boxOutline({ ...spec([]), corner: 99 });
    const ys = full.map((q) => q[1]);
    expect(Math.min(...ys)).toBeCloseTo(0, 3);
    expect(Math.max(...ys)).toBeCloseTo(40, 3);
  });
});

describe('custom boxes: what the editor does sticks', () => {
  it('a dragged port stays where it was put, and the others on its face do not move', () => {
    const b = makeBox('hubc'); // 3 USB-A and a USB-C on the front, laid out by themselves
    const before = new Map(b.comps.filter((c) => c.conn).map((c) => [c.ref, [c.x, c.y, c.id] as const]));
    const p2 = port(b, 'P2');
    p2.x += 7.3; p2.y += 4; // dragged right and a little into the box
    expect(boxFromEdits(b)).toBe(true);
    expect(port(b, 'P2').x).toBeCloseTo(before.get('P2')![0] + 7.3, 2);
    expect(port(b, 'P2').y).toBe(before.get('P2')![1]); // back on its face
    expect(port(b, 'P2').id).toBe(before.get('P2')![2]); // the same part, so dimensions to it hold
    for (const r of ['P1', 'P3', 'P4', 'UP']) expect(port(b, r).x).toBeCloseTo(before.get(r)![0], 2);
    // laid out again (a later change elsewhere in the box), it is still there
    const s = structuredClone(b.box!); s.groups[3].count = 1; applyBox(b, s);
    expect(port(b, 'P2').x).toBeCloseTo(before.get('P2')![0] + 7.3, 2);
    expect(boxFromEdits(b)).toBe(false);
  });

  it('a side port dragged over to another side goes onto it; a deleted port leaves its row', () => {
    const b = makeBox('hub4');
    const p3 = port(b, 'P3');
    p3.y = b.box!.w - 1; // over to the back
    boxFromEdits(b);
    const g = b.box!.groups.find((x) => x.refs?.includes('P3'))!;
    expect(g.face).toBe('back');
    expect(g.count).toBe(1);
    expect(b.box!.groups.find((x) => x.refs?.includes('P1'))!.count).toBe(3);
    expect(port(b, 'P3').conn!.angle).toBe(90);
    const x1 = port(b, 'P1').x;
    b.comps = b.comps.filter((c) => c.ref !== 'P2');
    boxFromEdits(b);
    expect(b.comps.some((c) => c.ref === 'P2')).toBe(false);
    expect(b.box!.groups.find((x) => x.refs?.includes('P1'))!.count).toBe(2);
    expect(port(b, 'P1').x).toBeCloseTo(x1, 2);
  });

  it('a dimension typed to a port moves it for good, and one between two edges sizes the box', () => {
    const b = makeBox('hub4');
    const id = port(b, 'P1').id;
    b.dims = [{ id: 'd1', a: { k: 'edge', at: 'x0' }, b: { k: 'comp', id, at: 'x0' }, axis: 'x' }];
    expect(setDim(b, b.dims[0], 8)).toBe(true);
    const x0 = (c: { x: number; w: number }) => c.x - c.w / 2;
    expect(x0(port(b, 'P1'))).toBeCloseTo(8, 2);
    expect(b.box!.groups[0].at?.[0]).toBeCloseTo(8 + connById('usb_a').body.w / 2, 2);
    const s = structuredClone(b.box!); applyBox(b, s);
    expect(x0(port(b, 'P1'))).toBeCloseTo(8, 2);
    // the box's length from two edges
    b.dims.push({ id: 'd2', a: { k: 'edge', at: 'x0' }, b: { k: 'edge', at: 'x1' }, axis: 'x' });
    expect(setDim(b, b.dims[1], 130)).toBe(true);
    expect(b.box!.l).toBe(130);
    expect(Math.max(...b.outline.map((q) => q[0]))).toBeCloseTo(130, 3);
    expect(port(b, 'UP').x).toBeLessThan(5); // the upstream port still on the left end
  });

  it('a top port dragged keeps both its place along and across; turned (R), its row turns', () => {
    const b = makeBox('hub7');
    const p = port(b, 'P4');
    p.x += 3; p.y = 10;
    boxFromEdits(b);
    expect(port(b, 'P4').y).toBe(10);
    expect(port(b, 'P3').y).toBe(24);
    port(b, 'P1').rot = 90;
    boxFromEdits(b);
    expect(b.comps.filter((c) => c.role === 'hub-down').every((c) => c.rot === 90)).toBe(true);
  });
});

describe('custom boxes: build your own, save it, print it', () => {
  beforeAll(async () => { await initKernel(); });

  it('starts a box of each kind from scratch, with ports to edit', () => {
    // (J-Links and USB-serial adapters are boards now, from the library or drawn: not boxes)
    for (const k of ['hub', 'charger', 'supply'] as const) {
      const b = newBox(k, { l: 80, w: 40, h: 20 });
      expect(b.kind).toBe('box');
      expect(b.box!.groups.length).toBeGreaterThan(0);
      expect(boxProblems(b.box!), k).toEqual([]);
    }
  });

  it('a saved box comes back with its spec, and lays out the same', () => {
    const b = boxOf(spec([{ count: 2, from: 'start', edge: 4, pitch: 16, turn: 90, up: 10 }, { face: 'left', type: 'usb_c', role: 'hub-up' }]));
    b.color = '#ffffff';
    const c = copyOf({ id: 'x', name: 'Mine', at: '', board: structuredClone(b) });
    expect(c.box).toEqual(b.box);
    expect(c.color).toBe('#ffffff');
    const s = structuredClone(c.box!); applyBox(c, s);
    expect(c.comps.filter((q) => q.conn).map((q) => [q.ref, q.x, q.y])).toEqual(b.comps.filter((q) => q.conn).map((q) => [q.ref, q.x, q.y]));
  });

  it("an upright USB-A's opening in the holder is taller than wide, a flat one's wider than tall", () => {
    const mk = (turn: 0 | 90) => {
      const b = boxOf(spec([{ count: 2, turn, up: turn ? 12 : 8 }, { face: 'left', type: 'usb_c', role: 'hub-up' }]));
      const p = newProject(b);
      const out = buildModule({ p, mi: 0, b: p.modules[0].board, H: p.modules[0].holder, din: false, stand: false, hooks: {}, name: b.name });
      return { out, pl: out.plugs.find((q) => q.ref === 'P1')! };
    };
    const up = mk(90), flat = mk(0);
    expect(up.pl.open![1]).toBeGreaterThan(up.pl.open![0]);
    expect(flat.pl.open![0]).toBeGreaterThan(flat.pl.open![1]);
    expect(up.pl.open![0]).toBeCloseTo(connById('usb_a').plug.h + 1.2, 3);
    // the plug drawn in it stands on its side: taller than wide
    const g = up.out.ghosts.filter((x) => x.tag?.kind === 'plug' && x.tag.refs?.[0] === 'P1');
    expect(g.length).toBeGreaterThan(0);
    const pos = g.flatMap((x) => Array.from(x.mesh.pos));
    const xs = pos.filter((_, i) => i % 3 === 0), zs = pos.filter((_, i) => i % 3 === 2);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(Math.max(...xs) - Math.min(...xs));
    expect(up.out.warnings.filter((w) => !/^A box/.test(w))).toEqual([]);
  });

  it('a custom box builds in a rack without warnings of its own', () => {
    const b = newBox('hub', { l: 130, w: 45, h: 22 });
    const s = structuredClone(b.box!);
    s.corner = 10; s.chamfer = true;
    s.groups[0].turn = 90; s.groups[0].pitch = 10; s.groups[0].from = 'start'; s.groups[0].edge = 6;
    applyBox(b, s);
    expect(boxProblems(b.box!)).toEqual([]);
    const p = newProject(b);
    const r = generate(p);
    const mine = r.report.warnings.filter((w) => !b.notes.some((n) => w.includes(n)));
    expect(mine.filter((w) => /box|port|P\d|strap/i.test(w))).toEqual([]);
    expect(r.report.checks.filter((c) => c.status === 'bad' && /Box/.test(c.name))).toEqual([]);
  });
});

describe('custom boxes: a plug from the toolbox', () => {
  it('put on a box, it becomes a port of its own and stays where it was put', () => {
    const b = makeBox('hub4');
    const t = connById('usb_c');
    b.comps.push({ id: 'new', ref: 'J9', pkg: 'USB-C', side: 'top', x: 70, y: b.box!.w - 3, rot: 0, w: t.body.w, l: t.body.l, h: t.body.h, kind: 'connector', tht: false,
      conn: { type: 'usb_c', entry: 'edge', angle: 90, zc: 1.6, plug: { ...t.plug }, cradle: true, cap: true, guard: false, tie: false } });
    const x1 = b.comps.find((c) => c.ref === 'P1')!.x;
    expect(boxFromEdits(b)).toBe(true);
    const g = b.box!.groups.find((x) => x.refs?.includes('J9'))!;
    expect([g.face, g.type, g.count, g.role]).toEqual(['back', 'usb_c', 1, 'hub-down']);
    expect(b.comps.find((c) => c.ref === 'J9')!.x).toBe(70);
    expect(b.comps.find((c) => c.ref === 'J9')!.id).toBe('new');
    expect(b.comps.find((c) => c.ref === 'P1')!.x).toBe(x1);
  });
});
