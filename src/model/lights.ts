// The little lights on boards and boxes, for the 3D view and the board editor: which LEDs a board has, what colour
// they are and how they behave (a power LED stays on, an activity LED flickers, an Arduino's "L" blinks once a
// second, a Pi's ACT beats, an RGB pixel runs through the rainbow), and which boards have power at all, so a board
// with no power cable stays dark. Real LED parts come from the board's own parts; boards made from a template get
// the LEDs the real board has, drawn only (they are not parts: nothing is printed round them). Pure.
import type { Board, Comp, Light, LightPattern, Project, V2 } from './types';
import { plugRole } from './links';
import { bbox, compRect, inside } from '../geom/poly';

export const LED_COLOUR = { red: '#ff3b30', green: '#38e05a', blue: '#3d8bff', yellow: '#ffd23f', amber: '#ffa126', white: '#f4f7ff' } as const;

/** What an LED part looks like lit, from its reference, value and package (D3 "PWR", "LED_0805_Red", "WS2812B"...). */
export function ledLook(c: Pick<Comp, 'ref' | 'pkg' | 'value'>): { colour: string; pattern: LightPattern } {
  const s = ` ${c.ref} ${c.value ?? ''} ${c.pkg} `.toLowerCase().replace(/[_-]/g, ' ');
  if (/rgb|ws281\d|sk6812|neopixel|apa102/.test(s)) return { colour: LED_COLOUR.white, pattern: 'rainbow' };
  const named = /\bred\b/.test(s) ? LED_COLOUR.red : /\bgreen\b|\bgrn\b/.test(s) ? LED_COLOUR.green : /\bblue\b/.test(s) ? LED_COLOUR.blue
    : /\byellow\b|\byel\b/.test(s) ? LED_COLOUR.yellow : /\bamber\b|\borange\b/.test(s) ? LED_COLOUR.amber : /\bwhite\b/.test(s) ? LED_COLOUR.white : '';
  let pattern: LightPattern = 'on', colour = '';
  if (/\btx\b|\brx\b|\btxd\b|\brxd\b|\bact\b|activity|\bdata\b|\blink\b|\bbusy\b|\bsd\b/.test(s)) { pattern = 'activity'; colour = /\btx|\brx/.test(s) ? LED_COLOUR.yellow : LED_COLOUR.green; }
  else if (/\bl\b|led13|\buser\b|\bstat(us)?\b|heart/.test(s)) { pattern = /\bl\b|led13/.test(s) ? 'blink' : 'heartbeat'; colour = /\bl\b|led13/.test(s) ? LED_COLOUR.amber : LED_COLOUR.green; }
  else if (/\bpwr\b|power|\bon\b|\bvcc\b|3v3|\b5v\b/.test(s)) { pattern = 'on'; colour = /\bon\b/.test(s) ? LED_COLOUR.green : LED_COLOUR.red; }
  return { colour: named || colour || LED_COLOUR.green, pattern };
}

const hash = (n: number) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };

/**
 * How bright a light is at time `t` (seconds): 0 off to 1 full. `seed` keeps two boards from blinking in step; `i`
 * is the light's place in a row (relays light one after another).
 */
export function lightLevel(p: LightPattern, t: number, seed = 0, i = 0): number {
  switch (p) {
    case 'on': case 'rainbow': return 1;
    case 'blink': return ((t + seed * 0.37) % 2) < 1 ? 1 : 0; // the Blink sketch: a second on, a second off
    case 'heartbeat': { const u = (t + seed * 0.61) % 1.25; return u < 0.08 || (u > 0.22 && u < 0.3) ? 1 : 0; } // two quick beats, then a rest
    case 'breathe': return 0.15 + 0.85 * (0.5 - 0.5 * Math.cos(((t + seed) * 2 * Math.PI) / 3.2));
    case 'chase': { const s = Math.floor(t / 0.8) % 6; return s < 4 ? (s === i % 4 ? 1 : 0) : 1; } // relays click on one by one, then all
    case 'activity': {
      // bursts of flicker: busy for a while, then quiet, like a card being read or packets going through
      const slot = Math.floor(t / 0.055), busy = Math.max(0, Math.sin(t * 0.9 + seed * 5.1 + i)) ** 2;
      return hash(slot * 7.31 + seed * 131 + i * 17) < 0.12 + 0.6 * busy ? 1 : 0;
    }
  }
}

/** A rainbow light's colour at `t`, as a hue from 0 to 1. */
export const lightHue = (t: number, seed = 0) => ((t * 0.18 + seed * 0.13) % 1 + 1) % 1;

/** Where a template board's own LEDs are, nudged off any part in the way (board millimetres). */
function spot(b: Board, want: V2, taken: V2[]): V2 {
  const busy = (q: V2) => !inside(q, b.outline) || b.comps.some((c) => c.side === 'top' && !c.hidden && c.h > 0.05 && inside(q, compRect(c, 0.6)))
    || b.holes.some((h) => Math.hypot(h.x - q[0], h.y - q[1]) < h.d / 2 + 1.6) || taken.some((o) => Math.hypot(o[0] - q[0], o[1] - q[1]) < 2);
  if (!busy(want)) return want;
  for (let r = 0.5; r < 12; r += 0.5) for (let a = 0; a < 16; a++) {
    const q: V2 = [want[0] + r * Math.cos((a * Math.PI) / 8), want[1] + r * Math.sin((a * Math.PI) / 8)];
    if (!busy(q)) return q;
  }
  return want;
}

type Want = [number, number, keyof typeof LED_COLOUR, LightPattern, string];
// the LEDs of boards that come as templates, roughly where the real boards have them
const TEMPLATE_LEDS: [RegExp, Want[]][] = [
  [/raspberry pi 4|raspberry pi 3/i, [[2.4, 46, 'red', 'on', 'PWR'], [2.4, 43.4, 'green', 'activity', 'ACT']]],
  [/raspberry pi 5/i, [[2.4, 38, 'green', 'heartbeat', 'STAT']]],
  [/raspberry pi zero/i, [[59.6, 6.5, 'green', 'activity', 'ACT']]],
  [/raspberry pi pico/i, [[6.8, 17.2, 'green', 'blink', 'LED']]],
  [/arduino (uno|mega)/i, [[28, 45.5, 'amber', 'blink', 'L'], [28, 42.2, 'yellow', 'activity', 'TX'], [28, 39.4, 'yellow', 'activity', 'RX'], [60.5, 36, 'green', 'on', 'ON']]],
  [/arduino nano/i, [[4.6, 24, 'yellow', 'activity', 'TX'], [4.6, 21.4, 'yellow', 'activity', 'RX'], [13.2, 24, 'blue', 'on', 'PWR'], [13.2, 21.4, 'amber', 'blink', 'L']]],
  [/esp32/i, [[10, 19.5, 'red', 'on', 'PWR']]],
];

/**
 * The lights a board shows, in its own frame (z up from its top face; `n` the way a side-facing one looks). Its LED
 * parts first; a template board without any gets its real board's; a closed box gets its status light; relay
 * boards light a lamp per relay.
 */
export function boardLights(b: Board): Light[] {
  const out: Light[] = [];
  const leds = b.comps.filter((c) => c.kind === 'led' && !c.hidden);
  leds.forEach((c, i) => {
    const { colour, pattern } = ledLook(c);
    const z = c.side === 'bottom' ? -b.thickness - c.h : c.h;
    out.push({ p: [c.x, c.y, z], colour, pattern, r: Math.max(0.5, Math.min(2.4, Math.min(c.w, c.l) * 0.45)), i, name: c.value || c.ref, bottom: c.side === 'bottom' || undefined });
  });
  if (!leds.length && b.source === 'template') {
    const hit = TEMPLATE_LEDS.find(([re]) => re.test(b.name));
    const taken: V2[] = [];
    hit?.[1].forEach(([x, y, col, pattern, name], i) => { const q = spot(b, [x, y], taken); taken.push(q); out.push({ p: [q[0], q[1], 0.5], colour: LED_COLOUR[col], pattern, r: 0.6, i, name }); });
  }
  if (!leds.length && /relay/i.test(b.name)) {
    b.comps.filter((c) => /relay/i.test(`${c.pkg} ${c.value ?? ''} ${c.ref}`) && !c.hidden).forEach((c, i) => {
      const r = bbox(compRect(c, 1.2));
      out.push({ p: [r.x0, r.y0, 0.5], colour: LED_COLOUR.red, pattern: 'chase', r: 0.6, i, name: `${c.ref} on` });
    });
  }
  return out;
}

/** The status light a closed box shows on its top (hubs and chargers blue, switches green, powerboards red). */
export function boxLight(b: Board): Pick<Light, 'colour' | 'pattern'> {
  const n = b.name.toLowerCase();
  if (/switch/.test(n) && !/powerboard|outlet/.test(n)) return { colour: LED_COLOUR.green, pattern: 'on' };
  if (/powerboard|outlet|mains/.test(n)) return { colour: LED_COLOUR.red, pattern: 'on' };
  if (/j-?link|probe|debug/.test(n)) return { colour: LED_COLOUR.green, pattern: 'breathe' };
  return { colour: LED_COLOUR.blue, pattern: 'on' };
}

/**
 * The boards that have power: a board with a cable into its power input, or a USB cable from a host or hub into
 * it; a box that plugs into the wall (or takes a plug pack) by itself. Only for the lights: the power check is
 * the real test of whether each gets enough.
 */
export function poweredBoards(p: Project): Set<string> {
  const out = new Set<string>();
  const byId = new Map(p.modules.map((m) => [m.id, m]));
  const role = (mod: string, ref: string) => { const m = byId.get(mod), c = m?.board.comps.find((x) => x.ref === ref.replace(/:2$/, '')); return m && c ? plugRole(m, c) : 'other'; };
  const takes = new Set(['power-in', 'power-in-dc', 'device', 'hub-up', 'mains-in']);
  for (const l of p.links ?? []) {
    if (takes.has(role(l.a.module, l.a.ref))) out.add(l.a.module);
    if (takes.has(role(l.b.module, l.b.ref))) out.add(l.b.module);
  }
  for (const m of p.modules) {
    if (m.board.kind !== 'box') continue;
    const supply = m.board.comps.filter((c) => c.conn && !c.hidden && ['mains-in', 'power-in-dc', 'other'].includes(plugRole(m, c)));
    if (supply.length || !m.board.comps.some((c) => c.conn && ['hub-up', 'power-in', 'device'].includes(plugRole(m, c)))) out.add(m.id);
  }
  return out;
}
