// Geometry worker: builds all parts off the main thread.
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { initKernel, csLoops, freeAll } from '../cad/kernel';
import { generate } from '../cad/assembly';
import { clipProfile, clipDims } from '../cad/dinclip';
import { latchProfile, noseProfile, shoeFeaProfiles } from '../cad/dock';
import { testKit } from '../cad/testkit';
import type { Project } from '../model/types';

const ready = initKernel(wasmUrl);

self.onmessage = async (e: MessageEvent) => {
  const { id, type, payload } = e.data;
  try {
    await ready;
    if (type === 'generate') {
      // meshes stay cached in this worker (unchanged holders are not rebuilt), so they are copied, not transferred
      const res = generate(payload as Project);
      (self as any).postMessage({ id, ok: true, result: res });
    } else if (type === 'clipProfile') {
      const p = payload as { W: number; tf: number; tabExt: number; HA?: number };
      const loops = csLoops(clipProfile(p).cs);
      freeAll();
      (self as any).postMessage({ id, ok: true, result: { loops, dims: clipDims(p) } });
    } else if (type === 'testKit') {
      const parts = testKit((payload as { fit: number }).fit);
      (self as any).postMessage({ id, ok: true, result: parts }, parts.flatMap((p) => [p.mesh.pos.buffer as ArrayBuffer, p.mesh.idx.buffer as ArrayBuffer]));
    } else if (type === 'dockProfiles') {
      const latch = csLoops(latchProfile().add(noseProfile()));
      const sp = shoeFeaProfiles(), shoe = csLoops(sp.jaw), grip = csLoops(sp.grip);
      freeAll();
      (self as any).postMessage({ id, ok: true, result: { latch, shoe, grip } });
    }
  } catch (err: any) {
    freeAll();
    (self as any).postMessage({ id, ok: false, error: String(err?.message ?? err) });
  }
};
