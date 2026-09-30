// How a stopper, a catch or a rib is joined to the body it grows out of. A feature that only sits on the body by a
// sliver (a thin neck, a joint a layer or two tall, a leaf cut out of a wall) prints as a fringe and snaps, so every
// stopper has to grow out of solid material: its joint at least JOINT_MIN wide, and no neck thinner than that between the
// joint and its tip, apart from a tip that tapers away. Measured on the feature's outline (all the dock's stoppers are
// profiles extruded along a print layer's axis) and, layer by layer in the print pose, on the solid.
import type { CS, MF } from './kernel';

/** The narrowest joint or neck a stopper may have: three 0.4 mm lines. */
export const JOINT_MIN = 1.2;
/** How much of a stopper may be thinner than JOINT_MIN (the tapering tip of a nose or a ramp is; a sliver is all of it). */
export const THIN_SHARE = 0.15;

const perimeter = (c: CS) => (c.toPolygons() as [number, number][][]).reduce((s, l) => s + l.reduce((t, p, i) => { const q = l[(i + 1) % l.length]; return t + Math.hypot(q[0] - p[0], q[1] - p[1]); }, 0), 0);

/** How wide (mm) the feature's joint to its body is: the length of the boundary they share. */
export function contactLength(feature: CS, body: CS): number {
  const f = feature.subtract(body);
  return Math.max(0, (perimeter(f) + perimeter(body) - perimeter(f.add(body))) / 2);
}

/** The share of the feature's area that is thinner than `min` (an opening by half of it removes what is). */
export function thinShare(feature: CS, min = JOINT_MIN): number {
  const a = feature.area();
  if (a < 1e-9) return 1;
  return Math.max(0, 1 - feature.offset(-min / 2, 'Round').offset(min / 2, 'Round').area() / a);
}

/** What a stopper is: `stopper` (a rigid stop, a nose, a post: its joint and its whole body at least JOINT_MIN), `tooth` (a catch or a rib that is low by design: its joint at least JOINT_MIN wide, the rest may be a tooth's shape). */
export type JointKind = 'stopper' | 'tooth';

export interface JointReport { name: string; kind: JointKind; root: number; thin: number; issues: string[] }

/** Check one feature (its outline, what it adds to the body) against the body's outline. */
export function checkJoint(name: string, kind: JointKind, feature: CS, body: CS, min = JOINT_MIN): JointReport {
  const root = contactLength(feature, body), thin = thinShare(feature.subtract(body), min);
  const issues: string[] = [];
  if (root < min) issues.push(`${name}: its joint to the body is ${root.toFixed(2)} mm wide, under ${min} mm`);
  if (kind === 'stopper' && thin > THIN_SHARE) issues.push(`${name}: ${(thin * 100).toFixed(0)}% of it is thinner than ${min} mm (a neck or a sliver)`);
  return { name, kind, root, thin, issues };
}

export interface LayerJoint { layers: number; /** the narrowest a piece of the feature is joined to the body in a layer of its own (mm), and where */ worst: { z: number; contact: number; area: number } | null }

/**
 * The feature `f` (the solid it adds) against the body `b`, sliced in a print pose (`pose`, a 4x4 column-major matrix that
 * puts the print's up on z) every `step` mm: in every layer where a piece of the feature is at least `minArea` mm², how
 * long is the boundary it shares with the body's layer? A piece joined along under `min` (or not at all: it sits on the
 * layer below, joined only by the bond between layers) is a feature joined along a layer line.
 */
export function layerJoints(f: MF, b: MF, pose: number[], min = JOINT_MIN, step = 0.2, minArea = 0.3): LayerJoint {
  const F = f.subtract(b).transform(pose as any), B = b.transform(pose as any), bb = F.boundingBox();
  let worst: LayerJoint['worst'] = null, layers = 0;
  for (let z = bb.min[2] + step / 2; z < bb.max[2]; z += step) {
    const sf = F.slice(z) as CS, sb = B.slice(z) as CS;
    if (sf.area() < 1e-6) continue;
    layers++;
    for (const piece of sf.decompose() as CS[]) {
      const area = piece.area();
      if (area < minArea) continue;
      const d = 0.03, contact = piece.offset(d, 'Round').intersect(sb).area() / d;
      if (!worst || contact < worst.contact) worst = { z, contact, area };
    }
  }
  return { layers, worst };
}
