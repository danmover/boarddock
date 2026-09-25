// Geometry worker: builds all parts off the main thread.
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { initKernel, csLoops, freeAll } from '../cad/kernel';
import { generate } from '../cad/assembly';
import { clipProfile, clipDims } from '../cad/dinclip';
import { latchProfile, noseProfile, shoeProfile } from '../cad/dock';
import { testKit } from '../cad/testkit';
import type { Project } from '../model/types';

const ready = initKernel(wasmUrl);

self.onmessage = async (e: MessageEvent) => {
  const { id, type, payload } = e.data;
  try {
    await ready;
    if (type === 'generate') {
      const res = generate(payload as Project);
      const transfer: ArrayBuffer[] = [];
      for (const p of res.parts) transfer.push(p.mesh.pos.buffer as ArrayBuffer, p.mesh.idx.buffer as ArrayBuffer);
      for (const g of res.ghosts) transfer.push(g.mesh.pos.buffer as ArrayBuffer, g.mesh.idx.buffer as ArrayBuffer);
      (self as any).postMessage({ id, ok: true, result: res }, transfer);
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
      const shoe = csLoops(shoeProfile());
      freeAll();
      (self as any).postMessage({ id, ok: true, result: { latch, shoe } });
    }
  } catch (err: any) {
    freeAll();
    (self as any).postMessage({ id, ok: false, error: String(err?.message ?? err) });
  }
};
