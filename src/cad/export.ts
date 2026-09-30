// Exports: binary STL, 3MF (one object per part, positioned on the plate), and bed packing so all parts
// fit on as few plates (files) as possible.
import { zipSync, strToU8 } from 'fflate';
import type { MeshData, PartOut, V2 } from '../model/types';

export function writeStl(meshes: MeshData[], offsets: [number, number, number][] = []): Uint8Array {
  const nTri = meshes.reduce((s, m) => s + m.idx.length / 3, 0);
  const buf = new ArrayBuffer(84 + nTri * 50);
  const dv = new DataView(buf);
  const head = 'BoardDock STL';
  for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
  dv.setUint32(80, nTri, true);
  let o = 84;
  meshes.forEach((m, mi) => {
    const [ox, oy, oz] = offsets[mi] ?? [0, 0, 0];
    for (let t = 0; t < m.idx.length; t += 3) {
      const a = m.idx[t] * 3, b = m.idx[t + 1] * 3, c = m.idx[t + 2] * 3;
      const ax = m.pos[a] + ox, ay = m.pos[a + 1] + oy, az = m.pos[a + 2] + oz;
      const bx = m.pos[b] + ox, by = m.pos[b + 1] + oy, bz = m.pos[b + 2] + oz;
      const cx = m.pos[c] + ox, cy = m.pos[c + 1] + oy, cz = m.pos[c + 2] + oz;
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const L = Math.hypot(nx, ny, nz) || 1;
      nx /= L; ny /= L; nz /= L;
      for (const v of [nx, ny, nz, ax, ay, az, bx, by, bz, cx, cy, cz]) { dv.setFloat32(o, v, true); o += 4; }
      dv.setUint16(o, 0, true);
      o += 2;
    }
  });
  return new Uint8Array(buf);
}

export interface Placed { part: PartOut; copy: number; x: number; y: number; rot90: boolean }
/** `used`: the size the parts cover (no spacing counted); `edge`: how far they are from the nearest bed edge with the
 * plate centred on the bed, which is how placedMesh puts them (below 0: they hang over it). */
export interface Plate { items: Placed[]; used: V2; edge: number }

function footprint(p: PartOut): { x0: number; y0: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < p.mesh.pos.length; i += 3) {
    x0 = Math.min(x0, p.mesh.pos[i]); x1 = Math.max(x1, p.mesh.pos[i]);
    y0 = Math.min(y0, p.mesh.pos[i + 1]); y1 = Math.max(y1, p.mesh.pos[i + 1]);
  }
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * How far past a part's outline Kiri:Moto's rim reaches (mm), measured in its G-code (v4.7.0): the brim's seven 0.45 mm
 * loops touching the part reach 3.15, the skirt's one loop 3 mm out reaches 3.45.
 */
export const BRIM_OUT = 3.15, SKIRT_OUT = 3.45;
/** Kept between a brim or skirt and the bed's edge (mm). */
export const EDGE_CLEAR = 0.5;
/** Least space between two parts on a plate (mm): a brim each, with EDGE_CLEAR left between them, so brims never run together. */
export const MIN_SPACING = 2 * BRIM_OUT + EDGE_CLEAR;
/**
 * Room kept clear round the edge of the bed (mm): the brim or skirt goes there (with EDGE_CLEAR to spare) and nothing is
 * printed right at the edge. A part that only fits without it gets a plate to itself, centred on the bed.
 */
export const EDGE = 4;

/** Does a packed plate fit the bed at all, either way round (a part bigger than the bed gets a "plate" of its own that doesn't)? */
export function fitsBed(pl: { used: V2 }, bed: V2): boolean {
  const [w, h] = pl.used, t = 0.05;
  return (w <= bed[0] + t && h <= bed[1] + t) || (w <= bed[1] + t && h <= bed[0] + t);
}

/**
 * MaxRects bin packing (best short-side fit, 90 degree rotation allowed). Parts keep their print orientation.
 * Fewest plates wins; each plate becomes one STL/3MF. `spacing` is never less than MIN_SPACING (projects saved with
 * less get that much).
 */
export function packPlates(parts: PartOut[], bed: V2, spacing: number, copies = 1, margin = EDGE): Plate[] {
  spacing = Math.max(spacing, MIN_SPACING);
  type R = { x: number; y: number; w: number; h: number };
  const items: { part: PartOut; copy: number; w: number; h: number }[] = [];
  for (const p of parts) for (let c = 0; c < p.qty * copies; c++) { const f = footprint(p); items.push({ part: p, copy: c, w: f.w + spacing, h: f.h + spacing }); }
  items.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h);
  const plates: { free: R[]; placed: Placed[] }[] = [];
  // a margin round the edge of the bed: the skirt (or brim) goes there, and nothing is printed right at the edge
  const W = bed[0] - 2 * margin + spacing, Hh = bed[1] - 2 * margin + spacing;
  const place = (pl: { free: R[]; placed: Placed[] }, it: (typeof items)[0]) => {
    let best: { r: R; rot: boolean; score: number } | null = null;
    for (const r of pl.free) for (const rot of [false, true]) {
      const w = rot ? it.h : it.w, h = rot ? it.w : it.h;
      if (w <= r.w + 1e-6 && h <= r.h + 1e-6) {
        const score = Math.min(r.w - w, r.h - h);
        if (!best || score < best.score) best = { r, rot, score };
      }
    }
    if (!best) return false;
    const w = best.rot ? it.h : it.w, h = best.rot ? it.w : it.h;
    const n: R = { x: best.r.x, y: best.r.y, w, h };
    pl.placed.push({ part: it.part, copy: it.copy, x: n.x, y: n.y, rot90: best.rot });
    // split free rectangles (MaxRects)
    const next: R[] = [];
    for (const f of pl.free) {
      if (n.x >= f.x + f.w || n.x + n.w <= f.x || n.y >= f.y + f.h || n.y + n.h <= f.y) { next.push(f); continue; }
      if (n.x > f.x) next.push({ x: f.x, y: f.y, w: n.x - f.x, h: f.h });
      if (n.x + n.w < f.x + f.w) next.push({ x: n.x + n.w, y: f.y, w: f.x + f.w - n.x - n.w, h: f.h });
      if (n.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: n.y - f.y });
      if (n.y + n.h < f.y + f.h) next.push({ x: f.x, y: n.y + n.h, w: f.w, h: f.y + f.h - n.y - n.h });
    }
    pl.free = next.filter((a, i) => !next.some((b, j) => j !== i && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h && (j < i || a.w !== b.w || a.h !== b.h || a.x !== b.x || a.y !== b.y)));
    return true;
  };
  const unplaceable: typeof items = [];
  for (const it of items) {
    if (Math.min(it.w, it.h) > Math.min(W, Hh) || Math.max(it.w, it.h) > Math.max(W, Hh)) { unplaceable.push(it); continue; }
    let ok = false;
    for (const pl of plates) if (place(pl, it)) { ok = true; break; }
    if (!ok) {
      const pl = { free: [{ x: 0, y: 0, w: W, h: Hh }], placed: [] as Placed[] };
      plates.push(pl);
      if (!place(pl, it)) unplaceable.push(it);
    }
  }
  const room = (used: V2) => Math.min(bed[0] - used[0], bed[1] - used[1]) / 2;
  const out: Plate[] = plates.map((pl) => {
    let ux = 0, uy = 0;
    for (const it of pl.placed) {
      const f = footprint(it.part);
      ux = Math.max(ux, it.x + (it.rot90 ? f.h : f.w));
      uy = Math.max(uy, it.y + (it.rot90 ? f.w : f.h));
    }
    return { items: pl.placed, used: [ux, uy] as V2, edge: room([ux, uy]) };
  });
  // a part too big for the margin (or the bed) gets a plate of its own, the way round that fits the bed and centred on
  // its own size, so it sits on the bed when it can; `edge` says how much room that leaves for a brim
  for (const it of unplaceable) {
    const f = footprint(it.part), way = (w: number, h: number) => w <= bed[0] + 0.05 && h <= bed[1] + 0.05;
    const rot90 = !way(f.w, f.h) && way(f.h, f.w);
    const used: V2 = rot90 ? [f.h, f.w] : [f.w, f.h];
    out.push({ items: [{ part: it.part, copy: it.copy, x: 0, y: 0, rot90 }], used, edge: room(used) });
  }
  return out;
}

/** Mesh of one placed item, moved onto the plate (rotation about z, then translation). */
export function placedMesh(it: Placed, bed: V2, used: V2): MeshData {
  const f = footprint(it.part);
  const m = it.part.mesh;
  const pos = new Float32Array(m.pos.length);
  // every part sits on the bed, whatever pose it came in (a part below z = 0 would drop the whole plate)
  let z0 = Infinity;
  for (let i = 2; i < m.pos.length; i += 3) z0 = Math.min(z0, m.pos[i]);
  // centre the used area on the bed
  const cx = (bed[0] - used[0]) / 2, cy = (bed[1] - used[1]) / 2;
  for (let i = 0; i < m.pos.length; i += 3) {
    let x = m.pos[i] - f.x0, y = m.pos[i + 1] - f.y0;
    if (it.rot90) { const t = x; x = f.h - y; y = t; }
    pos[i] = x + it.x + cx;
    pos[i + 1] = y + it.y + cy;
    pos[i + 2] = m.pos[i + 2] - z0;
  }
  return { pos, idx: m.idx };
}

export function write3mf(objects: { name: string; mesh: MeshData }[]): Uint8Array {
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
  let res = '', build = '';
  objects.forEach((o, i) => {
    const id = i + 1;
    const v: string[] = [], t: string[] = [];
    for (let k = 0; k < o.mesh.pos.length; k += 3) v.push(`<vertex x="${o.mesh.pos[k].toFixed(4)}" y="${o.mesh.pos[k + 1].toFixed(4)}" z="${o.mesh.pos[k + 2].toFixed(4)}"/>`);
    for (let k = 0; k < o.mesh.idx.length; k += 3) t.push(`<triangle v1="${o.mesh.idx[k]}" v2="${o.mesh.idx[k + 1]}" v3="${o.mesh.idx[k + 2]}"/>`);
    res += `<object id="${id}" name="${esc(o.name)}" type="model"><mesh><vertices>${v.join('')}</vertices><triangles>${t.join('')}</triangles></mesh></object>`;
    build += `<item objectid="${id}"/>`;
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">BoardDock</metadata><resources>${res}</resources><build>${build}</build></model>`;
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
    '3D/3dmodel.model': strToU8(model),
  });
}

/** Surface area of a mesh (for filament estimates). */
export function meshArea(m: MeshData): number {
  let a = 0;
  for (let t = 0; t < m.idx.length; t += 3) {
    const i = m.idx[t] * 3, j = m.idx[t + 1] * 3, k = m.idx[t + 2] * 3;
    const ux = m.pos[j] - m.pos[i], uy = m.pos[j + 1] - m.pos[i + 1], uz = m.pos[j + 2] - m.pos[i + 2];
    const vx = m.pos[k] - m.pos[i], vy = m.pos[k + 1] - m.pos[i + 1], vz = m.pos[k + 2] - m.pos[i + 2];
    a += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return a;
}

/** Rough filament and time estimate: 3 walls / 5 top-bottom layers (~1.2 mm skin) + 15% infill. */
export function estimate(p: PartOut, density: number) {
  const A = meshArea(p.mesh);
  const skin = Math.min(p.volume, A * 1.2 * 0.5);
  const extruded = skin + 0.15 * Math.max(0, p.volume - skin);
  const grams = (extruded / 1000) * density;
  const layers = p.size[2] / 0.2;
  const minutes = (extruded / 9 + layers * 2.5 + A * 0.02) / 60; // ~9 mm3/s average flow, per-layer overhead, travel
  return { grams, minutes, extruded };
}

/**
 * Printability of a part in its print pose: faces pointing down more steeply than 45 degrees that are not on the
 * bed (measured from the part's own bottom). Flat ones are bridges or ledges (fine when short); sloped ones need
 * support. `span`: the farthest any flat underside reaches from the wall that holds it, in plan. Returns the flagged
 * triangles too (the print plates paint them). The Check step's layer check is the finer tool (printcheck.ts).
 */
export function printability(m: MeshData) {
  const { pos, idx } = m;
  const nT = idx.length / 3;
  let z0 = Infinity;
  for (let i = 2; i < pos.length; i += 3) z0 = Math.min(z0, pos[i]);
  const kind = new Uint8Array(nT); // 0 ok, 1 slope overhang, 2 flat (bridge)
  let slope = 0, flat = 0;
  for (let t = 0; t < nT; t++) {
    const a = idx[3 * t] * 3, b = idx[3 * t + 1] * 3, c = idx[3 * t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz);
    if (L < 1e-12) continue;
    const zc = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
    if (zc < z0 + 0.3 || nz / L > -0.72) continue;
    const area = L / 2;
    if (nz / L < -0.985) { kind[t] = 2; flat += area; } else { kind[t] = 1; slope += area; }
  }
  // flat regions: triangles joined across shared edges
  const nv = pos.length / 3;
  const ek = (i: number, j: number) => (i < j ? i * nv + j : j * nv + i);
  const edges = new Map<number, number[]>();
  for (let t = 0; t < nT; t++) if (kind[t] === 2) for (let k = 0; k < 3; k++) {
    const key = ek(idx[3 * t + k], idx[3 * t + ((k + 1) % 3)]);
    const l = edges.get(key); if (l) l.push(t); else edges.set(key, [t]);
  }
  const parent = new Int32Array(nT).map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (const l of edges.values()) if (l.length === 2) parent[find(l[0])] = find(l[1]);
  // each region's edges on its rim are where the wall below holds it (the neighbour face goes down from there)
  const regions = new Map<number, { tris: number[]; rim: number[] }>();
  for (let t = 0; t < nT; t++) if (kind[t] === 2) { const r = find(t); (regions.get(r) ?? regions.set(r, { tris: [], rim: [] }).get(r)!).tris.push(t); }
  const rimEdges = new Map<number, number>(); // edge -> its flat triangle
  for (const [key, l] of edges) if (l.length === 1) rimEdges.set(key, l[0]);
  for (let t = 0; t < nT; t++) if (kind[t] !== 2) for (let k = 0; k < 3; k++) {
    const i = idx[3 * t + k], j = idx[3 * t + ((k + 1) % 3)], key = ek(i, j), ft = rimEdges.get(key);
    if (ft === undefined) continue;
    const o = idx[3 * t + ((k + 2) % 3)]; // the neighbour's third corner: below the edge means a wall going down holds it here
    if (pos[o * 3 + 2] < Math.max(pos[i * 3 + 2], pos[j * 3 + 2]) - 0.002) regions.get(find(ft))!.rim.push(i, j);
  }
  let span = 0;
  const triArea = (t: number) => {
    const a = idx[3 * t] * 3, b = idx[3 * t + 1] * 3, c = idx[3 * t + 2] * 3;
    return Math.abs((pos[b] - pos[a]) * (pos[c + 1] - pos[a + 1]) - (pos[c] - pos[a]) * (pos[b + 1] - pos[a + 1])) / 2;
  };
  for (const { tris, rim } of regions.values()) {
    const area = tris.reduce((a, t) => a + triArea(t), 0);
    if (area < 0.05) continue; // slivers where two faces meet: nothing prints there
    const d2 = (x: number, y: number) => {
      let best = Infinity;
      for (let k = 0; k < rim.length; k += 2) {
        const a = rim[k] * 3, b = rim[k + 1] * 3, dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1];
        const f = Math.max(0, Math.min(1, ((x - pos[a]) * dx + (y - pos[a + 1]) * dy) / (dx * dx + dy * dy || 1e-12)));
        best = Math.min(best, Math.hypot(x - pos[a] - f * dx, y - pos[a + 1] - f * dy));
      }
      return best;
    };
    // the farthest centre of a triangle from where it is held: how far this underside reaches out (a bridge: half its
    // span); held nowhere, all of it
    if (!rim.length) {
      if (area < 0.5) continue; // a fleck on a step no wider than a line (the layer check sees real islands)
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const t of tris) for (let k = 0; k < 3; k++) { const v = idx[3 * t + k] * 3; x0 = Math.min(x0, pos[v]); x1 = Math.max(x1, pos[v]); y0 = Math.min(y0, pos[v + 1]); y1 = Math.max(y1, pos[v + 1]); }
      span = Math.max(span, Math.hypot(x1 - x0, y1 - y0));
      continue;
    }
    let far = 0;
    const step = Math.max(1, Math.floor(tris.length / 400));
    const nMax = Math.max(1, Math.floor(Math.sqrt(6000 / Math.ceil(tris.length / step)))); // (about 3000 points a region)
    for (let q = 0; q < tris.length; q += step) {
      const t = tris[q], a = idx[3 * t] * 3, b = idx[3 * t + 1] * 3, c = idx[3 * t + 2] * 3;
      // points over the triangle about 0.5 mm apart
      const L = Math.max(Math.hypot(pos[b] - pos[a], pos[b + 1] - pos[a + 1]), Math.hypot(pos[c] - pos[a], pos[c + 1] - pos[a + 1]), Math.hypot(pos[c] - pos[b], pos[c + 1] - pos[b + 1]));
      const n = Math.min(nMax, Math.max(1, Math.ceil(L / 0.5)));
      for (let i = 0; i <= n; i++) for (let j = 0; i + j <= n; j++) {
        const u = i / n, v = j / n, w = 1 - u - v;
        far = Math.max(far, d2(pos[a] * w + pos[b] * u + pos[c] * v, pos[a + 1] * w + pos[b + 1] * u + pos[c + 1] * v));
      }
    }
    span = Math.max(span, far);
  }
  return { slope, flat, span, kind };
}
