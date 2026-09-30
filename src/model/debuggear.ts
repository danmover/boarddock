// Debug gear: which J-Link and USB-serial adapter each board's headers want, one action that adds them for every
// board (docked beside it, cabled to its header and its USB to a hub), the headers that have none, and what to buy
// and which way round each plugs in (pin 1). The one-page bench sheet is made from the same rows.
import type { Comp, Link, Module, PanelReport, Project } from './types';
import type { CableOut } from './cablelist';
import { buyText, SOCKET } from './cablebuy';
import { autoLinks, baseRef, isAccessory, isSocket, numberLinks, plugName, shortName, type PlugAt } from './links';
import { addAdapters, addProbes, adapterFor, debugHeaders, headerPins, isDebugPort, isProbe, probeKeyFor, ribbonOf, stackCompanions, uartHeaders, uartPins, uartWiring } from './probes';
import { COMPANIONS, type CompanionKey } from './boxes';
import { seatLabels } from './built';

/** Pin names of the standard debug connectors, pin 1 first (Arm's Cortex debug and JTAG pinouts). */
export const PINOUTS: Record<string, string[]> = {
  swd10: ['VTref', 'SWDIO', 'GND', 'SWCLK', 'GND', 'SWO', 'KEY', 'NC', 'GNDdet', 'nRESET'],
  cortex20: ['VTref', 'SWDIO', 'GND', 'SWCLK', 'GND', 'SWO', 'KEY', 'NC', 'GNDdet', 'nRESET', 'NC', 'NC', 'GND', 'NC', 'GND', 'NC', 'GND', 'NC', 'GND', 'NC'],
  jtag20: ['VTref', 'NC', 'nTRST', 'GND', 'TDI', 'GND', 'TMS', 'GND', 'TCK', 'GND', 'RTCK', 'GND', 'TDO', 'GND', 'nRESET', 'GND', 'DBGRQ', 'GND', '5V', 'GND'],
};

/** A debug header's pins with their standard names (pin 1 first), where the part has none. Mutates and returns `c`. */
export function withPinout(c: Comp): Comp {
  const names = PINOUTS[c.conn?.type ?? ''];
  if (!names || c.pins?.length) return c;
  c.pins = headerPins(c).map((q, i) => ({ ...q, net: names[i] }));
  return c;
}

/** The J-Links to offer for a header, the right one first: by its connector. */
export const PROBE_CHOICES: { key: CompanionKey; label: string }[] = [
  { key: 'jlink', label: '20-pin Cortex (1.27 mm)' },
  { key: 'jlink10', label: '10-pin Cortex-M (1.27 mm)' },
  { key: 'jlinkjtag', label: '20-pin JTAG box header (2.54 mm)' },
];
export const probeLabel = (key: CompanionKey) => PROBE_CHOICES.find((x) => x.key === key)?.label ?? COMPANIONS[key].name;

const end = (l: Link, id: string, ref: string) => (l.a.module === id && baseRef(l.a.ref) === ref ? l.b : l.b.module === id && baseRef(l.b.ref) === ref ? l.a : null);

/** One debug or UART header of a board and what is on it. */
export interface HeaderRow {
  board: Module;
  comp: Comp;
  kind: 'debug' | 'uart';
  /** the J-Link or adapter cabled to it */
  probe: Module | null;
  /** a serial cable or another lead is on it instead */
  other: boolean;
  link: Link | null;
}

/** Every debug and UART header of every board (accessories are left out), with the J-Link or adapter on it, if any. */
export function headerRows(p: Project): HeaderRow[] {
  const rows: HeaderRow[] = [];
  for (const m of p.modules) {
    if (isAccessory(m.board)) continue;
    for (const [kind, list] of [['debug', debugHeaders(m.board)], ['uart', uartHeaders(m.board)]] as const) for (const c of list) {
      let probe: Module | null = null, link: Link | null = null, other = false;
      for (const l of p.links ?? []) {
        const e = end(l, m.id, c.ref);
        if (!e) continue;
        const o = p.modules.find((x) => x.id === e.module);
        if (o && isProbe(o)) { probe = o; link = l; } else other = true;
      }
      rows.push({ board: m, comp: c, kind, probe, other, link });
    }
  }
  return rows;
}

/** The headers with nothing on them (no J-Link, no adapter, no serial cable). */
export const freeHeaders = (p: Project) => headerRows(p).filter((r) => !r.probe && !r.other);

/** What one action would add: per board, its free debug and UART headers and the J-Link each one takes. */
export function debugOffer(p: Project, ids?: string[]) {
  return freeHeaders(p).filter((r) => !ids || ids.includes(r.board.id)).map((r) => ({ ...r, offer: r.kind === 'debug' ? probeKeyFor(r.comp) : ('ftdi' as CompanionKey) }));
}

export interface GearAdded { probes: Module[]; adapters: Module[]; usb: number; boards: string[]; guess: string[] }

/**
 * A J-Link for each free debug header and a USB-serial adapter for each free UART header, on every board (or `ids`):
 * cabled to its header (jumper wires crossed over for an adapter), the new ones' USB cables to a hub or a host, and
 * a column each beside its board. Mutates the project. `at`: where the plugs are on the rack now, for the USB cables.
 */
export function addDebugGear(p: Project, ids?: string[], at?: PlugAt): GearAdded {
  const out: GearAdded = { probes: [], adapters: [], usb: 0, boards: [], guess: [] };
  for (const m of [...p.modules]) {
    if (isAccessory(m.board) || (ids && !ids.includes(m.id))) continue;
    const pr = addProbes(p, m.id), ad = addAdapters(p, m.id);
    if (!pr.length && !ad.length) continue;
    out.probes.push(...pr); out.adapters.push(...ad); out.boards.push(m.board.name);
    if (ad.length && uartHeaders(m.board).some((c) => uartPins(c)?.from === 'guess')) out.guess.push(m.board.name);
  }
  const fresh = new Set([...out.probes, ...out.adapters].map((x) => x.id));
  if (fresh.size) {
    // their USB cables only: the rest of Auto-connect is the user's to press
    const usb = autoLinks(p, at).filter((l) => fresh.has(l.a.module) || fresh.has(l.b.module));
    out.usb = usb.length;
    p.links = numberLinks([...(p.links ?? []), ...usb]);
    stackCompanions(p);
  }
  return out;
}

// ---- what to buy, and which way round ----

const IDC: Record<string, string> = { cortex20: '20-pin 1.27 mm (0.05") IDC ribbon', swd10: '10-pin 1.27 mm (0.05") IDC ribbon', jtag20: '20-pin 2.54 mm IDC ribbon' };
/** Standard ribbon lengths (cm), and the shortest that reaches a run (mm) with 5% to spare. */
export const ribbonToBuy = (mm: number) => [15, 20, 30, 50, 100].find((l) => l * 10 >= mm * 1.05) ?? Math.ceil((mm * 1.05) / 100) * 10;

/** Where pin 1 of a header is, as the board looks from above: "the bottom-left pin", "the left end". */
export function pin1Words(c: Comp): string {
  const pins = headerPins(c);
  if (pins.length < 2) return 'its only pin';
  const p1 = pins.find((q) => q.n === '1') ?? pins[0];
  const cx = pins.reduce((t, q) => t + q.x, 0) / pins.length, cy = pins.reduce((t, q) => t + q.y, 0) / pins.length;
  const dx = p1.x - cx, dy = p1.y - cy;
  const wide = pins.length > 2 && new Set(pins.map((q) => (Math.abs(dx) >= Math.abs(dy) ? Math.round(q.y * 10) : Math.round(q.x * 10)))).size > 1;
  const along = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'bottom' : 'top';
  if (!wide) return `the ${along} end`;
  // a two-row header: which row pin 1 is in, across the row's length
  const across = Math.abs(dx) >= Math.abs(dy) ? (dy < 0 ? 'bottom' : 'top') : dx < 0 ? 'left' : 'right';
  return `the ${across}-${along} pin`;
}

/** Pin 1 is exact where the file gave the pins; from a footprint's name it is the drawn end, and the silkscreen has the last word. */
export const pin1Exact = (c: Comp) => !!c.pins && c.pins.length >= 2;

/** A header's pins in words, pin 1 first ("VTref, SWDIO, GND, …"): the names the file gave, else the connector's standard ones. */
export function pinoutText(c: Comp): string | null {
  const names = c.pins && c.pins.length >= 2 && c.pins.some((q) => q.net) ? headerPins(c).map((q) => q.net?.replace(/^\//, '') ?? '-') : PINOUTS[c.conn?.type ?? ''];
  return names ? names.join(', ') : null;
}

export interface SheetRow {
  board: string;
  header: string; // "J_JTAG, 20-pin debug (JTAG)"
  kind: 'debug' | 'uart';
  probe: string | null; // the J-Link or adapter, by name
  where: string; // its dock, or "not on the rack yet"
  pin1: string; // which way round the ribbon plugs in
  pins: string | null; // a UART header's wires, in words
  pinout: string | null; // a debug header's pins, pin 1 first
  guess: boolean; // its pin names are a guess: check yours
  ribbon: string | null; // what the ribbon is, its length and whether it reaches
  buy: string[]; // what to buy for it
  usb: string; // where its USB goes
  port: string; // how the computer sees it
}

/** The COM port or debug notes for the computer end. */
const PORT: Record<'debug' | 'uart', string> = {
  debug: "Plugs into a USB port through the hub (or your computer). SEGGER's J-Link software finds it by its serial number: no COM port to pick.",
  uart: 'Shows up as a serial (COM) port: Windows, Device Manager › Ports (COMn); Linux, /dev/ttyUSB0; macOS, /dev/cu.usbserial-…. Open it at the board\'s baud rate (often 115200, 8N1), 3.3 V logic.',
};

/** What a header row says on the bench sheet and in the Plugs debug panel. `panel`, `cables`: the rack as laid out, when it is. */
export function sheetRow(p: Project, r: HeaderRow, cables: CableOut[] = [], panel?: PanelReport | null): SheetRow {
  const c = r.comp, type = c.conn?.type ?? '', name = r.kind === 'uart' ? 'UART' : plugName(type);
  const row: SheetRow = { board: r.board.board.name, header: `${c.ref}, ${name}`, kind: r.kind, probe: r.probe?.board.name ?? null, where: 'no J-Link or adapter yet', pin1: '', pins: null, guess: false, pinout: r.kind === 'debug' ? pinoutText(c) : null, ribbon: null, buy: [], usb: '', port: '' };
  const seats = seatLabels(panel);
  // which way round it plugs in (before there is anything on it too)
  if (r.kind === 'debug') row.pin1 = `Red stripe (pin 1) on ${pin1Words(c)} of ${c.ref}${pin1Exact(c) ? '' : ' (as drawn: check the 1 or arrow on your board)'}; the J-Link's connector is keyed the same way.`;
  else { row.guess = uartPins(c)?.from === 'guess'; row.pin1 = `Pin 1 of ${c.ref} is ${pin1Words(c)}${pin1Exact(c) ? '' : ' (as drawn: check the 1 on your board)'}.`; }
  if (r.probe) {
    const pm = r.probe, cab = r.link && cables.find((x) => x.id === r.link!.id);
    row.where = seats.get(pm.id) ?? (panel ? 'on its board\'s dock, in a column' : 'not laid out yet');
    const pc = pm.board.comps.find(isDebugPort) ?? null;
    if (r.kind === 'debug') {
      const have = ribbonOf(pm.board), need = cab?.length;
      const adapter = pc ? adapterFor(pc, c) : null;
      row.ribbon = need == null ? `the J-Link's own, ${have / 10} cm` : need <= have ? `the J-Link's own, ${have / 10} cm (it runs about ${Math.round(need / 10)} cm)` : `has to run about ${Math.round(need / 10)} cm: the J-Link's own ${have / 10} cm is short`;
      if (need != null && need > have) row.buy.push(`1 × ${ribbonToBuy(need)} cm ${IDC[pc?.conn?.type ?? type] ?? 'IDC ribbon'}, and set its length to ${ribbonToBuy(need) * 10} mm here`);
      if (adapter) row.buy.push(`1 × ${adapter}`);
    } else {
      row.pins = uartWiring(c).replace(/^black/, 'Black');
      // (worded as the shopping list words it: buyText)
      const n = r.link?.wires?.length || 3, ad = pm.board.comps.find((x) => x.conn?.type === 'pins_ra' || x.role === 'uart');
      row.buy.push(`${n} × ${buyText('jumper', cab?.buy ?? 0.2, ad?.conn ? plugName(ad.conn.type) : 'pins', isSocket(c) ? SOCKET : plugName(type))}`);
    }
    const usb = (p.links ?? []).find((l) => l.kind === 'usb' && (l.a.module === pm.id || l.b.module === pm.id));
    if (usb) { const o = usb.a.module === pm.id ? usb.b : usb.a, om = p.modules.find((x) => x.id === o.module); row.usb = `${shortName(om?.board.name ?? 'your computer')} ${baseRef(o.ref)}`; } else row.usb = 'not connected yet (Auto-connect)';
    row.port = PORT[r.kind];
  } else if (r.other) row.where = 'a serial cable or another lead is on it';
  return row;
}

/** The rows of the bench sheet: every header of every board, and the notes that go once at the bottom. */
export function benchSheet(p: Project, cables: CableOut[] = [], panel?: PanelReport | null) {
  const rows = headerRows(p).map((r) => sheetRow(p, r, cables, panel));
  const buy = new Map<string, number>();
  for (const r of rows) for (const b of r.buy) { const m = /^(\d+) × (.*)$/.exec(b); const q = m ? +m[1] : 1, k = m ? m[2] : b; buy.set(k, (buy.get(k) ?? 0) + q); }
  return { rows, buy: [...buy].map(([item, qty]) => `${qty} × ${item}`), guess: rows.some((r) => r.guess) };
}
