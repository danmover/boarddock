// The racks the collision test builds: every board alone four ways, boards back to back and stacked, probes, boxes,
// stands on and off, rails across and along and at right angles, two big racks with Auto-connect, a rack laid out by
// hand and then changed, and a built rack with boards added. Ids come from a seeded Math.random, so a rack comes out
// the same on every run.
import { TEMPLATES } from '../../src/model/templates';
import { newModule, newProject, setLayout } from '../../src/model/library';
import { autoLinks, numberLinks } from '../../src/model/links';
import { addAdapters, addProbes } from '../../src/model/probes';
import { seatBoard, seatCompanion, spreadOut, spreadRails } from '../../src/cad/dockplan';
import { generatePanel } from '../../src/cad/panelgen';
import { snapshot } from '../../src/model/built';
import type { Board, EdgeName, Project, V2 } from '../../src/model/types';

export interface Rack {
  name: string;
  auto: boolean; // laid out by Auto-arrange (the layout checks apply)
  make: () => Project;
}

/** Run f with Math.random giving the same numbers every time (mulberry32). */
export function seeded<T>(seed: number, f: () => T): T {
  const orig = Math.random;
  let s = seed >>> 0;
  Math.random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try { return f(); } finally { Math.random = orig; }
}

const T = (id: string): Board => TEMPLATES.find((t) => t.id === id)!.make();

function rackOf(ids: string[], f?: (p: Project) => void): Project {
  const p = newProject(T(ids[0]));
  for (const id of ids.slice(1)) p.modules.push(newModule(T(id)));
  f?.(p);
  p.links = numberLinks(autoLinks(p));
  return p;
}

/** Freeze an automatic layout as it came out, the way the first edit by hand does (and Mark as built, with `built`). */
export function freeze(p: Project, built = false) {
  const r = generatePanel(p), pr = r.report.panel!;
  p.panel.rails = pr.rails.map((x) => ({ id: x.id, x: x.x, y: x.y, dir: x.dir, length: built ? x.length : null }));
  p.panel.mounts = pr.mounts.map((m) => ({
    id: m.id, rail: m.rail, at: m.at, kind: m.kind, turn: m.turn, lever: m.leverSide > 0 ? 'pos' as const : 'neg' as const,
    slots: m.slots.map((s, k) => ({ ...s, edge: s.module ? pr.modules.find((x) => x.id === s.module && x.mount === m.id && x.slot === k)?.edge ?? s.edge : s.edge })),
  }));
  p.panel.auto = false;
  if (built) p.built = snapshot(p, r);
}

/** What the app does once a change by hand is built: docks that now overlap slide along, rails across. */
export function settle(p: Project) {
  const pr = generatePanel(p).report.panel!;
  spreadOut(p, pr, 2);
  spreadRails(p, pr, 2);
}

const mountOf = (p: Project, id: string) => p.panel.mounts.find((m) => m.slots.some((s) => s.module === id))!;

// ---- every board alone ----
const alone: Rack[] = TEMPLATES.flatMap((t, i) => [
  { name: `${t.id} standing`, auto: true, make: () => seeded(100 + i, () => rackOf([t.id])) },
  { name: `${t.id} lying flat`, auto: true, make: () => seeded(200 + i, () => rackOf([t.id], (p) => { p.panel.lie = 'flat'; })) },
  { name: `${t.id} loose`, auto: false, make: () => seeded(300 + i, () => rackOf([t.id], (p) => setLayout(p, 'loose'))) },
  { name: `${t.id} DIN flat clip`, auto: false, make: () => seeded(400 + i, () => rackOf([t.id], (p) => { setLayout(p, 'loose'); p.mount = { ...p.mount, kind: 'din', mode: 'flat', picked: true }; })) },
]);

// ---- boards together ----
const L_SHAPE: V2[] = [[0, 0], [80, 0], [80, 30], [35, 30], [35, 60], [0, 60]];
const together: Rack[] = [
  {
    name: 'back to back', auto: false, make: () => seeded(501, () => {
      // two pairs sharing a dock: a Pico behind a Nano, a Pi 4 behind a Pi 4
      const p = rackOf(['nano', 'pico', 'rpi4', 'rpi4', 'uno'], (q) => { q.panel.pairs = false; });
      freeze(p);
      for (const [a, b] of [[0, 1], [2, 3]]) {
        const A = mountOf(p, p.modules[a].id), B = mountOf(p, p.modules[b].id);
        const k = B.slots.findIndex((s) => s.module === p.modules[b].id);
        B.slots[k] = { module: null, edge: 'auto' };
        A.slots[1] = { module: p.modules[b].id, edge: 'auto' };
      }
      p.panel.mounts = p.panel.mounts.filter((m) => m.slots.some((s) => s.module));
      settle(p);
      return p;
    }),
  },
  { name: 'pairs by Auto-arrange', auto: true, make: () => seeded(502, () => rackOf(['pico', 'nano', 'esp32', 'pico', 'uno', 'rpi_zero'], (p) => { p.panel.pairs = true; })) },
  {
    name: 'stacks', auto: true, make: () => seeded(503, () => rackOf(['rpi4', 'rpi4', 'uno', 'uno', 'rpi4', 'proto_5x7', 'rpi4', 'rpi_zero'], (p) => {
      const [a, b, c, d, e, f, g, h] = p.modules;
      b.on = a.id; b.onMode = 'bolted'; // a HAT-sized board on a Pi
      d.on = c.id; d.onMode = 'bolted'; d.onGap = 15; // a shield on an Uno
      f.on = e.id; f.onMode = 'towers'; // a board on its own printed layer
      h.on = g.id; h.onMode = 'bolted'; // a Zero on a Pi, two holes shared
    })),
  },
  {
    name: 'probes and adapters', auto: true, make: () => seeded(504, () => {
      const p = rackOf(['example_dual_swd', 'example_jtag', 'usb_hub7', 'rpi4']);
      addProbes(p, p.modules[0].id); addProbes(p, p.modules[1].id); addAdapters(p, p.modules[0].id);
      p.modules.push(newModule(T('jlink')), newModule(T('ftdi')));
      p.links = numberLinks([...(p.links ?? []), ...autoLinks(p)]);
      return p;
    }),
  },
  { name: 'boxes', auto: true, make: () => seeded(505, () => rackOf(['rpi4', 'pico', 'uno', 'usb_hub', 'usb_hub7', 'usb_hubc', 'usb_charger', 'usb_charger6', 'net_switch5', 'pb4', 'rpi5'])) },
  { name: 'no table stands', auto: true, make: () => seeded(506, () => rackOf(['rpi4', 'uno', 'pico', 'esp32', 'usb_hub', 'rpi5', 'usb_charger'], (p) => { p.panel.stands = false; })) },
  { name: 'rails along (columns)', auto: true, make: () => seeded(507, () => rackOf(['rpi4', 'uno', 'pico', 'esp32', 'usb_hub7', 'rpi5', 'mega', 'nano'], (p) => { p.panel.rowDir = 'v'; p.panel.maxRail = 300; })) },
  { name: 'rows of rails', auto: true, make: () => seeded(508, () => rackOf(['rpi4', 'rpi4', 'rpi5', 'uno', 'mega', 'pico', 'nano', 'esp32', 'usb_hub7', 'usb_charger', 'jlink', 'ftdi'], (p) => { p.panel.maxRail = 300; })) },
  { name: 'rows lying flat', auto: true, make: () => seeded(509, () => rackOf(['rpi4', 'rpi4', 'rpi5', 'uno', 'mega', 'pico', 'nano', 'esp32', 'usb_hub7', 'usb_charger', 'jlink', 'ftdi'], (p) => { p.panel.maxRail = 300; p.panel.lie = 'flat'; })) },
  { name: 'whichever suits each', auto: true, make: () => seeded(510, () => rackOf(['rpi4', 'uno', 'pico', 'esp32', 'mega', 'usb_hub7'], (p) => { p.panel.lie = 'auto'; })) },
  {
    name: 'L-shaped rails', auto: false, make: () => seeded(511, () => {
      // one rail across and one along, at right angles, set by hand
      const p = rackOf(['rpi4', 'uno', 'pico', 'esp32', 'nano', 'usb_hub']);
      freeze(p);
      const [r1] = p.panel.rails;
      p.panel.rails = [{ ...r1, length: null }, { id: 'rv', x: r1.x - 90, y: r1.y + 40, dir: 'v', length: null }];
      p.panel.mounts.forEach((m, i) => { m.rail = i % 2 ? 'rv' : r1.id; m.at = null; });
      return p;
    }),
  },
  {
    name: 'L-shaped board', auto: true, make: () => seeded(512, () => rackOf(['blank', 'rpi4', 'uno'], (p) => {
      const b = p.modules[0].board;
      b.name = 'L-shaped board';
      b.outline = L_SHAPE;
      // an M3 hole in each outer corner: the four the blank has, moved there, and one more
      const at: V2[] = [[4, 4], [76, 4], [76, 26], [4, 56], [31, 56]];
      b.holes = at.map(([x, y], k) => ({ ...b.holes[k % b.holes.length], id: `h${k}`, x, y }));
      p.modules[0].original = structuredClone(b);
    })),
  },
  { name: 'Pi cluster', auto: true, make: () => seeded(513, () => rackOf(['rpi5', 'rpi5', 'rpi5', 'rpi5', 'rpi4', 'rpi4', 'rpi_zero', 'net_switch8', 'usb_hub7', 'usb_charger', 'usb_charger', 'psu_pi5', 'psu_pi5', 'psu_pi5', 'psu_pi5', 'pb6'])) },
  { name: 'busy mixed rack', auto: true, make: () => seeded(514, () => rackOf(['rpi5', 'rpi5', 'rpi4', 'usb_hub7', 'usb_hubc', 'uno', 'pico', 'usb_charger6', 'net_switch5', 'esp32', 'pb4'])) },
  {
    name: 'laid out by hand, then changed', auto: false, make: () => seeded(515, () => {
      const p = rackOf(['rpi4', 'uno', 'mega', 'pico', 'esp32', 'rpi5', 'nano', 'usb_hub7'], (q) => { q.panel.maxRail = 300; });
      freeze(p);
      const [pi, uno, mega, , esp] = p.modules;
      // lay a board flat, dock one by another edge, turn a dock, swap a dock's front and back
      // (lying flat, the edge is BoardDock's pick, as with the toggle: every edge of a Mega has plugs or headers)
      const a = mountOf(p, mega.id); a.slots[a.slots.findIndex((s) => s.module === mega.id)] = { module: mega.id, edge: 'auto', lie: 'flat' };
      const b = mountOf(p, uno.id); const kb = b.slots.findIndex((s) => s.module === uno.id); b.slots[kb] = { ...b.slots[kb], edge: (b.slots[kb].edge === 'bottom' ? 'right' : 'bottom') as EdgeName };
      const c = mountOf(p, esp.id); c.turn = ((c.turn + 90) % 360) as 0 | 90 | 180 | 270;
      const d = mountOf(p, pi.id); while (d.slots.length < 2) d.slots.push({ module: null, edge: 'auto' }); d.slots.reverse();
      settle(p);
      return p;
    }),
  },
  {
    name: 'built, then boards added', auto: false, make: () => seeded(516, () => {
      const p = rackOf(['rpi4', 'uno', 'pico', 'usb_hub7'], (q) => { q.panel.maxRail = 300; });
      freeze(p, true);
      for (const id of ['esp32', 'rpi5', 'nano']) { p.modules.push(newModule(T(id))); seatBoard(p, p.modules[p.modules.length - 1].id); }
      const probe = addProbes(p, p.modules[0].id);
      for (const m of probe) if (!m.on) seatCompanion(p, m.id);
      p.links = numberLinks([...(p.links ?? []), ...autoLinks(p)]);
      settle(p);
      return p;
    }),
  },
];

export const RACKS: Rack[] = [...alone, ...together];

/** The quick ones `npm test` runs every time (the rest: `npm run collisions`). */
export const FAST = ['rpi4 standing', 'uno lying flat', 'pico loose', 'esp32 DIN flat clip', 'usb_hubc standing', 'busy mixed rack', 'laid out by hand, then changed'];
