// Angles typed and snapped: the rotation box (15°, 45° and 90° steps, or free), for parts, ports and docks.

/** The snaps the rotation box offers, degrees (0 in a box's own list means free). */
export const SNAPS = [15, 45, 90] as const;

/** An angle in [0, 360). */
export const normDeg = (d: number) => { const r = ((d % 360) + 360) % 360; return r === 0 ? 0 : r; };

/** The nearest multiple of `step` (0: free, only tidied to 0.01°). */
export const snapDeg = (d: number, step: number) => (step > 0 ? Math.round(d / step) * step + 0 : Math.round(d * 100) / 100);

/** The turn from one angle to another, the short way round: -180 < turn <= 180. */
export function shortTurn(from: number, to: number) {
  const d = normDeg(to - from);
  return d > 180 ? d - 360 : d;
}

/** The next multiple of `step` from an angle, going up (dir 1) or down (dir -1): a press of the turn button. */
export function stepTo(value: number, dir: 1 | -1, step: number) {
  const k = value / step;
  return (dir > 0 ? Math.floor(k + 1e-9) + 1 : Math.ceil(k - 1e-9) - 1) * step;
}

/** What was typed as an angle: "45", "-30", "12.5°", "90 deg", with a comma for the point; null when it is not a number. */
export function parseDeg(s: string): number | null {
  const m = /^\s*([+-]?\d*[.,]?\d+)\s*(?:°|deg(?:rees?)?)?\s*$/i.exec(s);
  if (!m) return null;
  const v = parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}
