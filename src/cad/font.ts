// Tiny single-stroke font (4 x 6 grid) for engraved labels. No font files, prints cleanly at 3 to 6 mm.
import type { V2 } from '../model/types';
import type { CS } from './kernel';
import { K, poly, unionCS } from './kernel';

type G = number[][];
const O: G = [[1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5, 4, 1, 3, 0, 1, 0]];
const P: G = [[0, 0, 0, 6, 3, 6, 4, 5, 4, 4, 3, 3, 0, 3]];
const GLYPHS: Record<string, G> = {
  A: [[0, 0, 0, 4, 2, 6, 4, 4, 4, 0], [0, 3, 4, 3]],
  B: [[0, 0, 0, 6, 3, 6, 4, 5, 4, 4, 3, 3, 0, 3], [3, 3, 4, 2, 4, 1, 3, 0, 0, 0]],
  C: [[4, 1, 3, 0, 1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5]],
  D: [[0, 0, 0, 6, 3, 6, 4, 5, 4, 1, 3, 0, 0, 0]],
  E: [[4, 0, 0, 0, 0, 6, 4, 6], [0, 3, 3, 3]],
  F: [[0, 0, 0, 6, 4, 6], [0, 3, 3, 3]],
  G: [[4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0, 3, 0, 4, 1, 4, 3, 2, 3]],
  H: [[0, 0, 0, 6], [4, 0, 4, 6], [0, 3, 4, 3]],
  I: [[1, 0, 3, 0], [2, 0, 2, 6], [1, 6, 3, 6]],
  J: [[0, 1, 1, 0, 3, 0, 4, 1, 4, 6]],
  K: [[0, 0, 0, 6], [4, 6, 0, 2], [1, 3, 4, 0]],
  L: [[0, 6, 0, 0, 4, 0]],
  M: [[0, 0, 0, 6, 2, 3, 4, 6, 4, 0]],
  N: [[0, 0, 0, 6, 4, 0, 4, 6]],
  O,
  P,
  Q: [...O, [2, 2, 4, 0]],
  R: [...P, [2, 3, 4, 0]],
  S: [[4, 5, 3, 6, 1, 6, 0, 5, 0, 4, 1, 3, 3, 3, 4, 2, 4, 1, 3, 0, 1, 0, 0, 1]],
  T: [[0, 6, 4, 6], [2, 6, 2, 0]],
  U: [[0, 6, 0, 1, 1, 0, 3, 0, 4, 1, 4, 6]],
  V: [[0, 6, 2, 0, 4, 6]],
  W: [[0, 6, 1, 0, 2, 3, 3, 0, 4, 6]],
  X: [[0, 0, 4, 6], [0, 6, 4, 0]],
  Y: [[0, 6, 2, 3, 4, 6], [2, 3, 2, 0]],
  Z: [[0, 6, 4, 6, 0, 0, 4, 0]],
  '0': [...O, [1, 1, 3, 5]],
  '1': [[1, 5, 2, 6, 2, 0], [1, 0, 3, 0]],
  '2': [[0, 5, 1, 6, 3, 6, 4, 5, 4, 4, 0, 0, 4, 0]],
  '3': [[0, 5, 1, 6, 3, 6, 4, 5, 4, 4, 3, 3, 4, 2, 4, 1, 3, 0, 1, 0, 0, 1], [1, 3, 3, 3]],
  '4': [[3, 0, 3, 6, 0, 2, 4, 2]],
  '5': [[4, 6, 0, 6, 0, 3, 3, 3, 4, 2, 4, 1, 3, 0, 1, 0, 0, 1]],
  '6': [[4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 3, 3, 0, 3]],
  '7': [[0, 6, 4, 6, 1, 0]],
  '8': [[1, 3, 0, 4, 0, 5, 1, 6, 3, 6, 4, 5, 4, 4, 3, 3, 1, 3, 0, 2, 0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 3, 3]],
  '9': [[0, 1, 1, 0, 3, 0, 4, 1, 4, 5, 3, 6, 1, 6, 0, 5, 0, 4, 1, 3, 4, 3]],
  '-': [[1, 3, 3, 3]],
  '.': [[2, 0, 2, 0.01]],
  _: [[0, 0, 4, 0]],
  '/': [[0, 0, 4, 6]],
  '+': [[2, 1, 2, 5], [0, 3, 4, 3]],
  '(': [[3, 6, 2, 5, 2, 1, 3, 0]],
  ')': [[1, 6, 2, 5, 2, 1, 1, 0]],
  ':': [[2, 1, 2, 1.01], [2, 4, 2, 4.01]],
  '#': [[1, 0, 1, 6], [3, 0, 3, 6], [0, 2, 4, 2], [0, 4, 4, 4]],
};

export const ADVANCE = 6; // grid units per character

export function textWidth(text: string, height: number) {
  const u = height / 6;
  return Math.max(0, text.length * ADVANCE - 2) * u;
}

/** Text as a filled 2D region, baseline at y = 0, starting at x = 0. */
export function textCS(text: string, height: number): CS {
  const u = height / 6;
  const sw = Math.max(0.45, height * 0.15);
  const parts: CS[] = [];
  const up = text.toUpperCase();
  for (let i = 0; i < up.length; i++) {
    const g = GLYPHS[up[i]];
    if (!g) continue;
    const ox = i * ADVANCE * u;
    for (const stroke of g) {
      const pts: V2[] = [];
      for (let k = 0; k < stroke.length; k += 2) pts.push([ox + stroke[k] * u, stroke[k + 1] * u]);
      for (let k = 0; k < pts.length; k++) {
        parts.push(K().CrossSection.circle(sw / 2, 12).translate(pts[k]));
        if (k + 1 < pts.length) {
          const [a, b] = [pts[k], pts[k + 1]];
          const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1e-6;
          const nx = (-dy / L) * sw / 2, ny = (dx / L) * sw / 2;
          parts.push(poly([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]], 'NonZero'));
        }
      }
    }
  }
  return unionCS(parts);
}
