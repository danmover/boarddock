// The socket latch's arm and nose while they move (after the first print): what the arm clears as it swings out, and that the
// nose gets out of the undercut groove along the beam's own arc. The strain at each end of the travel is in dockfea.test.ts
// and flexures.test.ts; this is the geometry of the motion, with the displacements the FEA gives.
import { beforeAll, describe, expect, it } from 'vitest';
import { csLoops, initKernel } from '../src/cad/kernel';
import { END_POSE, latchProfile, noseProfile, SHOE_LEVER, socket } from '../src/cad/dock';
import { layerCheck, verdict } from '../src/cad/printcheck';
import { freeAll, toMesh } from '../src/cad/kernel';
import { LATCH, latchGeom, SOCKET_Z } from '../src/cad/dockdims';
import { latchFea } from '../src/fea/dockfea';

let fea: ReturnType<typeof latchFea>;
beforeAll(async () => {
  await initKernel();
  fea = latchFea(csLoops(latchProfile().add(noseProfile())), 2100, 0.38, 0.1);
});

describe('the latch in motion', () => {
  it('the arm clears the lever\'s hub: 0.3 mm at the release, 0.15 mm with the button pressed right home', () => {
    // the hub is a ring of radius 3.55 about the lever's pin (13.4, 39.2 in the shoe's frame: z less the socket's height)
    const [py, pz] = SHOE_LEVER.pivot, cz = pz - SOCKET_Z, R = 3.55, d = fea.data;
    const outer = () => LATCH.yIn + LATCH.arm; // (the arm's tongue-away face over its thin part; the ramp's flare stays under z -2.4)
    const gap = (scale: number) => Math.min(...d.arm.filter((a) => a.z >= LATCH.zt && a.z <= -2.4).map((a) => Math.hypot(outer() + a.u * scale - py, a.z - cz) - R));
    const atRelease = gap(d.release.delta / d.stop.delta), full = gap(1);
    console.log('arm to hub: at the release', atRelease.toFixed(2), 'mm, button home', full.toFixed(2), 'mm; arm out at z -4:', d.arm.find((a) => a.z === -4)?.u.toFixed(2));
    expect(atRelease).toBeGreaterThan(0.3); expect(full).toBeGreaterThan(0.15);
  });

  it('the nose rises 0.6 mm going out (an eccentric nose rises as the beam tips), more than the undercut\'s 0.4 mm, so it leaves the face; with no rise at all the play covers the undercut with 0.2 mm to spare', () => {
    const g = latchGeom(), d = fea.data, need = (LATCH.engage + 0.15) * g.tanHook, rise = -d.release.drop;
    console.log('nose rise at the release', rise.toFixed(3), 'mm; undercut needs', need.toFixed(2), 'mm; play', LATCH.play);
    expect(rise).toBeGreaterThan(need); // (it separates from the groove floor as it goes)
    expect(LATCH.play - need).toBeGreaterThan(0.2); // (and if it rose by nothing, the holder seated)
  });

  it('is a light spring: 3.9 N to push the holder in (under 15 N with room for the ribs\' 20 N, once), 2.5 N on the button, 0.85% at the button\'s end', () => {
    const d = fea.data;
    expect(d.insertion.push).toBeLessThan(6); expect(d.release.button).toBeLessThan(4);
    expect(d.stop.peak).toBeLessThan(0.01);
    expect(d.release.rodTravel + 0.42).toBeLessThan(3.1); // (the button's stroke is enough)
    expect(d.pull.nose).toBeLessThan(0.6); expect(d.pull.popOut).toBeGreaterThan(40);
  });

  it('the socket prints standing on its -X end with no support, and no gap round the beam, arm or nose prints closed (the latch is printed in place)', () => {
    const q = layerCheck(toMesh(socket().transform(END_POSE.pose as any)))!, v = verdict(q, true);
    console.log('socket', v.brief);
    expect(q.islands).toEqual([]);
    expect(q.gaps, 'a slot that prints closed').toBeNull();
    expect(q.bridge?.span ?? 0).toBeLessThan(6);
    expect(q.cantilever?.reach ?? 0).toBeLessThan(2);
    expect(v.status).not.toBe('bad');
    freeAll();
  });
});
