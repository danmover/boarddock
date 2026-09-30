// Rough power figures at 5 V, for the power budget: what a board takes, what a port and a box can give. These are
// estimates (the makers' recommended supplies and typical draws under load), not measurements; every board can be
// given its own figure (Board › Power) and every charger or powered hub its own total (Box › Power).
import type { Board, Comp } from './types';

/**
 * load: what it takes at full load (sums against a supply); peak: the supply one port should give it; min: the least a
 * port may give for it to run at all (a Pi 5 runs on 3 A with its USB ports held back), when that is below peak.
 */
export interface Need { load: number; peak: number; min?: number; why: string }

const GUESS: [RegExp, number, number, string, number?][] = [
  [/\bpi 5\b|raspberry pi 5/i, 2.5, 5, 'Raspberry Pi 5: the maker recommends its 27 W (5 A) USB-C supply; on a 3 A supply it runs, but holds its USB ports to 0.6 A between them', 3],
  [/pi 4|pi 400|pi4/i, 1.5, 3, 'Raspberry Pi 4: the maker recommends a 3 A supply; about 1.5 A busy with a few USB devices'],
  [/pi 3|pi3/i, 1.2, 2.5, 'Raspberry Pi 3: the maker recommends a 2.5 A supply'],
  [/zero 2/i, 0.6, 1, 'Pi Zero 2 W: about 0.6 A busy'],
  [/\bzero\b/i, 0.3, 1, 'Pi Zero: about 0.3 A busy'],
  [/pico/i, 0.1, 0.1, 'Pico: under 0.1 A'],
  [/mega|uno|leonardo|due/i, 0.2, 0.5, 'Arduino: about 0.2 A with a few LEDs or sensors; its USB fuse trips at 0.5 A'],
  [/esp32|esp8266|feather|wemos|d1 mini|xiao|qt py/i, 0.3, 0.5, 'Wi-Fi microcontroller: up to about 0.3 A when transmitting'],
  [/nano|arduino micro|pro mini/i, 0.1, 0.5, 'small Arduino: about 0.1 A'],
  [/jetson/i, 3, 4, 'Jetson: several amps; it wants its own supply'],
];

/** What a board takes from the port that powers it. */
export function needOf(b: Board, powerIn: boolean): Need {
  const g = GUESS.find(([re]) => re.test(b.name));
  const base: Need = g ? { load: g[1], peak: g[2], ...(g[4] ? { min: g[4] } : {}), why: g[3] } : powerIn ? { load: 1, peak: 2, why: 'a guess for a board with its own power input: set its real figure' } : { load: 0.3, peak: 0.5, why: 'a guess for a USB device (a USB 2 port gives 0.5 A): set its real figure' };
  if (b.draw != null) { const peak = Math.max(b.draw, Math.min(base.peak, b.draw * 1.5)); return { load: b.draw, peak, ...(base.min && base.min < peak ? { min: Math.max(b.draw, base.min) } : {}), why: 'your figure' }; }
  return base;
}

/** The least a port must give this board: its peak, or less where it runs on less (a Pi 5 on 3 A). */
export const minOf = (n: Need) => Math.min(n.peak, n.min ?? n.peak);

const isBox = (b: Board) => b.kind === 'box';
export const isCharger = (b: Board) => isBox(b) && /charg|power|supply|psu/i.test(b.name);
export const isHub = (b: Board) => isBox(b) && /hub/i.test(b.name);
/** A hub with its own power supply (a barrel or mains input, or "powered" in its name). */
export const poweredHub = (b: Board) => isHub(b) && (/powered/i.test(b.name) || b.comps.some((c) => c.conn && (c.conn.type === 'barrel' || c.conn.type === 'iec_c7' || c.conn.type === 'iec_c14')));

/** A plug pack: a supply that plugs straight into an outlet (or the wall), its own lead ending in its output plug. */
export const isPlugPack = (b: Board) => isBox(b) && !!b.box?.pack;

/**
 * The DC input range of a board whose barrel jack is known: the volts its maker recommends, and the usual pick (an
 * Arduino Uno, Mega, Leonardo or Due takes 7 to 12 V; 9 V is the usual pack). Null for a board with no known range.
 */
export function dcRange(b: Board): { min: number; max: number; usual: number } | null {
  return /\b(uno|mega|leonardo|due)\b/i.test(b.name) ? { min: 7, max: 12, usual: 9 } : null;
}

/** What one port can give, in A at 5 V. */
export function portCap(b: Board, c: Comp, role: string): number {
  const t = c.conn?.type ?? '';
  // a box port's own figure (a 5 A USB-C PD port), from its row of ports
  const own = b.box?.groups.find((x) => x.refs?.includes(c.ref.replace(/:2$/, '')))?.amps;
  if (own && (role === 'power-out' || role === 'dc-out')) return own;
  if (role === 'power-out') return t === 'usb_c' ? 3 : t === 'usb_a' || t === 'usb_a_dual' ? 2.4 : 2;
  if (role === 'hub-down') return poweredHub(b) ? 0.9 : /usb-c|usb_c|hubc/i.test(b.name) ? 0.9 : 0.5;
  if (role === 'host') return hostTotal(b) ?? 0.9;
  return 0;
}

/**
 * What all a board's USB host ports give together (a Pi shares 1.2 A between them), or null for per-port only. `fed`:
 * what its own supply gives, when known (a Pi 5 gives 1.6 A on a 5 A supply, 0.6 A on less).
 */
export function hostTotal(b: Board, fed?: number): number | null {
  if (/\bpi 5\b|raspberry pi 5/i.test(b.name)) return fed != null && fed >= 5 ? 1.6 : 0.6;
  if (/pi 4|pi 400|pi4|pi 3|pi3/i.test(b.name)) return 1.2;
  return null;
}

/** What a charger or powered hub gives in all (its own figure, or about 60% of its ports added up). */
export function supplyOf(b: Board, ports: { c: Comp; role: string }[]): { total: number; guessed: boolean } {
  if (b.box?.supply) return { total: b.box.supply, guessed: false };
  if (isHub(b)) return { total: 4, guessed: true };
  const sum = ports.reduce((a, p) => a + portCap(b, p.c, p.role) * (p.c.conn?.type === 'usb_a_dual' ? 2 : 1), 0);
  return { total: Math.round(sum * 0.6 * 10) / 10, guessed: true };
}

export const watts = (a: number) => Math.round(a * 5);
export const amps = (a: number) => `${Math.round(a * 10) / 10} A`;
