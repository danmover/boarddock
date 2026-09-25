// Holder heights (kernel-free).
import type { Board, HolderSettings } from '../model/types';
import { round } from '../geom/poly';

/** Heights of a holder (no geometry kernel needed). */
export function computeLevels(b: Board, H: HolderSettings, minZb = 0) {
  let needMax = 0;
  for (const c of b.comps) {
    if (c.side === 'bottom' && c.h > 0) needMax = Math.max(needMax, c.h + 0.5);
    if (c.side === 'top' && c.tht) needMax = Math.max(needMax, H.leadLen + 0.4);
  }
  const base = H.base;
  const sAuto = Math.max(H.minStandoff, needMax - (base - 0.6));
  const s = Math.max(H.standoff ?? round(sAuto, 1), round(minZb - base, 2));
  const zb = base + s, zt = zb + b.thickness;
  const zw = Math.max(zb + 0.6, zt + H.wallAbove);
  // highest thing above the tray: parts, plugs from above
  let topMax = zw;
  for (const c of b.comps) if (!c.hidden && c.side === 'top') topMax = Math.max(topMax, zt + c.h + (c.conn?.entry === 'top' ? 0 : 0));
  return { needMax, base, s, zb, zt, zw, topMax };
}
