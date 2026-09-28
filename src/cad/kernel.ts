// Thin layer over manifold-3d (robust mesh booleans, always-manifold output) with automatic memory cleanup.
// Every WASM object created through the wrapped API is tracked and freed by `freeAll()` after a build.
import Module from 'manifold-3d';
import type { CrossSection as CS, Manifold as MF } from 'manifold-3d';
import type { Loop, MeshData, V2 } from '../model/types';

export type { CS, MF };
type Wasm = Awaited<ReturnType<typeof Module>>;

let wasm: Wasm | null = null;
const live: { delete(): void }[] = [];

function track<T>(x: T): T {
  if (Array.isArray(x)) x.forEach(track);
  else if (x && typeof (x as any).delete === 'function') live.push(x as any);
  return x;
}

function wrap(proto: any, names: string[]) {
  for (const n of names) {
    const orig = proto[n];
    if (typeof orig !== 'function' || orig.__tracked) continue;
    const f = function (this: any, ...a: any[]) { return track(orig.apply(this, a)); };
    (f as any).__tracked = true;
    proto[n] = f;
  }
}

export async function initKernel(wasmUrl?: string): Promise<Wasm> {
  if (wasm) return wasm;
  const w = await Module(wasmUrl ? { locateFile: () => wasmUrl } : undefined);
  w.setup();
  const M = w.Manifold as any, C = w.CrossSection as any;
  wrap(M.prototype, ['add', 'subtract', 'intersect', 'decompose', 'warp', 'transform', 'translate', 'rotate', 'scale', 'mirror', 'refine', 'asOriginal', 'trimByPlane', 'split', 'splitByPlane', 'hull', 'slice', 'project', 'simplify', 'setTolerance']);
  wrap(M, ['cube', 'cylinder', 'sphere', 'tetrahedron', 'extrude', 'revolve', 'union', 'difference', 'intersection', 'hull', 'compose', 'ofMesh']);
  wrap(C.prototype, ['add', 'subtract', 'intersect', 'decompose', 'warp', 'transform', 'translate', 'rotate', 'scale', 'mirror', 'offset', 'simplify', 'hull', 'extrude', 'revolve']);
  wrap(C, ['square', 'circle', 'union', 'difference', 'intersection', 'hull', 'compose', 'ofPolygons']);
  wasm = w;
  return w;
}

export function K(): Wasm {
  if (!wasm) throw new Error('Geometry kernel not initialised');
  return wasm;
}

export function freeAll() {
  while (live.length) {
    const o = live.pop()!;
    try { o.delete(); } catch { /* already freed */ }
  }
}

// ---------------- 2D ----------------
export function poly(loops: Loop | Loop[], fill: 'Positive' | 'EvenOdd' | 'NonZero' = 'EvenOdd'): CS {
  const ls = (loops.length && typeof (loops as Loop)[0][0] === 'number' ? [loops as Loop] : (loops as Loop[])).filter((l) => l.length >= 3);
  if (!ls.length) return emptyCS();
  return track(new (K().CrossSection)(ls as V2[][], fill));
}

export const emptyCS = (): CS => K().CrossSection.square([0, 0]);

export function rect2(x0: number, y0: number, x1: number, y1: number): CS {
  return poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
}

export function circle2(x: number, y: number, r: number, n?: number): CS {
  return K().CrossSection.circle(r, n ?? segs(r)).translate([x, y]);
}

export function segs(r: number) {
  return Math.max(16, Math.min(128, Math.ceil((2 * Math.PI * r) / 0.45)));
}

export function unionCS(list: CS[]): CS {
  const l = list.filter((c) => c && !c.isEmpty());
  if (!l.length) return emptyCS();
  return l.length === 1 ? l[0] : K().CrossSection.union(l);
}

/** Round convex and concave corners of a region by r (opening then closing). */
export function roundCS(c: CS, r: number): CS {
  if (r <= 0) return c;
  return c.offset(-r, 'Round').offset(2 * r, 'Round').offset(-r, 'Round');
}

// ---------------- 3D ----------------
export const emptyMF = () => K().Manifold.cube([0, 0, 0]);

export function ext(c: CS, z0: number, z1: number): MF {
  if (z1 - z0 <= 1e-6 || c.isEmpty()) return emptyMF();
  return c.extrude(z1 - z0).translate([0, 0, z0]);
}

/**
 * Extrusion with stepped 45 degree chamfers (0.2 mm steps = one layer), so printed edges look chamfered
 * and the first layer is inset against elephant's foot.
 */
export function extCh(c: CS, z0: number, z1: number, top = 0, bot = 0, step = 0.2): MF {
  const parts: MF[] = [];
  const nb = Math.round(bot / step), nt = Math.round(top / step);
  const za = z0 + nb * step, zb = z1 - nt * step;
  if (zb > za) parts.push(ext(c, za, zb));
  // each chamfer step overlaps its neighbours by a hair, so the union fuses them instead of leaving touching solids
  const e = 0.002;
  for (let i = 0; i < nb; i++) { const s = c.offset(-(nb - i) * step, 'Round'); if (!s.isEmpty()) parts.push(ext(s, z0 + i * step, Math.min(z1, z0 + (i + 1) * step + e))); }
  for (let i = 0; i < nt; i++) { const s = c.offset(-(i + 1) * step, 'Round'); if (!s.isEmpty()) parts.push(ext(s, Math.max(z0, zb + i * step - e), zb + (i + 1) * step)); }
  return unionMF(parts);
}

export function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): MF {
  return K().Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0]);
}

export function cyl(x: number, y: number, z0: number, z1: number, r0: number, r1 = r0, n?: number): MF {
  return K().Manifold.cylinder(z1 - z0, r0, r1, n ?? segs(Math.max(r0, r1))).translate([x, y, z0]);
}

export function unionMF(list: MF[]): MF {
  const l = list.filter((m) => m && !m.isEmpty());
  if (!l.length) return emptyMF();
  return l.length === 1 ? l[0] : K().Manifold.union(l);
}

/** Box in a local frame: s along d (unit, in XY), t along the left normal, z up. */
export function orientedBox(o: V2, d: V2, s0: number, s1: number, t0: number, t1: number, z0: number, z1: number): MF {
  const b = box(s0, t0, z0, s1, t1, z1);
  return b.transform(frame(o, d));
}

/** Profile in the (t, z) plane extruded along d from s0 to s1. */
export function sweepTZ(o: V2, d: V2, profile: CS, s0: number, s1: number): MF {
  // extrude along +Z, then map local x->t, y->z, z->s
  const m = profile.extrude(s1 - s0).translate([0, 0, s0]);
  const t: V2 = [-d[1], d[0]];
  // columns: local x -> (t, 0), local y -> (0,0,1), local z -> (d, 0)
  return m.transform([t[0], t[1], 0, 0, 0, 0, 1, 0, d[0], d[1], 0, 0, o[0], o[1], 0, 1] as any);
}

/** 4x4 column-major matrix of the frame (s = d, t = left normal, z) at origin o. */
export function frame(o: V2, d: V2): any {
  return [d[0], d[1], 0, 0, -d[1], d[0], 0, 0, 0, 0, 1, 0, o[0], o[1], 0, 1];
}

/** A closed mesh (at T, column-major, when given) as a solid, freed with the rest; null when it isn't closed. */
export function fromMesh(m: MeshData, T?: number[]): MF | null {
  try {
    const W = K() as any;
    const mesh = new W.Mesh({ numProp: 3, vertProperties: new Float32Array(m.pos), triVerts: new Uint32Array(m.idx) });
    mesh.merge();
    const s = track(new W.Manifold(mesh)) as MF;
    return T ? s.transform(T as any) : s;
  } catch { return null; }
}

export function toMesh(m: MF): MeshData {
  const mesh = m.getMesh();
  const np = mesh.numProp;
  const nv = mesh.vertProperties.length / np;
  const pos = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) { pos[i * 3] = mesh.vertProperties[i * np]; pos[i * 3 + 1] = mesh.vertProperties[i * np + 1]; pos[i * 3 + 2] = mesh.vertProperties[i * np + 2]; }
  return { pos, idx: new Uint32Array(mesh.triVerts) };
}

export function csLoops(c: CS): Loop[] {
  return c.toPolygons() as Loop[];
}
