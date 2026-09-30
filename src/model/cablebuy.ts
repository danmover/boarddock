// How the shopping list names a cable to buy, so the same kind of cable reads the same everywhere it is listed.
import type { Link } from './types';

/** The plug name of a header that is a pin socket (female): a jumper wire into it needs a male end. */
export const SOCKET = 'pin socket';

/**
 * A cable to buy, in words a shop would understand. `a`, `b`: the plug names at its ends ("USB-C", "wires" for a
 * screw terminal, "DC barrel", "UK outlet", "pin socket"); `buy`: the length in metres (for a jumper wire, a run of
 * wires: 0.2 is 20 cm), or null for a mains lead of a length nobody has measured. `poe`: an Ethernet lead that also carries a
 * board's power (over PoE), so it must be Cat5e or better.
 */
export function buyText(kind: NonNullable<Link['kind']>, buy: number | null, a: string, b: string, poe = false): string {
  const ends = [a, b];
  if (kind === 'mains') {
    const plug = /UK|US|EU/.exec(ends.join(' '))?.[0] ?? 'AU';
    const len = buy != null ? `${buy} m or longer` : 'long enough to reach';
    // (a board's C14 inlet takes an ordinary kettle-type lead, which is bought)
    if (ends.some((e) => /C13/.test(e))) return `mains lead, kettle-type (C13) to ${plug} plug, ${len}`;
    return `mains lead, figure-8 (C7) to ${plug} plug, ${len} (your charger may have come with one: check the box)`;
  }
  // an SFP cage takes a module, and what goes between is the DAC or the fibre, or a copper module and an Ethernet cable
  if (ends.includes('SFP')) return ends.every((e) => e === 'SFP') ? `SFP+ direct-attach copper cable (DAC), ${buy} m (or an SFP module in each cage and a fibre patch cable)` : `Ethernet cable, ${buy} m, and a copper (1000BASE-T) SFP module in the SFP cage`;
  if (ends.includes('4 mm plug')) return `4 mm banana-plug test leads (red and black), ${buy} m each${ends.includes('wires') ? ', bare at the screw terminal end with a ferrule crimped on' : ''}`;
  if (kind === 'jumper') {
    // a wire's end into a socket is a male pin, its end onto pins is a female housing
    const male = ends.filter((e) => e === SOCKET).length;
    return `${male === 2 ? 'male–male' : male === 1 ? 'male–female' : 'female–female'} jumper wire (Dupont), ${Math.round((buy ?? 0) * 100)} cm`;
  }
  if (kind === 'uart') return `USB to TTL serial cable, 3.3 V, with loose jumper ends (PL2303 or CP2102 type, like Adafruit 954), ${buy} m or longer${ends.includes(SOCKET) ? ', plus male–male jumper wires: the header is a pin socket and takes pins' : ''}`;
  if (ends.includes('DC barrel') && ends.includes('wires')) return `DC barrel plug to bare wire lead (a pigtail) to fit your socket, ${buy} m, with a ferrule crimped on each bare end for the screw terminal`;
  if (kind === 'wire' || ends.includes('wires')) {
    const term = ends.includes('wires') ? ', a ferrule crimped on each end that goes into a screw terminal' : '';
    return `red and black hook-up wire, 0.5 to 0.75 mm² (20 to 18 AWG), ${buy} m of each${term}`;
  }
  return `${buy} m ${a} to ${b} cable${poe ? " (Cat5e or better: it carries the board's power over PoE)" : ''}`;
}
