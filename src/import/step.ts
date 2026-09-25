// STEP import (any EDA tool exports a board STEP: Altium, KiCad, Fusion, EasyEDA, OrCAD...).
// The PCB body is the thin, largest-footprint solid; its top-face boundary gives the outline, round inner loops
// give holes, and every other solid becomes a component box with its real height.
import type { Board, Comp, Hole, Loop, V2 } from '../model/types';
import { area, bbox, chainLoops, uid } from '../geom/poly';
import { finishBoard } from './common';

export interface StepMesh { name: string; pos: Float32Array | number[]; idx: Uint32Array | number[] }

type Axis = 0 | 1 | 2;

export function boardFromMeshes(meshes: StepMesh[], fileName: string): Board {
  if (!meshes.length) throw new Error('The STEP file has no solids');
  const boxes = meshes.map((m) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < m.pos.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], m.pos[i + k]); hi[k] = Math.max(hi[k], m.pos[i + k]); }
    return { lo, hi, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
  });
  // board: smallest dimension 0.3..3.5 mm, largest product of the other two
  let bi = -1, best = 0, axis: Axis = 2;
  boxes.forEach((b, i) => {
    const ax = [0, 1, 2].sort((p, q) => b.size[p] - b.size[q])[0] as Axis;
    const t = b.size[ax];
    const a = b.size[(ax + 1) % 3] * b.size[(ax + 2) % 3];
    if (t >= 0.3 && t <= 3.5 && a > best) { best = a; bi = i; axis = ax; }
  });
  if (bi < 0) throw new Error('Could not find a board-like solid (0.3 to 3.5 mm thick) in the STEP file');
  const bb = boxes[bi];
  const thickness = bb.size[axis];
  // map to a frame where the board normal is +z
  const u = ((axis + 1) % 3) as Axis, v = ((axis + 2) % 3) as Axis;
  const to2 = (p: ArrayLike<number>, i: number): V2 => [p[i + u], p[i + v]];
  const top = bb.hi[axis], bot = bb.lo[axis];

  // outline = boundary edges of the faces lying in the top plane
  const bm = meshes[bi];
  const edgeCount = new Map<string, [number, number]>();
  const key = (p: V2) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
  const verts = new Map<string, V2>();
  for (let t = 0; t < bm.idx.length; t += 3) {
    const ia = bm.idx[t] * 3, ib = bm.idx[t + 1] * 3, ic = bm.idx[t + 2] * 3;
    const zs = [bm.pos[ia + axis], bm.pos[ib + axis], bm.pos[ic + axis]];
    if (zs.some((z) => Math.abs(z - top) > 0.01)) continue;
    const pts = [to2(bm.pos, ia), to2(bm.pos, ib), to2(bm.pos, ic)];
    const ks = pts.map(key);
    pts.forEach((p, k) => verts.set(ks[k], p));
    for (let e = 0; e < 3; e++) {
      const a = ks[e], b = ks[(e + 1) % 3];
      const kk = a < b ? `${a}|${b}` : `${b}|${a}`;
      const cur = edgeCount.get(kk);
      edgeCount.set(kk, cur ? [cur[0] + 1, 0] : [1, 0]);
    }
  }
  const segs: V2[][] = [];
  for (const [kk, [n]] of edgeCount) if (n === 1) { const [a, b] = kk.split('|'); segs.push([verts.get(a)!, verts.get(b)!]); }
  const loops = chainLoops(segs, 0.005);
  if (!loops.length) throw new Error('Could not trace the board outline from the STEP board solid');
  const outline = loops[0];
  const holes: Hole[] = [];
  const cutouts: Loop[] = [];
  for (const l of loops.slice(1)) {
    const b2 = bbox(l);
    const dx = b2.x1 - b2.x0, dy = b2.y1 - b2.y0;
    const round = Math.abs(dx - dy) < 0.05 && Math.abs(Math.abs(area(l)) - (Math.PI * dx * dx) / 4) < 0.08 * dx * dx;
    if (round && dx < 8) holes.push({ id: uid('h'), x: (b2.x0 + b2.x1) / 2, y: (b2.y0 + b2.y1) / 2, d: dx, plated: true, use: 'auto' });
    else cutouts.push(l);
  }
  // components: every other mesh, grouped by name
  const groups = new Map<string, { lo: number[]; hi: number[] }>();
  meshes.forEach((m, i) => {
    if (i === bi) return;
    const b = boxes[i];
    const g = groups.get(m.name + '#' + i);
    if (!g) groups.set(m.name + '#' + i, { lo: [...b.lo], hi: [...b.hi] });
  });
  const comps: Comp[] = [];
  for (const [name, g] of groups) {
    const mid = (g.lo[axis] + g.hi[axis]) / 2;
    const side = mid >= (top + bot) / 2 ? 'top' : 'bottom';
    const h = side === 'top' ? g.hi[axis] - top : bot - g.lo[axis];
    if (h <= 0.05) continue;
    const w = g.hi[u] - g.lo[u], l = g.hi[v] - g.lo[v];
    if (w > (bb.size[u] * 1.5) || l > bb.size[v] * 1.5) continue; // enclosures or panels in the same file
    const clean = name.replace(/#\d+$/, '');
    comps.push({ id: uid('c'), ref: refFrom(clean), pkg: clean, side, x: (g.lo[u] + g.hi[u]) / 2, y: (g.lo[v] + g.hi[v]) / 2, rot: 0, w, l, h, kind: 'generic', tht: false });
  }
  const board: Board = {
    name: fileName.replace(/\.(step|stp)$/i, ''), outline, cutouts, thickness: Math.round(thickness * 100) / 100, holes, comps,
    source: `STEP: ${fileName}`, notes: ['From STEP: component boxes are axis-aligned bounding boxes of each solid.'],
  };
  return finishBoard(board, { sizesKnown: true, heightsKnown: true });
}

function refFrom(name: string): string {
  const m = name.match(/\b([A-Z]{1,3}\d{1,4})\b/);
  return m ? m[1] : name.slice(0, 12);
}

let occtPromise: Promise<any> | null = null;

/** Lazy-load the OpenCascade WASM reader (about 8 MB) only when a STEP file is opened. */
export async function importStep(bytes: Uint8Array, fileName: string): Promise<Board> {
  if (!occtPromise) {
    occtPromise = (async () => {
      const [{ default: factory }, { default: wasmUrl }] = await Promise.all([
        import('occt-import-js'),
        import('occt-import-js/dist/occt-import-js.wasm?url'),
      ]);
      return (factory as any)({ locateFile: () => wasmUrl });
    })();
  }
  const occt = await occtPromise;
  const res = occt.ReadStepFile(bytes, { linearUnit: 'millimeter', linearDeflectionType: 'absolute_value', linearDeflection: 0.05, angularDeflection: 0.3 });
  if (!res.success) throw new Error('OpenCascade could not read this STEP file');
  const names: string[] = [];
  const walk = (node: any, path: string) => {
    const nm = node.name || path;
    for (const mi of node.meshes ?? []) names[mi] = nm;
    for (const c of node.children ?? []) walk(c, nm);
  };
  walk(res.root, 'part');
  const meshes: StepMesh[] = res.meshes.map((m: any, i: number) => ({ name: names[i] || m.name || `part${i}`, pos: m.attributes.position.array, idx: m.index.array }));
  return boardFromMeshes(meshes, fileName);
}
