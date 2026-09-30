// Cards in card sockets (M.2, mini PCIe, PCIe, DIMM): they are not drawn, but holders and stacks keep clear of them.
import type { Board, Comp, V2 } from './types';
import { centroid, inside, rad } from '../geom/poly';

/**
 * The card in an M.2, mini PCIe, PCIe or DIMM socket, as a part for holders and stacks to keep clear of (the card is
 * not drawn). M.2, mini PCIe and SO-DIMM cards lie over the board, away from the socket towards the middle of it (the
 * length from a size code in the name, else a 2280 stick); PCIe and full DIMM cards stand up from the socket (a
 * full-height card is 107 mm, a DIMM 31 mm plus its socket).
 */
export function cardOf(c: Comp, b: Board): Comp | null {
  const t = c.conn?.type;
  if (c.hidden || (t !== 'm2' && t !== 'pcie' && t !== 'dimm')) return null;
  const wide = c.w >= c.l, across = wide ? c.w : c.l, depth = wide ? c.l : c.w;
  const card = { id: `${c.id}:card`, ref: `${c.ref} card`, pkg: 'card keep-out', side: c.side, rot: c.rot, kind: 'generic' as const, tht: false };
  if (t === 'pcie' || (t === 'dimm' && across > 100)) return { ...card, x: c.x, y: c.y, w: c.w, l: c.l, h: t === 'pcie' ? 107 : 33 };
  const name = `${c.pkg} ${c.value ?? ''}`;
  const len = t === 'dimm' ? 30 : /mini[\s_-]?pci|mpcie/i.test(name) ? 51 : +(/(?<!\d)22(30|42|60|80|110)(?!\d)/.exec(name)?.[1] ?? 80);
  // the card runs along the socket's short axis, to whichever side has the board under its far end (else the middle)
  const a = rad(c.rot + (wide ? 90 : 0)), u: V2 = [Math.cos(a), Math.sin(a)], mid = centroid(b.outline);
  const far = (s: number): V2 => [c.x + s * u[0] * (len - depth / 2), c.y + s * u[1] * (len - depth / 2)];
  const on = (s: number) => inside(far(s), b.outline);
  const s = on(1) !== on(-1) ? (on(1) ? 1 : -1) : (mid[0] - c.x) * u[0] + (mid[1] - c.y) * u[1] >= 0 ? 1 : -1;
  const k = s * (len / 2 - depth / 2);
  return { ...card, x: c.x + k * u[0], y: c.y + k * u[1], w: wide ? across : len, l: wide ? len : across, h: c.h + 2 };
}

/** A board's parts and the cards in its card sockets: what holders and stacks have to keep clear of. */
export function holderParts(b: Board): Comp[] {
  if (!b.comps.some((c) => c.conn?.type === 'm2' || c.conn?.type === 'pcie' || c.conn?.type === 'dimm')) return b.comps;
  return b.comps.flatMap((c) => { const k = cardOf(c, b); return k ? [c, k] : [c]; });
}
