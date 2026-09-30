// Display models of a board for the 3D view: soldermask with gold pads and silkscreen, and every part shaped
// after what it is (metal connector shells with their openings, headers with gold pins, chips with legs, jacks,
// LEDs, passives), plus realistic plugs with cables. Built once per board (the module cache keeps them).
import type { Anim, Board, Comp, Ghost, Light, MeshData, PickTag, V2 } from '../model/types';
import { boardLights, boxLight, LED_COLOUR } from '../model/lights';
import { bbox, compRect, extentAlong, inside, rad } from '../geom/poly';
import { textStrokes, textWidth } from './font';
import { headerPins } from '../model/probes';
import { kkPitch, nameCircuits, wtbPitch } from '../model/library';
import { isSocket } from '../model/links';
import { contribLook } from '../model/contributed';
import { drawLook } from './lookdraw';
import { boardCopper } from '../model/copper';
import { box, circle2, cyl, ext, poly, toMesh, unionCS, unionMF, type MF } from './kernel';
import { K } from './kernel';

type Mat = NonNullable<Ghost['mat']>;

/** Collects primitives per material; boxes go straight to triangles, solids through the kernel. */
class Bin {
  meshes = new Map<Mat, MeshData[]>();
  solids = new Map<Mat, MF[]>();
  lights: Light[] = []; // what glows (on the 'led' ghost, for the 3D view)
  add(mat: Mat, m: MF) {
    // a solid that failed (a box turned inside out on a part too low for it) is left out: composed with the rest of
    // its material it emptied them all (one Tag-Connect footprint took every black jack, JST and buzzer off its board)
    if (m.status() !== 'NoError') return;
    (this.solids.get(mat) ?? this.solids.set(mat, []).get(mat)!).push(m);
  }
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
      out.push({ name: `${name} ${mat}`, mesh: merge(list), color: color[mat] ?? MAT_COLOR[mat], opacity: mat === 'led' ? 0.9 : 1, tag, anim, mat, ...(smooth ? { smooth } : {}), ...(mat === 'led' && this.lights.length ? { fx: { lights: this.lights } } : {}) });
    }
    return out;
  }
}

export const MAT_COLOR: Record<Mat, string> = {
  mask: '#15603a', gold: '#d9aa3c', metal: '#c9d0d8', black: '#1d2024', chip: '#25282d', white: '#ece9e2', silk: '#f2f2ea',
  led: '#efece4', passive: '#b89a6a', blue: '#2f5bd8', plug: '#2f3338', cable: '#24272b', copper: '#c87533',
  trace: '#2f9e63', tin: '#c9ced4', box: '#2b2f36', red: '#b8322b', yellow: '#e2b21c',
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
/** A point, and a direction, carried by a 4x4 transform (column-major). */
const at = (T: number[], q: number[]) => [T[0] * q[0] + T[4] * q[1] + T[8] * q[2] + T[12], T[1] * q[0] + T[5] * q[1] + T[9] * q[2] + T[13], T[2] * q[0] + T[6] * q[1] + T[10] * q[2] + T[14]];
const along = (T: number[], v: number[]) => [T[0] * v[0] + T[4] * v[1] + T[8] * v[2], T[1] * v[0] + T[5] * v[1] + T[9] * v[2], T[2] * v[0] + T[6] * v[1] + T[10] * v[2]];

/**
 * A board's lights as it sits in a rack: dark when the board has no power; a jack's lights only while a cable is in
 * that jack (`plugged`).
 */
export function powerFx(fx: Ghost['fx'], powered: boolean, plugged: (ref: string) => boolean): Ghost['fx'] {
  if (!fx?.lights) return fx;
  return { ...fx, dark: !powered, lights: fx.lights.filter((l) => !l.ref || plugged(l.ref)) };
}

/** Lights (and a cable's flow) moved with the ghost they belong to. */
export function moveFx(fx: Ghost['fx'], T: number[]): Ghost['fx'] {
  if (!fx) return fx;
  return {
    ...fx,
    ...(fx.lights ? { lights: fx.lights.map((l) => ({ ...l, p: at(T, l.p), ...(l.n ? { n: along(T, l.n) } : {}) })) } : {}),
    ...(fx.flow ? { flow: { ...fx.flow, pts: fx.flow.pts.map((q) => at(T, q)) } } : {}),
    ...(fx.fade ? { fade: { ...fx.fade, p: at(T, fx.fade.p), d: along(T, fx.fade.d) } } : {}),
  };
}

/** Which local side of the part the plug enters: +y, -y, +x or -x. */
function mouthSide(c: Comp): 'py' | 'ny' | 'px' | 'nx' {
  if (!c.conn) return 'py';
  const a = rad(c.conn.angle - c.rot);
  const dx = Math.cos(a), dy = Math.sin(a);
  return Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? 'py' : 'ny') : dx > 0 ? 'px' : 'nx';
}

/** Upright wire-to-board sockets: their pitch, wall, colour, and whether their pins are in two rows. */
const WTB_LOOK: Record<string, { pitch: number; wall: number; mat: Mat; two?: boolean }> = {
  jst_ph: { pitch: 2, wall: 0.5, mat: 'white' }, jst_xh: { pitch: 2.5, wall: 0.7, mat: 'white' }, jst_gh: { pitch: 1.25, wall: 0.45, mat: 'white' },
  jst_zh: { pitch: 1.5, wall: 0.45, mat: 'white' }, picoblade: { pitch: 1.25, wall: 0.45, mat: 'white' },
  microfit: { pitch: 3, wall: 0.8, mat: 'black', two: true }, minifit: { pitch: 4.2, wall: 1, mat: 'white', two: true },
};

/** A connector's number of pins: its numbered pins, else what its name says, else a guess from its size. */
function pinCount(c: Comp, name: string, guess: number): number {
  const n = (c.pins ?? []).filter((q) => /^\d+$/.test(q.n)).length;
  return Math.max(1, Math.min(80, n >= 2 ? n : nameCircuits(name) || guess));
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

  if (type === 'swd10' || type === 'cortex20' || type === 'jtag20' || type === 'idc') {
    // a shrouded box header: walls round two rows of pins, a key slot in one long wall
    const fine = type === 'swd10' || type === 'cortex20', pitch = fine ? 1.27 : 2.54, wall = fine ? 0.55 : 0.9;
    const n = type === 'swd10' ? 5 : type === 'idc' ? Math.max(2, Math.round((Math.max(w, l) - 7.6) / 2.54)) : 10;
    const long = w >= l, ax = long ? hx : hy, ac = long ? hy : hx;
    let shroud = box(-hx, -hy, 0, hx, hy, h).subtract(box(-hx + wall, -hy + wall, 0.8, hx - wall, hy - wall, h + 1));
    const key = Math.min(ax * 0.5, pitch * 2.2);
    shroud = shroud.subtract(long ? box(-key / 2, -hy - 1, 1.6, key / 2, -hy + wall + 0.1, h + 1) : box(-hx - 1, -key / 2, 1.6, -hx + wall + 0.1, key / 2, h + 1));
    bin.add('black', tf(shroud, T));
    const r = pitch * 0.16;
    for (let i = 0; i < n; i++) for (const j of [-0.5, 0.5]) {
      const u = (i - (n - 1) / 2) * pitch, v = j * pitch;
      const [px, py] = long ? [u, v] : [v, u];
      B('gold', px - r, py - r, 0.8, px + r, py + r, h - 0.6);
    }
    void ac;
    return;
  }
  if (type === 'tagconnect') {
    // no connector, just pads: two rows on 1.27 mm (five each for a TC2050, three for a TC2030) that the cable's
    // spring pins land on
    const n = /2030/.test(name) ? 3 : 5;
    for (let i = 0; i < n; i++) for (const j of [-0.5, 0.5]) {
      const u = (i - (n - 1) / 2) * 1.27, v = j * 1.27, [px, py] = w >= l ? [u, v] : [v, u];
      bin.add('gold', tf(cyl(px, py, -0.01, 0.035, 0.39, 0.39, 16), T));
    }
    return;
  }
  const look = WTB_LOOK[type];
  if (look) {
    // an upright wire-to-board socket (JST, Molex): a housing open at the top round its pins (the plug goes in from
    // above, as the toolbox says), a slot in one long wall for the plug's latch, a latch ramp outside on the big ones
    const long = w >= l, wall = look.wall, floor = Math.min(1, h * 0.3);
    const pm = /_P(\d+(?:\.\d+)?)mm/i.exec(c.pkg), pitch = pm ? +pm[1] : look.pitch;
    const two = !!look.two && Math.min(w, l) > 1.6 * pitch && !/1x\d/i.test(c.pkg);
    const n = pinCount(c, name, Math.round((Math.max(w, l) - look.pitch) / look.pitch) + 1), k = two ? Math.ceil(n / 2) : n;
    const s = Math.min((long ? w : l) * 0.4, 3);
    // (the latch ramp stands inside the part's size: the housing is that much narrower on its side)
    const lat = two ? 0.9 : 0, ex = long ? 0 : lat, ey = long ? lat : 0;
    let shell = box(-hx, -hy, 0, hx - ex, hy - ey, h);
    if (Math.min(w, l) > 2 * wall + 0.6 + lat && h > floor + 0.5) {
      shell = shell.subtract(box(-hx + wall, -hy + wall, floor, hx - ex - wall, hy - ey - wall, h + 1))
        .subtract(long ? box(-s / 2, hy - ey - wall - 0.1, h * 0.5, s / 2, hy + 1, h + 1) : box(hx - ex - wall - 0.1, -s / 2, h * 0.5, hx + 1, s / 2, h + 1));
    }
    bin.add(look.mat, tf(shell, T));
    if (two) { if (long) B(look.mat, -s / 2, hy - ey, h * 0.45, s / 2, hy, h - 0.6); else B(look.mat, hx - ex, -s / 2, h * 0.45, hx, s / 2, h - 0.6); }
    const r = Math.min(0.32, pitch * 0.2);
    for (let i = 0; i < k; i++) for (const j of two ? [-0.5, 0.5] : [0]) {
      const u = (i - (k - 1) / 2) * pitch, v = j * pitch, [px, py] = long ? [u, v] : [v, u];
      B('gold', px - r, py - r, floor, px + r, py + r, Math.max(floor + 0.3, h - 1.2));
    }
    return;
  }
  if (type === 'kk254') {
    // a Molex KK (or a fan) header: a low base, the polarising wall along one side, tall square pins
    const long = w >= l, kp = kkPitch(name), n = pinCount(c, name, Math.max(2, Math.round(Math.max(w, l) / kp))), base = Math.min(3.2, h * 0.35);
    B('white', -hx, -hy, 0, hx, hy, base);
    if (long) B('white', -hx, -hy, base, hx, -hy + 1, h * 0.8); else B('white', -hx, -hy, base, -hx + 1, hy, h * 0.8);
    for (let i = 0; i < n; i++) { const u = (i - (n - 1) / 2) * kp, [px, py] = long ? [u, 0.4] : [0.4, u]; B('gold', px - 0.32, py - 0.32, base, px + 0.32, py + 0.32, h - 0.3); }
    return;
  }
  if (type === 'ufl') {
    // a u.FL: a small square base, the round metal socket on it, its centre contact
    B('white', -hx, -hy, 0, hx, hy, 0.3);
    const R = Math.min(hx, hy) * 0.7;
    bin.add('metal', tf(cyl(0, 0, 0.3, h, R, R, 24).subtract(cyl(0, 0, 0.5, h + 1, R - 0.25, R - 0.25, 24)), T));
    bin.add('gold', tf(cyl(0, 0, 0.3, h - 0.3, 0.2, 0.2, 12), T));
    return;
  }
  if (type === 'b2b' || type === 'm2' || type === 'pcie' || type === 'dimm') {
    // a board-to-board connector or a card socket: a black body with a slot along its top, a row of contacts down each side of it
    const long = w >= l, len = long ? w : l, wid = long ? l : w, wall = Math.min(1, wid * 0.22), pitch = type === 'pcie' || type === 'dimm' ? 1.27 : type === 'm2' ? 1 : 0.8;
    let body = box(-hx, -hy, 0, hx, hy, h);
    if (h > 1.5 && wid > 2 * wall + 0.6) body = body.subtract(box(-hx + (long ? wall : wall), -hy + wall, h * 0.4, hx - wall, hy - wall, h + 1));
    bin.add('black', tf(body, T));
    const n = Math.min(60, Math.max(1, Math.floor((len - 2 * wall) / pitch)));
    for (let i = 0; i < n; i++) for (const j of [-1, 1]) {
      const u = (i - (n - 1) / 2) * pitch, v = j * (wid / 2 - wall - 0.25), [px, py] = long ? [u, v] : [v, u];
      B('gold', px - 0.15, py - 0.15, h * 0.4, px + 0.15, py + 0.15, h - 0.2);
    }
    return;
  }
  if (type === 'pogo') {
    // pads for spring pins: a row of round pads on the board's face
    const n = Math.min(16, pinCount(c, name, Math.max(1, Math.round(Math.max(w, l) / 2.54)))), long = w >= l;
    for (let i = 0; i < n; i++) { const u = (i - (n - 1) / 2) * 2.54, [px, py] = long ? [u, 0] : [0, u]; bin.add('gold', tf(cyl(px, py, -0.01, 0.035, 0.75, 0.75, 16), T)); }
    return;
  }
  if (type === 'pins_ra') {
    // right-angle pins (ahead of the upright headers below, as its name says "pin header" too): the plastic row along
    // the edge, each pin bent down into the board (trimmed flush under it) and out over the edge
    const n = Math.max(1, Math.round(w / 2.54));
    B('black', -hx, hy - 2.5, 0, hx, hy, 2.5);
    for (let i = 0; i < n; i++) {
      const px = (i - (n - 1) / 2) * 2.54;
      B('gold', px - 0.32, hy - 3.6, 0.95, px + 0.32, hy + 6, 1.6);
      B('gold', px - 0.32, hy - 3.6, -(zt - zb), px + 0.32, hy - 2.96, 1.6);
    }
    return;
  }
  if (c.kind === 'header' || type === 'header' || ((!type || type === 'custom') && /pin.?header|pin.?socket|conn_\d+x\d+|idc/i.test(name))) {
    const socket = isSocket(c);
    const baseH = socket ? h : Math.min(2.5, h);
    const nx = Math.max(1, Math.round(w / 2.54)), ny = Math.max(1, Math.round(l / 2.54));
    if (socket && nx * ny <= 120 && h > 2) {
      // a socket: the black body with a bore for each pin, a gold ring round it on top (as the board editor's gold
      // dots), the contact's cup down in it
      const depth = Math.min(3, h * 0.6), bores: MF[] = [], rings: MF[] = [], cups: MF[] = [];
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        const px = (i - (nx - 1) / 2) * 2.54, py = (j - (ny - 1) / 2) * 2.54;
        bores.push(cyl(px, py, h - depth, h + 0.1, 0.55, 0.55, 14));
        rings.push(cyl(px, py, h - 0.02, h + 0.05, 0.95, 0.95, 14));
        cups.push(cyl(px, py, h - depth, h - depth + 0.4, 0.5, 0.5, 14));
      }
      const bore = unionMF(bores);
      bin.add('black', tf(box(-hx, -hy, 0, hx, hy, h).subtract(bore), T));
      bin.add('gold', tf(unionMF(rings).subtract(bore), T));
      bin.add('gold', tf(unionMF(cups), T));
      return;
    }
    B('black', -hx, -hy, 0, hx, hy, baseH);
    if (nx * ny <= 120) for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const px = (i - (nx - 1) / 2) * 2.54, py = (j - (ny - 1) / 2) * 2.54;
      if (socket) B('chip', px - 0.5, py - 0.5, h - 0.02, px + 0.5, py + 0.5, h + 0.01);
      else { B('gold', px - 0.32, py - 0.32, 0, px + 0.32, py + 0.32, h - 0.5); B('gold', px - 0.2, py - 0.2, h - 0.5, px + 0.2, py + 0.2, h); }
    }
    return;
  }
  if (type === 'idc_ra' || type === 'wtb_side') {
    // a right-angle socket, its mouth to the edge: walls round the opening (the key slot in a box header's top, a
    // latch slot in a wire-to-board one's) and the pins lying in it
    const ribbon = type === 'idc_ra', wall = ribbon ? 0.9 : 0.5;
    const pitch = ribbon ? 2.54 : wtbPitch(name), rows = ribbon || /2x\d|mini[\s_-]?fit|5569|39-?30|39301/i.test(name) ? 2 : 1;
    const n = pinCount(c, name, rows * Math.max(1, Math.round((w - (ribbon ? 7.6 : 4)) / pitch) + (ribbon ? 0 : 1))), k = Math.ceil(n / rows);
    let shell = box(-hx, -hy, 0, hx, hy, h);
    if (w > 2 * wall + 1 && h > 2 * wall + 1) shell = shell.subtract(box(-hx + wall, -hy + Math.min(1.5, l * 0.3), wall, hx - wall, hy + 1, h - wall));
    const key = Math.min(hx, pitch * (ribbon ? 2.2 : 1.2));
    if (h > 2 * wall + 1) shell = shell.subtract(box(-key / 2, hy - Math.min(3, l * 0.4), h - wall - 0.1, key / 2, hy + 1, h + 1));
    bin.add(ribbon || /micro[\s_-]?fit/i.test(name) ? 'black' : 'white', tf(shell, T));
    const zc = h / 2, r = Math.min(0.32, pitch * 0.2);
    for (let i = 0; i < k; i++) for (const j of rows === 2 ? [-0.5, 0.5] : [0]) {
      const px = (i - (k - 1) / 2) * pitch, pz = zc + j * pitch;
      B('gold', px - r, -hy + Math.min(1.5, l * 0.3), pz - r, px + r, hy - 1.2, pz + r);
    }
    return;
  }
  if (type === 'fpc') {
    // a flat-cable connector: a low housing with its slot to the edge, the latch bar across the mouth, a row of
    // contacts along the back
    let housing = box(-hx, -hy, 0, hx, hy - 1.6, h * 0.72);
    if (w > 3 && h > 1) housing = housing.subtract(box(-hx + 1.2, hy - 4, h * 0.25, hx - 1.2, hy, h * 0.5));
    bin.add('white', tf(housing, T));
    B('black', -hx, hy - 1.6, h * 0.1, hx, hy, h);
    const m = /_P(\d+(?:\.\d+)?)mm/i.exec(c.pkg), pitch = m ? +m[1] : 0.5, n = Math.min(80, pinCount(c, name, Math.max(2, Math.round((w - 5) / pitch) + 1)));
    for (let i = 0; i < n; i++) { const px = (i - (n - 1) / 2) * pitch; B('gold', px - pitch * 0.22, -hy, 0, px + pitch * 0.22, -hy + 0.8, 0.15); }
    return;
  }
  if (type === 'dsub') {
    // a right-angle D-sub: the metal flange at the edge, the D-shaped shell out past it round the black insulator,
    // a hex jackscrew post each side, the plastic body behind
    const n = w < 35 ? 9 : w < 46 ? 15 : w < 61 ? 25 : 37, top = (Math.ceil(n / 2) - 1) * 2.77 + 5.6, sh = Math.min(7.9, h - 2), zc = h / 2;
    const D = (tw: number, hh: number) => poly([[-tw / 2 + hh * 0.18, -hh / 2], [tw / 2 - hh * 0.18, -hh / 2], [tw / 2, hh / 2], [-tw / 2, hh / 2]]);
    const outY = (m: MF, y1: number) => m.transform([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, y1, zc, 1] as any);
    const sl = Math.min(6, l * 0.45), fy = hy - sl; // the shell's length out past the flange, where the flange is
    B('black', -hx + 2.5, -hy, 0, hx - 2.5, fy - 0.8, h - 1);
    B('metal', -hx, fy - 0.8, 0, hx, fy, h);
    bin.add('metal', tf(outY(ext(D(top, sh), 0, sl).subtract(ext(D(top - 1.2, sh - 1.2), -1, sl - 0.6)), hy), T));
    bin.add('black', tf(outY(ext(D(top - 1.3, sh - 1.3), 0, sl - 1), hy - 1), T));
    for (const sx of [-1, 1]) {
      const x = sx * Math.min(hx - 2.8, top / 2 + 4.2);
      bin.add('metal', tf(cyl(0, 0, 0, sl - 1.2, 2.7, 2.7, 6).subtract(cyl(0, 0, 1, sl, 1.3, 1.3, 16)).transform([-1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, x, fy, zc, 1] as any), T));
    }
    return;
  }
  if (type === 'bnc') {
    // a right-angle BNC: its body on the board, the metal barrel out past the edge with its two bayonet studs, the
    // white insulator and centre pin in its mouth
    const zc = h / 2, R = Math.max(1.5, Math.min(4.8, h / 2 - 0.5)), bl = Math.min(l * 0.55, 11);
    B('black', -hx, -hy, 0, hx, hy - bl, h);
    bin.add('metal', tf(cylY(0, zc, R + 1.4, hy - bl, hy - bl + 2.5), T));
    bin.add('metal', tf(cylY(0, zc, R, hy - bl, hy).subtract(cylY(0, zc, R - 0.6, hy - bl + 1, hy + 1)), T));
    bin.add('white', tf(cylY(0, zc, R - 0.6, hy - bl + 1, hy - 1.5).subtract(cylY(0, zc, 0.8, hy - bl, hy)), T));
    bin.add('gold', tf(cylY(0, zc, 0.5, hy - bl + 1, hy - 1.8), T));
    for (const sx of [-1, 1]) B('metal', sx > 0 ? R - 0.2 : -R - 1.2, hy - 3.6, zc - 0.6, sx > 0 ? R + 1.2 : -R + 0.2, hy - 2.4, zc + 0.6);
    return;
  }
  if (type === 'rca') {
    // an RCA jack: a black body, the coloured ring (red or white for sound, yellow for video) and its metal sleeve
    const R = Math.max(1.5, Math.min(4.1, h / 2 - 0.6)), zc = Math.max(R + 0.8, Math.min(h - R - 0.8, c.conn?.zc ?? h / 2));
    const ring: Mat = /red|right|\bR\b/i.test(name) ? 'red' : /white|left|\bL\b/i.test(name) ? 'white' : 'yellow';
    B('black', -hx, -hy, 0, hx, hy - 3, h);
    bin.add(ring, tf(cylY(0, zc, R + 0.8, hy - 3, hy - 1.2), T));
    bin.add('metal', tf(cylY(0, zc, R, hy - 3, hy).subtract(cylY(0, zc, R - 0.5, hy - 2.5, hy + 1)), T));
    bin.add('metal', tf(cylY(0, zc, 1.3, hy - 3, hy - 0.4).subtract(cylY(0, zc, 0.6, hy - 2.5, hy)), T));
    return;
  }
  if (type === 'xt60' || type === 'xt30') {
    // an XT socket: the yellow housing, its mouth with one corner cut (a plug only goes in one way), two gold sockets
    const s = type === 'xt60' ? 1 : 0.65, zc = h / 2, mw = Math.max(1, w - 1.6), mh = Math.max(1, h - 1.6), ch = Math.min(2 * s, mh / 2);
    const mouth = poly([[-mw / 2, -mh / 2], [mw / 2 - ch, -mh / 2], [mw / 2, -mh / 2 + ch], [mw / 2, mh / 2], [-mw / 2, mh / 2]]);
    const depth = Math.min(l * 0.7, 10 * s);
    bin.add('yellow', tf(box(-hx, -hy, 0, hx, hy, h).subtract(ext(mouth, 0, depth + 1).transform([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, hy + 1, zc, 1] as any)), T));
    for (const sx of [-1, 1]) bin.add('gold', tf(cylY(sx * 3.6 * s, zc, 1.9 * s, hy - depth, hy - 1).subtract(cylY(sx * 3.6 * s, zc, 1.35 * s, hy - depth + 1, hy)), T));
    return;
  }
  // a contributed connector with a look of its own (parts/type-*.json): drawn from that (a part plugged from above in its own frame, w along x)
  const own = contribLook(type);
  if (own) { if (own.entry === 'top') drawLook(bin, frameOf(c, z0, below), c.w, c.l, h, own.look); else drawLook(bin, T, w, l, h, own.look); return; }
  if (c.conn?.entry === 'edge' || c.kind === 'connector') {
    const metalShell = /usb|hdmi|microsd|sma|rj45|^(dp|sd)$/.test(type) || /usb|hdmi|sd/i.test(name);
    if ((type === 'sma' || type === 'xlr' || type === 'm12' || type === 'minidin') && Math.min(w, h) > 3 && l > 4) {
      // a round connector: a block on the board, and out past its edge the metal barrel, threaded on an SMA and an M12,
      // plain on an XLR and a mini-DIN, with its contacts in the mouth (one, three, a ring of four or more, a ring of six)
      const R = Math.min(h / 2, w / 2, type === 'sma' ? 99 : type === 'xlr' ? Math.min(w, h) / 2 - 0.6 : type === 'm12' ? Math.min(w, h) * 0.375 : Math.min(w, h) * 0.4);
      const zc = Math.max(R, Math.min(h - R, c.conn?.zc || h / 2));
      const bl = Math.min(l * (type === 'sma' ? 0.7 : type === 'minidin' ? 0.6 : 0.55), type === 'sma' ? 7 : type === 'xlr' ? 14 : type === 'm12' ? 11 : 9), y0 = hy - bl;
      const wall = type === 'sma' ? 0.9 : type === 'xlr' ? 1 : type === 'm12' ? 1.2 : 0.6, rec = type === 'sma' ? 1.6 : type === 'xlr' ? 4 : type === 'm12' ? 3 : 2.5;
      const thread = type === 'sma' || type === 'm12', pitch = type === 'sma' ? 0.8 : 1;
      B(type === 'xlr' || type === 'm12' ? 'black' : 'metal', -hx, -hy, 0, hx, y0, h);
      const ring: MF[] = [cylY(0, zc, thread ? R - 0.25 : R, y0, hy)];
      if (thread) for (let y = y0 + 0.5; y + 0.45 < hy - 0.1; y += pitch) ring.push(cylY(0, zc, R, y, y + 0.45));
      bin.add('metal', tf(unionMF(ring).subtract(cylY(0, zc, R - wall, y0 + 1, hy + 1)), T));
      const ri = R - wall, face = hy - rec;
      bin.add(type === 'sma' ? 'white' : 'black', tf(cylY(0, zc, ri, y0 + 1, face), T));
      // the contacts: tubes standing a little proud of the insert's face
      const n = type === 'sma' ? 1 : type === 'xlr' ? 3 : Math.max(3, Math.min(type === 'm12' ? 8 : 9, pinCount(c, name, type === 'm12' ? 4 : 6)));
      const ringN = type === 'sma' ? 0 : type === 'xlr' ? 3 : type === 'm12' && n >= 5 ? n - 1 : n, rr = ri * (type === 'minidin' ? 0.6 : type === 'm12' ? 0.6 : 0.45);
      const at2: [number, number][] = type === 'sma' || (type === 'm12' && n >= 5) ? [[0, 0]] : [];
      for (let k = 0; k < ringN; k++) { const an = rad((type === 'xlr' ? 30 : 90) + (360 * (k + (type === 'minidin' ? 0.5 : type === 'm12' ? 0.5 : 0))) / ringN); at2.push([rr * Math.cos(an), rr * Math.sin(an)]); }
      const cr = type === 'sma' ? 0.75 : type === 'xlr' ? 1.1 : type === 'm12' ? 0.6 : 0.5;
      for (const [px, pz] of at2) bin.add('gold', tf(cylY(px, zc + pz, cr, face - 0.05, face + 0.4).subtract(cylY(px, zc + pz, cr * 0.5, face + 0.1, face + 1)), T));
      // the key (an XLR's latch slot, a mini-DIN's and an M12's keyway) at the top of the mouth
      if (type !== 'sma') B(type === 'xlr' ? 'metal' : 'black', -Math.min(1.2, ri * 0.15), y0 + 1, zc + ri - Math.min(1.6, ri * 0.25), Math.min(1.2, ri * 0.15), face + 0.2, zc + ri);
      return;
    }
    if (type === 'iec_c7' && w > 3 && h > 3 && l > 4) {
      // the figure-8 socket: two round lobes side by side (the mouth and the body's own outline), two pin blades inside
      const fig = (ww: number, hh: number) => { const r = hh / 2, d = Math.max(0, ww / 2 - r); return unionCS([circle2(-d, 0, r, 32), circle2(d, 0, r, 32)]); };
      const wall = Math.min(0.6, h / 6), depth = Math.min(l * 0.75, 10);
      const at3 = (y: number) => [-1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, y, h / 2, 1] as any;
      bin.add('black', tf(ext(fig(w, h), 0, l).transform(at3(-hy)).subtract(ext(fig(w - 2 * wall, h - 2 * wall), 0, depth + 1).transform(at3(hy - depth))), T));
      const d = Math.max(0, w / 2 - h / 2);
      for (const sx of [-1, 1]) B('gold', sx * d - 0.4, hy - depth + 0.3, h / 2 - Math.min(1.6, h / 5), sx * d + 0.4, hy - 1.5, h / 2 + Math.min(1.6, h / 5));
      return;
    }
    if (type === 'barrel' || type === 'audio35') {
      // the bore on the plug's axis (6.5 mm up on a barrel jack), so the plug drawn in it lines up
      const r = Math.min(w, h) * (type === 'barrel' ? 0.34 : 0.26), zc = Math.max(r + 0.4, Math.min(h - r - 0.4, c.conn?.zc || h / 2));
      let body = box(-hx, -hy, 0, hx, hy, h);
      body = body.subtract(cylY(0, zc, r, hy - Math.min(l * 0.7, 9), hy + 1));
      bin.add('black', tf(body, T));
      bin.add('metal', tf(cylY(0, zc, r * 0.35, hy - Math.min(l * 0.7, 9), hy - 1.5), T));
      if (type === 'audio35') bin.add('black', tf(cylY(0, zc, r + 0.9, hy - 0.2, hy + 1.6).subtract(cylY(0, zc, r, hy - 1, hy + 2)), T));
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
    const depth = Math.min(l * 0.75, type === 'rj45' || type === 'rj11' ? 13 : 7);
    let body = box(-hx, -hy, 0, hx, hy, h);
    let hole: MF;
    if (type === 'usb_c' || type === 'usb_micro_b' || type === 'hdmi_micro') {
      const hh = Math.max(0.6, h - 2 * t), ww = Math.max(1, w - 2 * t), r = Math.min(hh, ww) / 2;
      hole = ext(roundRect(ww, hh, r), 0, depth + 1).transform([-1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, hy - depth, h / 2, 1] as any);
      body = ext(roundRect(w, h, Math.min(w, h) / 2), 0, l).transform([-1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, -hy, h / 2, 1] as any);
    } else if (type === 'rj45' || type === 'rj11') {
      hole = box(-hx + 2.2, hy - depth, 1.2, hx - 2.2, hy + 1, h - 2.5).add(box(-2, hy - depth, 0.4, 2, hy + 1, 1.3)); // latch slot
    } else if (type.startsWith('hdmi') || type === 'dp') {
      // HDMI's trapezoid mouth; DisplayPort's has one corner cut
      const ww = w - 2 * t, hh = h - 2 * t, ch = Math.min(1.4, hh * 0.35);
      const mouth = type === 'dp' ? [[-ww / 2, 0], [ww / 2 - ch, 0], [ww / 2, ch], [ww / 2, hh], [-ww / 2, hh]] : [[-ww / 2 + ch, 0], [ww / 2 - ch, 0], [ww / 2, ch], [ww / 2, hh], [-ww / 2, hh], [-ww / 2, ch]];
      hole = ext(poly(mouth as [number, number][]), 0, depth + 1).transform([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, hy + 1, t, 1] as any);
    } else {
      hole = box(-hx + t, hy - depth, t + (type === 'microsd' ? 0 : 0.2), hx - t, hy + 1, h - t);
    }
    // (a part too low for its opening, whose opening would be a box inside out, is drawn solid)
    bin.add(metalShell ? 'metal' : 'black', tf(hole.status() === 'NoError' ? body.subtract(hole) : body, T));
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
    } else if (type === 'usb_c' || type === 'usb_micro_b' || type === 'hdmi_micro' || type === 'hdmi_mini' || type === 'hdmi_a' || type === 'dp') {
      B('black', -hx * 0.62, hy - depth + 0.3, h / 2 - 0.3, hx * 0.62, hy - 0.9, h / 2 + 0.3);
      const nc = type === 'usb_c' ? 6 : 5;
      for (let c2 = 0; c2 < nc; c2++) { const cx = -hx * 0.55 + (hx * 1.1 * (c2 + 0.5)) / nc; B('gold', cx - 0.12, hy - depth + 0.8, h / 2 + 0.3, cx + 0.12, hy - 1.2, h / 2 + 0.36); }
      B('black', -hx + t, hy - depth, t, hx - t, hy - depth + 0.3, h - t);
    } else if (type === 'rj11') {
      B('black', -hx + 2.2, hy - depth, 1.2, hx - 2.2, hy - depth + 0.4, h - 2.5);
      for (let c2 = 0; c2 < 6; c2++) { const cx = (c2 - 2.5) * 1.02; B('gold', cx - 0.2, hy - depth + 0.4, h - 3.3, cx + 0.2, hy - depth + 5, h - 2.55); }
    } else if (type === 'rj45') {
      B('black', -hx + 2.2, hy - depth, 1.2, hx - 2.2, hy - depth + 0.4, h - 2.5);
      for (let c2 = 0; c2 < 8; c2++) { const cx = -3.57 + c2 * 1.02; B('gold', cx - 0.2, hy - depth + 0.4, h - 3.3, cx + 0.2, hy - depth + 5, h - 2.55); }
      bin.box('led', T, -hx + 0.8, hy - 0.2, h - 2.1, -hx + 3.2, hy + 0.15, h - 0.6);
      bin.box('led', T, hx - 3.2, hy - 0.2, h - 2.1, hx - 0.8, hy + 0.15, h - 0.6);
      // the jack's link light (green, on while a cable is in) and activity light (amber, flickering with traffic)
      const n = along(T, [0, 1, 0]);
      bin.lights.push({ p: at(T, [-hx + 2, hy + 0.2, h - 1.35]), n, colour: LED_COLOUR.green, pattern: 'on', r: 0.9, i: 0, name: `${c.ref} link`, ref: c.ref });
      bin.lights.push({ p: at(T, [hx - 2, hy + 0.2, h - 1.35]), n, colour: LED_COLOUR.amber, pattern: 'activity', r: 0.9, i: 1, name: `${c.ref} activity`, ref: c.ref });
    } else {
      B('black', -hx + t, hy - depth, t, hx - t, hy - depth + 0.3, h - t);
    }
    return;
  }
  if (c.kind === 'switch' && Math.min(w, l) >= 3 && Math.abs(w - l) < 1.5) {
    // a tactile switch: black body, metal frame, round plunger
    B('black', -hx, -hy, 0, hx, hy, h * 0.55);
    B('metal', -hx + 0.2, -hy + 0.2, h * 0.55, hx - 0.2, hy - 0.2, h * 0.62);
    bin.add('black', tf(cyl(0, 0, h * 0.62, h, Math.min(w, l) * 0.28, Math.min(w, l) * 0.28, 20), T));
    return;
  }
  if (c.kind === 'switch') {
    B('black', -hx, -hy, 0, hx, hy, h * 0.6);
    const s = Math.min(w, l) * 0.3;
    B('white', -s, -s, h * 0.6, s, s, h);
    return;
  }
  if (c.kind === 'led') {
    if (h > 3 && Math.abs(w - l) < 1) {
      // a through-hole LED: a coloured-clear dome on a collar
      const r = Math.min(w, l) / 2;
      bin.add('led', tf(cyl(0, 0, 0.8, h - r * 0.9, r * 0.9, r * 0.9, 24).add(K().Manifold.sphere(r * 0.9, 24).translate([0, 0, h - r * 0.9])), T));
      bin.add('led', tf(cyl(0, 0, 0, 0.8, r, r, 24), T));
      return;
    }
    // a surface-mount LED: white body, tinned ends, the clear lens on top
    const long = w >= l, e = Math.min(0.35, (long ? w : l) * 0.18);
    if (long) { B('white', -hx + e, -hy, 0, hx - e, hy, h * 0.55); B('tin', -hx, -hy, 0, -hx + e, hy, h * 0.6); B('tin', hx - e, -hy, 0, hx, hy, h * 0.6); B('led', -hx + e, -hy + 0.05, h * 0.55, hx - e, hy - 0.05, h); }
    else { B('white', -hx, -hy + e, 0, hx, hy - e, h * 0.55); B('tin', -hx, -hy, 0, hx, -hy + e, h * 0.6); B('tin', -hx, hy - e, 0, hx, hy, h * 0.6); B('led', -hx + 0.05, -hy + e, h * 0.55, hx - 0.05, hy - e, h); }
    return;
  }
  if (c.kind === 'hot') {
    B('chip', -hx, -hy, 0, hx, hy, Math.max(0.2, h - 0.6));
    B('metal', -hx + 0.6, -hy + 0.6, Math.max(0.2, h - 0.6), hx - 0.6, hy - 0.6, h);
    return;
  }
  if (c.kind === 'module' && !/relay/i.test(`${c.pkg} ${c.value ?? ''}`)) { // (a relay tagged a module is drawn as the relay it is, below)
    B('mask', -hx, -hy, 0, hx, hy, Math.min(1, h));
    if (h > 1.2) B('metal', -hx + 0.8, -hy + 0.8, Math.min(1, h), hx - 0.8, hy - 0.8, h);
    return;
  }
  if (c.kind === 'antenna') { B('white', -hx, -hy, 0, hx, hy, h); return; }
  // tall parts that have a look of their own: electrolytic caps, buzzers, relays, trimmers, coin cell holders
  const pkgName = `${c.pkg} ${c.value ?? ''}`;
  const round = Math.abs(w - l) < 0.6 * Math.min(w, l) && h > 3;
  if (round && /elec|cap|\bCP_|electrolytic/i.test(pkgName)) {
    const r = Math.min(w, l) / 2;
    bin.add('metal', tf(cyl(0, 0, 0, h - 0.4, r - 0.05, r - 0.05, 32), T));
    bin.add('blue', tf(cyl(0, 0, 0.3, h - 0.9, r, r, 32), T));
    bin.add('metal', tf(cyl(0, 0, h - 0.4, h, r - 0.35, r - 0.35, 32), T));
    B('white', -r * 0.85, r * 0.35, 0.35, -r * 0.25, r * 0.75, h - 1); // the minus stripe
    return;
  }
  if (round && /buzzer|beeper|speaker/i.test(pkgName)) {
    const r = Math.min(w, l) / 2;
    bin.add('black', tf(cyl(0, 0, 0, h, r, r, 32).subtract(cyl(0, 0, h - 0.6, h + 1, 1, 1, 16)), T));
    return;
  }
  if (/relay/i.test(pkgName)) { B('blue', -hx, -hy, 0, hx, hy, h); B('white', -hx * 0.7, -hy * 0.5, h, hx * 0.1, hy * 0.5, h + 0.02); return; }
  if (/trimmer|pot\b|potentiometer/i.test(pkgName)) { B('blue', -hx, -hy, 0, hx, hy, h * 0.6); bin.add('white', tf(cyl(0, 0, h * 0.6, h, Math.min(w, l) * 0.32, Math.min(w, l) * 0.32, 24), T)); return; }
  if (/coin|cr2032|battery/i.test(pkgName)) { B('black', -hx, -hy, 0, hx, hy, h * 0.55); bin.add('metal', tf(cyl(0, -hy * 0.1, h * 0.55, h, Math.min(w, l) * 0.42, Math.min(w, l) * 0.42, 32), T)); return; }
  if (/crystal|xtal|hc.?49|\bY\d/i.test(`${pkgName} ${c.ref}`)) { B('metal', -hx, -hy, 0, hx, hy, h); return; }
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
    // the part number printed on the top, as makers do
    const mark = (c.value || '').replace(/\s+/g, ' ').trim().slice(0, 12);
    if (mark && (w - 2 * leg) * (l - 2 * leg) > 20 && /^[A-Za-z0-9][\w\- .+/]*$/.test(mark)) {
      const inner = Math.max(w, l) - 2 * leg - 1.6, hg = Math.min(1.2, (Math.min(w, l) - 2 * leg) * 0.28, inner / Math.max(3, mark.length) / 0.75);
      if (hg >= 0.5) {
        // along the chip's long side, centred on its top
        const tw = textWidth(mark, hg), sw = Math.max(0.1, hg * 0.12), rot = l > w;
        for (const [a, b] of textStrokes(mark, hg)) {
          const ax = a[0] - tw / 2, ay = a[1] - hg / 2, bx = b[0] - tw / 2, by = b[1] - hg / 2;
          const [p0, p1] = rot ? [[-ay, ax], [-by, bx]] : [[ax, ay], [bx, by]];
          const dx = p1[0] - p0[0], dy = p1[1] - p0[1], L = Math.hypot(dx, dy), an = Math.atan2(dy, dx);
          bin.box('silk', mulT(T, [Math.cos(an), Math.sin(an), 0, 0, -Math.sin(an), Math.cos(an), 0, 0, 0, 0, 1, 0, p0[0], p0[1], h, 1]), -sw / 2, -sw / 2, 0, L + sw / 2, sw / 2, 0.03);
        }
      }
    }
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

/** Silkscreen text with its bottom-left corner at o, running at `deg` degrees (0: along x). */
function silkText(bin: Bin, text: string, o: [number, number], hgt: number, zt: number, deg = 0) {
  const sw = Math.max(0.14, hgt * 0.13), rc = Math.cos(rad(deg)), rs = Math.sin(rad(deg));
  const R = (q: number[]): [number, number] => [q[0] * rc - q[1] * rs, q[0] * rs + q[1] * rc];
  for (const [a0, b0] of textStrokes(text, hgt)) {
    const a = R(a0), b = R(b0);
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    const an = Math.atan2(dy, dx), ca = Math.cos(an), sa = Math.sin(an);
    const T = [ca, sa, 0, 0, -sa, ca, 0, 0, 0, 0, 1, 0, o[0] + a[0], o[1] + a[1], zt, 1];
    bin.box('silk', T, -sw / 2, -sw / 2, 0, L + sw / 2, sw / 2, 0.05);
  }
}

/** A spot on the board surface clear of parts for a label of w x h (bottom-left corner), or null. */
function findFree(b: Board, comps: Comp[], w: number, h: number, also: { x0: number; y0: number; x1: number; y1: number }[] = []): [number, number] | null {
  const bb = bbox(b.outline);
  const rects = [...comps.filter((c) => c.side === 'top').map((c) => bbox(compRect(c, 1))), ...also];
  const holes = b.holes.map((q) => ({ x0: q.x - q.d, y0: q.y - q.d, x1: q.x + q.d, y1: q.y + q.d }));
  for (let y = bb.y0 + 2; y + h < bb.y1 - 2; y += 1.5) for (let x = bb.x0 + 2; x + w < bb.x1 - 2; x += 1.5) {
    const box = { x0: x - 0.5, y0: y - 0.5, x1: x + w + 0.5, y1: y + h + 0.5 };
    if (![...rects, ...holes].some((r) => r.x0 < box.x1 && box.x0 < r.x1 && r.y0 < box.y1 && box.y0 < r.y1) && [[x, y], [x + w, y + h], [x, y + h], [x + w, y]].every((q) => inside(q as [number, number], b.outline))) return [x, y];
  }
  return null;
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

/** A mains outlet in the top of a powerboard: its raised face and the slots of its kind, a rocker switch beside it. */
function outlet(bin: Bin, c: Comp, zt: number) {
  const t = c.conn!.type, r0 = rad(c.rot);
  // a slot (or pin hole) w x h at (x, y) on the face, turned a degrees
  const at = (x: number, y: number, a = 0) => {
    const ca = Math.cos(r0), sa = Math.sin(r0), r = r0 + rad(a);
    return [Math.cos(r), Math.sin(r), 0, 0, -Math.sin(r), Math.cos(r), 0, 0, 0, 0, 1, 0, c.x + x * ca - y * sa, c.y + x * sa + y * ca, zt, 1];
  };
  const slot = (x: number, y: number, w: number, h: number, a = 0) => bin.box('black', at(x, y, a), -w / 2, -h / 2, 0.55, w / 2, h / 2, 0.66);
  const hw = Math.min(c.w, c.l) / 2 - 1;
  bin.box('white', at(0, 0), -hw, -hw, -0.1, hw, hw, 0.6);
  if (t === 'ac_au') { slot(-5.6, 2.2, 1.8, 6.5, -30); slot(5.6, 2.2, 1.8, 6.5, 30); slot(0, -7, 1.8, 6.5); }
  else if (t === 'ac_uk') { slot(0, 8, 4, 8); slot(-11, -4.5, 6.2, 2.4); slot(11, -4.5, 6.2, 2.4); }
  else if (t === 'ac_us') { slot(-6.3, 1.5, 1.8, 7); slot(6.3, 1.5, 1.8, 7); slot(0, -8, 4.2, 4.2); }
  else { slot(-9.5, 0, 4.8, 4.8); slot(9.5, 0, 4.8, 4.8); slot(0, hw - 1.5, 6, 1.2); slot(0, -hw + 1.5, 6, 1.2); }
  if (c.value === 'switched') { bin.box('box', at(0, hw + 7), -6, -4, 0, 6, 4, 1.2); bin.box('red', at(0, hw + 7), -4.8, -2.8, 1.2, 4.8, 2.8, 2.6); }
}

/**
 * Ghosts of a board: soldermask slab with plated pads and silkscreen, and every part. `T` places them
 * (for boards bolted on top of another).
 */
export function boardDetail(b: Board, zb: number, zt: number, tag: PickTag, anim: Anim): Ghost[] {
  const bin = new Bin();
  // a bare board (a probe, an adapter) is drawn as the circuit board it is, its colour the solder mask's
  const bare = b.kind === 'box' && !!b.box && b.box.h < 5;
  if (b.kind === 'box' && !bare) {
    // a closed device: rounded plastic housing with its ports as openings
    bin.add('box', ext(poly(b.outline), zb, zt - 0.6));
    bin.add('box', ext(poly(b.outline).offset(-0.6, 'Round'), zt - 0.61, zt));
    for (const c of b.comps) {
      if (c.hidden || !c.conn || c.conn.entry !== 'edge') continue;
      const t = c.conn.type, a = rad(c.conn.angle), d = [Math.cos(a), Math.sin(a)], tt = [-d[1], d[0]];
      const zc = zt + c.conn.zc;
      // drawn as the socket is made (flat), then turned the way it sits in the box's face
      const roll = c.conn.roll ?? 0, pl = roll % 180 ? { w: c.conn.plug.h, h: c.conn.plug.w } : c.conn.plug;
      const pw = t === 'usb_a' ? 13 : t === 'barrel' ? 9 : Math.max(6, pl.w * 0.65), ph = t === 'usb_a' ? 5.8 : t === 'barrel' ? 9 : Math.max(2.8, pl.h * 0.45);
      // the mouth sits on the housing face: find it along d from the port position
      let s0 = 0;
      for (let k = 0; k < 60 && inside([c.x + d[0] * s0, c.y + d[1] * s0], b.outline); k++) s0 += 0.5;
      const T = rollT([d[0], d[1], 0, 0, tt[0], tt[1], 0, 0, 0, 0, 1, 0, c.x + d[0] * s0, c.y + d[1] * s0, zc, 1], roll);
      bin.box('black', T, -0.8, -pw / 2, -ph / 2, 0.08, pw / 2, ph / 2);
      // a USB-A's tongue in the upper half of its mouth (the lower half upside down), its metal shell above and below
      if (t === 'usb_a') { bin.box('white', T, -0.7, -pw / 2 + 1.6, 0.2, 0.1, pw / 2 - 1.6, 1.9); bin.box('metal', T, -0.2, -pw / 2 - 0.4, -ph / 2 - 0.4, 0.12, pw / 2 + 0.4, -ph / 2); bin.box('metal', T, -0.2, -pw / 2 - 0.4, ph / 2, 0.12, pw / 2 + 0.4, ph / 2 + 0.4); }
      // an RJ45's latch notch at the top of its mouth (at the bottom upside down)
      if (t === 'rj45') {
        bin.box('box', T, -0.7, -2, ph / 2 - 1.4, 0.1, 2, ph / 2 + 0.01);
        // link and activity lights in the top corners of the jack's mouth
        for (const [k, y] of [[0, -(pw / 2 - 1.1)], [1, pw / 2 - 1.1]] as const) {
          bin.box('led', T, -0.1, y - 0.7, ph / 2 - 1.6, 0.14, y + 0.7, ph / 2 - 0.4);
          bin.lights.push({ p: at(T, [0.16, y, ph / 2 - 1]), n: along(T, [1, 0, 0]), colour: k ? LED_COLOUR.amber : LED_COLOUR.green, pattern: k ? 'activity' : 'on', r: 0.8, i: k, name: `${c.ref} ${k ? 'activity' : 'link'}`, ref: c.ref });
        }
      }
      if (t === 'barrel') bin.box('metal', T, -0.7, -0.8, -0.8, 0.1, 0.8, 0.8);
    }
    // ports in the top face: the opening, the tongue and the shell rim (a mains outlet: its face and slots)
    for (const c of b.comps) {
      if (c.hidden || !c.conn || c.conn.entry !== 'top') continue;
      if (c.conn.type.startsWith('ac_')) { outlet(bin, c, zt); continue; }
      // turned with the port (a row turned 90 degrees runs across the box)
      const t = c.conn.type, ca = Math.cos(rad(c.rot)), sa = Math.sin(rad(c.rot)), T = [ca, sa, 0, 0, -sa, ca, 0, 0, 0, 0, 1, 0, c.x, c.y, zt, 1];
      const pw = t === 'usb_a' ? 13 : Math.max(6, c.conn.plug.w * 0.65), ph = t === 'usb_a' ? 5.8 : Math.max(2.8, c.conn.plug.h * 0.45);
      bin.box('black', T, -pw / 2, -ph / 2, -0.8, pw / 2, ph / 2, 0.08);
      if (t === 'usb_a') { bin.box('white', T, -pw / 2 + 1.6, -0.7, -0.7, pw / 2 - 1.6, 0.9, 0.1); bin.box('metal', T, -pw / 2 - 0.4, -ph / 2 - 0.4, -0.2, pw / 2 + 0.4, -ph / 2, 0.12); bin.box('metal', T, -pw / 2 - 0.4, ph / 2, -0.2, pw / 2 + 0.4, ph / 2 + 0.4, 0.12); }
    }
    const bb = bbox(b.outline);
    bin.box('led', [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, bb.x0 + 6, (bb.y0 + bb.y1) / 2, zt, 1], -1, -1, -0.02, 1, 1, 0.3);
    bin.lights.push({ p: [bb.x0 + 6, (bb.y0 + bb.y1) / 2, zt + 0.32], ...boxLight(b), r: 1.1, i: 0, name: 'status' });
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
  // the lights: an LED part's lens is drawn with the part; a template board's LEDs (not parts) drawn here
  const hasLed = list.some((c) => c.kind === 'led');
  for (const L of boardLights(b)) {
    if (!hasLed) {
      const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, L.p[0], L.p[1], zt, 1];
      bin.box('white', T, -0.6, -0.4, 0, 0.6, 0.4, 0.28); bin.box('tin', T, -0.8, -0.4, 0, -0.6, 0.4, 0.3); bin.box('tin', T, 0.6, -0.4, 0, 0.8, 0.4, 0.3);
      bin.box('led', T, -0.6, -0.35, 0.28, 0.6, 0.35, 0.5);
    }
    bin.lights.push({ ...L, p: [L.p[0], L.p[1], zt + (hasLed ? L.p[2] : 0.5) + 0.02], ...(L.bottom ? { n: [0, 0, -1] } : {}) });
  }
  // copper: the board's own tracks (KiCad), else plausible ones between the parts' pins
  const cu = boardCopper(b), tr = cu.tracks;
  for (const t of tr.slice(0, 6000)) {
    const dx = t.b[0] - t.a[0], dy = t.b[1] - t.a[1], L = Math.hypot(dx, dy);
    if (L < 0.01) continue;
    const a = Math.atan2(dy, dx), ca = Math.cos(a), sa = Math.sin(a);
    const z = t.side === 'top' ? zt : zb - 0.04;
    const T = [ca, sa, 0, 0, -sa, ca, 0, 0, 0, 0, 1, 0, t.a[0], t.a[1], z, 1];
    bin.box('trace', T, -t.w / 2, -t.w / 2, 0, L + t.w / 2, t.w / 2, 0.04);
  }
  const vias = cu.vias;
  for (const v of vias.slice(0, 3000)) {
    for (const z of [zt, zb - 0.05]) {
      const T = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v.x, v.y, z, 1];
      const r = v.d / 2, q = r * 0.42;
      bin.box('tin', T, -r, -q, 0.0, r, q, 0.05); bin.box('tin', T, -q, -r, 0.0, q, r, 0.05);
      bin.box('black', T, -q * 0.6, -q * 0.6, 0.0, q * 0.6, q * 0.6, 0.06);
    }
  }
  // (what the silkscreen text takes, so the board's name and the plugs' labels keep clear of it)
  const taken: { x0: number; y0: number; x1: number; y1: number }[] = [];
  // silkscreen: what each pin of a named header is (GND, TX, RX…), beside it, as boards have them printed
  for (const c of list) {
    if (c.side !== 'top' || !c.conn || !['header', 'pins_ra', 'jst_ph', 'jst_xh'].includes(c.conn.type)) continue;
    const pins = headerPins(c);
    if (!pins.some((q) => q.net)) continue;
    const hgt = 0.95;
    const short = (n: string) => { const t = n.replace(/^\//, '').split(/[^a-z0-9+]+/i).filter(Boolean); return (t[t.length - 1] ?? '').replace(/^\+/, '').toUpperCase().slice(0, 4); };
    let dx = 0, dy = 0;
    if (c.conn.type === 'pins_ra') { const a = rad(c.conn.angle); dx = -Math.cos(a); dy = -Math.sin(a); } // inward, away from the pins
    else { const a = rad(c.w >= c.l ? c.rot : c.rot + 90); dx = -Math.sin(a); dy = Math.cos(a); if (Math.abs(dy) > 0.7) { dx = 0; dy = -1; } }
    const off = c.conn.type === 'pins_ra' ? 3.4 : Math.min(c.w, c.l) / 2 + 0.7;
    for (const q of pins) {
      if (!q.net) continue;
      const t = short(q.net), tw = textWidth(t, hgt);
      const cx = q.x + dx * off, cy = q.y + dy * off;
      if (Math.abs(dy) > 0.7) {
        // across a row that runs along x the names sit under the pins, turned 90 degrees and reading up (four letters
        // are wider than the pitch), as boards print them; beside a row along y, to its side
        const y0 = dy < 0 ? cy - tw : cy;
        silkText(bin, t, [cx + hgt / 2, y0], hgt, zt, 90);
        taken.push({ x0: cx - hgt / 2, y0, x1: cx + hgt / 2, y1: y0 + tw });
      } else {
        const o: [number, number] = [dx < 0 ? cx - tw : cx, cy - hgt / 2];
        silkText(bin, t, o, hgt, zt);
        taken.push({ x0: o[0], y0: o[1], x1: o[0] + tw, y1: o[1] + hgt });
      }
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
    taken.push({ x0: o[0], y0: o[1], x1: o[0] + tw, y1: o[1] + hgt });
    labels++;
  }
  // what each plug on an edge is, printed just inside it (on the plug the plug would hide it), along the edge
  const rects = list.filter((c) => c.side === 'top').map((c) => ({ c, r: bbox(compRect(c, 0.3)) }));
  for (const c of list) {
    if (c.side !== 'top' || c.conn?.entry !== 'edge') continue;
    const d = [Math.cos(rad(c.conn.angle)), Math.sin(rad(c.conn.angle))], t = [-d[1], d[0]];
    const back = extentAlong(c, c.conn.angle + 180), wide = Math.abs(t[0]) * c.w + Math.abs(t[1]) * c.l;
    const hgt = Math.max(0.9, Math.min(1.8, (wide * 0.85) / Math.max(3, c.ref.length) / 0.75)), tw = textWidth(c.ref, hgt);
    let deg = (Math.atan2(t[1], t[0]) * 180) / Math.PI;
    if (deg > 90.01) deg -= 180; else if (deg <= -90.01) deg += 180;
    const u = [Math.cos(rad(deg)), Math.sin(rad(deg))], v = [-u[1], u[0]];
    let at = [c.x - d[0] * (back + 1.8 + hgt / 2), c.y - d[1] * (back + 1.8 + hgt / 2)]; // (far enough in to be seen past a tall plug)
    const box = (q: number[]) => { const hx = Math.abs(u[0]) * tw / 2 + Math.abs(v[0]) * hgt / 2, hy = Math.abs(u[1]) * tw / 2 + Math.abs(v[1]) * hgt / 2; return { x0: q[0] - hx, x1: q[0] + hx, y0: q[1] - hy, y1: q[1] + hy }; };
    const clash = (r: ReturnType<typeof box>) => ![[r.x0, r.y0], [r.x1, r.y1], [r.x0, r.y1], [r.x1, r.y0]].every((q) => inside(q as [number, number], b.outline)) || taken.some((o) => o.x0 < r.x1 && r.x0 < o.x1 && o.y0 < r.y1 && r.y0 < o.y1) || rects.some((o) => o.c !== c && o.r.x0 < r.x1 && r.x0 < o.r.x1 && o.r.y0 < r.y1 && r.y0 < o.r.y1);
    let k = 0;
    for (; k < 4 && clash(box(at)); k++) at = [at[0] - d[0] * (hgt + 0.5), at[1] - d[1] * (hgt + 0.5)];
    if (k === 4 && clash(box(at))) continue;
    taken.push(box(at));
    silkText(bin, c.ref, [at[0] - u[0] * tw / 2 - v[0] * hgt / 2, at[1] - u[1] * tw / 2 - v[1] * hgt / 2], hgt, zt, deg);
  }
  const bbB = bbox(b.outline), nameH = Math.min(2.2, (bbB.y1 - bbB.y0) * 0.05);
  const nm = b.name.slice(0, 28), nw = textWidth(nm, nameH);
  const spot = findFree(b, list, nw, nameH, taken); // (clear of the part labels, pin names and plugs' labels too)
  if (spot) silkText(bin, nm, spot, nameH, zt);
  // (a bare box, or a board with a colour of its own: a J-Link, an adapter, drawn in its solder mask's colour)
  return bin.ghosts('board', tag, anim, b.color ? { mask: b.color } : {});
}

/**
 * What a picture of a board shows (a tile on Start, a part in the toolbox): the board's own 3D model, just as the 3D
 * view draws it, without its see-through bits.
 */
export function pictureOf(b: Board): Ghost[] {
  return boardDetail(b, 0, b.thickness, { kind: 'board' }, { seq: 0, dir: [0, 0, 1] }).filter((g) => g.opacity > 0.5);
}

/**
 * A fingerprint of a picture's meshes and colours (to 0.01 mm). The pictures shipped in public/tiles/ keep the one of
 * the model each was rendered from (src/ui/tiles.json), and tests/toolbox.test.ts fails once a model has moved on.
 */
export function pictureSig(parts: { mesh: MeshData; color: string; mat?: string; opacity?: number }[]): string {
  let h = 2166136261, k = 0x9e3779b9;
  const add = (v: number) => { h ^= v; h = Math.imul(h, 16777619); k = Math.imul(k ^ v, 2246822519) + 1 | 0; };
  const str = (s: string) => { for (let i = 0; i < s.length; i++) add(s.charCodeAt(i)); };
  for (const q of parts) {
    str(`${q.mat ?? ''}|${q.color}|${q.opacity ?? 1}|${q.mesh.pos.length}|${q.mesh.idx.length}`);
    for (let i = 0; i < q.mesh.pos.length; i++) add(Math.round(q.mesh.pos[i] * 100));
    for (let i = 0; i < q.mesh.idx.length; i++) add(q.mesh.idx[i]);
  }
  return (h >>> 0).toString(36) + (k >>> 0).toString(36);
}

type PlugSize = { w: number; h: number; len: number; cable: number };

/** A plug in a receptacle: its metal tip inside the mouth, the overmoulded body and the boot, shaped after its type. */
export function plugDetail(mouth: V2, d: V2, zAx: number, p: PlugSize, tag: PickTag, anim: Anim, type = '', roll = 0): Ghost[] {
  // x along the plug axis; `roll` turns it about that axis, clockwise looking at the socket (a plug on its side)
  return plugAt(rollT([d[0], d[1], 0, 0, -d[1], d[0], 0, 0, 0, 0, 1, 0, mouth[0], mouth[1], zAx, 1], roll), p, tag, anim, type);
}

/** A frame whose x runs out of a socket, turned `deg` clockwise about x as seen looking into the socket. */
function rollT(T: number[], deg: number) {
  if (!deg) return T;
  const a = rad(-deg), c = Math.cos(a), sn = Math.sin(a);
  return mulT(T, [1, 0, 0, 0, 0, c, sn, 0, 0, -sn, c, 0, 0, 0, 0, 1]);
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
    case 'dp':
      // DisplayPort: the metal shell, the moulded body, the latch button on top
      metal(rect(-8.5, x0 + 0.4, 16, 4.6, 0.5));
      body(overmold(W, H, Math.min(2.5, H / 3), x0, x1, p.cable, 0.3));
      push('black', loft(T, rect(x0 + 2, x0 + 9, 5, 1, 0.4, H / 2 + 0.1)));
      break;
    case 'rj11':
      push('white', loft(T, rect(-11, x0 + 1.5, 9.6, 6.6, 0.5)));
      body([{ x: x0, w: 10, h: 7.5, r: 1 }, { x: x0 + 3, w: W, h: H * 0.9, r: 2 }, pill(x0 + p.len * 0.8, p.cable + 2, p.cable + 2), pill(x1, p.cable + 0.6, p.cable + 0.6)]);
      break;
    case 'dsub': {
      // the D-shaped metal shell in the socket, its flange, the hood tapering onto the cable, a thumbscrew each side
      // into the socket's jackscrew posts
      const sw = Math.max(10, W - 14.5);
      metal(rect(-6, x0 + 0.5, sw, 7.2, 1));
      metal(rect(x0 + 0.5, x0 + 1.3, W, H * 0.8, 1));
      body([{ x: x0 + 1.3, w: W - 3, h: H * 0.62, r: 2 }, { x: x0 + p.len * 0.45, w: W - 4, h: H * 0.62, r: 2.5 }, { x: x0 + p.len * 0.85, w: Math.max(2 * p.cable + 4, W * 0.4), h: H * 0.55, r: 3 }, pill(x1, p.cable + 2, p.cable + 2), pill(x1 + 6, p.cable + 0.6, p.cable + 0.6)]);
      for (const y of [-(sw / 2 + 4.2), sw / 2 + 4.2]) {
        push('metal', loft(T, [pill(-4.5, 2.4, 2.4, { y }), pill(x0 + 3, 2.4, 2.4, { y })]));
        push('metal', loft(T, [pill(x0 + 3, 5.4, 5.4, { y }), pill(x0 + 9, 5.4, 5.4, { y })]));
      }
      break;
    }
    case 'xt60': case 'xt30': {
      // the yellow plug housing, a red and a black lead out of the back
      const s = type === 'xt60' ? 1 : 0.65;
      push('yellow', loft(T, rect(-10 * s, x0 + 9 * s, W, H, 1.2 * s)));
      for (const [y, m] of [[-3.6 * s, 'red'], [3.6 * s, 'cable']] as const) push(m, loft(T, [pill(x0 + 9 * s, Math.max(2, p.cable), Math.max(2, p.cable), { y }), pill(x1 + 10, Math.max(2, p.cable), Math.max(2, p.cable), { y })]));
      return bin.ghosts('plug', tag, anim, {}, true);
    }
    case 'rca':
      metal([pill(-9, 7.8, 7.8), pill(x0 + 1, 7.8, 7.8)]);
      body(overmold(W, H, W / 2, x0 + 1, x1, p.cable, 0.35));
      break;
    case 'bnc':
      // the bayonet sleeve, its grip, then the boot
      metal([pill(-10, 9.6, 9.6), pill(x0 + 9, 9.6, 9.6)]);
      metal([pill(x0 + 2, 11.4, 11.4), pill(x0 + 7, 11.4, 11.4)]);
      body([pill(x0 + 9, 8.4, 8.4), pill(x0 + 18, 7, 7), pill(x1, p.cable + 1.2, p.cable + 1.2)], 'black');
      return bin.ghosts('plug', tag, anim, {}, true);
    case 'sd':
      push('blue', loft(T, rect(-27, 2.5, 24, 2.1, 0.6)));
      return bin.ghosts('plug', tag, anim, {}, true);
    case 'fpc':
      // the flat cable: its stiffened end in the slot, then the cable itself
      push('blue', loft(T, rect(-3.5, x0 + 1, W, 0.35, 0.05)));
      push('white', loft(T, rect(x0 + 1, x1 + 25, W, 0.25, 0.05)));
      return bin.ghosts('plug', tag, anim, {}, true);
    case 'ufl':
      metal(rect(-1.1, x0 + 0.8, 2.2, 2.2, 1.05));
      push('cable', loft(T, [pill(x0 + 0.8, 1.6, 1.6), pill(x1, 1.2, 1.2)]));
      return bin.ghosts('plug', tag, anim, {}, true);
    case 'microfit': case 'minifit':
      // a Molex power plug: its housing (black Micro-Fit, natural Mini-Fit), then the bundle of wires
      push(type === 'microfit' ? 'black' : 'white', loft(T, rect(-1, x0 + Math.min(10, p.len), W, H, 0.6)));
      body([{ x: x0 + Math.min(10, p.len) - 0.5, w: Math.max(2, W - 2), h: Math.max(2, H * 0.5), r: 1 }, { x: x1 + 6, w: Math.max(2, W - 2), h: Math.max(2, H * 0.5), r: 1 }], 'cable');
      return bin.ghosts('plug', tag, anim, {}, true);
    case 'microsd': case 'sim':
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
    case 'qwiic': case 'jst_ph': case 'jst_xh': case 'jst_gh': case 'jst_zh': case 'picoblade': case 'kk254': case 'wtb_side': case 'header':
      push('white', loft(T, rect(-1, x0 + Math.min(6, p.len), W, H, 0.4)));
      if (type === 'header') push('black', loft(T, rect(-1, x0 + Math.min(12, p.len), W, H, 0.3)));
      body([{ x: x0 + Math.min(6, p.len) - 0.5, w: Math.max(2, W - 1.5), h: 1.2, r: 0.5 }, { x: x1 + 6, w: Math.max(2, W - 1.5), h: 1.2, r: 0.5 }], 'cable');
      return bin.ghosts('plug', tag, anim, {}, true);
    case 'swd10': case 'cortex20': case 'jtag20': case 'idc': case 'idc_ra':
      // an IDC socket pressed onto a ribbon: its body (the lower part goes into the header's shroud), the cable clamp
      // across its top, and the polarising key on one side
      push('black', loft(T, rect(-2.5, x1 - 1.8, W, H, 0.5)));
      push('black', loft(T, rect(x1 - 1.8, x1, W + 0.8, H - 1.4, 0.4)));
      push('black', loft(T, rect(0.5, x1 - 3, Math.min(4.5, W * 0.3), 1.4, 0.3, H / 2 + 0.6)));
      return bin.ghosts('plug', tag, anim, {}, true);
    case 'dupont': case 'dupont_m':
      // a single jumper housing pushed over one pin (its wire is drawn with the cable); the male one has its own pin
      // sticking out of the front, for a pin socket
      push('black', loft(T, rect(x0, x1 - 1.2, W, H, 0.25)));
      push('black', loft(T, [{ x: x1 - 1.2, w: W, h: H, r: 0.25 }, { x: x1, w: W * 0.72, h: H * 0.72, r: 0.6 }]));
      if (type === 'dupont_m') push('gold', loft(T, rect(-6, x0 + 0.2, 0.64, 0.64, 0.05)));
      return bin.ghosts('plug', tag, anim, {}, true);
    case 'tagconnect':
      // the spring-pin head held on the pads, then its ribbon
      push('plug', loft(T, rect(-0.2, x0 + 8, W, H, 1.6)));
      push('black', loft(T, [{ x: x0 + 8, w: W * 0.85, h: H * 0.8, r: 1.2 }, { x: x1, w: W * 0.7, h: 1.4, r: 0.5 }]));
      return bin.ghosts('plug', tag, anim, {}, true);
    case 'ac_au': case 'ac_uk': case 'ac_us': case 'ac_eu':
      // a mains plug in its outlet: the moulded body, its lead out of the top through a boot
      body(overmold(W, H, Math.min(W, H) * (type === 'ac_eu' ? 0.5 : 0.2), -0.6, x1, p.cable, 0.3));
      break;
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
 * A cable leaving a plug that nothing in the rack connects to (the mains, a supply): out of the boot, a bend down,
 * and along the table away from the rack. p, d: the boot's end and the plug's direction; floor: the table's height;
 * bounds: the rack's footprint [x0, y0, x1, y1], so the lead runs on along the table until it is well clear of it
 * (towards the wall socket or the supply) instead of stopping beside it.
 */
/**
 * A lead that leaves the rack (to a screen, a supply, the wall), drawn as a short stretch out of its plug that fades
 * away, then a dotted line on the way it goes and where to: nothing to route, so no cable hangs about in the air.
 * `clear`: how far out of the plug nothing is in the way.
 */
/** What runs along a lead that leaves the rack, for its pulses: into the plug (a supply, the mains, your computer), in this glow colour. */
export interface StubFlow { colour: string; on: boolean; slow: boolean }
export function leadStub(name: string, p: number[], d: number[], cable: number, label: string, tag: PickTag, anim: Anim, clear = Infinity, flow?: StubFlow): Ghost {
  // (no longer than the way out of the plug is clear, and never under 6 mm, so a plug always shows its lead)
  const r = Math.max(1.1, cable / 2), len = Math.max(6, Math.min(clear, Math.max(30, 10 + 10 * r)));
  return {
    name, mesh: tubeMesh([p, [p[0] + d[0] * len, p[1] + d[1] * len, p[2] + d[2] * len]], r, 16), color: '#2b2e33', opacity: 1, tag, anim, mat: 'cable', smooth: true,
    fx: { fade: { p, d, len, dash: 34, label, colour: '#8b95a3' }, ...(flow ? { flow: { pts: [[p[0] + d[0] * len, p[1] + d[1] * len, p[2] + d[2] * len], p], r: r * 1.4, ...flow } } : {}) },
  };
}

/**
 * Round every corner of a polyline with an arc of radius `r` (smaller where the segments are short), the way a
 * cable bends: no kinks, however the route was drawn. With `ok`, a corner whose arc `ok` rejects (it would cut through
 * something the corner itself clears) is bent tighter, down to a sixth of `r`.
 */
export function filletPath(pts: number[][], r0: number, ok?: (arc: number[][]) => boolean): number[][] {
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
    const radii = ok ? [r0, r0 * 0.6, r0 * 0.35, r0 / 6] : [r0];
    for (const [ri, r] of radii.entries()) {
      const arc: number[][] = [];
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
        arc.push([cen[0] + e0[0] * w0 + e1[0] * w1, cen[1] + e0[1] * w0 + e1[1] * w1, cen[2] + e0[2] * w0 + e1[2] * w1]);
      }
      if (ri < radii.length - 1 && !ok!(arc)) continue;
      out.push(...arc);
      break;
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
