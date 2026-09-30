// One length for every RJ45 lead: buy all the Ethernet cables at the longest route on the rack, rounded up to a stock
// length, so one box of patch leads does (Plugs › Cables). Off by default: each lead is bought at its own length.
import type { GenReport, Project } from './types';
import { cableToBuy } from './links';

type Routed = Pick<NonNullable<GenReport['cables']>[number], 'kind' | 'length' | 'buy' | 'ribbon'>;
const nets = (cables: Routed[]) => cables.filter((c) => c.kind === 'net' && c.ribbon == null);

/** The one length (m) to buy every routed Ethernet lead at, or null when the option is off or there are none. */
export function oneNetBuy(p: Pick<Project, 'oneNetLength'>, cables: Routed[]): number | null {
  const n = nets(cables);
  if (!p.oneNetLength || !n.length) return null;
  return Math.max(cableToBuy(Math.max(...n.map((c) => c.length))), ...n.map((c) => c.buy));
}

/** How many routed Ethernet leads there are and the shortest and longest length each would be bought at on its own. */
export function netSpread(cables: Routed[]): { n: number; short: number; long: number } | null {
  const n = nets(cables);
  return n.length ? { n: n.length, short: Math.min(...n.map((c) => c.buy)), long: Math.max(...n.map((c) => c.buy)) } : null;
}
