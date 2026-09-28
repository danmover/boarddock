// How the shopping list names a cable to buy, so the same kind of cable reads the same everywhere it is listed.
import type { Link } from './types';

/**
 * A cable to buy, in words a shop would understand. `a`, `b`: the plug names at its ends ("USB-C", "wires" for a
 * screw terminal, "DC barrel", "UK outlet"); `buy`: the length in metres.
 */
export function buyText(kind: NonNullable<Link['kind']>, buy: number, a: string, b: string): string {
  const ends = [a, b];
  if (kind === 'mains') {
    const plug = /UK|US|EU/.exec(ends.join(' '))?.[0] ?? 'AU';
    return `mains lead, figure-8 (C7) to ${plug} plug, ${buy} m or longer (your charger may have come with one: check the box)`;
  }
  if (kind === 'uart') return `USB to TTL serial cable, 3.3 V, with loose jumper ends (PL2303 or CP2102 type, like Adafruit 954), ${buy} m or longer`;
  if (ends.includes('DC barrel') && ends.includes('wires')) return `DC barrel plug to bare wire lead (a pigtail) to fit your socket, ${buy} m, with a ferrule crimped on each bare end for the screw terminal`;
  if (kind === 'wire' || ends.includes('wires')) {
    const term = ends.includes('wires') ? ', a ferrule crimped on each end that goes into a screw terminal' : '';
    return `red and black hook-up wire, 0.5 to 0.75 mm² (20 to 18 AWG), ${buy} m of each${term}`;
  }
  return `${buy} m ${a} to ${b} cable`;
}
