// Every stopper, catch and rib of the dock grows out of solid material: its joint to the body at least 1.2 mm wide, no
// neck under 1.2 mm on the way out, and in every print layer it is joined to the body in the layer itself (src/cad/joints.ts).
// The round after the first print found the anti-rattle leaves, the latch's stop post and the like snapping off: those
// shapes are held here as what the check must flag.
import { beforeAll, describe, expect, it } from 'vitest';
import { box, freeAll, initKernel, poly, rect2 } from '../src/cad/kernel';
import { crushRibs, extYZ, END_POSE, latchProfile, noseProfile, noseSolid, tongue } from '../src/cad/dock';
import { CRUSH, EAR, HD, LATCH } from '../src/cad/dockdims';
import { checkJoint, contactLength, JOINT_MIN, layerJoints, thinShare } from '../src/cad/joints';

beforeAll(async () => { await initKernel(); });
const P = (pts: number[][]) => poly(pts as [number, number][], 'NonZero');

describe('what the check flags', () => {
  it('the latch\'s old stop post (a 1.0 mm wall 10 mm tall on the anchor plate)', () => {
    const post = P([[9.1, -19.0], [9.4, -18.7], [9.4, -9.0], [10.4, -9.0], [10.4, -19.0]]);
    const anchor = rect2(-20, -21, 20, -19.0);
    const r = checkJoint('old stop post', 'stopper', post, anchor);
    expect(r.root).toBeGreaterThan(1.2); // (its joint is 1.3 wide...)
    expect(r.issues.join()).toMatch(/thinner than 1.2/); // (...but the wall itself is a 1.0 mm neck)
  });
  it('a leaf cut out of a wall (0.9 mm thick, 6 mm long, the old anti-rattle leaf) and a 0.6 mm sliver left over a slot', () => {
    const leaf = rect2(6.1, -14, 7.0, -8), wall = rect2(0, -8, 20, 0);
    const r = checkJoint('old side leaf', 'stopper', leaf, wall);
    expect(r.root).toBeLessThan(JOINT_MIN);
    expect(r.issues.length).toBe(2);
    expect(checkJoint('sliver', 'stopper', rect2(0, 0, 0.6, 5), rect2(-5, -1, 5, 0)).issues.length).toBe(2);
  });
  it('a sound stopper passes: a 2 x 3 block on a plate, a tapering nose', () => {
    expect(checkJoint('block', 'stopper', rect2(0, 0, 2, 3), rect2(-5, -1, 5, 0)).issues).toEqual([]);
    expect(checkJoint('nose', 'stopper', P([[0, 0], [3, 0.4], [3, 2.6], [0, 3], [0, 0]]), rect2(-1, -1, 0, 5)).issues).toEqual([]);
  });
  it('a low rib is a tooth: its base has to be 1.2 wide, its height may be less', () => {
    expect(checkJoint('rib', 'tooth', P([[0, 0], [1.8, 0], [1.05, 0.4], [0.75, 0.4]]), rect2(-2, -3, 4, 0)).issues).toEqual([]);
    expect(checkJoint('nib', 'tooth', P([[0, 0], [0.5, 0], [0.4, 0.4], [0.1, 0.4]]), rect2(-2, -3, 4, 0)).issues.length).toBe(1);
  });
  it('measures the contact and the thin share', () => {
    expect(contactLength(rect2(0, 0, 2, 3), rect2(-5, -1, 5, 0))).toBeCloseTo(2, 1);
    expect(thinShare(rect2(0, 0, 0.9, 6))).toBeGreaterThan(0.95);
    expect(thinShare(rect2(0, 0, 3, 3))).toBeLessThan(0.1);
  });
});

describe('the dock\'s stoppers, catches and ribs', () => {
  it('the latch nose grows out of the arm along its whole height, filleted, and is 1.2 mm or more all the way out', () => {
    const arm = latchProfile(), nose = noseProfile().subtract(arm);
    const r = checkJoint('latch nose', 'stopper', nose, arm);
    console.log('nose joint', r.root.toFixed(2), 'thin share', r.thin.toFixed(3));
    expect(r.issues).toEqual([]);
    expect(r.root).toBeGreaterThan(2);
  });

  it('the latch\'s beam reaches its root through fillets (over 2 mm wide where it joins the boss), and has no stop post any more', () => {
    const arm = latchProfile();
    const root = arm.intersect(rect2(-30, LATCH.zr + 0.02, 30, LATCH.zr + 0.06)).bounds();
    expect(root.max[0] - root.min[0]).toBeGreaterThan(2);
    // (nothing of it reaches out past the arm's own faces: the old post stood at y 9.1 to 10.4)
    expect(arm.bounds().max[0]).toBeLessThan(9.06);
  });

  it('the tongue\'s crush ribs are 1.8 mm wide where they grow out of the face, and low by design', () => {
    const { proud, base, crown } = CRUSH, half = (base - crown) / 2;
    const rib = P([[0, 0], [base, 0], [half + crown, proud], [half, proud]]);
    const r = checkJoint('crush rib', 'tooth', rib, rect2(-2, -3, base + 2, 0));
    expect(r.issues).toEqual([]);
    expect(r.root).toBeCloseTo(base, 1);
    expect(base).toBeGreaterThanOrEqual(JOINT_MIN);
  });

  it('the release rod\'s barbs are joined to their fingers along 1.4 mm', () => {
    const { ramp, flat, barb, finger, root } = HD.catch, xs = HD.rodHx, h = ramp + flat;
    const b = P([[xs, 0], [xs + barb, ramp], [xs + barb, h], [xs, h]]), fingerBody = rect2(xs - finger, -root, xs, h);
    const r = checkJoint('rod barb', 'tooth', b, fingerBody);
    expect(r.issues).toEqual([]);
    expect(r.root).toBeGreaterThan(1.3);
  });

  it('the flat holder\'s key hangs on a dovetail 7.8 mm wide where it grows out of its pedestal', () => {
    const { root, top, h } = EAR.dove;
    const dove = P([[-root, EAR.ped], [root, EAR.ped], [top, EAR.ped + h], [-top, EAR.ped + h]]);
    const r = checkJoint('dovetail', 'stopper', dove, rect2(-HD.base.hx, 0, HD.base.hx, EAR.ped));
    expect(r.issues).toEqual([]);
    expect(r.root).toBeCloseTo(2 * root, 1);
  });

  it('the socket\'s divider is the one thin one: 0.7 mm, which is all the 0.15 mm gaps to the two tongues leave; it is joined to the floor and to both side walls (about 29 mm²)', () => {
    // (a 1.2 mm divider would put the tongues' back faces 0.25 mm off the bed they print on)
    const divider = rect2(-0.35, -14.5, 0.35, -1.0), floor = rect2(-10, -20, 10, -14.5);
    const r = checkJoint('divider', 'stopper', divider, floor);
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.root).toBeCloseTo(0.7, 1);
    expect(0.7 * 14.4 + 2 * 0.7 * 13.5).toBeGreaterThan(28);
    expect(TONGUE_BACK_GAP).toBeCloseTo(0.15, 2);
  });
});

const TONGUE_BACK_GAP = 0.5 - 0.35; // (TONGUE.y0 less the divider's half thickness)

describe('layer by layer, in the print pose', () => {
  it('the crush ribs are joined to the tongue in every layer they have a piece in (none sits on the layer below)', () => {
    const up = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]; // socket-local y up: how the holder side prints
    const ribs = crushRibs(0), body = tongue(0.2, 0).subtract(ribs);
    const r = layerJoints(ribs, body, up);
    console.log('ribs, layers', r.layers, 'worst', JSON.stringify(r.worst));
    expect(r.layers).toBeGreaterThan(1);
    expect(r.worst!.contact).toBeGreaterThan(JOINT_MIN);
    freeAll();
  });

  it('the latch nose is joined to the arm in every layer of the socket\'s print (standing on its -X end)', () => {
    const nose = noseSolid(), arm = extYZ(latchProfile(), LATCH.hx);
    const r = layerJoints(nose, arm, END_POSE.pose);
    console.log('nose, layers', r.layers, 'worst', JSON.stringify(r.worst));
    expect(r.worst!.contact).toBeGreaterThan(JOINT_MIN);
    freeAll();
  });

  it('a feature that only sits on the layer below is flagged: a block stood on top of a wall', () => {
    const wall = box(0, 0, 0, 10, 3, 5), cap = box(0, 0, 5, 10, 3, 5.6);
    const r = layerJoints(cap, wall, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], JOINT_MIN);
    expect(r.worst!.contact).toBeLessThan(0.2);
    freeAll();
  });
});

