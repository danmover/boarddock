// Test-fit kit: one rail shoe, one socket and a small "tongue key" (tongue, spine, grip bar and its release rod).
// About 30-40 minutes of printing that proves the rail clip, the latch click and the button release on your
// printer before any full holder is printed.
import type { PartOut } from '../model/types';
import { inv, mul, tr, type M4 } from '../geom/mat';
import { END_POSE, holderDock, rod, shoe, socket } from './dock';
import { dockFrame } from './dockplan';
import { freeAll, toMesh, type MF } from './kernel';

function part(id: string, name: string, m: MF, pose: M4, color: string): PartOut {
  const pm = m.transform(pose as any);
  const bb = pm.boundingBox();
  const moved = pm.translate([0, 0, -bb.min[2]]);
  return { id, name, qty: 1, mesh: toMesh(moved), toAssembly: mul(inv(pose), tr(0, 0, bb.min[2])), volume: m.volume(), size: [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]], color };
}

export function testKit(fit = 0): PartOut[] {
  try {
    const D = inv(dockFrame('bottom', 0, 0)); // socket-local -> flat on its back
    const f = holderDock(6, 3, 0, fit);
    const key = f.add.subtract(f.cut);
    return [
      part('kit_shoe', 'Rail shoe', shoe(), END_POSE.pose, '#f59e42'),
      part('kit_socket', 'Dock socket', socket(), END_POSE.pose, '#5b8def'),
      part('kit_key', 'Tongue key', key, D, '#e4ebe6'),
      part('kit_rod', 'Release rod (key)', rod(f.zg1).m, D, '#ff5d6c'),
    ];
  } finally {
    freeAll();
  }
}
