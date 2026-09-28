// Promise wrappers around the workers. Generation is "latest wins": stale requests are dropped.
import type { Board, GenResult, HolderSettings, MeshData, PartOut, Project } from '../model/types';
import type { LayerReport } from '../cad/printcheck';
import type { ClipFeaResult } from '../fea/clipfea';
import type { DockFeaResult } from '../fea/dockfea';

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; onProgress?: (s: string) => void };

// Workers must be created with the literal `new Worker(new URL(...), ...)` pattern so the bundler emits them.
function makeWorker(w: Worker) {
  const pending = new Map<number, Pending>();
  let seq = 0;
  w.onmessage = (e) => {
    const { id, ok, result, error, progress } = e.data;
    const p = pending.get(id);
    if (!p) return;
    if (progress) { p.onProgress?.(progress); return; }
    pending.delete(id);
    ok ? p.resolve(result) : p.reject(new Error(error));
  };
  return {
    call<T>(type: string, payload: unknown, onProgress?: (s: string) => void): Promise<T> {
      const id = ++seq;
      return new Promise<T>((resolve, reject) => { pending.set(id, { resolve, reject, onProgress }); w.postMessage({ id, type, payload }); });
    },
  };
}

const cad = makeWorker(new Worker(new URL('./cad.worker.ts', import.meta.url), { type: 'module' }));
let fea: ReturnType<typeof makeWorker> | null = null;
let latest = 0;

export async function generateProject(p: Project): Promise<GenResult | null> {
  const ticket = ++latest;
  const res = await cad.call<GenResult>('generate', p);
  return ticket === latest ? res : null;
}

export async function runClipFea(W: number, tf: number, tabExt: number, HA: number | undefined, E: number, nu: number, h: number, onProgress?: (s: string) => void): Promise<ClipFeaResult & { loops: [number, number][][] }> {
  const { loops, dims } = await cad.call<any>('clipProfile', { W, tf, tabExt, HA });
  fea ??= makeWorker(new Worker(new URL('./fea.worker.ts', import.meta.url), { type: 'module' }));
  const res = await fea.call<ClipFeaResult>('clip', { loops, dims, W, E, nu, h }, onProgress);
  return { ...res, loops };
}

export async function runDockFea(E: number, nu: number, h: number, onProgress?: (s: string) => void): Promise<DockFeaResult & { latch: [number, number][][]; shoe: [number, number][][] }> {
  const { latch, shoe } = await cad.call<any>('dockProfiles', {});
  fea ??= makeWorker(new Worker(new URL('./fea.worker.ts', import.meta.url), { type: 'module' }));
  const res = await fea.call<DockFeaResult>('dock', { latch, shoe, E, nu, h }, onProgress);
  return { ...res, latch, shoe };
}

let printer: ReturnType<typeof makeWorker> | null = null;
const side = () => (printer ??= makeWorker(new Worker(new URL('./print.worker.ts', import.meta.url), { type: 'module' })));
export type PicPart = { mesh: MeshData; color: string; mat?: string; opacity: number; M?: number[]; smooth?: boolean };
/** Meshes for a picture of a board on its own. */
export const boardPicture = (b: Board) => side().call<PicPart[]>('board', b);
/** Meshes for a picture of a board in its holder with these settings (loose, no mount). */
export const holderPicture = (board: Board, holder: HolderSettings) => side().call<PicPart[]>('holder', { board, holder });
const layerCache = new Map<string, Promise<LayerReport | null>>();
/** Slice one part layer by layer (cached by its signature, so an unchanged part is checked once). */
export function checkLayers(key: string, mesh: MeshData): Promise<LayerReport | null> {
  const hit = layerCache.get(key);
  if (hit) return hit;
  const p = side().call<LayerReport | null>('layers', { mesh });
  layerCache.set(key, p);
  p.catch(() => layerCache.delete(key));
  if (layerCache.size > 200) layerCache.delete(layerCache.keys().next().value!);
  return p;
}

export function buildTestKit(fit: number): Promise<PartOut[]> {
  return cad.call<PartOut[]>('testKit', { fit });
}
