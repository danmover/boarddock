// Cable tags: a half-ring saddle that sits on the cable and a flag with the cable's number raised on it, so the numbers in
// the app (3D, Wiring, the shopping list, the assembly steps) are on the real cables too. Printed flat, ring axis up.
//
// It is held on by a zip tie, not by the print: a ring that snaps round a cable has to open by the cable's whole
// diameter less its mouth, and a 1.3 mm ring 3 to 8 mm across cannot do that without going to 10% strain or more
// (FEA, tests/cabletag.test.ts) unless the cable gives, which a stiff one does not. So the saddle is open (its mouth is
// wider than the cable: it just drops on), and a groove round its outside takes a 2.5 mm zip tie that goes round the
// cable and the saddle: nothing on the tag flexes.
import { circle2, ext, poly, rect2, roundCS, unionMF, type MF } from './kernel';
import { textCS, textWidth } from './font';

export const TAG = {
  wall: 1.8, // saddle wall, at the collar and the flange
  clear: 0.5, // between the cable and the saddle
  plate: 1.2, // flag
  relief: 0.8, // raised digits
  flagL: 12,
  flagW: 9,
  groove: 1.0, // how deep the zip tie's groove is cut (the tie is 1.2 thick)
  grooveW: 2.8, // and how wide (a 2.5 mm tie)
  collar: 1.4, // the bottom collar, over the flag's plate
  flange: 0.6, // the top flange
  height: 1.4 + 2.8 + 0.6,
  reach: 100, // half the saddle's arc, degrees from the flag's side round to each tip
};

/** The saddle's profile for a cable of diameter d: the half ring (round the axis, open towards -x), at radius `grow` less than full. */
export function tagRing(d: number, grow = 0) {
  const r = d / 2 + TAG.clear, R = r + TAG.wall - grow;
  const a = (TAG.reach * Math.PI) / 180, big = R + 2;
  // (a wedge from the axis out to both tips, and round the back)
  const back = poly([[0, 0], [big * Math.cos(a), -big * Math.sin(a)], [big, -big], [big, big], [big * Math.cos(a), big * Math.sin(a)]], 'NonZero');
  return circle2(0, 0, R, 64).subtract(circle2(0, 0, r, 64)).intersect(back);
}

/** Tag for cable `no` of diameter `d`, in its print pose: saddle round the z axis at the origin, flag along +x. */
export function cableTag(no: number, d: number): MF {
  const { wall, plate, relief, flagL, flagW, groove, grooveW, collar, height, clear } = TAG;
  const r = d / 2 + clear;
  const full = tagRing(d), cut = tagRing(d, groove);
  const x0 = r + wall - 0.6, flag = roundCS(rect2(x0, -flagW / 2, x0 + flagL, flagW / 2), 1.6);
  const txt = String(no), h = Math.min(6, (flagL - 2.5) / Math.max(1, textWidth(txt, 1)));
  const digits = textCS(txt, h).translate([x0 + flagL / 2 + 0.4 - textWidth(txt, h) / 2, -h / 2]);
  return unionMF([ext(full, 0, collar), ext(cut, collar - 0.01, collar + grooveW + 0.01), ext(full, collar + grooveW, height), ext(flag, 0, plate), ext(digits, plate - 0.01, plate + relief)]);
}
