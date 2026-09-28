// IPC-2581 (the open XML "Offspring" format; revisions A, B and C). Allegro, OrCAD, PADS, Xpedition, Altium,
// Zuken and others can export it. Read: the board profile (outline and cut-outs), board thickness from the
// stack-up, drilled holes (plated, non-plated, vias) from the drill layers, and every component with its package:
// body outline (or pads, for the size), height when given, pin positions and their nets.
import type { Board, Loop, V2 } from '../model/types';
import { arcCenter, outlineFromLoops } from '../geom/poly';
import { finishBoard } from './common';
import { findAll, kidOf, kidsOf, parseXml, type XEl } from './xml';
import { isMountPkg, sortHoles, toComp, type Placed, type RawHole } from './place';

/** Does this text look like an IPC-2581 file? (checked on its first few kilobytes) */
export const isIpc2581 = (head: string) => /<(\w+:)?IPC-2581\b/.test(head);

const unitK = (u: string | undefined, fallback = 1) => {
  const s = (u ?? '').toUpperCase();
  return s === 'INCH' ? 25.4 : s === 'MICRON' ? 0.001 : s === 'MILLIMETER' || s === 'MM' ? 1 : s === 'MIL' ? 0.0254 : fallback;
};

/** A Polygon / Cutout / Contour element as a closed loop (PolyBegin, then straight and curved steps). */
function polyLoop(el: XEl, k: number): Loop {
  const pts: V2[] = [];
  const P = (e: XEl, xa = 'x', ya = 'y'): V2 => [(+(e.a[xa] ?? 0)) * k, (+(e.a[ya] ?? 0)) * k];
  for (const s of el.kids) {
    if (s.name === 'PolyBegin') pts.push(P(s));
    else if (s.name === 'PolyStepSegment') pts.push(P(s));
    else if (s.name === 'PolyStepCurve' && pts.length) {
      const a = pts[pts.length - 1], e = P(s), c = P(s, 'centerX', 'centerY');
      const cw = /^(true|1|yes)$/i.test(s.a.clockwise ?? 'false');
      let sw = Math.atan2(e[1] - c[1], e[0] - c[0]) - Math.atan2(a[1] - c[1], a[0] - c[0]);
      if (cw) { while (sw >= 0) sw -= 2 * Math.PI; } else { while (sw <= 0) sw += 2 * Math.PI; }
      if (Math.hypot(e[0] - a[0], e[1] - a[1]) < 1e-9) sw = cw ? -2 * Math.PI : 2 * Math.PI; // start = end: a full circle
      pts.push(...arcCenter(c, a, (sw * 180) / Math.PI).slice(1));
    }
  }
  if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6) pts.pop();
  return pts;
}

/** The size (width, height) of a standard pad shape from the dictionary. */
function primSize(e: XEl | undefined, k: number): V2 {
  if (!e) return [0, 0];
  const n = (a: string) => (+(e.a[a] ?? 0)) * k;
  switch (e.name) {
    case 'Circle': return [n('diameter'), n('diameter')];
    case 'Donut': case 'Thermal': return [n('outerDiameter'), n('outerDiameter')];
    case 'Octagon': case 'Hexagon': { const d = n('length') || n('diameter') || n('width'); return [d, d]; }
    case 'Contour': { const p = kidOf(e, 'Polygon'); if (!p) return [0, 0]; const l = polyLoop(p, k); if (!l.length) return [0, 0]; const xs = l.map((q) => q[0]), ys = l.map((q) => q[1]); return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]; }
    default: return [n('width'), n('height')];
  }
}

export function importIpc2581(text: string, fileName = 'board.xml'): Board {
  const doc = parseXml(text);
  const top = doc.kids.find((e) => e.name === 'IPC-2581');
  if (!top) throw new Error('Not an IPC-2581 file (no <IPC-2581> element).');
  const ecad = kidOf(top, 'Ecad');
  const cad = kidOf(ecad, 'CadData');
  if (!cad) throw new Error('This IPC-2581 file has no design data (its Ecad section is missing). Export it with the "full" or "assembly" function mode.');
  const k = unitK(kidOf(ecad, 'CadHeader')?.a.units, 1);

  // pad shapes, each with its own units
  const prim = new Map<string, V2>();
  for (const dict of findAll(kidOf(top, 'Content'), 'DictionaryStandard').concat(findAll(kidOf(top, 'Content'), 'DictionaryUser'))) {
    const dk = unitK(dict.a.units, k);
    for (const ent of dict.kids) { const shape = ent.kids.find((c) => c.name !== 'LineDesc' && c.name !== 'FillDesc'); if (ent.a.id && shape) prim.set(ent.a.id, primSize(shape, dk)); }
  }

  // the board step: the one with a profile and the most parts (a panel's step repeats boards and holds none)
  const steps = kidsOf(cad, 'Step').filter((s) => kidOf(s, 'Profile'));
  if (!steps.length) throw new Error('This IPC-2581 file has no board profile (outline).');
  const score = (s: XEl) => kidsOf(s, 'Component').length - (kidOf(s, 'StepRepeat') ? 1e6 : 0);
  const step = [...steps].sort((a, b) => score(b) - score(a))[0];

  const loops: Loop[] = [];
  const prof = kidOf(step, 'Profile')!;
  for (const e of prof.kids) if (e.name === 'Polygon' || e.name === 'Cutout') { const l = polyLoop(e, k); if (l.length >= 3) loops.push(l); }
  const ol = outlineFromLoops(loops);
  if (!ol) throw new Error('The IPC-2581 board profile does not form a closed shape.');

  // layer sides (TOP / BOTTOM) for component placement
  const sideOf = new Map<string, string>();
  for (const L of kidsOf(cad, 'Layer')) sideOf.set(L.a.name ?? '', (L.a.side ?? '').toUpperCase());
  const stack = kidOf(cad, 'Stackup');
  const thickness = +(stack?.a.overallThickness ?? 0) * k || 1.6;

  // nets on pins: LogicalNet > PinRef
  const netOf = new Map<string, string>();
  for (const n of findAll(step, 'LogicalNet')) for (const r of kidsOf(n, 'PinRef')) netOf.set(`${r.a.componentRef}|${r.a.pin}`, n.a.name ?? '');
  // values and part numbers from the bill of materials
  const valueOf = new Map<string, string>();
  for (const it of kidsOf(top, 'Bom').flatMap((b) => kidsOf(b, 'BomItem'))) {
    const v = findAll(it, 'Textual').find((t) => /value/i.test(t.a.textualCharacteristicName ?? ''))?.a.textualCharacteristicValue ?? '';
    for (const r of kidsOf(it, 'RefDes')) if (v) valueOf.set(r.a.name ?? '', v);
  }

  // packages: body outline, pads, pins, height
  const pkgs = new Map<string, { body: V2[]; pads: V2[]; pins: { n: string; at: V2 }[]; h: number; tht: boolean }>();
  for (const p of kidsOf(step, 'Package')) {
    const outline = kidOf(p, 'Outline') ?? kidOf(kidOf(p, 'AssemblyDrawing'), 'Outline');
    const body: V2[] = [];
    for (const poly of findAll(outline, 'Polygon')) body.push(...polyLoop(poly, k));
    for (const ln of findAll(outline, 'Line')) body.push([+(ln.a.startX ?? 0) * k, +(ln.a.startY ?? 0) * k], [+(ln.a.endX ?? 0) * k, +(ln.a.endY ?? 0) * k]);
    const pads: V2[] = [], pins: { n: string; at: V2 }[] = [];
    let tht = false;
    const padAt = (e: XEl, name?: string) => {
      const loc = kidOf(e, 'Location');
      if (!loc) return;
      const at: V2 = [+(loc.a.x ?? 0) * k, +(loc.a.y ?? 0) * k];
      let [w, h] = prim.get(kidOf(e, 'StandardPrimitiveRef')?.a.id ?? '') ?? primSize(e.kids.find((c) => /^(Circle|RectCenter|Oval|RectRound|RectCham|Contour|Octagon)$/.test(c.name)), k);
      const r = Math.abs(+(kidOf(e, 'Xform')?.a.rotation ?? 0)) % 180;
      if (r > 45 && r < 135) [w, h] = [h, w];
      pads.push([at[0] - w / 2, at[1] - h / 2], [at[0] + w / 2, at[1] + h / 2]);
      if (name != null) pins.push({ n: name, at });
    };
    for (const pin of kidsOf(p, 'Pin')) { padAt(pin, pin.a.number ?? pin.a.name ?? String(pins.length + 1)); if (/THRU/i.test(pin.a.type ?? '')) tht = true; }
    if (!pads.length) for (const pad of findAll(kidOf(p, 'LandPattern'), 'Pad')) padAt(pad);
    pkgs.set(p.a.name ?? '', { body, pads, pins, h: +(p.a.height ?? 0) * k, tht });
  }

  const placed: { comp: ReturnType<typeof toComp>['comp']; pinsOnBoard: V2[]; sized: boolean }[] = [];
  for (const c of kidsOf(step, 'Component')) {
    const ref = c.a.refDes ?? '?';
    const pk = pkgs.get(c.a.packageRef ?? '');
    const xf = kidOf(c, 'Xform'), loc = kidOf(c, 'Location');
    const side = /BOT/i.test(sideOf.get(c.a.layerRef ?? '') || c.a.layerRef || '') ? 'bottom' : 'top';
    const mirror = /^(true|1)$/i.test(xf?.a.mirror ?? '') || side === 'bottom';
    const pkgName = `${c.a.packageRef ?? ''}${c.a.part && c.a.part !== c.a.packageRef ? ` ${c.a.part}` : ''}`.trim();
    const p: Placed = {
      ref, pkg: pkgName, value: valueOf.get(ref), side,
      x: (+(loc?.a.x ?? 0) + +(xf?.a.xOffset ?? 0)) * k, y: (+(loc?.a.y ?? 0) + +(xf?.a.yOffset ?? 0)) * k,
      rot: +(xf?.a.rotation ?? 0), mirror,
      body: pk?.body ?? [], pads: pk?.pads ?? [], pins: (pk?.pins ?? []).map((q) => ({ ...q, net: netOf.get(`${ref}|${q.n}`) })),
      h: +(c.a.height ?? 0) * k || pk?.h || 0, tht: pk?.tht || /THMT|THT|THRU/i.test(c.a.mountType ?? ''),
    };
    placed.push(toComp(p));
  }

  // drilled holes: Hole (revision B/C) or LayerHole (revision A) elements in the step's layer features
  const raw: RawHole[] = [];
  for (const lf of kidsOf(step, 'LayerFeature')) {
    for (const h of findAll(lf, 'Hole').concat(findAll(lf, 'LayerHole'))) {
      const st = (h.a.platingStatus ?? 'PLATED').toUpperCase();
      raw.push({ x: +(h.a.x ?? 0) * k, y: +(h.a.y ?? 0) * k, d: +(h.a.diameter ?? 0) * k, plated: st !== 'NONPLATED', via: st === 'VIA' });
    }
  }
  const holes = sortHoles(raw, placed);
  const comps = placed.filter((c) => !isMountPkg(c.comp.pkg)).map((c) => c.comp);
  const unsized = placed.filter((c) => !c.sized).length;
  const notes: string[] = [];
  if (unsized) notes.push(`${unsized} part${unsized > 1 ? 's have' : ' has'} no package outline or pads in the file: ${unsized > 1 ? 'their sizes are' : 'its size is'} guessed from the package name.`);
  if (!raw.length) notes.push('The file has no drill layer: add mounting holes by hand, or export IPC-2581 with drill data.');
  const board: Board = { name: fileName.replace(/\.(xml|cvg|ipc|2581)$/i, ''), outline: ol.outline, cutouts: ol.cutouts, thickness, holes, comps, source: `IPC-2581: ${fileName}`, notes };
  return finishBoard(board, { sizesKnown: true, heightsKnown: true });
}

