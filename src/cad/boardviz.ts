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
  ghosts(name: string, tag: PickTag, anim: Anim, color: Partial<Record<Mat, string>> = {}, smooth = false): Ghost[] {
    const out: Ghost[] = [];
    const mats = new Set<Mat>([...this.meshes.keys(), ...this.solids.keys()]);
    for (const mat of mats) {
      const list = [...(this.meshes.get(mat) ?? [])];
      const sol = this.solids.get(mat);
      if (sol?.length) list.push(toMesh(sol.length === 1 ? sol[0] : K().Manifold.compose(sol)));
      if (!list.length) continue;
      out.push({ name: `${name} ${mat}`, mesh: merge(list), color: color[mat] ?? MAT_COLOR[mat], opacity: mat === 'led' ? 0.85 : 1, tag, anim, mat, ...(smooth ? { smooth } : {}) });
    }
    return out;
  }
}

export const MAT_COLOR: Record<Mat, string> = {
  mask: '#15603a', gold: '#d9aa3c', metal: '#c9d0d8', black: '#1d2024', chip: '#25282d', white: '#ece9e2', silk: '#f2f2ea',
  led: '#ffe066', passive: '#b89a6a', blue: '#2f5bd8', plug: '#2f3338', cable: '#24272b', copper: '#c87533',
  trace: '#2f9e63', tin: '#c9ced4', box: '#2b2f36', red: '#b8322b',
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
    // ports in the top face: the opening, the tongue and the shell rim
    for (const c of b.comps) {
      if (c.hidden || !c.conn || c.conn.entry !== 'top') continue;
      const t = c.conn.type, T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, c.x, c.y, zt, 1];
      const pw = t === 'usb_a' ? 13 : Math.max(6, c.conn.plug.w * 0.65), ph = t === 'usb_a' ? 5.8 : Math.max(2.8, c.conn.plug.h * 0.45);
      bin.box('black', T, -pw / 2, -ph / 2, -0.8, pw / 2, ph / 2, 0.08);
      if (t === 'usb_a') { bin.box('white', T, -pw / 2 + 1.6, -0.7, -0.7, pw / 2 - 1.6, 0.9, 0.1); bin.box('metal', T, -pw / 2 - 0.4, -ph / 2 - 0.4, -0.2, pw / 2 + 0.4, -ph / 2, 0.12); bin.box('metal', T, -pw / 2 - 0.4, ph / 2, -0.2, pw / 2 + 0.4, ph / 2 + 0.4, 0.12); }
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

type PlugSize = { w: number; h: number; len: number; cable: number };

/** A plug in a receptacle: its metal tip inside the mouth, the overmoulded body and the boot, shaped after its type. */
export function plugDetail(mouth: V2, d: V2, zAx: number, p: PlugSize, tag: PickTag, anim: Anim, type = ''): Ghost[] {
  return plugAt([d[0], d[1], 0, 0, -d[1], d[0], 0, 0, 0, 0, 1, 0, mouth[0], mouth[1], zAx, 1], p, tag, anim, type); // x along the plug axis
}

/** A plug pointing straight up out of a port in a top face at (x, y, z). */
/** A plug standing in a top-entry socket at (x, y, z): its width along `ang` degrees (the box's length at 0). */
export function plugUp(x: number, y: number, z: number, p: PlugSize, tag: PickTag, anim: Anim, type = '', ang = 0): Ghost[] {
  const c = Math.cos((ang * Math.PI) / 180), s = Math.sin((ang * Math.PI) / 180);
  return plugAt([0, 0, 1, 0, c, s, 0, 0, -s, c, 0, 0, x, y, z, 1], p, tag, anim, type); // plug x up, y along its width, z = x × y
}

/** A cross-section of a loft: a rounded rectangle w × h (corner radius r) at x along the axis, centred at (y, z). */
type Sec = { x: number; w: number; h: number; r: number; y?: number; z?: number };

/**
 * A smooth solid through rounded-rectangle sections along x (a circle when r is half of w and h): plug bodies,
 * boots, metal shells. Transformed by T; closed at both ends.
 */
export function loft(T: number[], secs: Sec[], seg = 5): MeshData {
  const ringN = 4 * (seg + 1);
  const ring = (q: Sec) => {
    const r = Math.max(0.01, Math.min(q.r, q.w / 2 - 0.001, q.h / 2 - 0.001));
    const cy = q.y ?? 0, cz = q.z ?? 0, out: number[][] = [];
    const corners: [number, number, number][] = [[q.w / 2 - r, q.h / 2 - r, 0], [-(q.w / 2 - r), q.h / 2 - r, 90], [-(q.w / 2 - r), -(q.h / 2 - r), 180], [q.w / 2 - r, -(q.h / 2 - r), 270]];
    for (const [a, b, a0] of corners) for (let k = 0; k <= seg; k++) {
      const an = ((a0 + (90 * k) / seg) * Math.PI) / 180;
      out.push([q.x, cy + a + r * Math.cos(an), cz + b + r * Math.sin(an)]);
    }
    return out;
  };
  const rings = secs.map(ring);
  const n = rings.length;
  const pos = new Float32Array((n * ringN + 2) * 3), idx: number[] = [];
  const put = (i: number, v: number[]) => { pos[3 * i] = T[0] * v[0] + T[4] * v[1] + T[8] * v[2] + T[12]; pos[3 * i + 1] = T[1] * v[0] + T[5] * v[1] + T[9] * v[2] + T[13]; pos[3 * i + 2] = T[2] * v[0] + T[6] * v[1] + T[10] * v[2] + T[14]; };
  rings.forEach((rg, i) => rg.forEach((v, k) => put(i * ringN + k, v)));
  for (let i = 0; i + 1 < n; i++) for (let k = 0; k < ringN; k++) {
    const a = i * ringN + k, b = i * ringN + ((k + 1) % ringN), c = a + ringN, d = b + ringN;
    idx.push(a, b, d, a, d, c); // outward: the rings run anticlockwise about +x
  }
  const e0 = n * ringN, e1 = e0 + 1, c0 = secs[0], c1 = secs[n - 1];
  put(e0, [c0.x, c0.y ?? 0, c0.z ?? 0]); put(e1, [c1.x, c1.y ?? 0, c1.z ?? 0]);
  for (let k = 0; k < ringN; k++) { idx.push(e0, (k + 1) % ringN, k); idx.push(e1, (n - 1) * ringN + k, (n - 1) * ringN + ((k + 1) % ringN)); }
  return { pos, idx: Uint32Array.from(idx) };
}

const pill = (x: number, w: number, h: number, extra: Partial<Sec> = {}): Sec => ({ x, w, h, r: Math.min(w, h) / 2, ...extra });

/**
 * The moulded body of a plug from x0 to x1 (w × h, corner radius r): a small bevel at the front, optional grip
 * ridges, a taper at the back, then a strain-relief boot that narrows onto the cable.
 */
function overmold(W: number, H: number, r: number, x0: number, x1: number, cable: number, grip = 0): Sec[] {
  const cr = Math.max(1.1, cable / 2), s: Sec[] = [];
  s.push({ x: x0, w: W - 1.2, h: H - 1.2, r: Math.max(0.3, r - 0.6) }, { x: x0 + 0.8, w: W, h: H, r });
  const g0 = x0 + (x1 - x0) * 0.3, g1 = x0 + (x1 - x0) * 0.72;
  if (grip > 0) {
    s.push({ x: g0, w: W, h: H, r });
    const n = Math.max(3, Math.round((g1 - g0) / 2.2));
    for (let i = 1; i <= n; i++) {
      const x = g0 + ((g1 - g0) * i) / (n + 1);
      s.push({ x: x - 0.45, w: W, h: H, r }, { x, w: W - 2 * grip, h: H - 2 * grip, r: Math.max(0.3, r - grip) }, { x: x + 0.45, w: W, h: H, r });
    }
  }
  const tw = Math.max(2 * cr + 2.6, W * 0.62), th = Math.max(2 * cr + 2.6, H * 0.62);
  s.push({ x: x1 - (x1 - x0) * 0.22, w: W, h: H, r }, { x: x1, w: tw, h: th, r: Math.min(tw, th) / 2 });
  // boot: a round taper onto the cable, with a few rings
  const bl = Math.max(6, cable * 2);
  s.push(pill(x1 + 0.4, 2 * cr + 2.2, 2 * cr + 2.2), pill(x1 + bl * 0.45, 2 * cr + 1.4, 2 * cr + 1.4), pill(x1 + bl * 0.5, 2 * cr + 1.7, 2 * cr + 1.7), pill(x1 + bl * 0.55, 2 * cr + 1.1, 2 * cr + 1.1), pill(x1 + bl, 2 * cr + 0.4, 2 * cr + 0.4));
  return s;
}

/** A plug in its own frame T: x along its axis out of the mouth (0 at the mouth), y across its width, z across its height. */
function plugAt(T: number[], p: PlugSize, tag: PickTag, anim: Anim, type: string): Ghost[] {
  const bin = new Bin();
  const push = (mat: Mat, m: MeshData) => (bin.meshes.get(mat) ?? bin.meshes.set(mat, []).get(mat)!).push(m);
  const x0 = 0.6, x1 = 0.6 + p.len, W = p.w, H = p.h;
  const metal = (secs: Sec[]) => push('metal', loft(T, secs));
  const body = (secs: Sec[], mat: Mat = 'plug') => push(mat, loft(T, secs));
  const rect = (x0: number, x1: number, w: number, h: number, r: number, z = 0): Sec[] => [{ x: x0, w, h, r, z }, { x: x1, w, h, r, z }];
  switch (type) {
    case 'usb_c':
      metal(rect(-6.6, x0 + 0.3, 8.25, 2.4, 1.2));
      body(overmold(W, H, H / 2, x0, x1, p.cable));
      break;
    case 'usb_micro_b':
      metal(rect(-5.6, x0 + 0.3, 6.85, 1.8, 0.35));
      body(overmold(W, H, 1.8, x0, x1, p.cable, 0.25));
      break;
    case 'usb_mini_b':
      metal(rect(-6.2, x0 + 0.3, 6.8, 3, 0.6));
      body(overmold(W, H, 2, x0, x1, p.cable, 0.25));
      break;
    case 'usb_a':
      metal(rect(-11.5, x0 + 0.4, 12, 4.5, 0.4));
      body(overmold(W, H, 1.8, x0, x1, p.cable, 0.3));
      break;
    case 'usb_a_dual': {
      // a stacked pair of sockets: a plug in each, named apart so a rack can show only the one in use (lower = the
      // part's own ref, upper = "REF:2")
      const hh = Math.min(7.6, H / 2 - 0.4), out: Ghost[] = [];
      for (const [z, nm] of [[-4.05, 'plug lower'], [4.05, 'plug upper']] as const) {
        const b2 = new Bin();
        const put = (mat: Mat, m: MeshData) => (b2.meshes.get(mat) ?? b2.meshes.set(mat, []).get(mat)!).push(m);
        put('metal', loft(T, rect(-11.5, x0 + 0.4, 12, 4.5, 0.4, z)));
        put('plug', loft(T, overmold(W, hh, 1.8, x0, x1, p.cable, 0.3).map((q) => ({ ...q, z }))));
        out.push(...b2.ghosts(nm, tag, anim, {}, true));
      }
      return out;
    }
    case 'usb_b':
      metal(rect(-8.5, x0 + 0.3, 11.5, 10.4, 1.6));
      body(overmold(W, H, 2.4, x0, x1, p.cable, 0.3));
      break;
    case 'hdmi_micro': case 'hdmi_mini': case 'hdmi_a': {
      const t = type === 'hdmi_micro' ? [6.2, 2.2, 6.5] : type === 'hdmi_mini' ? [10.4, 2.6, 7.2] : [13.9, 4.45, 9];
      metal(rect(-t[2], x0 + 0.4, t[0], t[1], 0.5));
      body(overmold(W, H, Math.min(2.5, H / 3), x0, x1, p.cable, 0.3));
      break;
    }
    case 'rj45':
      // the clear plug sits in the jack; what shows is the boot, tapering onto the cable, and its latch cover
      push('white', loft(T, rect(-14, x0 + 1.5, 11.7, 8, 0.6)));
      body([{ x: x0, w: 12.4, h: 9, r: 1 }, { x: x0 + 3, w: W, h: H * 0.9, r: 2.6 }, { x: x0 + p.len * 0.35, w: W * 0.86, h: H * 0.78, r: 3 }, pill(x0 + p.len * 0.8, 2 * p.cable / 2 + 3, 2 * p.cable / 2 + 3), pill(x1, p.cable + 0.8, p.cable + 0.8)]);
      body([{ x: x0 + 0.5, w: 7, h: 1.6, r: 0.6, z: H * 0.45 }, { x: x0 + 9, w: 6, h: 1.2, r: 0.5, z: H * 0.38 }]);
      break;
    case 'barrel':
      metal([pill(-9, 5.5, 5.5), pill(x0 + 0.5, 5.5, 5.5)]);
      body(overmold(W, H, W / 2, x0, x1, p.cable, 0.35));
      break;
    case 'audio35':
      metal([pill(-14.5, 2.6, 2.6), pill(-13.2, 3.5, 3.5), pill(-9.6, 3.5, 3.5)]);
      push('black', loft(T, [pill(-9.6, 3.52, 3.52), pill(-8.6, 3.52, 3.52)]));
      metal([pill(-8.6, 3.5, 3.5), pill(-5.4, 3.5, 3.5)]);
      push('black', loft(T, [pill(-5.4, 3.52, 3.52), pill(-4.4, 3.52, 3.52)]));
      metal([pill(-4.4, 3.5, 3.5), pill(x0 + 0.3, 3.5, 3.5), pill(x0 + 0.3, 5, 5), pill(x0 + 1.5, 5, 5)]);
      body(overmold(W, H, W / 2, x0 + 1.5, x1, p.cable));
      break;
    case 'microsd':
      // a card in its slot, a millimetre or two showing
      push('black', loft(T, rect(-13, 1.8, 11, 0.8, 0.3)));
      return bin.ghosts('plug', tag, anim, {}, true);
    case 'sma': {
      // knurled nut and a short rubber-duck antenna
      metal([pill(-2, 6.2, 6.2), pill(x0 + 5.5, 6.2, 6.2)]);
      body([pill(x0 + 5.5, 8.4, 8.4), pill(x0 + 12, 8.4, 8.4), pill(x0 + 12.4, 7, 7), pill(x0 + 13.4, 7, 7), pill(x0 + 14, 8, 8), pill(x0 + 50, 6.6, 6.6), pill(x0 + 54, 4.2, 4.2)], 'black');
      return bin.ghosts('plug', tag, anim, {}, true);
    }
    case 'terminal': {
      // wires with crimped ferrules in the screw terminals, red and black
      const n = Math.max(2, Math.round(W / 5)), pitch = W / n;
      for (let i = 0; i < n; i++) {
        const y = -W / 2 + pitch * (i + 0.5);
        push('tin', loft(T, [pill(-5, 1.6, 1.6, { y }), pill(1.5, 1.6, 1.6, { y }), pill(1.5, 2.4, 2.4, { y }), pill(4.5, 2.4, 2.4, { y })]));
        push(i % 2 ? 'cable' : 'red', loft(T, [pill(4.5, 2.6, 2.6, { y }), pill(7, 3, 3, { y }), pill(9.5, 2.2, 2.2, { y }), pill(x1 + 8, 2.2, 2.2, { y })]));
      }
      return bin.ghosts('plug', tag, anim, {}, true);
    }
    case 'qwiic': case 'jst_ph': case 'jst_xh': case 'header':
      push('white', loft(T, rect(-1, x0 + Math.min(6, p.len), W, H, 0.4)));
      if (type === 'header') push('black', loft(T, rect(-1, x0 + Math.min(12, p.len), W, H, 0.3)));
      body([{ x: x0 + Math.min(6, p.len) - 0.5, w: Math.max(2, W - 1.5), h: 1.2, r: 0.5 }, { x: x1 + 6, w: Math.max(2, W - 1.5), h: 1.2, r: 0.5 }], 'cable');
      return bin.ghosts('plug', tag, anim, {}, true);
    case 'swd10': case 'jtag20':
      // an IDC socket pressed onto a ribbon: its body (the lower part goes into the header's shroud), the cable clamp
      // across its top, and the polarising key on one side
      push('black', loft(T, rect(-2.5, x1 - 1.8, W, H, 0.5)));
      push('black', loft(T, rect(x1 - 1.8, x1, W + 0.8, H - 1.4, 0.4)));
      push('black', loft(T, rect(0.5, x1 - 3, Math.min(4.5, W * 0.3), 1.4, 0.3, H / 2 + 0.6)));
      return bin.ghosts('plug', tag, anim, {}, true);
    case 'dupont':
      // a single jumper housing pushed over one pin (its wire is drawn with the cable)
      push('black', loft(T, rect(x0, x1 - 1.2, W, H, 0.25)));
      push('black', loft(T, [{ x: x1 - 1.2, w: W, h: H, r: 0.25 }, { x: x1, w: W * 0.72, h: H * 0.72, r: 0.6 }]));
      return bin.ghosts('plug', tag, anim, {}, true);
    case 'tagconnect':
      // the spring-pin head held on the pads, then its ribbon
      push('plug', loft(T, rect(-0.2, x0 + 8, W, H, 1.6)));
      push('black', loft(T, [{ x: x0 + 8, w: W * 0.85, h: H * 0.8, r: 1.2 }, { x: x1, w: W * 0.7, h: 1.4, r: 0.5 }]));
      return bin.ghosts('plug', tag, anim, {}, true);
    case 'iec_c7':
      body([{ x: -2, w: W - 1.4, h: H - 1.4, r: (H - 1.4) / 2 }, { x: x0, w: W - 1.4, h: H - 1.4, r: (H - 1.4) / 2 }, ...overmold(W, H, H / 2, x0, x1, p.cable, 0.3)]);
      break;
    default:
      metal(rect(-4, x0 + 0.3, W * 0.55, Math.min(H * 0.45, 3), 0.4));
      body(overmold(W, H, Math.min(W, H) * 0.3, x0, x1, p.cable));
  }
  return bin.ghosts('plug', tag, anim, {}, true);
}

/**
 * A cable leaving a plug that nothing in the rack connects to (a screen, a supply, the mains): out of the boot,
 * a bend down, and along the table away from the rack. p, d: the boot's end and the plug's direction; floor: the
 * table's height.
 */
export function hangingCable(p: number[], d: number[], cable: number, floor: number, centre?: number[]): number[][] {
  const r = Math.max(1.1, cable / 2);
  const bend = Math.max(12, 6 * r);
  const h = Math.hypot(d[0], d[1]);
  // horizontal way out: along the plug, or (for a plug pointing up or down) away from the middle of the rack, so it
  // falls clear of the neighbours
  const aw = centre ? [p[0] - centre[0], p[1] - centre[1]] : [1, 0], la = Math.hypot(aw[0], aw[1]);
  const out = h > 0.2 ? [d[0] / h, d[1] / h, 0] : la > 1 ? [aw[0] / la, aw[1] / la, 0] : [1, 0, 0];
  const z0 = floor + r + 0.2;
  const pts: number[][] = [p];
  if (d[2] > 0.5) {
    // pointing up: rise a little, arc over and down
    pts.push([p[0] + d[0] * 10, p[1] + d[1] * 10, p[2] + 10], [p[0] + out[0] * bend * 1.6, p[1] + out[1] * bend * 1.6, p[2] + 14]);
  } else pts.push([p[0] + d[0] * 8, p[1] + d[1] * 8, p[2] + d[2] * 8]);
  const last = pts[pts.length - 1];
  const fall = Math.max(0, last[2] - z0);
  // a cable droops: it curves over and falls, landing a little further out than it left
  const reach = Math.min(60, 8 + fall * 0.35);
  if (fall > 1) pts.push([last[0] + out[0] * reach, last[1] + out[1] * reach, z0]);
  const end = pts[pts.length - 1];
  pts.push([end[0] + out[0] * 45, end[1] + out[1] * 45, z0]);
  return filletPath(pts, bend);
}

/**
 * Round every corner of a polyline with an arc of radius `r` (smaller where the segments are short), the way a
 * cable bends: no kinks, however the route was drawn.
 */
export function filletPath(pts: number[][], r: number): number[][] {
  if (pts.length < 3) return pts;
  const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const len = (a: number[]) => Math.hypot(a[0], a[1], a[2]);
  const at = (a: number[], u: number[], t: number) => [a[0] + u[0] * t, a[1] + u[1] * t, a[2] + u[2] * t];
  // drop repeated points first
  const P = pts.filter((q, i) => i === 0 || len(sub(q, pts[i - 1])) > 1e-6);
  if (P.length < 3) return P;
  const out: number[][] = [P[0]];
  const segLen = P.slice(1).map((q, i) => len(sub(q, P[i])));
  for (let i = 1; i + 1 < P.length; i++) {
    const a = P[i - 1], b = P[i], c = P[i + 1];
    const u = sub(a, b), v = sub(c, b), lu = len(u), lv = len(v);
    const un = u.map((x) => x / lu), vn = v.map((x) => x / lv);
    const cos = Math.max(-1, Math.min(1, un[0] * vn[0] + un[1] * vn[1] + un[2] * vn[2]));
    const th = Math.acos(cos); // angle between the two legs at the corner
    if (th > Math.PI - 0.02 || th < 0.02) { out.push(b); continue; } // straight on, or straight back (no arc fits a U-turn)
    // tangent length for radius r, at most half of each neighbouring segment (the other half is the next corner's)
    let t = r / Math.tan(th / 2);
    t = Math.min(t, segLen[i - 1] * 0.5, segLen[i] * 0.5);
    const rr = t * Math.tan(th / 2);
    const p0 = at(b, un, t), p1 = at(b, vn, t);
    // arc centre: along the bisector
    const bis = [un[0] + vn[0], un[1] + vn[1], un[2] + vn[2]], lb = len(bis) || 1;
    const cen = at(b, bis.map((x) => x / lb), rr / Math.sin(th / 2));
    const e0 = sub(p0, cen), e1 = sub(p1, cen);
    const sweep = Math.PI - th, n = Math.max(2, Math.ceil(sweep / (Math.PI / 18)));
    // slerp between the two radius vectors
    const s = Math.sin(sweep) || 1;
    for (let k = 0; k <= n; k++) {
      const f = k / n, w0 = Math.sin((1 - f) * sweep) / s, w1 = Math.sin(f * sweep) / s;
      out.push([cen[0] + e0[0] * w0 + e1[0] * w1, cen[1] + e0[1] * w0 + e1[1] * w1, cen[2] + e0[2] * w0 + e1[2] * w1]);
    }
  }
  out.push(P[P.length - 1]);
  return out;
}

/** A round tube along a polyline (for cables), `sides` facets, parallel-transport frames so it doesn't twist. */
export function tubeMesh(pts: number[][], r: number, sides = 16): MeshData {
  const n = pts.length;
  // rings, then each end's rim again (so its flat cap shades apart from the round side) and the two centres
  const pos = new Float32Array((n * sides + 2 * sides + 2) * 3), idx: number[] = [];
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
  const r0 = n * sides, r1 = r0 + sides, e0 = r1 + sides, e1 = e0 + 1;
  pos.copyWithin(r0 * 3, 0, sides * 3);
  pos.copyWithin(r1 * 3, (n - 1) * sides * 3, n * sides * 3);
  for (let j = 0; j < 3; j++) { pos[e0 * 3 + j] = pts[0][j]; pos[e1 * 3 + j] = pts[n - 1][j]; }
  for (let k = 0; k < sides; k++) { idx.push(e0, r0 + ((k + 1) % sides), r0 + k); idx.push(e1, r1 + k, r1 + ((k + 1) % sides)); }
  return { pos, idx: Uint32Array.from(idx) };
}

/**
 * A flat ribbon cable along a polyline: `w` wide, `t` thick, its width along `side` at the start and carried along
 * without twisting (a ribbon bends across its flat). `end`: its width axis where it lands (either way round) and the
 * stretch, in mm along it, where it may twist to get there (where it hangs free, not where it lies on a board). `off`
 * shifts it sideways across its width, for the red stripe that marks pin 1.
 */
export function ribbonMesh(pts: number[][], w: number, t: number, side: number[], off = 0, end?: { side: number[]; from: number; to: number }): MeshData {
  const n = pts.length, K = 4;
  const pos = new Float32Array((n * K + 2 * K + 2) * 3), idx: number[] = [];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const square = (q: number[], tg: number[]) => { const d = dot(q, tg); const r = [q[0] - d * tg[0], q[1] - d * tg[1], q[2] - d * tg[2]]; const L = Math.hypot(r[0], r[1], r[2]); return L < 1e-6 ? null : r.map((x) => x / L); };
  // tangents, the width axis carried along square to them, and the distance along
  const T: number[][] = [], U: number[][] = [], S: number[] = [];
  let u = side;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tg = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L = Math.hypot(tg[0], tg[1], tg[2]) || 1;
    tg = tg.map((v) => v / L);
    u = square(u, tg) ?? square(Math.abs(tg[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], tg)!;
    T.push(tg); U.push(u);
    S.push(i ? S[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]) : 0);
  }
  // the twist that lands it square on the far plug, spread over the free stretch
  let phi = 0;
  const want = end && square(end.side, T[n - 1]);
  if (want) {
    phi = Math.atan2(dot(cross(U[n - 1], want), T[n - 1]), dot(U[n - 1], want));
    if (phi > Math.PI / 2) phi -= Math.PI; else if (phi < -Math.PI / 2) phi += Math.PI;
  }
  const s0 = end ? Math.max(0, Math.min(end.from, S[n - 1])) : 0, s1 = end ? Math.max(s0 + 1e-6, Math.min(end.to, S[n - 1])) : 1;
  const corner: [number, number][] = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  for (let i = 0; i < n; i++) {
    const th = phi * Math.min(1, Math.max(0, (S[i] - s0) / (s1 - s0)));
    const tg = T[i], tu = cross(tg, U[i]);
    const uu = [0, 1, 2].map((j) => U[i][j] * Math.cos(th) + tu[j] * Math.sin(th));
    const v = cross(tg, uu);
    corner.forEach(([sx, sy], k) => {
      const o = (i * K + k) * 3, cx = sx * w / 2 + off, cy = sy * t / 2;
      for (let j = 0; j < 3; j++) pos[o + j] = pts[i][j] + uu[j] * cx + v[j] * cy;
    });
  }
  for (let i = 0; i + 1 < n; i++) for (let k = 0; k < K; k++) {
    const a = i * K + k, b = i * K + ((k + 1) % K), c = a + K, d = b + K;
    idx.push(a, b, d, a, d, c);
  }
  const r0 = n * K, r1 = r0 + K, e0 = r1 + K, e1 = e0 + 1;
  pos.copyWithin(r0 * 3, 0, K * 3);
  pos.copyWithin(r1 * 3, (n - 1) * K * 3, n * K * 3);
  for (let j = 0; j < 3; j++) {
    pos[e0 * 3 + j] = (pos[r0 * 3 + j] + pos[(r0 + 2) * 3 + j]) / 2;
    pos[e1 * 3 + j] = (pos[r1 * 3 + j] + pos[(r1 + 2) * 3 + j]) / 2;
  }
  for (let k = 0; k < K; k++) { idx.push(e0, r0 + ((k + 1) % K), r0 + k); idx.push(e1, r1 + k, r1 + ((k + 1) % K)); }
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

/** A small UV sphere (for markers). */
export function sphereMesh(c: number[], r: number, n = 12): MeshData {
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * Math.PI;
    for (let j = 0; j < 2 * n; j++) {
      const ph = (j / (2 * n)) * Math.PI * 2;
      pos.push(c[0] + r * Math.sin(th) * Math.cos(ph), c[1] + r * Math.sin(th) * Math.sin(ph), c[2] + r * Math.cos(th));
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < 2 * n; j++) {
    const a = i * 2 * n + j, b = i * 2 * n + ((j + 1) % (2 * n)), c2 = a + 2 * n, d = b + 2 * n;
    idx.push(a, c2, d, a, d, b);
  }
  return { pos: Float32Array.from(pos), idx: Uint32Array.from(idx) };
}
