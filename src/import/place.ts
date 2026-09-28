// Shared steps for the neutral fabrication formats (IPC-2581, ODB++, GenCAD): turn a placed package into a
// BoardDock part, and sort drilled holes into mounting holes (which get holder pins) and part leads.
import type { Comp, Hole, Pin, Side, V2 } from '../model/types';
import { bbox, rad, uid } from '../geom/poly';
import { guessPackage } from '../model/library';

export interface Placed {
  ref: string;
  pkg: string;
  value?: string;
  side: Side;
  x: number; y: number; // where the package's origin is on the board
  rot: number; // degrees, counter-clockwise seen from the top
  mirror: boolean; // package drawn mirrored (bottom side): its local x is flipped before turning
  body: V2[]; // body outline points in the package's own frame (may be empty)
  pads: V2[]; // pad extents (corners) in the package's own frame, used when there is no body outline
  pins: { n: string; at: V2; net?: string }[]; // pin centres in the package's own frame
  pinsAt?: V2[]; // the same pins' places on the board, when the file gives them (ODB++): used as they are
  h?: number; // body height, when the file gives it
  tht?: boolean;
}

/** A package's own frame to the board: mirror (bottom side), turn, then move to its place. */
export function placer(p: Pick<Placed, 'x' | 'y' | 'rot' | 'mirror'>): (q: V2) => V2 {
  const a = rad(p.rot), c = Math.cos(a), s = Math.sin(a);
  return ([x0, y]) => { const x = p.mirror ? -x0 : x0; return [p.x + x * c - y * s, p.y + x * s + y * c]; };
}

const HEADERISH = /header|conn|socket|idc|jst|molex|uart|serial|ftdi|pin_?\d|^j\d/i;
export const isMountPkg = (pkg: string) => /mount(ing)?[\s_-]?hole|^mtg|[\s_-]mtg|^hole|standoff|fiducial/i.test(pkg);

/**
 * A placed package as a part: the body centre and size come from its outline, else from its pads, else from its
 * package name (then `sized` is false). A header's pins are kept, with their nets.
 */
export function toComp(p: Placed): { comp: Comp; sized: boolean; pinsOnBoard: V2[] } {
  const tf = placer(p);
  const src = p.body.length >= 2 ? p.body : p.pads.length >= 2 ? p.pads : p.pins.map((q) => q.at);
  let w = 0, l = 0, cl: V2 = [0, 0];
  if (src.length >= 2) {
    const bb = bbox(src);
    w = bb.x1 - bb.x0; l = bb.y1 - bb.y0; cl = [(bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2];
  }
  const sized = w > 0.2 && l > 0.2;
  if (!sized) { const g = guessPackage(p.pkg, p.ref, p.value); w = g.w || 1; l = g.l || 1; }
  const [x, y] = tf(cl);
  const pinsOnBoard = p.pins.map((q, i) => p.pinsAt?.[i] ?? tf(q.at));
  const pins: Pin[] = p.pins.map((q, i) => ({ n: q.n, x: pinsOnBoard[i][0], y: pinsOnBoard[i][1], ...(q.net && !/^\$?N\$?\d+$|^\d+$/.test(q.net) ? { net: q.net } : {}) }));
  const keepPins = HEADERISH.test(`${p.pkg} ${p.ref}`) && pins.length >= 2 && pins.length <= 40;
  const comp: Comp = {
    id: uid('c'), ref: p.ref || '?', pkg: p.pkg, value: p.value, side: p.side, x, y, rot: norm(p.rot),
    w: Math.max(0.3, w), l: Math.max(0.3, l), h: p.h && p.h > 0 ? p.h : 0, kind: 'generic', tht: !!p.tht,
    ...(keepPins ? { pins } : {}),
  };
  return { comp, sized, pinsOnBoard };
}

const norm = (d: number) => { let r = d % 360; if (r > 180) r -= 360; if (r <= -180) r += 360; return Math.round(r * 1000) / 1000; };

export interface RawHole { x: number; y: number; d: number; plated: boolean; via?: boolean; mount?: boolean }

/**
 * Sort drilled holes. A hole at a pin of a part with three or more pins is one of its leads (the part is marked
 * through-hole). Other holes of 1.9 mm and up (2.0 mm if plated), or ones the file calls mounting holes, are
 * mounting holes. Vias and small holes are left out. Parts are marked through-hole by the lead holes under them.
 */
export function sortHoles(raw: RawHole[], comps: { comp: Comp; pinsOnBoard: V2[] }[]): Hole[] {
  const holes: Hole[] = [];
  const near = (a: V2, h: RawHole) => Math.hypot(a[0] - h.x, a[1] - h.y) < Math.max(0.15, h.d / 2);
  for (const h of raw) {
    if (h.via && !h.mount) continue;
    const owner = comps.find((c) => c.pinsOnBoard.some((q) => near(q, h)));
    const part = owner && !isMountPkg(owner.comp.pkg) ? owner : undefined; // a real part, not a mounting-hole footprint
    if (part && h.plated) part.comp.tht = true;
    if (part && part.pinsOnBoard.length >= 3) continue;
    // a one- or two-pin part's hole is only a mounting hole when it is big (a power terminal's 1.3 mm leads are not)
    const big = part ? h.d >= 2.5 : h.d >= 2.0 || (!h.plated && h.d >= 1.9) || (!!owner && h.d >= 1.5);
    if (h.mount || big) {
      holes.push({ id: uid('h'), x: h.x, y: h.y, d: h.d, plated: h.plated, use: 'auto' });
      continue;
    }
    // a plated lead hole with no pin data under it: mark the part whose body covers it
    if (h.plated && !owner) {
      const c = comps.find(({ comp: k }) => Math.abs(h.x - k.x) < Math.max(k.w, k.l) / 2 && Math.abs(h.y - k.y) < Math.max(k.w, k.l) / 2);
      if (c) c.comp.tht = true;
    }
  }
  return holes;
}
