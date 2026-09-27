// Side worker: slices parts layer by layer (src/cad/printcheck.ts) and builds the meshes for the 3D pictures of
// boards and holder styles, away from the geometry worker, so neither holds up rebuilding the rack after an edit.
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { initKernel, freeAll } from '../cad/kernel';
import { layerCheck, type Expected } from '../cad/printcheck';
import { boardDetail } from '../cad/boardviz';
import { generate } from '../cad/assembly';
import { newProject } from '../model/library';
import type { Board, HolderSettings, MeshData } from '../model/types';

const ready = initKernel(wasmUrl);
type Pic = { mesh: MeshData; color: string; mat?: string; opacity: number };
const pics = (list: { mesh: MeshData; color: string; mat?: string; opacity?: number }[]): Pic[] =>
  list.map((g) => ({ mesh: { pos: g.mesh.pos.slice(), idx: g.mesh.idx.slice() }, color: g.color, mat: g.mat, opacity: g.opacity ?? 1, ...((g as { smooth?: boolean }).smooth ? { smooth: true } : {}) }));

self.onmessage = async (e: MessageEvent) => {
  const { id, type, payload } = e.data;
  try {
    await ready;
    let result: unknown;
    if (type === 'layers') {
      const { mesh, expect } = payload as { mesh: MeshData; expect: Expected[] };
      result = layerCheck(mesh, expect);
    } else if (type === 'board') {
      const b = payload as Board;
      result = pics(boardDetail(b, 0, b.thickness, { kind: 'board' }, { seq: 0, dir: [0, 0, 1] }).filter((g) => g.opacity > 0.5));
    } else if (type === 'holder') {
      const { board, holder } = payload as { board: Board; holder: HolderSettings };
      const p = newProject(board);
      p.layout = 'loose'; p.mount.kind = 'none'; p.stand.enabled = false;
      p.modules[0].holder = { ...holder };
      const r = generate(p);
      const keep = r.parts.filter((x) => x.tag?.kind === 'holder' || x.tag?.kind === 'cap');
      // the holder on its own (the board would hide the frame or tray), its caps beside it
      result = pics(keep.map((x) => ({ mesh: x.mesh, color: x.tag?.kind === 'holder' ? holder.color ?? '#e9e6df' : x.color, opacity: 1 }))).map((q, i) => ({ ...q, M: keep[i].toAssembly }));
    }
    freeAll();
    (self as any).postMessage({ id, ok: true, result });
  } catch (err: any) {
    freeAll();
    (self as any).postMessage({ id, ok: false, error: String(err?.message ?? err) });
  }
};
