// The cluster preset on Start: N Raspberry Pis (a Pi 4 or a Pi 5), a network switch, a powerboard and the supplies. This
// works out which library boards that is; the boards are then put on the rack and connected by Auto-connect, and
// whatever it still says is missing (the switch's own supply) is added the way the To do list adds it (ui/clusterOps.ts).
import type { Board } from './types';
import { TEMPLATES } from './templates';

export type ClusterPi = 'rpi4' | 'rpi5';
export interface ClusterOpts { count: number; pi: ClusterPi; poe: boolean }
export const CLUSTER_MAX = 7; // one 8-port switch: its ports for the Pis, one for its uplink to your router

/** How many Pis a cluster can have, kept in range. */
export const clusterCount = (n: number) => Math.max(1, Math.min(CLUSTER_MAX, Math.round(Number.isFinite(n) ? n : 1)));

/** The library templates a cluster is made of, by id: Pis, switch, powerboards, and a supply for each Pi (none over PoE). */
export function clusterParts(o: ClusterOpts): { pis: ClusterPi[]; switchId: string; powerboards: string[]; supplies: string[] } {
  const n = clusterCount(o.count);
  // (a PoE switch powers the Pis: its ports are all PoE; else a small switch does when its ports are enough)
  const switchId = o.poe ? 'net_switch8poe' : n <= 4 ? 'net_switch5' : 'net_switch8';
  const supplies = o.poe ? [] : Array<string>(n).fill(o.pi === 'rpi5' ? 'psu_pi5' : 'psu_pi4');
  // an outlet for each Pi's supply and one for the switch's; a powerboard is never plugged into another
  const outlets = supplies.length + 1;
  const powerboards = outlets <= 4 ? ['pb4'] : Array<string>(Math.ceil(outlets / 6)).fill('pb6');
  return { pis: Array<ClusterPi>(n).fill(o.pi), switchId, powerboards, supplies };
}

const make = (id: string): Board => TEMPLATES.find((t) => t.id === id)!.make();

/** The boards of a cluster, before they are connected: the Pis (with a PoE HAT when asked), the switch, the powerboards, the supplies. */
export function clusterBoards(o: ClusterOpts): Board[] {
  const c = clusterParts(o);
  const pis = c.pis.map((id) => { const b = make(id); if (o.poe) b.poe = true; return b; });
  return [...pis, make(c.switchId), ...c.powerboards.map(make), ...c.supplies.map(make)];
}

/** What to call the rack a cluster starts: "4 × Pi 4 cluster". */
export const clusterName = (o: ClusterOpts) => `${clusterCount(o.count)} × Pi ${o.pi === 'rpi5' ? 5 : 4} cluster`;
