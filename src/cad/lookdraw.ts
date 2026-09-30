// Draws a contributed connector from its look (parts/type-*.json, see src/model/contributed.ts LookShape): boxes, round
// barrels, a mouth cut into what came before, rows of pins, every position a fraction of the part's body. boardviz.ts
// calls this for a type that has a look; everything else is drawn by its own code there.
import { box, cyl, type MF } from './kernel';
import type { Ghost } from '../model/types';
import type { LookShape } from '../model/contributed';

type Mat = NonNullable<Ghost['mat']>;
/** What is drawn into (boardviz.ts's Bin). */
interface Sink {
  add(mat: Mat, m: MF): void;
  box(mat: Mat, T: number[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void;
}

/** A cylinder along y at (x, z), from y0 to y1. */
const cylY = (x: number, z: number, r: number, y0: number, y1: number): MF => cyl(0, 0, 0, y1 - y0, r, r, 32).transform([-1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, x, y0, z, 1] as any);

/** In the part's frame T (body [-w/2, w/2] x [-l/2, l/2] x [0, h], the mouth on +y). */
export function drawLook(bin: Sink, T: number[], w: number, l: number, h: number, look: LookShape[]) {
  const hy = l / 2;
  const X = (f: number) => (f - 0.5) * w, Y = (f: number) => (f - 0.5) * l, Z = (f: number) => f * h;
  const solids: { mat: Mat; m: MF }[] = [];
  for (const s of look) {
    if ('box' in s) solids.push({ mat: s.box, m: box(X(s.from[0]), Y(s.from[1]), Z(s.from[2]), X(s.to[0]), Y(s.to[1]), Z(s.to[2])) });
    else if ('mouth' in s) {
      const cx = X(s.at[0]), cz = Z(s.at[1]), y0 = hy - s.depth * l;
      const cut = s.mouth === 'round'
        ? cylY(cx, cz, Math.min(s.size[0] * w, s.size[1] * h) / 2, y0, hy + 1)
        : box(cx - (s.size[0] * w) / 2, y0, cz - (s.size[1] * h) / 2, cx + (s.size[0] * w) / 2, hy + 1, cz + (s.size[1] * h) / 2);
      // (a cut that fails leaves the solid as it was)
      for (const q of solids) { const r = q.m.subtract(cut); if (r.status() === 'NoError') q.m = r; }
    } else if ('barrel' in s) {
      const r = (s.d * Math.min(w, h)) / 2, y0 = Y(s.y[0]), y1 = Y(s.y[1]), cx = X(s.at[0]), cz = Z(s.at[1]);
      if (!(y1 > y0)) continue;
      let m = cylY(cx, cz, r, y0, y1);
      if (s.bore) m = m.subtract(cylY(cx, cz, r * s.bore, y0 + (y1 - y0) * 0.2, y1 + 1));
      solids.push({ mat: s.barrel, m });
    } else {
      const hd = s.d / 2, up = (s.axis ?? 'z') === 'z';
      for (let i = 0; i < s.n; i++) {
        const cx = X(s.at[0]) + (i - (s.n - 1) / 2) * s.pitch;
        if (up) bin.box(s.pins, T, cx - hd, Y(s.at[1]) - hd, Z(s.at[2]), cx + hd, Y(s.at[1]) + hd, Z(s.at[2] + s.len));
        else bin.box(s.pins, T, cx - hd, Y(s.at[1]), Z(s.at[2]) - hd, cx + hd, Y(s.at[1] + s.len), Z(s.at[2]) + hd);
      }
    }
  }
  for (const q of solids) bin.add(q.mat, q.m.transform(T as any));
}
