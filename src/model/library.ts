// Reference data: connectors and their mating plugs, package size heuristics, materials, printers, defaults.
// Dimensions are typical catalogue values; every one is editable in the app because real parts vary.
import { PRINTERS_DB, printerByName } from './printers';
import { applyHoleRoles } from './holes';
import { DEBUG_HINT, numberLinks } from './links';
import type { ArrangeSettings, Board, Comp, CompKind, ConnSetup, HolderSettings, Material, Module, MountSettings, PanelSettings, PlugSpec, PrinterSettings, Project, StandSettings } from './types';

export interface ConnType {
  id: string;
  name: string;
  entry: 'edge' | 'top';
  body: { w: number; l: number; h: number }; // receptacle: w across the mouth, l along the insertion axis, h above board
  zc: number; // plug axis above the board surface
  overhang: number; // typical overhang of the receptacle past the board edge
  plug: PlugSpec;
  match: RegExp;
  cradle: boolean; // sensible default
  note?: string;
}

// Order matters: first match wins, so specific names come before generic ones.
export const CONNECTORS: ConnType[] = [
  { id: 'usb_c', name: 'USB-C', entry: 'edge', body: { w: 8.94, l: 7.35, h: 3.26 }, zc: 1.63, overhang: 0.6, plug: { w: 12.4, h: 6.6, len: 22, cable: 4 }, match: /usb[\s_-]?c\b|type[\s_-]?c|usb_?c_|usbc|usb4|gct_usb4/i, cradle: true },
  { id: 'usb_micro_b', name: 'USB Micro-B', entry: 'edge', body: { w: 7.5, l: 5.3, h: 2.8 }, zc: 1.4, overhang: 0.6, plug: { w: 11, h: 7.5, len: 20, cable: 3.5 }, match: /micro[\s_-]?usb|usb[\s_-]?micro|microusb|micro[\s_-]?b/i, cradle: true },
  { id: 'usb_mini_b', name: 'USB Mini-B', entry: 'edge', body: { w: 7.7, l: 9.2, h: 3.9 }, zc: 2.0, overhang: 0.8, plug: { w: 12, h: 8, len: 22, cable: 4 }, match: /mini[\s_-]?usb|usb[\s_-]?mini|mini[\s_-]?b/i, cradle: true },
  { id: 'usb_a_dual', name: 'USB-A (stacked x2)', entry: 'edge', body: { w: 13.1, l: 17.5, h: 15.6 }, zc: 7.8, overhang: 2.5, plug: { w: 16, h: 17, len: 32, cable: 4.5 }, match: /usb[\s_-]?a.*(dual|stack|x2|2x)|dual.*usb/i, cradle: false },
  { id: 'usb_a', name: 'USB-A', entry: 'edge', body: { w: 13.1, l: 14, h: 7 }, zc: 3.5, overhang: 1.5, plug: { w: 16, h: 8.5, len: 32, cable: 4.5 }, match: /usb[\s_-]?a\b|usb_a|type[\s_-]?a/i, cradle: true },
  { id: 'usb_b', name: 'USB-B', entry: 'edge', body: { w: 12, l: 16.3, h: 10.9 }, zc: 5.5, overhang: 6.3, plug: { w: 16, h: 13, len: 32, cable: 5 }, match: /usb[\s_-]?b\b|usb_b/i, cradle: true },
  { id: 'hdmi_micro', name: 'Micro HDMI (D)', entry: 'edge', body: { w: 6.5, l: 7, h: 3 }, zc: 1.5, overhang: 0.5, plug: { w: 11, h: 7, len: 26, cable: 5 }, match: /micro[\s_-]?hdmi|hdmi[\s_-]?micro|hdmi[\s_-]?d\b/i, cradle: true },
  { id: 'hdmi_mini', name: 'Mini HDMI (C)', entry: 'edge', body: { w: 11.2, l: 7.5, h: 3.2 }, zc: 1.6, overhang: 0.5, plug: { w: 15, h: 8, len: 30, cable: 6 }, match: /mini[\s_-]?hdmi|hdmi[\s_-]?mini|hdmi[\s_-]?c\b/i, cradle: true },
  { id: 'hdmi_a', name: 'HDMI (A)', entry: 'edge', body: { w: 15, l: 11, h: 5.6 }, zc: 2.8, overhang: 0.5, plug: { w: 21, h: 11, len: 38, cable: 7 }, match: /hdmi/i, cradle: true },
  { id: 'rj45', name: 'RJ45 / Ethernet', entry: 'edge', body: { w: 16, l: 21, h: 13.5 }, zc: 6.8, overhang: 2.5, plug: { w: 14, h: 13, len: 30, cable: 6 }, match: /rj[\s_-]?45|8p8c|ethernet|magjack|hr911/i, cradle: false, note: 'The plug latch holds it; add a cable tie anchor for strain relief.' },
  { id: 'barrel', name: 'DC barrel jack 5.5/2.1', entry: 'edge', body: { w: 9, l: 14, h: 11 }, zc: 6.5, overhang: 1.5, plug: { w: 10, h: 10, len: 32, cable: 3.5 }, match: /barrel|dc[\s_-]?jack|pj[\s_-]?0\d\d|dc[\s_-]?0\d\d|power[\s_-]?jack|bar(rel)?_?jack/i, cradle: true },
  { id: 'audio35', name: '3.5 mm audio jack', entry: 'edge', body: { w: 6, l: 12, h: 5 }, zc: 2.5, overhang: 1.0, plug: { w: 8.5, h: 8.5, len: 25, cable: 3.5 }, match: /3\.5\s?mm|audio|trs|pj[\s_-]?3\d\d|phone[\s_-]?jack|headphone/i, cradle: true },
  { id: 'microsd', name: 'microSD slot', entry: 'edge', body: { w: 11.5, l: 14, h: 1.9 }, zc: 0.9, overhang: 0, plug: { w: 14, h: 6, len: 8, cable: 0 }, match: /micro[\s_-]?sd|tf[\s_-]?card|sd[\s_-]?card|microsd/i, cradle: false, note: 'Opening sized for card access and a fingertip, no cradle.' },
  { id: 'sma', name: 'SMA / RP-SMA (edge)', entry: 'edge', body: { w: 6.4, l: 10, h: 6.4 }, zc: 0, overhang: 7, plug: { w: 9, h: 9, len: 16, cable: 3 }, match: /\bsma\b|sma_|rp[\s_-]?sma|bnc/i, cradle: false },
  { id: 'qwiic', name: 'JST-SH / Qwiic (side)', entry: 'edge', body: { w: 6, l: 4.3, h: 2.9 }, zc: 1.5, overhang: 0, plug: { w: 6.5, h: 3.5, len: 6, cable: 3 }, match: /qwiic|stemma|jst[\s_-]?sh|sm0\dB-SRSS|bm0\dB-SRSS/i, cradle: false },
  { id: 'terminal', name: 'Screw terminal block', entry: 'edge', body: { w: 10.2, l: 7.5, h: 10 }, zc: 3, overhang: 0, plug: { w: 10, h: 4, len: 15, cable: 2 }, match: /terminal[\s_-]?block|screw[\s_-]?terminal|kf301|kf128|mstb|mkds|tb\d|wago|phoenix/i, cradle: false, note: 'Wires only: add a tie anchor.' },
  { id: 'jst_xh', name: 'JST-XH (top entry)', entry: 'top', body: { w: 9.9, l: 5.75, h: 7 }, zc: 0, overhang: 0, plug: { w: 9.9, h: 5.75, len: 12, cable: 2 }, match: /jst[\s_-]?xh|b\dB-XH|xh[\s_-]?\d/i, cradle: false },
  { id: 'jst_ph', name: 'JST-PH (top entry)', entry: 'top', body: { w: 7.9, l: 4.5, h: 6 }, zc: 0, overhang: 0, plug: { w: 7.9, h: 4.5, len: 10, cable: 2 }, match: /jst[\s_-]?ph|b\dB-PH|ph[\s_-]?\d/i, cradle: false },
  // debug connectors: a probe (J-Link, ST-Link) plugs in from above with an IDC socket on a ribbon
  { id: 'swd10', name: 'Debug 10-pin (Cortex, 1.27 mm)', entry: 'top', body: { w: 12.7, l: 5.8, h: 5.6 }, zc: 0, overhang: 0, plug: { w: 12.4, h: 5.4, len: 5.5, cable: 1 }, match: /$^/, cradle: false, note: 'A J-Link plugs in with its 10-pin ribbon (the 20-to-10-pin adapter on a 20-pin J-Link).' },
  { id: 'jtag20', name: 'Debug 20-pin (JTAG, 2.54 mm)', entry: 'top', body: { w: 33.2, l: 8.9, h: 9 }, zc: 0, overhang: 0, plug: { w: 31, h: 7.6, len: 6.5, cable: 1.2 }, match: /$^/, cradle: false, note: "A J-Link's own 20-pin ribbon plugs straight in." },
  { id: 'tagconnect', name: 'Tag-Connect pads', entry: 'top', body: { w: 10, l: 5, h: 0.1 }, zc: 0, overhang: 0, plug: { w: 10, h: 5, len: 22, cable: 1 }, match: /$^/, cradle: false, note: 'Pads only: the Tag-Connect cable clips onto the board from above.' },
  { id: 'header', name: 'Pin header (Dupont)', entry: 'top', body: { w: 10.2, l: 2.54, h: 8.5 }, zc: 0, overhang: 0, plug: { w: 10.2, h: 2.54, len: 14, cable: 1.5 }, match: /pin[\s_-]?header|pin[\s_-]?socket|conn_\d+x\d+|header_\d|idc|box[\s_-]?header|^[12]x\d\d\b|pinhd/i, cradle: false },
  { id: 'pins_ra', name: 'Pin header, right-angle (Dupont)', entry: 'edge', body: { w: 15.24, l: 2.5, h: 2.5 }, zc: 1.27, overhang: 0, plug: { w: 15.2, h: 2.5, len: 14, cable: 1.4 }, match: /$^/, cradle: false, note: 'Jumper wires push onto its pins one by one.' },
  { id: 'ac_au', name: 'Mains outlet, AU/NZ', entry: 'top', body: { w: 36, l: 36, h: 0.5 }, zc: 0, overhang: 0, plug: { w: 34, h: 26, len: 24, cable: 7.5 }, match: /$^/, cradle: false },
  { id: 'ac_uk', name: 'Mains outlet, UK', entry: 'top', body: { w: 42, l: 42, h: 0.5 }, zc: 0, overhang: 0, plug: { w: 44, h: 30, len: 26, cable: 7.5 }, match: /$^/, cradle: false },
  { id: 'ac_us', name: 'Mains outlet, US', entry: 'top', body: { w: 36, l: 36, h: 0.5 }, zc: 0, overhang: 0, plug: { w: 32, h: 24, len: 22, cable: 7 }, match: /$^/, cradle: false },
  { id: 'ac_eu', name: 'Mains outlet, EU (Schuko)', entry: 'top', body: { w: 44, l: 44, h: 0.5 }, zc: 0, overhang: 0, plug: { w: 38, h: 38, len: 26, cable: 8 }, match: /$^/, cradle: false },
  { id: 'mains_lead', name: 'Mains lead (fixed)', entry: 'edge', body: { w: 10, l: 10, h: 10 }, zc: 0, overhang: 0, plug: { w: 12, h: 12, len: 22, cable: 7.5 }, match: /$^/, cradle: false },
  { id: 'iec_c7', name: 'Mains (figure-8, C7)', entry: 'edge', body: { w: 11.5, l: 12, h: 8 }, zc: 4, overhang: 0, plug: { w: 13, h: 9, len: 30, cable: 6 }, match: /iec[\s_-]?60320|figure[\s_-]?8/i, cradle: false },
  { id: 'custom', name: 'Custom connector', entry: 'edge', body: { w: 10, l: 8, h: 5 }, zc: 2.5, overhang: 0.5, plug: { w: 12, h: 8, len: 20, cable: 4 }, match: /$^/, cradle: true },
];

export const connById = (id: string) => CONNECTORS.find((c) => c.id === id) ?? CONNECTORS[CONNECTORS.length - 1];

export function connSetup(type: ConnType, angle: number): ConnSetup {
  return {
    type: type.id,
    entry: type.entry,
    angle,
    zc: type.zc,
    plug: { ...type.plug },
    cradle: type.cradle,
    cap: type.cradle,
    guard: !type.cradle && type.entry === 'edge',
    tie: !type.cradle || type.entry === 'top',
  };
}

// ---- package size heuristics (footprint / package name -> body size) ----
const CHIP: Record<string, [number, number, number]> = {
  '01005': [0.4, 0.2, 0.15], '0201': [0.6, 0.3, 0.3], '0402': [1.0, 0.5, 0.4], '0603': [1.6, 0.8, 0.5], '0805': [2.0, 1.25, 0.6],
  '1206': [3.2, 1.6, 0.7], '1210': [3.2, 2.5, 0.7], '1812': [4.5, 3.2, 1.0], '2010': [5.0, 2.5, 0.7], '2512': [6.4, 3.2, 0.7],
};

export interface PkgGuess { w: number; l: number; h: number; kind?: CompKind; tht?: boolean; conn?: ConnType }

const num = (s: string | undefined) => (s ? parseFloat(s.replace(',', '.')) : NaN);

/** Guess body size and kind from a footprint/package name and reference designator. */
export function guessPackage(pkg: string, ref = '', value = ''): PkgGuess {
  const name = `${pkg} ${value}`;
  const p = pkg.toUpperCase();
  let g: PkgGuess = { w: 3, l: 3, h: 2 };
  const imperial = p.match(/(?:^|[^0-9])(01005|0201|0402|0603|0805|1206|1210|1812|2010|2512)(?:[^0-9]|$)/);
  if (imperial) {
    const [w, l, h] = CHIP[imperial[1]];
    g = { w, l, h };
  }
  let m;
  if ((m = p.match(/SOT-?23-?(\d)?/))) g = { w: 2.9, l: 2.4, h: 1.1 };
  if (/SOT-?223/.test(p)) g = { w: 6.5, l: 7, h: 1.8, kind: 'hot' };
  if (/SOT-?89/.test(p)) g = { w: 4.5, l: 4.2, h: 1.6 };
  if (/TO-?252|DPAK/.test(p)) g = { w: 6.6, l: 10, h: 2.4, kind: 'hot' };
  if (/TO-?263|D2PAK/.test(p)) g = { w: 10.2, l: 15, h: 4.6, kind: 'hot' };
  if (/TO-?220/.test(p)) g = { w: 10.2, l: 4.6, h: 16, kind: 'hot', tht: true };
  if (/TO-?92/.test(p)) g = { w: 4.8, l: 3.8, h: 5, tht: true };
  if ((m = p.match(/(?:SOIC|SOP|SO)-?(\d+)/)) && !/SOT/.test(p)) g = { w: 6, l: 1.27 * (+m[1] / 2) + 0.4, h: 1.75 };
  if ((m = p.match(/(?:TSSOP|MSOP|SSOP)-?(\d+)/))) g = { w: 6.4, l: 0.65 * (+m[1] / 2) + 0.6, h: 1.2 };
  if ((m = p.match(/DIP-?(\d+)/))) g = { w: 7.62 + 1.5, l: 2.54 * (+m[1] / 2) + 0.5, h: 5, tht: true };
  if ((m = p.match(/(?:QFN|DFN|LQFP|TQFP|QFP|BGA|LGA)-?\d*[_-](\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)/))) g = { w: num(m[1]), l: num(m[2]), h: /LQFP|TQFP|QFP/.test(p) ? 1.6 : 1.0 };
  // KiCad-style explicit sizes
  if ((m = p.match(/_L(\d+(?:\.\d+)?)MM_W(\d+(?:\.\d+)?)MM/))) g = { ...g, w: num(m[1]), l: num(m[2]) };
  else if ((m = p.match(/(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)(?:X(\d+(?:\.\d+)?))?MM/))) g = { ...g, w: num(m[1]), l: num(m[2]), h: m[3] ? num(m[3]) : g.h };
  if ((m = p.match(/_D(\d+(?:\.\d+)?)MM/))) g = { ...g, w: num(m[1]), l: num(m[1]), h: num(m[1]) * 1.4 };
  if ((m = p.match(/_H(\d+(?:\.\d+)?)MM/))) g = { ...g, h: num(m[1]) };
  if (/CP_RADIAL|C_RADIAL|ELEC/.test(p)) g = { ...g, tht: /RADIAL/.test(p) || g.tht, kind: 'generic' };
  if ((m = p.match(/PIN(?:HEADER|SOCKET)_(\d+)X(\d+)_P(\d+(?:\.\d+)?)MM/))) {
    const rows = +m[1], cols = +m[2], pitch = num(m[3]);
    g = { w: pitch * cols, l: pitch * rows, h: /SOCKET/.test(p) ? 8.5 : 8.5, tht: true, kind: 'header', conn: connById('header') };
    if (/HORIZONTAL/.test(p)) g.h = 2.5 + pitch;
  }
  if (/MOUNTINGHOLE|MOUNTING_HOLE|MTG|FIDUCIAL/.test(p)) g = { w: 0, l: 0, h: 0 };
  if (/ESP32|ESP8266|WROOM|WROVER|NINA|RFM9|BLE|NRF52.*MODULE|RP2040.*ZERO/.test(p + ' ' + name.toUpperCase())) g = { ...g, kind: 'antenna', h: Math.max(g.h, 3.2) };
  if (/LED/.test(p) || /^LED/i.test(ref)) g = { ...g, kind: 'led' };
  if (/^(SW|S|BTN|KEY)\d/i.test(ref) || /SW_|SWITCH|TACT|BUTTON|PUSH/.test(p)) g = { ...g, kind: 'switch', h: Math.max(g.h, 3.5) };
  if (/INDUCTOR|^L_|CRYSTAL|XTAL/.test(p)) g = { ...g, h: Math.max(g.h, 2) };
  // a debug header (SWD / JTAG) by its shape or its name: a probe plugs in there
  const dbg = debugType(pkg, ref, value);
  if (dbg) { const t = connById(dbg); return { w: t.body.w, l: t.body.l, h: t.body.h, kind: 'connector', tht: dbg !== 'tagconnect' && !/smd/i.test(pkg), conn: t }; }
  // connectors
  const isConnRef = /^(J|P|CN|X|USB|CON|JP)\d/i.test(ref);
  const hit = CONNECTORS.find((c) => c.id !== 'custom' && c.match.test(name));
  if (hit && (isConnRef || hit.id !== 'header' || g.kind === 'header')) {
    const keepSize = hit.entry === 'top' && g.w > 0 && g.kind === 'header';
    g = {
      w: keepSize ? g.w : hit.body.w, l: keepSize ? g.l : hit.body.l, h: keepSize ? g.h : hit.body.h,
      kind: hit.entry === 'top' && hit.id === 'header' ? 'header' : 'connector', tht: g.tht ?? /usb[\s_-]?[ab]\b|rj45|barrel|jack|terminal|header/i.test(name), conn: hit,
    };
  } else if (isConnRef && !g.kind) g = { ...g, kind: 'connector', conn: connById('custom') };
  return g;
}

/**
 * The debug connector a footprint is, if any (debugType() picks them; their `match` never does): Tag-Connect pads;
 * a 2 x 5 header at 1.27 mm (the Cortex debug connector, whatever it is called); or a 10 or 20-pin header whose
 * name, value or reference says JTAG / SWD / debug. Other headers named for debug (a 1 x 4 SWD header) stay pin
 * headers: jumper wires go there, and they still count as a debug port.
 */
export function debugType(pkg: string, ref = '', value = ''): 'swd10' | 'jtag20' | 'tagconnect' | null {
  const text = `${pkg} ${value} ${ref}`;
  if (/tag[\s_-]?connect|tc20[35]0/i.test(text)) return 'tagconnect';
  const grid = pkg.match(/(\d+)x(\d+)/i);
  const rows = grid ? +grid[1] : 0, pins = grid ? rows * +grid[2] : 0;
  const pitch = /1\.27/.test(pkg) ? 1.27 : /2\.54/.test(pkg) ? 2.54 : 0;
  if (/ftsh[\s_-]?105/i.test(pkg) || (pins === 10 && rows === 2 && pitch === 1.27)) return 'swd10';
  if (!DEBUG_HINT.test(text)) return null;
  const n = pins || +(text.match(/(?:_|\b)(10|20)(?:[\s_-]?pins?)?\b/i)?.[1] ?? 0);
  if (n === 10 && pitch !== 2.54) return 'swd10';
  if (n === 20 && pitch !== 1.27) return 'jtag20';
  return null;
}

/** A reference that says connector: J1, P3, CN2, X4, CON1, JP2, HDR1. */
export const CONN_REF = /^(J|P|CN|X|USB|CON|JP|HDR)\d/i;

/**
 * A header's pins as a grid, from where they are: one or two rows, all pitches the same (2.54, 2.0 or 1.27 mm), every
 * place filled. Mounting and shield pads (not numbered) are left out. Null when the pins are not a header's.
 */
export function pinGrid(pins: Comp['pins']): { rows: number; cols: number; pitch: number } | null {
  const ps = (pins ?? []).filter((q) => /^\d+$/.test(q.n));
  if (ps.length < 2 || ps.length > 80) return null;
  // along the rows: the pins' main axis (their spread's longest direction)
  const mx = ps.reduce((t, p) => t + p.x, 0) / ps.length, my = ps.reduce((t, p) => t + p.y, 0) / ps.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of ps) { sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; sxy += (p.x - mx) * (p.y - my); }
  const t = 0.5 * Math.atan2(2 * sxy, sxx - syy), a = { x: mx, y: my };
  const u = [Math.cos(t), Math.sin(t)], v = [-u[1], u[0]];
  const cluster = (xs: number[], tol: number) => { const out: number[] = []; for (const x of [...xs].sort((m, n) => m - n)) if (!out.length || x - out[out.length - 1] > tol) out.push(x); return out; };
  let near = Infinity;
  for (const p of ps) for (const q of ps) if (p !== q) near = Math.min(near, Math.hypot(p.x - q.x, p.y - q.y));
  const pitch = [2.54, 2.0, 1.27].find((t) => Math.abs(near - t) < 0.08);
  if (!pitch) return null;
  const along = cluster(ps.map((p) => (p.x - a.x) * u[0] + (p.y - a.y) * u[1]), pitch / 3);
  const across = cluster(ps.map((p) => (p.x - a.x) * v[0] + (p.y - a.y) * v[1]), pitch / 3);
  if (across.length > 2 || along.length * across.length !== ps.length) return null;
  const even = (xs: number[]) => xs.every((x, i) => i === 0 || Math.abs(x - xs[i - 1] - pitch) < 0.1);
  return even(along) && even(across) ? { rows: across.length, cols: along.length, pitch } : null;
}

/** Nets that say debug (SWD or JTAG) or serial, on a header's pins. */
const DEBUG_NETS = /(^|[^a-z])(swdio|swclk|swdclk|swo|tms|tck|tdi|tdo|n?trst)([^a-z]|$)/i;
const UART_NETS = /(^|[^a-z])(u?art\d?_?)?(txd?|rxd?)\d?([^a-z]|$)/i;

/**
 * A connector known by its pins when its name says nothing BoardDock knows (an Allegro footprint's "CON10" or
 * "HDR2X5"): a 2 x 5 header at 1.27 mm is the 10-pin debug connector, a 2 x 10 at 2.54 mm with JTAG nets the 20-pin
 * one, and any other one or two-row header a pin header, marked for debug or serial when its nets say so.
 */
function byPins(c: Comp, g: PkgGuess): { conn: ConnType; kind: CompKind; role?: string; w: number; l: number } | null {
  if (!c.pins || (g.conn && g.conn.id !== 'custom' && g.conn.id !== 'header')) return null;
  if (!g.conn && !CONN_REF.test(c.ref)) return null;
  const grid = pinGrid(c.pins);
  if (!grid) return null;
  const n = grid.rows * grid.cols, nets = c.pins.map((q) => q.net ?? '').join(' ');
  const dbg = DEBUG_NETS.test(nets), uart = !dbg && UART_NETS.test(nets) && n <= 8;
  if (grid.rows === 2 && n === 10 && grid.pitch === 1.27) return { conn: connById('swd10'), kind: 'connector', w: 12.7, l: 5.8 };
  if (dbg && grid.rows === 2 && n === 20 && grid.pitch === 2.54) return { conn: connById('jtag20'), kind: 'connector', w: 33.2, l: 8.9 };
  return { conn: connById('header'), kind: 'header', ...(dbg ? { role: 'debug' } : uart ? { role: 'uart' } : {}), w: grid.pitch * grid.cols, l: grid.pitch * grid.rows };
}

/** Fill in kind / connector setup for a component from its names, or its pins where the names say nothing known. Keeps sizes that are already known. */
export function classify(c: Comp, sizeKnown: boolean, boardEdgeAngle?: number): Comp {
  let g = guessPackage(c.pkg, c.ref, c.value);
  const pinned = byPins(c, g);
  if (pinned) {
    g = { ...g, w: pinned.w, l: pinned.l, h: pinned.conn.id === 'header' ? 8.5 : pinned.conn.body.h, kind: pinned.kind, tht: true, conn: pinned.conn };
    if (pinned.role && !c.role) c = { ...c, role: pinned.role };
  }
  const out: Comp = { ...c, kind: g.kind ?? c.kind ?? 'generic', tht: c.tht || !!g.tht };
  if (!sizeKnown) {
    out.w = g.w || 1;
    out.l = g.l || 1;
  }
  if (!c.h || !sizeKnown) out.h = g.h;
  if (g.conn && !c.conn) {
    out.conn = connSetup(g.conn, boardEdgeAngle ?? 0); // importers aim edge connectors at the nearest edge afterwards
  }
  return out;
}

// ---- materials ----
export interface MaterialProps { E: number; nu: number; strainAllow: number; yield: number; density: number; tg: number }
export const MATERIALS: Record<Material, MaterialProps> = {
  // Typical printed values (E in MPa, yield in MPa, density g/cm3, softening point C). Printed parts vary a lot.
  PLA: { E: 3500, nu: 0.35, strainAllow: 0.015, yield: 50, density: 1.24, tg: 55 },
  PETG: { E: 2100, nu: 0.38, strainAllow: 0.02, yield: 45, density: 1.27, tg: 75 },
  ABS: { E: 2200, nu: 0.35, strainAllow: 0.02, yield: 40, density: 1.04, tg: 95 },
  ASA: { E: 2000, nu: 0.35, strainAllow: 0.02, yield: 40, density: 1.07, tg: 95 },
  PA: { E: 1800, nu: 0.39, strainAllow: 0.03, yield: 45, density: 1.14, tg: 70 },
  PC: { E: 2300, nu: 0.37, strainAllow: 0.025, yield: 55, density: 1.2, tg: 110 },
};

export const PRINTERS: PrinterSettings[] = PRINTERS_DB.map((x) => ({ name: x.name, bed: x.bed, spacing: 6, maxZ: x.maxZ }));

export const DEFAULT_HOLDER: HolderSettings = {
  wall: 1.8, base: 2.0, gap: 0.3, wallAbove: 0.8, standoff: null, minStandoff: 3, leadLen: 1.8,
  pattern: 'hex', cell: 10, rib: 1.8, tabs: 'auto', tabLip: 0.7, notches: true, label: '', chamfer: true, pinClear: 0.15, material: 'PETG', style: 'frame',
};

export const DEFAULT_FEATURES = { cradles: true, caps: true, ties: true, guards: true };

/** Holder presets: sturdier walls, or lean for faster prints and less filament. */
export const HOLDER_PRESETS: Record<'sturdy' | 'balanced' | 'lean', Partial<HolderSettings>> = {
  sturdy: { style: 'tray', wall: 2.4, base: 2.4, pattern: 'hex', cell: 9, rib: 2.2, wallAbove: 1.2, chamfer: true },
  balanced: { style: 'frame', wall: 1.8, base: 2.0, pattern: 'hex', cell: 10, rib: 1.8, wallAbove: 0.8, chamfer: true },
  lean: { style: 'frame', wall: 1.6, base: 1.6, pattern: 'hex', cell: 14, rib: 1.6, wallAbove: 0.4, chamfer: false },
};

export const DEFAULT_MOUNT: MountSettings = { kind: 'din', mode: 'flat', rotation: 0, edge: 'bottom', clipWidth: 14, tabSide: 'down', railT: 1.0, at: null };

export const DEFAULT_STAND: StandSettings = {
  enabled: false, shape: 'round', size: 10, depth: 12, fit: 'slip', clearance: 0.3, axis: 'edge', edge: 'bottom', offset: 0, wall: 3,
};

export const DEFAULT_ARRANGE: ArrangeSettings = { mode: 'stack', stackGap: 3, sideGap: 0.4, sideAxis: 'x', links: true };

export const DEFAULT_PANEL: PanelSettings = { auto: true, rowDir: 'h', pairs: true, gap: 2, maxRail: 400, rowGap: 25, stands: true, rails: [], mounts: [] };

export function newModule(board: Board, holder?: HolderSettings): Module {
  applyHoleRoles(board, [], false);
  return { id: Math.random().toString(36).slice(2, 9), board, holder: { ...(holder ?? DEFAULT_HOLDER), label: board.name.slice(0, 24) }, original: structuredClone(board) };
}

export function newProject(board: Board): Project {
  return {
    version: 3,
    modules: [newModule(board)],
    active: 0,
    layout: 'panel',
    panel: structuredClone(DEFAULT_PANEL),
    arrange: { ...DEFAULT_ARRANGE },
    mount: { ...DEFAULT_MOUNT },
    stand: { ...DEFAULT_STAND },
    printer: { ...PRINTERS[0] },
  };
}

/** Upgrade older project files (single board) to the current format. */
export function migrate(p: any): Project {
  if (p && p.version === 1 && p.board) {
    p = { version: 2, modules: [{ id: 'm0', board: p.board, holder: p.holder }], active: 0, arrange: { ...DEFAULT_ARRANGE }, mount: p.mount, stand: p.stand, printer: p.printer };
  }
  if (!p?.modules?.length) throw new Error('Not a BoardDock project file');
  // a switch's or powered hub's barrel input was saved as a plug that leaves the rack: it is a DC input (its supply goes on the rack)
  for (const m of p.modules) {
    const s = m.board?.box;
    if (m.board?.kind !== 'box' || !s?.groups || !/switch|hub/i.test(m.board.name ?? '')) continue;
    for (const g of s.groups) if (g.type === 'barrel' && g.role === 'other') { g.role = 'power-in-dc'; g.volts ??= 12; }
    for (const c of m.board.comps ?? []) if (c.conn?.type === 'barrel' && c.role === 'other') c.role = 'power-in-dc';
  }
  // v2 -> v3: boards go onto DIN rail docks, laid out automatically
  return {
    ...p,
    version: 3,
    layout: p.layout ?? 'panel',
    panel: { ...structuredClone(DEFAULT_PANEL), ...(p.panel ?? {}) },
    arrange: { ...DEFAULT_ARRANGE, ...(p.arrange ?? {}) },
    active: Math.min(p.active ?? 0, p.modules.length - 1),
    links: numberLinks(p.links ?? []),
    // printers saved under an older combined name get the matching one from the list, with its build height
    printer: ((pr) => (pr ? { ...p.printer, name: pr.name, maxZ: pr.maxZ } : p.printer ?? { ...PRINTERS[0] }))(printerByName(p.printer?.name ?? '')),
  };
}

/**
 * Switch between DIN rail docks and loose holders. Loose holders start without the DIN clip (they are loose because
 * there is no rail), unless it was switched on or off by hand before.
 */
export function setLayout(p: Project, layout: Project['layout']) {
  p.layout = layout;
  if (layout === 'loose' && !p.mount.picked) p.mount.kind = 'none';
  // loose holders start side by side (a stack of towers is a choice, not a surprise)
  if (layout === 'loose' && !p.arrange.picked) p.arrange.mode = 'side';
}

/** Ports that only matter with a screen or speakers plugged in: what a headless board (a Pi run over the network) can do without. */
const SCREEN_PORTS = ['hdmi_micro', 'hdmi_mini', 'hdmi_a', 'audio35'];

/** Screen and audio ports that have a cradle but no cable, on every board (not boxes), as module id and ref. */
export function headlessCradles(p: Project): { module: string; ref: string }[] {
  const cabled = new Set((p.links ?? []).flatMap((l) => [l.a, l.b].map((e) => `${e.module}/${e.ref.replace(/:2$/, '')}`)));
  return p.modules.flatMap((m) => (m.board.kind === 'box' ? [] : m.board.comps
    .filter((c) => c.conn && !c.hidden && c.conn.cradle && SCREEN_PORTS.includes(c.conn.type) && !cabled.has(`${m.id}/${c.ref}`))
    .map((c) => ({ module: m.id, ref: c.ref }))));
}

/** Run the boards headless: drop the cradles (and so the caps) of their unused screen and audio ports. */
export function makeHeadless(p: Project): number {
  const drop = headlessCradles(p);
  for (const d of drop) {
    const c = p.modules.find((m) => m.id === d.module)?.board.comps.find((x) => x.ref === d.ref);
    if (c?.conn) { c.conn.cradle = false; c.conn.cap = false; c.conn.use = 'no'; } // no screen: they stay empty
  }
  return drop.length;
}

export const activeModule = (p: Project): Module => p.modules[Math.min(p.active, p.modules.length - 1)];
