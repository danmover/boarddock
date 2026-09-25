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
export interface Plate { items: Placed[]; used: V2 }

function footprint(p: PartOut): { x0: number; y0: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < p.mesh.pos.length; i += 3) {
    x0 = Math.min(x0, p.mesh.pos[i]); x1 = Math.max(x1, p.mesh.pos[i]);
    y0 = Math.min(y0, p.mesh.pos[i + 1]); y1 = Math.max(y1, p.mesh.pos[i + 1]);
  }
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * MaxRects bin packing (best short-side fit, 90 degree rotation allowed). Parts keep their print orientation.
 * Fewest plates wins; each plate becomes one STL/3MF.
 */
export function packPlates(parts: PartOut[], bed: V2, spacing: number, copies = 1): Plate[] {
  type R = { x: number; y: number; w: number; h: number };
  const items: { part: PartOut; copy: number; w: number; h: number }[] = [];
  for (const p of parts) for (let c = 0; c < p.qty * copies; c++) { const f = footprint(p); items.push({ part: p, copy: c, w: f.w + spacing, h: f.h + spacing }); }
  items.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h);
  const plates: { free: R[]; placed: Placed[] }[] = [];
  const W = bed[0] + spacing, Hh = bed[1] + spacing;
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
  const out = plates.map((pl) => {
    let ux = 0, uy = 0;
    for (const it of pl.placed) {
      const f = footprint(it.part);
      ux = Math.max(ux, it.x + (it.rot90 ? f.h : f.w));
      uy = Math.max(uy, it.y + (it.rot90 ? f.w : f.h));
    }
    return { items: pl.placed, used: [ux, uy] as V2 };
  });
  // parts bigger than the bed still get their own "plate" so nothing is lost
  for (const it of unplaceable) out.push({ items: [{ part: it.part, copy: it.copy, x: 0, y: 0, rot90: false }], used: [it.w, it.h] });
  return out;
}

/** Mesh of one placed item, moved onto the plate (rotation about z, then translation). */
export function placedMesh(it: Placed, bed: V2, used: V2): MeshData {
  const f = footprint(it.part);
  const m = it.part.mesh;
  const pos = new Float32Array(m.pos.length);
  // centre the used area on the bed
  const cx = (bed[0] - used[0]) / 2, cy = (bed[1] - used[1]) / 2;
  for (let i = 0; i < m.pos.length; i += 3) {
    let x = m.pos[i] - f.x0, y = m.pos[i + 1] - f.y0;
    if (it.rot90) { const t = x; x = f.h - y; y = t; }
    pos[i] = x + it.x + cx;
    pos[i + 1] = y + it.y + cy;
    pos[i + 2] = m.pos[i + 2];
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
