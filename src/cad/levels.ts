// Holder heights (kernel-free).
import type { Board, HolderSettings } from '../model/types';
import { round } from '../geom/poly';
import { isBox, isDebugPort, isUartPort } from '../model/links';
import { CLIP_ABOVE, holdOf } from './grip';

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
  // highest thing above the tray: parts, and what stays plugged in from above (a debug ribbon lying over its socket,
  // a serial cable's jumper ends and the bend of their wires)
  let topMax = zw;
  for (const c of b.comps) {
    if (c.hidden || c.side !== 'top') continue;
    const above = c.conn?.entry !== 'top' ? 0 : isDebugPort(c) ? c.conn.plug.len + 0.6 + 1.2 : isUartPort(c) ? 14 + 8 - Math.max(0, c.h - 2.5) : 0;
    topMax = Math.max(topMax, zt + c.h + above);
  }
  // spring clips stand up past the wall: their lip, entry ramp and pull ear
  if (holdOf(H) !== 'pins' && !isBox(b)) topMax = Math.max(topMax, zt + CLIP_ABOVE);
  return { needMax, base, s, zb, zt, zw, topMax };
}
