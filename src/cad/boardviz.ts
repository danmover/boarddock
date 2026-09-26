// Display models of a board for the 3D view: soldermask with gold pads and silkscreen, and every part shaped
// after what it is (metal connector shells with their openings, headers with gold pins, chips with legs, jacks,
// LEDs, passives), plus realistic plugs with cables. Built once per board (the module cache keeps them).
import type { Anim, Board, Comp, Ghost, MeshData, PickTag, V2 } from '../model/types';
import { bbox, compRect, inside, rad } from '../geom/poly';
import { textStrokes, textWidth } from './font';
import { box, circle2, cyl, ext, poly, toMesh, type MF } from './kernel';
import { K } from './kernel';

type Mat = NonNullable<Ghost['mat']>;

/** Collects primitives per material; boxes go straight to triangles, solids through the kernel. */
class Bin {
  meshes = new Map<Mat, MeshData[]>();
  solids = new Map<Mat, MF[]>();
  add(mat: Mat, m: MF) { (this.solids.get(mat) ?? this.solids.set(mat, []).get(mat)!).push(m); }
  box(mat: Mat, T: number[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    (this.meshes.get(mat) ?? this.meshes.set(mat, []).get(mat)!).push(boxMesh(T, x0, y0, z0, x1, y1, z1));
  }
  ghosts(name: string, tag: PickTag, anim: Anim, color: Partial<Record<Mat, string>> = {}): Ghost[] {
    const out: Ghost[] = [];
    const mats = new Set<Mat>([...this.meshes.keys(), ...this.solids.keys()]);
    for (const mat of mats) {
      const list = [...(this.meshes.get(mat) ?? [])];
      const sol = this.solids.get(mat);
      if (sol?.length) list.push(toMesh(sol.length === 1 ? sol[0] : K().Manifold.compose(sol)));
      if (!list.length) continue;
      out.push({ name: `${name} ${mat}`, mesh: merge(list), color: color[mat] ?? MAT_COLOR[mat], opacity: mat === 'led' ? 0.85 : 1, tag, anim, mat });
    }
    return out;
  }
}

export const MAT_COLOR: Record<Mat, string> = {
  mask: '#15603a', gold: '#d9aa3c', metal: '#c9d0d8', black: '#1d2024', chip: '#25282d', white: '#ece9e2', silk: '#f2f2ea',
  led: '#ffe066', passive: '#b89a6a', blue: '#2f5bd8', plug: '#2f3338', cable: '#24272b', copper: '#c87533',
  trace: '#2f9e63', tin: '#c9ced4', box: '#2b2f36',
};

function boxMesh(T: number[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): MeshData {
  const P = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const pos = new Float32Array(24);
  P.forEach(([x, y, z], i) => { pos[3 * i] = T[0] * x + T[4] * y + T[8] * z + T[12]; pos[3 * i + 1] = T[1] * x + T[5] * y + T[9] * z + T[13]; pos[3 * i + 2] = T[2] * x + T[6] * y + T[10] * z + T[14]; });
  const idx = new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
  return { pos, idx };
}

function merge(list: MeshData[]): MeshData {
  let np = 0, ni = 0;
  for (const m of list) { np += m.pos.length; ni += m.idx.length; }
  const pos = new Float32Array(np), idx = new Uint32Array(ni);
  let op = 0, oi = 0;
  for (const m of list) {
    pos.set(m.pos, op);
    const base = op / 3;
    for (let k = 0; k < m.idx.length; k++) idx[oi + k] = m.idx[k] + base;
    op += m.pos.length; oi += m.idx.length;
  }
  return { pos, idx };
}

/** Part frame: local x across w, y along l, z up from the board surface (or down for bottom-side parts). */
function frameOf(c: Comp, z: number, below: boolean): number[] {
  const a = rad(c.rot), ca = Math.cos(a), sa = Math.sin(a), f = below ? -1 : 1;
  return [ca, sa, 0, 0, -sa * f, ca * f, 0, 0, 0, 0, f, 0, c.x, c.y, z, 1];
}

const tf = (m: MF, T: number[]) => m.transform(T as any);

/** Which local side of the part the plug enters: +y, -y, +x or -x. */
function mouthSide(c: Comp): 'py' | 'ny' | 'px' | 'nx' {
  if (!c.conn) return 'py';
  const a = rad(c.conn.angle - c.rot);
  const dx = Math.cos(a), dy = Math.sin(a);
  return Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? 'py' : 'ny') : dx > 0 ? 'px' : 'nx';
}

/** Part detail. Local frame: body [-w/2, w/2] x [-l/2, l/2] x [0, h]; the mouth faces +y after `rot`. */
function partDetail(bin: Bin, c: Comp, zt: number, zb: number) {
  const below = c.side === 'bottom';
  const z0 = below ? zb : zt;
  let T = frameOf(c, z0, below);
  let w = c.w, l = c.l;
  const h = Math.max(0.2, c.h);
  // turn the local frame so the mouth is always +y
  const side = mouthSide(c);
  if (side !== 'py') {
    const turn = side === 'ny' ? 180 : side === 'px' ? -90 : 90;
    const a = rad(turn), ca = Math.cos(a), sa = Math.sin(a);
    T = mulT(T, [ca, sa, 0, 0, -sa, ca, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    if (side === 'px' || side === 'nx') [w, l] = [l, w];
  }
  const type = c.conn?.type ?? '';
  const name = `${c.pkg} ${c.ref} ${c.value ?? ''}`;
  const hx = w / 2, hy = l / 2;
  const B = (mat: Mat, x0: number, y0: number, a0: number, x1: number, y1: number, a1: number) => bin.box(mat, T, x0, y0, a0, x1, y1, a1);

  if (c.kind === 'header' || type === 'header' || /pin.?header|pin.?socket|conn_\d+x\d+|idc/i.test(name)) {
    const socket = /socket|female/i.test(name);
    const baseH = socket ? h : Math.min(2.5, h);
    B('black', -hx, -hy, 0, hx, hy, baseH);
    const nx = Math.max(1, Math.round(w / 2.54)), ny = Math.max(1, Math.round(l / 2.54));
    if (nx * ny <= 120) for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const px = (i - (nx - 1) / 2) * 2.54, py = (j - (ny - 1) / 2) * 2.54;
      if (socket) B('chip', px - 0.5, py - 0.5, h - 0.02, px + 0.5, py + 0.5, h + 0.01);
      else { B('gold', px - 0.32, py - 0.32, 0, px + 0.32, py + 0.32, h - 0.5); B('gold', px - 0.2, py - 0.2, h - 0.5, px + 0.2, py + 0.2, h); }
    }
    return;
  }
  if (c.conn?.entry === 'edge' || c.kind === 'connector') {
    const metalShell = /usb|hdmi|microsd|sma|rj45/.test(type) || /usb|hdmi|sd/i.test(name);
    if (type === 'barrel' || type === 'audio35') {
      const r = Math.min(w, h) * (type === 'barrel' ? 0.34 : 0.26);
      let body = box(-hx, -hy, 0, hx, hy, h);
      body = body.subtract(cylY(0, h / 2, r, hy - Math.min(l * 0.7, 9), hy + 1));
      bin.add('black', tf(body, T));
      bin.add('metal', tf(cylY(0, h / 2, r * 0.35, hy - Math.min(l * 0.7, 9), hy - 1.5), T));
      if (type === 'audio35') bin.add('black', tf(cylY(0, h / 2, r + 0.9, hy - 0.2, hy + 1.6).subtract(cylY(0, h / 2, r, hy - 1, hy + 2)), T));
      return;
    }
    if (type === 'terminal') {
      let body = box(-hx, -hy, 0, hx, hy, h);
      const n = Math.max(1, Math.round(w / 5.0));
      for (let i = 0; i < n; i++) {
        const px = (i - (n - 1) / 2) * (w / n);
        body = body.subtract(box(px - 1.4, hy - 3, h * 0.2, px + 1.4, hy + 1, h * 0.55)).subtract(cyl(px, -hy * 0.2, h - 2.5, h + 1, 1.3, 1.3, 16));
      }
      bin.add('blue', tf(body, T));
      return;
    }
    const t = Math.max(0.3, Math.min(0.6, Math.min(w, h) * 0.08));
    const depth = Math.min(l * 0.75, type === 'rj45' ? 13 : 7);
    let body = box(-hx, -hy, 0, hx, hy, h);
    let hole: MF;
    if (type === 'usb_c' || type === 'usb_micro_b' || type === 'hdmi_micro') {
      const hh = Math.max(0.6, h - 2 * t), ww = Math.max(1, w - 2 * t), r = Math.min(hh, ww) / 2;
      hole = ext(roundRect(ww, hh, r), 0, depth + 1).transform([-1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, hy - depth, h / 2, 1] as any);
      body = ext(roundRect(w, h, Math.min(w, h) / 2), 0, l).transform([-1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, -hy, h / 2, 1] as any);
    } else if (type === 'rj45') {
      hole = box(-hx + 2.2, hy - depth, 1.2, hx - 2.2, hy + 1, h - 2.5).add(box(-2, hy - depth, 0.4, 2, hy + 1, 1.3)); // latch slot
    } else if (type.startsWith('hdmi')) {
      // HDMI's trapezoid mouth
      const ww = w - 2 * t, hh = h - 2 * t, ch = Math.min(1.4, hh * 0.35);
      hole = ext(poly([[-ww / 2 + ch, 0], [ww / 2 - ch, 0], [ww / 2, ch], [ww / 2, hh], [-ww / 2, hh], [-ww / 2, ch]]), 0, depth + 1).transform([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, hy + 1, t, 1] as any);
    } else {
      hole = box(-hx + t, hy - depth, t + (type === 'microsd' ? 0 : 0.2), hx - t, hy + 1, h - t);
    }
    bin.add(metalShell ? 'metal' : 'black', tf(body.subtract(hole), T));
    // what you see inside the opening
    if (type === 'usb_a' || type === 'usb_a_dual' || type === 'usb_b') {
      const n = type === 'usb_a_dual' ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const zc = n === 1 ? h * 0.45 : h * (i ? 0.72 : 0.26);
        B(/3|blue/i.test(name) ? 'blue' : 'white', -hx + 2.4, hy - depth + 0.3, zc - 0.9, hx - 2.4, hy - 0.8, zc + 0.9);
        for (let c2 = 0; c2 < 4; c2++) { const cx = -hx + 3.2 + ((w - 6.4) * (c2 + 0.5)) / 4; B('gold', cx - 0.5, hy - depth + 1, zc + 0.9, cx + 0.5, hy - 1.2, zc + 1.0); }
      }
      // shell spring tabs on top
      B('metal', -hx * 0.5, hy - 5, h, -hx * 0.5 + 1.2, hy - 2, h + 0.25); B('metal', hx * 0.5 - 1.2, hy - 5, h, hx * 0.5, hy - 2, h + 0.25);
      B('black', -hx + t, hy - depth, t, hx - t, hy - depth + 0.3, h - t);
    } else if (type === 'usb_c' || type === 'usb_micro_b' || type === 'hdmi_micro' || type === 'hdmi_mini' || type === 'hdmi_a') {
      B('black', -hx * 0.62, hy - depth + 0.3, h / 2 - 0.3, hx * 0.62, hy - 0.9, h / 2 + 0.3);
      const nc = type === 'usb_c' ? 6 : 5;
      for (let c2 = 0; c2 < nc; c2++) { const cx = -hx * 0.55 + (hx * 1.1 * (c2 + 0.5)) / nc; B('gold', cx - 0.12, hy - depth + 0.8, h / 2 + 0.3, cx + 0.12, hy - 1.2, h / 2 + 0.36); }
      B('black', -hx + t, hy - depth, t, hx - t, hy - depth + 0.3, h - t);
    } else if (type === 'rj45') {
      B('black', -hx + 2.2, hy - depth, 1.2, hx - 2.2, hy - depth + 0.4, h - 2.5);
      for (let c2 = 0; c2 < 8; c2++) { const cx = -3.57 + c2 * 1.02; B('gold', cx - 0.2, hy - depth + 0.4, h - 3.3, cx + 0.2, hy - depth + 5, h - 2.55); }
      bin.box('led', T, -hx + 0.8, hy - 0.2, h - 2.1, -hx + 3.2, hy + 0.15, h - 0.6);
      bin.box('led', T, hx - 3.2, hy - 0.2, h - 2.1, hx - 0.8, hy + 0.15, h - 0.6);
    } else {
      B('black', -hx + t, hy - depth, t, hx - t, hy - depth + 0.3, h - t);
    }
    return;
  }
  if (c.kind === 'switch') {
    B('black', -hx, -hy, 0, hx, hy, h * 0.6);
    const s = Math.min(w, l) * 0.3;
    B('white', -s, -s, h * 0.6, s, s, h);
    return;
  }
  if (c.kind === 'led') { bin.box('led', T, -hx, -hy, 0, hx, hy, h); return; }
  if (c.kind === 'hot') {
    B('chip', -hx, -hy, 0, hx, hy, Math.max(0.2, h - 0.6));
    B('metal', -hx + 0.6, -hy + 0.6, Math.max(0.2, h - 0.6), hx - 0.6, hy - 0.6, h);
    return;
  }
  if (c.kind === 'module') {
    B('mask', -hx, -hy, 0, hx, hy, Math.min(1, h));
    if (h > 1.2) B('metal', -hx + 0.8, -hy + 0.8, Math.min(1, h), hx - 0.8, hy - 0.8, h);
    return;
  }
  if (c.kind === 'antenna') { B('white', -hx, -hy, 0, hx, hy, h); return; }
  // generic: ICs with legs, or small passives with metal ends
  if (Math.min(w, l) >= 3 && h <= 4) {
    const leg = 0.55, legH = Math.min(0.45, h * 0.5);
    B('chip', -hx + leg, -hy + leg, 0.15, hx - leg, hy - leg, h);
    const long = w >= l;
    const n = Math.min(16, Math.max(2, Math.floor(((long ? w : l) - 2 * leg) / 1.27)));
    for (let i = 0; i < n; i++) {
      const u = (i - (n - 1) / 2) * 1.27;
      if (long) { B('metal', u - 0.2, -hy, 0, u + 0.2, -hy + leg + 0.2, legH); B('metal', u - 0.2, hy - leg - 0.2, 0, u + 0.2, hy, legH); }
      else { B('metal', -hx, u - 0.2, 0, -hx + leg + 0.2, u + 0.2, legH); B('metal', hx - leg - 0.2, u - 0.2, 0, hx, u + 0.2, legH); }
    }
    B('silk', -hx + leg + 0.5, -hy + leg + 0.5, h, -hx + leg + 1.1, -hy + leg + 1.1, h + 0.02);
    return;
  }
  if (Math.max(w, l) < 7 && h <= 3) {
    const long = w >= l, e = Math.min(0.4, (long ? w : l) * 0.2);
    if (long) { B('passive', -hx + e, -hy, 0, hx - e, hy, h); B('metal', -hx, -hy, 0, -hx + e, hy, h); B('metal', hx - e, -hy, 0, hx, hy, h); }
    else { B('passive', -hx, -hy + e, 0, hx, hy - e, h); B('metal', -hx, -hy, 0, hx, -hy + e, h); B('metal', -hx, hy - e, 0, hx, hy, h); }
    return;
  }
  B('chip', -hx, -hy, 0, hx, hy, h);
}

const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return (0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255)) / 255; };

function silkText(bin: Bin, text: string, o: [number, number], hgt: number, zt: number) {
  const sw = Math.max(0.14, hgt * 0.13);
  for (const [a, b] of textStrokes(text, hgt)) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    const an = Math.atan2(dy, dx), ca = Math.cos(an), sa = Math.sin(an);
    const T = [ca, sa, 0, 0, -sa, ca, 0, 0, 0, 0, 1, 0, o[0] + a[0], o[1] + a[1], zt, 1];
    bin.box('silk', T, -sw / 2, -sw / 2, 0, L + sw / 2, sw / 2, 0.05);
  }
}

/** A spot on the board surface clear of parts for a label of w x h (bottom-left corner), or null. */
function findFree(b: Board, comps: Comp[], w: number, h: number): [number, number] | null {
  const bb = bbox(b.outline);
  const rects = comps.filter((c) => c.side === 'top').map((c) => bbox(compRect(c, 1)));
  const holes = b.holes.map((q) => ({ x0: q.x - q.d, y0: q.y - q.d, x1: q.x + q.d, y1: q.y + q.d }));
  for (let y = bb.y0 + 2; y + h < bb.y1 - 2; y += 1.5) for (let x = bb.x0 + 2; x + w < bb.x1 - 2; x += 1.5) {
    const box = { x0: x - 0.5, y0: y - 0.5, x1: x + w + 0.5, y1: y + h + 0.5 };
    if (![...rects, ...holes].some((r) => r.x0 < box.x1 && box.x0 < r.x1 && r.y0 < box.y1 && box.y0 < r.y1) && [[x, y], [x + w, y + h], [x, y + h], [x + w, y]].every((q) => inside(q as [number, number], b.outline))) return [x, y];
  }
  return null;
}

/** Deterministic pseudo-random numbers from a seed. */
function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h += 0x6d2b79f5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Plausible copper for boards that came without it (templates, drawings, fab files): each part's pins get short
 * escape stubs, then 45-degree routes to a pin of a nearby part, some dropping through a via to the bottom side.
 */
function fakeTraces(b: Board): NonNullable<Board['traces']> {
  const R = rng(b.name + b.comps.length);
  const out: NonNullable<Board['traces']> = [];
  const pins: { p: [number, number]; n: [number, number]; comp: number }[] = [];
  b.comps.forEach((c, ci) => {
    if (c.hidden || c.side !== 'top') return;
    const a = rad(c.rot), ca = Math.cos(a), sa = Math.sin(a);
    const at = (u: number, v: number): [number, number] => [c.x + u * ca - v * sa, c.y + u * sa + v * ca];
    const nrm = (u: number, v: number): [number, number] => [u * ca - v * sa, u * sa + v * ca];
    const long = c.w >= c.l;
    const n = Math.min(6, Math.max(1, Math.floor((long ? c.w : c.l) / 2.5)));
    for (let k = 0; k < n; k++) {
      const s2 = (k - (n - 1) / 2) * ((long ? c.w : c.l) / n);
      if (long) { pins.push({ p: at(s2, -c.l / 2), n: nrm(0, -1), comp: ci }); if (c.w * c.l > 12) pins.push({ p: at(s2, c.l / 2), n: nrm(0, 1), comp: ci }); }
      else { pins.push({ p: at(-c.w / 2, s2), n: nrm(-1, 0), comp: ci }); if (c.w * c.l > 12) pins.push({ p: at(c.w / 2, s2), n: nrm(1, 0), comp: ci }); }
    }
  });
  const ok = (q: [number, number]) => inside(q, b.outline);
  const seg = (a: [number, number], c: [number, number], w: number, side: 'top' | 'bottom') => { if (ok(a) && ok(c)) out.push({ a, b: c, w, side }); };
  const used = new Set<number>();
  pins.forEach((pi, i) => {
    if (used.has(i) || out.length > 700) return;
    // nearest pin on another part
    let best = -1, bd = Infinity;
    pins.forEach((pj, j) => { if (j === i || used.has(j) || pj.comp === pi.comp) return; const d = Math.hypot(pj.p[0] - pi.p[0], pj.p[1] - pi.p[1]); if (d < bd) { bd = d; best = j; } });
    if (best < 0 || bd > 40 || R() < 0.25) return;
    used.add(i); used.add(best);
    const w = R() < 0.2 ? 0.5 : 0.25;
    const a0 = pi.p, s0: [number, number] = [a0[0] + pi.n[0] * 1.2, a0[1] + pi.n[1] * 1.2];
    const pj = pins[best], b0 = pj.p, s1: [number, number] = [b0[0] + pj.n[0] * 1.2, b0[1] + pj.n[1] * 1.2];
    const dx = s1[0] - s0[0], dy = s1[1] - s0[1];
    const diag = Math.min(Math.abs(dx), Math.abs(dy));
    const mid: [number, number] = Math.abs(dx) > Math.abs(dy) ? [s1[0] - Math.sign(dx) * diag, s0[1]] : [s0[0], s1[1] - Math.sign(dy) * diag];
    const side = R() < 0.2 ? 'bottom' : 'top';
    seg(a0, s0, w, 'top'); seg(s0, mid, w, side); seg(mid, s1, w, side); seg(s1, b0, w, 'top');
  });
  return out;
}

/** Vias where fake routes change side. */
function fakeVias(tr: NonNullable<Board['traces']>): NonNullable<Board['vias']> {
  const out: NonNullable<Board['vias']> = [];
  for (let i = 0; i + 1 < tr.length; i++) if (tr[i].side !== tr[i + 1].side && Math.hypot(tr[i].b[0] - tr[i + 1].a[0], tr[i].b[1] - tr[i + 1].a[1]) < 1e-6) out.push({ x: tr[i].b[0], y: tr[i].b[1], d: 0.7 });
  return out;
}

function mulT(a: number[], b: number[]) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

function cylY(x: number, z: number, r: number, y0: number, y1: number): MF {
  return cyl(0, 0, 0, y1 - y0, r, r, 32).transform([-1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, x, y0, z, 1] as any);
}

function roundRect(w: number, h: number, r: number) {
  const rr = Math.max(0.05, Math.min(r, w / 2 - 0.01, h / 2 - 0.01));
  return poly([[-w / 2 + rr, -h / 2], [w / 2 - rr, -h / 2], [w / 2, -h / 2 + rr], [w / 2, h / 2 - rr], [w / 2 - rr, h / 2], [-w / 2 + rr, h / 2], [-w / 2, h / 2 - rr], [-w / 2, -h / 2 + rr]]).offset(0, 'Round');
}

/**
 * Ghosts of a board: soldermask slab with plated pads and silkscreen, and every part. `T` places them
 * (for boards bolted on top of another).
 */
export function boardDetail(b: Board, zb: number, zt: number, tag: PickTag, anim: Anim): Ghost[] {
  const bin = new Bin();
  if (b.kind === 'box') {
    // a closed device: rounded plastic housing with its ports as openings
    bin.add('box', ext(poly(b.outline), zb, zt - 0.6));
    bin.add('box', ext(poly(b.outline).offset(-0.6, 'Round'), zt - 0.61, zt));
    for (const c of b.comps) {
      if (c.hidden || !c.conn || c.conn.entry !== 'edge') continue;
      const t = c.conn.type, a = rad(c.conn.angle), d = [Math.cos(a), Math.sin(a)], tt = [-d[1], d[0]];
      const zc = zt + c.conn.zc;
      const pw = t === 'usb_a' ? 13 : t === 'barrel' ? 9 : Math.max(6, c.conn.plug.w * 0.65), ph = t === 'usb_a' ? 5.8 : t === 'barrel' ? 9 : Math.max(2.8, c.conn.plug.h * 0.45);
      // the mouth sits on the housing face: find it along d from the port position
      let s0 = 0;
      for (let k = 0; k < 60 && inside([c.x + d[0] * s0, c.y + d[1] * s0], b.outline); k++) s0 += 0.5;
      const T = [d[0], d[1], 0, 0, tt[0], tt[1], 0, 0, 0, 0, 1, 0, c.x + d[0] * s0, c.y + d[1] * s0, zc, 1];
      bin.box('black', T, -0.8, -pw / 2, -ph / 2, 0.08, pw / 2, ph / 2);
      if (t === 'usb_a') { bin.box('white', T, -0.7, -pw / 2 + 1.6, -0.7, 0.1, pw / 2 - 1.6, 0.9); bin.box('metal', T, -0.2, -pw / 2 - 0.4, -ph / 2 - 0.4, 0.12, pw / 2 + 0.4, -ph / 2); bin.box('metal', T, -0.2, -pw / 2 - 0.4, ph / 2, 0.12, pw / 2 + 0.4, ph / 2 + 0.4); }
      if (t === 'barrel') bin.box('metal', T, -0.7, -0.8, -0.8, 0.1, 0.8, 0.8);
    }
    const bb = bbox(b.outline);
    bin.box('led', [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, bb.x0 + 6, (bb.y0 + bb.y1) / 2, zt, 1], -1, -1, -0.02, 1, 1, 0.3);
    const nm = b.name.slice(0, 20), nh = Math.min(3.5, (bb.y1 - bb.y0) * 0.12);
    silkText(bin, nm, [(bb.x0 + bb.x1) / 2 - textWidth(nm, nh) / 2, (bb.y0 + bb.y1) / 2 - nh / 2], nh, zt);
    return bin.ghosts('board', tag, anim, { box: b.color ?? '#2b2f36', silk: b.color && lum(b.color) > 0.6 ? '#3a3f47' : '#e9e7e2' });
  }
  let bcs = poly(b.outline);
  for (const cu of b.cutouts) bcs = bcs.subtract(poly(cu));
  for (const h of b.holes) bcs = bcs.subtract(circle2(h.x, h.y, h.d / 2, 24));
  bin.add('mask', ext(bcs, zb, zt));
  // plated rings and silkscreen
  const rings: ReturnType<typeof poly>[] = [];
  for (const h of b.holes) if (h.plated || (h.role ?? 'mount') !== 'lead') rings.push(circle2(h.x, h.y, h.d / 2 + (h.d > 2 ? 1.1 : 0.55), 28).subtract(circle2(h.x, h.y, h.d / 2, 24)));
  if (rings.length) {
    const r = K().CrossSection.union(rings);
    bin.add('gold', ext(r, zt - 0.01, zt + 0.035));
    bin.add('gold', ext(r, zb - 0.035, zb + 0.01));
  }
  const silk: ReturnType<typeof poly>[] = [];
  for (const c of b.comps) {
    if (c.hidden || c.side !== 'top' || c.conn?.entry === 'edge' || c.w * c.l < 4) continue;
    const o = poly(compRect(c, 0.45)), i2 = poly(compRect(c, 0.3));
    silk.push(o.subtract(i2));
  }
  if (silk.length) bin.add('silk', ext(K().CrossSection.union(silk).intersect(bcs), zt - 0.01, zt + 0.03));
  const list = b.comps.filter((c) => !c.hidden && c.h > 0.05);
  const small = list.length > 350; // big boards: skip the tiniest parts' details
  for (const c of list) {
    if (small && c.w * c.l < 2) continue;
    partDetail(bin, c, zt, zb);
  }
  // copper: the board's own tracks (KiCad), else plausible ones between the parts' pins
  const tr = b.traces?.length ? b.traces : fakeTraces(b);
  for (const t of tr.slice(0, 6000)) {
    const dx = t.b[0] - t.a[0], dy = t.b[1] - t.a[1], L = Math.hypot(dx, dy);
    if (L < 0.01) continue;
    const a = Math.atan2(dy, dx), ca = Math.cos(a), sa = Math.sin(a);
    const z = t.side === 'top' ? zt : zb - 0.04;
    const T = [ca, sa, 0, 0, -sa, ca, 0, 0, 0, 0, 1, 0, t.a[0], t.a[1], z, 1];
    bin.box('trace', T, -t.w / 2, -t.w / 2, 0, L + t.w / 2, t.w / 2, 0.04);
  }
  const vias = b.vias?.length ? b.vias : fakeVias(tr);
  for (const v of vias.slice(0, 3000)) {
    for (const z of [zt, zb - 0.05]) {
      const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v.x, v.y, z, 1];
      const r = v.d / 2, q = r * 0.42;
      bin.box('tin', T, -r, -q, 0.0, r, q, 0.05); bin.box('tin', T, -q, -r, 0.0, q, r, 0.05);
      bin.box('black', T, -q * 0.6, -q * 0.6, 0.0, q * 0.6, q * 0.6, 0.06);
    }
  }
  // silkscreen: reference designators beside the bigger parts, and the board name in a free corner
  let labels = 0;
  for (const c of list) {
    if (labels > 60 || c.side !== 'top' || c.w * c.l < 6 || c.conn?.entry === 'edge') continue;
    const r = compRect(c, 0.8), bb2 = bbox(r);
    const hgt = Math.min(1.4, Math.max(0.9, Math.min(c.w, c.l) * 0.3));
    const tw = textWidth(c.ref, hgt);
    const o: [number, number] = [bb2.x0, bb2.y1 + 0.3];
    if (!inside([o[0] + tw, o[1] + hgt], b.outline) || !inside(o, b.outline)) continue;
    silkText(bin, c.ref, o, hgt, zt);
    labels++;
  }
  const bbB = bbox(b.outline), nameH = Math.min(2.2, (bbB.y1 - bbB.y0) * 0.05);
  const nm = b.name.slice(0, 28), nw = textWidth(nm, nameH);
  const spot = findFree(b, list, nw, nameH);
  if (spot) silkText(bin, nm, spot, nameH, zt);
  return bin.ghosts('board', tag, anim);
}

/** A plug in a receptacle: metal tip inside the mouth, overmoulded body, and a cable leaving the body. */
export function plugDetail(mouth: V2, d: V2, zAx: number, p: { w: number; h: number; len: number; cable: number }, tag: PickTag, anim: Anim): Ghost[] {
  const bin = new Bin();
  const T = [d[0], d[1], 0, 0, -d[1], d[0], 0, 0, 0, 0, 1, 0, mouth[0], mouth[1], zAx, 1]; // x along the plug axis
  const tipW = p.w * 0.55, tipH = Math.min(p.h * 0.45, 3);
  bin.box('metal', T, -4, -tipW / 2, -tipH / 2, 0.6, tipW / 2, tipH / 2);
  const body = ext(roundRect(p.w, p.h, Math.min(p.w, p.h) * 0.3), 0, p.len).transform([0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0.6, 0, 0, 1] as any);
  bin.add('plug', body.transform(T as any));
  const cr = Math.max(1.2, p.cable / 2);
  const cable = cyl(0, 0, 0, 30, cr, cr, 20).transform([0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0.6 + p.len - 0.5, 0, 0, 1] as any);
  bin.add('cable', cable.transform(T as any));
  // strain relief boot
  bin.add('plug', cyl(0, 0, 0, 5, cr + 1.2, cr + 0.3, 20).transform([0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0.6 + p.len - 0.2, 0, 0, 1] as any).transform(T as any));
  return bin.ghosts('plug', tag, anim);
}

/** A round tube along a polyline (for cables), `sides` facets, parallel-transport frames so it doesn't twist. */
export function tubeMesh(pts: number[][], r: number, sides = 10): MeshData {
  const n = pts.length;
  const pos = new Float32Array(n * sides * 3 + 6), idx: number[] = [];
  let nrm = [0, 0, 1];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L = Math.hypot(t[0], t[1], t[2]) || 1;
    t = t.map((v) => v / L);
    // keep the previous normal, made perpendicular to the new tangent
    const dp = nrm[0] * t[0] + nrm[1] * t[1] + nrm[2] * t[2];
    let q = [nrm[0] - dp * t[0], nrm[1] - dp * t[1], nrm[2] - dp * t[2]];
    let lq = Math.hypot(q[0], q[1], q[2]);
    if (lq < 1e-6) { q = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]; const d2 = q[0] * t[0] + q[1] * t[1] + q[2] * t[2]; q = [q[0] - d2 * t[0], q[1] - d2 * t[1], q[2] - d2 * t[2]]; lq = Math.hypot(q[0], q[1], q[2]); }
    nrm = q.map((v) => v / lq);
    const bn = [t[1] * nrm[2] - t[2] * nrm[1], t[2] * nrm[0] - t[0] * nrm[2], t[0] * nrm[1] - t[1] * nrm[0]];
    for (let k = 0; k < sides; k++) {
      const an = (k / sides) * Math.PI * 2, c = Math.cos(an) * r, s2 = Math.sin(an) * r;
      const o = (i * sides + k) * 3;
      for (let j = 0; j < 3; j++) pos[o + j] = pts[i][j] + nrm[j] * c + bn[j] * s2;
    }
  }
  for (let i = 0; i + 1 < n; i++) for (let k = 0; k < sides; k++) {
    const a = i * sides + k, b = i * sides + ((k + 1) % sides), c = a + sides, d = b + sides;
    idx.push(a, b, d, a, d, c);
  }
  // end caps (fans to the centre points)
  const e0 = n * sides, e1 = n * sides + 1;
  for (let j = 0; j < 3; j++) { pos[e0 * 3 + j] = pts[0][j]; pos[e1 * 3 + j] = pts[n - 1][j]; }
  for (let k = 0; k < sides; k++) { idx.push(e0, (k + 1) % sides, k); idx.push(e1, (n - 1) * sides + k, (n - 1) * sides + ((k + 1) % sides)); }
  return { pos, idx: Uint32Array.from(idx) };
}

/** Chaikin corner cutting: rounds a polyline's corners, keeps its ends. */
export function smooth(pts: number[][], rounds = 3): number[][] {
  let p = pts;
  for (let r = 0; r < rounds; r++) {
    const q: number[][] = [p[0]];
    for (let i = 0; i + 1 < p.length; i++) {
      const a = p[i], b = p[i + 1];
      q.push(a.map((v, j) => 0.75 * v + 0.25 * b[j]), a.map((v, j) => 0.25 * v + 0.75 * b[j]));
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}
