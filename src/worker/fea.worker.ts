// FEA worker: runs the (slow) solvers without freezing the UI.
import { clipFea } from '../fea/clipfea';
import { cantileverCheck } from '../fea/fea2d';
import { dockFea } from '../fea/dockfea';

self.onmessage = (e: MessageEvent) => {
  const { id, type, payload } = e.data;
  try {
    if (type === 'clip') {
      const { loops, dims, W, E, nu, h } = payload;
      const res = clipFea(loops, dims, W, E, nu, h, (s) => (self as any).postMessage({ id, progress: s }));
      (self as any).postMessage({ id, ok: true, result: res });
    } else if (type === 'dock') {
      const { latch, shoe, grip, hold, E, nu, h } = payload;
      const res = dockFea(latch, shoe, E, nu, h, (s) => (self as any).postMessage({ id, progress: s }), grip, undefined, hold);
      (self as any).postMessage({ id, ok: true, result: res });
    } else if (type === 'validate') {
      (self as any).postMessage({ id, ok: true, result: cantileverCheck(0.1) });
    }
  } catch (err: any) {
    (self as any).postMessage({ id, ok: false, error: String(err?.message ?? err) });
  }
};
