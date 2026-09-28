// GenCAD 1.4 (.cad): a text format many tools export for test and assembly (Allegro, OrCAD, PADS, Xpedition,
// Altium, DipTrace...). Read: $BOARD (outline, cut-outs, thickness), $PADS / $PADSTACKS (drill sizes),
// $SHAPES (body outline, pins, height), $COMPONENTS (place, side, turn, shape), $DEVICES (package names),
// $SIGNALS (nets on pins) and $MECH (mounting holes and other mechanical parts).
import type { Board, Loop, V2 } from '../model/types';
import { arcCenter, bbox, chainLoops, outlineFromLoops } from '../geom/poly';
import { finishBoard } from './common';
import { isMountPkg, placer, sortHoles, toComp, type Placed, type RawHole } from './place';

/** Does this text look like GenCAD? */
export const isGencad = (head: string) => /^\s*\$HEADER[\s\S]{0,400}GENCAD/im.test(head);

/** Split a line into words, keeping "quoted strings" whole. */
const words = (line: string) => (line.match(/"[^"]*"|\S+/g) ?? []).map((t) => t.replace(/^"|"$/g, ''));

interface Sec { name: string; lines: string[][] }
function sections(text: string): Sec[] {
  const out: Sec[] = [];
  let cur: Sec | null = null;
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue; // GenCAD has no comment syntax, but some writers add '#' lines
    if (/^\$END/i.test(line)) { cur = null; continue; }
    if (line.startsWith('$')) { cur = { name: line.slice(1).toUpperCase(), lines: [] }; out.push(cur); continue; }
    cur?.lines.push(words(line));
  }
  return out;
}

/** mm per GenCAD unit: INCH, THOU, MM, MM100, USER n (n per inch), USERMM n (n per mm), USERCM n (n per cm). */
function unitK(t: string[] | undefined): number {
  const u = (t?.[1] ?? 'INCH').toUpperCase(), n = +(t?.[2] ?? 0);
  if (u === 'INCH') return 25.4;
  if (u === 'THOU' || u === 'MIL' || u === 'MILS') return 0.0254;
  if (u === 'MM') return 1;
  if (u === 'MM100') return 0.01;
  if (u === 'USER' && n) return 25.4 / n;
  if (u === 'USERMM' && n) return 1 / n;
  if ((u === 'USERCM' || u === 'USERM') && n) return 10 / n;
  return 25.4;
}

/** A drawing record (LINE / ARC / CIRCLE / RECTANGLE) as a polyline, or null. ARC goes counter-clockwise start to end. */
function geom(t: string[], k: number): V2[] | null {
  const v = t.slice(1).map((x) => +x * k);
  switch (t[0].toUpperCase()) {
    case 'LINE': return [[v[0], v[1]], [v[2], v[3]]];
    case 'ARC': {
      const a: V2 = [v[0], v[1]], e: V2 = [v[2], v[3]], c: V2 = [v[4], v[5]];
      let sw = Math.atan2(e[1] - c[1], e[0] - c[0]) - Math.atan2(a[1] - c[1], a[0] - c[0]);
      while (sw <= 1e-9) sw += 2 * Math.PI;
      return arcCenter(c, a, (sw * 180) / Math.PI);
    }
    case 'CIRCLE': return arcCenter([v[0], v[1]], [v[0] + v[2], v[1]], 360);
    case 'RECTANGLE': return [[v[0], v[1]], [v[0] + v[2], v[1]], [v[0] + v[2], v[1] + v[3]], [v[0], v[1] + v[3]], [v[0], v[1]]];
  }
  return null;
}

export function importGencad(text: string, fileName = 'board.cad'): Board {
  const secs = sections(text);
  const sec = (n: string) => secs.find((s) => s.name === n);
  const header = sec('HEADER');
  if (!header || !header.lines.some((l) => /^GENCAD$/i.test(l[0] ?? ''))) throw new Error('Not a GenCAD file (no $HEADER with GENCAD).');
  const k = unitK(header.lines.find((l) => /^UNITS$/i.test(l[0])));
  const name = header.lines.find((l) => /^DRAWING$/i.test(l[0]))?.[1] || fileName.replace(/\.(cad|gcd|gencad)$/i, '');

  // board outline: drawing records at the top of $BOARD belong to the outline, those after CUTOUT to a cut-out
  const board = sec('BOARD');
  if (!board) throw new Error('This GenCAD file has no $BOARD section (no outline).');
  let thickness = 1.6;
  const paths: V2[][] = [];
  let skip = false;
  for (const l of board.lines) {
    const w = l[0].toUpperCase();
    if (w === 'THICKNESS') { thickness = +l[1] * k || 1.6; continue; }
    if (w === 'CUTOUT') { skip = false; continue; }
    if (w === 'LAYER' || w === 'ATTRIBUTE') continue; // belong to the record before them
    if (w === 'MASK' || w === 'ARTWORK' || w === 'FIDUCIAL' || w === 'TRACK' || w === 'FILLED') { skip = true; continue; } // not the outline
    if (skip) continue;
    const g = geom(l, k);
    if (g) paths.push(g);
  }
  const loops: Loop[] = chainLoops(paths, 0.02);
  const ol = outlineFromLoops(loops);
  if (!ol) throw new Error('The GenCAD $BOARD outline does not close.');

  // pad drills and pad sizes (a padstack's drill wins over its pads')
  const padDrill = new Map<string, number>(), padSize = new Map<string, V2>();
  let curPad = '';
  for (const l of sec('PADS')?.lines ?? []) {
    if (/^PAD$/i.test(l[0])) { curPad = l[1]; padDrill.set(curPad, +(l[3] ?? 0) * k); padSize.set(curPad, [0, 0]); continue; }
    const g = curPad ? geom(l, k) : null;
    if (g) { const bb = bbox(g), s = padSize.get(curPad)!; padSize.set(curPad, [Math.max(s[0], bb.x1 - bb.x0, 2 * Math.max(Math.abs(bb.x0), Math.abs(bb.x1))), Math.max(s[1], bb.y1 - bb.y0, 2 * Math.max(Math.abs(bb.y0), Math.abs(bb.y1)))]); }
  }
  let curStack = '';
  for (const l of sec('PADSTACKS')?.lines ?? []) {
    if (/^PADSTACK$/i.test(l[0])) { curStack = l[1]; padDrill.set(curStack, +(l[2] ?? 0) * k); padSize.set(curStack, [0, 0]); continue; }
    if (/^PAD$/i.test(l[0]) && curStack) { const s = padSize.get(l[1]); const t = padSize.get(curStack)!; if (s) padSize.set(curStack, [Math.max(t[0], s[0]), Math.max(t[1], s[1])]); if (!padDrill.get(curStack)) padDrill.set(curStack, padDrill.get(l[1]) ?? 0); }
  }

  // shapes: body outline, pins (with their pad / padstack), height, through-hole or not; loose HOLE records too
  interface Shape { body: V2[]; pads: V2[]; pins: { n: string; at: V2; pad: string }[]; holes: { at: V2; d: number }[]; h: number; tht: boolean }
  const shapes = new Map<string, Shape>();
  let sh: Shape | null = null;
  for (const l of sec('SHAPES')?.lines ?? []) {
    const w = l[0].toUpperCase();
    if (w === 'SHAPE') { sh = { body: [], pads: [], pins: [], holes: [], h: 0, tht: false }; shapes.set(l[1], sh); continue; }
    if (!sh) continue;
    if (w === 'INSERT') { sh.tht = /^TH/i.test(l[1] ?? ''); continue; }
    if (w === 'HEIGHT') { sh.h = +l[1] * k; continue; }
    if (w === 'PIN') {
      const at: V2 = [+l[3] * k, +l[4] * k], s = padSize.get(l[2]) ?? [0, 0];
      sh.pins.push({ n: l[1], at, pad: l[2] });
      sh.pads.push([at[0] - s[0] / 2, at[1] - s[1] / 2], [at[0] + s[0] / 2, at[1] + s[1] / 2]);
      if ((padDrill.get(l[2]) ?? 0) > 0) sh.tht = true;
      continue;
    }
    if (w === 'HOLE') { sh.holes.push({ at: [+l[1] * k, +l[2] * k], d: +l[3] * k }); continue; }
    if (w === 'FIDUCIAL' || w === 'ARTWORK' || w === 'ATTRIBUTE') continue;
    const g = geom(l, k);
    if (g) sh.body.push(...g);
  }

  // devices: their package names
  const devPkg = new Map<string, string>();
  let dev = '';
  for (const l of sec('DEVICES')?.lines ?? []) {
    if (/^DEVICE$/i.test(l[0])) { dev = l[1]; continue; }
    if (dev && /^(PACKAGE|PART)$/i.test(l[0]) && l[1] && !devPkg.has(dev)) devPkg.set(dev, l[1]);
  }

  // nets on pins
  const netOf = new Map<string, string>();
  let sig = '';
  for (const l of sec('SIGNALS')?.lines ?? []) {
    if (/^SIGNAL$/i.test(l[0])) sig = l[1];
    else if (/^NODE$/i.test(l[0]) && sig) netOf.set(`${l[1]}|${l[2]}`, sig);
  }

  const raw: RawHole[] = [];
  const placed: ReturnType<typeof toComp>[] = [];
  // components and mechanical parts share their record layout
  const place = (lines: string[][], mech: boolean) => {
    let c: { ref: string; dev: string; x: number; y: number; bottom: boolean; rot: number; shape: string; mirror: boolean; value?: string } | null = null;
    const done = () => {
      if (!c) return;
      const s = shapes.get(c.shape);
      const pkg = [c.shape, devPkg.get(c.dev)].filter((x, i, a) => x && a.indexOf(x) === i).join(' ');
      const p: Placed = {
        ref: c.ref, pkg: pkg || c.dev, value: c.value, side: c.bottom ? 'bottom' : 'top', x: c.x, y: c.y, rot: c.rot, mirror: c.mirror,
        body: s?.body ?? [], pads: s?.pads ?? [], pins: (s?.pins ?? []).map((q) => ({ n: q.n, at: q.at, net: netOf.get(`${c!.ref}|${q.n}`) })), h: s?.h, tht: s?.tht,
      };
      const tf = placer(p);
      // pins with a drill are holes: a mounting part's become mounting holes, others are leads
      for (const q of s?.pins ?? []) {
        const d = padDrill.get(q.pad) ?? 0;
        if (d > 0) { const [x, y] = tf(q.at); raw.push({ x, y, d, plated: true, mount: mech && isMountPkg(pkg || c.ref) }); }
      }
      for (const hh of s?.holes ?? []) { const [x, y] = tf(hh.at); raw.push({ x, y, d: hh.d, plated: false, mount: true }); }
      if (!mech) placed.push(toComp(p));
      c = null;
    };
    for (const l of lines) {
      const w = l[0].toUpperCase();
      if (w === 'COMPONENT' || w === 'MECH') { done(); c = { ref: l[1], dev: '', x: 0, y: 0, bottom: false, rot: 0, shape: '', mirror: false }; continue; }
      if (!c) continue;
      if (w === 'DEVICE') c.dev = l[1];
      else if (w === 'PLACE') { c.x = +l[1] * k; c.y = +l[2] * k; }
      else if (w === 'LAYER') { c.bottom = /^BOT/i.test(l[1] ?? ''); if (c.bottom) c.mirror = true; } // bottom parts are seen from the top: mirrored
      else if (w === 'ROTATION') c.rot = +l[1] || 0;
      else if (w === 'SHAPE') { c.shape = l[1]; c.mirror = c.bottom || /MIRROR|FLIP/i.test(l.slice(2).join(' ')); }
      else if (w === 'VALUE') c.value = l[1];
      else if (w === 'HOLE') raw.push({ x: +l[1] * k, y: +l[2] * k, d: +l[3] * k, plated: false, mount: true });
    }
    done();
  };
  place(sec('COMPONENTS')?.lines ?? [], false);
  place(sec('MECH')?.lines ?? [], true);
  for (const l of board.lines) if (/^HOLE$/i.test(l[0])) raw.push({ x: +l[1] * k, y: +l[2] * k, d: +l[3] * k, plated: false, mount: true });

  const holes = sortHoles(raw, placed);
  const comps = placed.filter((c) => !isMountPkg(c.comp.pkg)).map((c) => c.comp);
  const notes: string[] = [];
  if (!holes.length) notes.push('No mounting holes found in the GenCAD file: add them by hand if the board has any.');
  const out: Board = { name, outline: ol.outline, cutouts: ol.cutouts, thickness, holes, comps, source: `GenCAD: ${fileName}`, notes };
  return finishBoard(out, { sizesKnown: true, heightsKnown: true });
}
