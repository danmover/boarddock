// Clip-on cable tags: a C-ring that snaps round the cable and a flag with the cable's number raised on it, so the
// numbers in the app (3D, Wiring, the shopping list, the assembly steps) are on the real cables too. Printed flat,
// ring axis up; the opening is 0.72 of the cable's diameter, so it snaps on and stays.
import { circle2, ext, rect2, roundCS, unionMF, type MF } from './kernel';
import { textCS, textWidth } from './font';

export const TAG = { wall: 1.3, height: 3.0, plate: 1.6, relief: 0.8, flagL: 12, flagW: 9 };

/** Tag for cable `no` of diameter `d`, in its print pose: ring round the z axis at the origin, flag along +x. */
export function cableTag(no: number, d: number): MF {
  const r = d / 2 + 0.2, { wall, height, plate, relief, flagL, flagW } = TAG;
  const ring = circle2(0, 0, r + wall, 48).subtract(circle2(0, 0, r, 48)).subtract(rect2(-(r + wall + 1), -0.36 * d, -r * 0.3, 0.36 * d));
  const x0 = r + wall - 0.6, flag = roundCS(rect2(x0, -flagW / 2, x0 + flagL, flagW / 2), 1.6);
  const txt = String(no), h = Math.min(6, (flagL - 2.5) / Math.max(1, textWidth(txt, 1)));
  const digits = textCS(txt, h).translate([x0 + flagL / 2 + 0.4 - textWidth(txt, h) / 2, -h / 2]);
  return unionMF([ext(ring, 0, height), ext(flag, 0, plate), ext(digits, plate - 0.01, plate + relief)]);
}
