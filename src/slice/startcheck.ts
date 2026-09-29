// Checking a Bambu Lab printer's own start, end and layer-change code before BoardDock trusts it. It comes from outside
// (pasted, opened from a profile file, or read from the user's slicer) and goes into every plate's G-code, where a wrong
// move or temperature can drive the nozzle into the printer's frame or overheat it. So it is filled in the way it will
// be printed and read back move by move, and used only when it looks like start code for this printer. The rules are
// BoardDock's own (nothing of Bambu's is copied); the limits are printers.ts'. Pure.
import type { Material, PrinterSettings } from '../model/types';
import { filamentOn, printerByName } from '../model/printers';
import { bambuVars, renderTemplate, type TplValue } from './bambutpl';

type Own = NonNullable<PrinterSettings['bambu']>;
/** `stop`: it can't be used as it is; otherwise the user reads it and may accept it (Own.ok holds the ids accepted). */
export interface Finding { id: string; stop: boolean; text: string }

/**
 * How far past the bed's edge the nozzle may go before code can't be this printer's (mm). Bambu's own start code goes
 * off the bed to reach its wipe and purge spot: Kiri:Moto's A1 profile reaches 48 mm past the left edge and 6.5 past the
 * back, its end code 11 past the right, the P1S's 3 past the front (measured on those profiles; none is the A1 mini's).
 * More than that is allowed on the left and front, where wipers sit (65), and less on the right and back (30): a
 * bigger printer's spots (the 256 mm printers' are 80 to 90 mm past a 180 mm bed) are well past both.
 */
const PAST_LOW = 65, PAST_HIGH = 30;
/** Print moves a start code may have (its prime and purge lines: the A1 profile has 12) and lines a layer change may have (the profiles' have 9). */
const MOVES_MAX = 60, LINES_MAX = 1500, LAYER_LINES_MAX = 40;
/** What a slicer writes into a print's own body, never into start code. */
const BODY = /^\s*;\s*(TYPE:|FEATURE:|LAYER_CHANGE|CHANGE_LAYER|LAYER:\s*\d|HEADER_BLOCK_START|CONFIG_BLOCK_START|EXECUTABLE_BLOCK_START|start printing object|WIPE_START|;? ?--- layer)/im;

const BOXES = [['start', 'The start code'], ['end', 'The end code'], ['layer', 'The layer change code']] as const;

interface Scan {
  lines: number; // lines with G-code on them
  printing: number; // moves in X or Y that push filament out
  x: [number, number]; y: [number, number]; z: [number, number]; // farthest the nozzle goes on each axis (Infinity, -Infinity if never known)
  nozzle: number[]; bed: number[]; // every target set with M104/M109 and M140/M190, in order
  homes: boolean;
  waits: number; // heat-and-wait commands that set a target above 0 (M109, M190)
}

/** Read G-code a move at a time: where the nozzle goes (absolute or relative moves), what it is heated to. */
function scan(text: string): Scan {
  const s: Scan = { lines: 0, printing: 0, x: [Infinity, -Infinity], y: [Infinity, -Infinity], z: [Infinity, -Infinity], nozzle: [], bed: [], homes: false, waits: 0 };
  const at = { X: NaN, Y: NaN, Z: NaN }, box = { X: s.x, Y: s.y, Z: s.z };
  let rel = false;
  for (const raw of text.split('\n')) {
    const code = raw.split(';')[0].trim().toUpperCase();
    if (!code) continue;
    s.lines++;
    const [g, ...ws] = code.split(/\s+/);
    const p: Record<string, number> = {};
    for (const w of ws) { const v = Number(w.slice(1)); if (!Number.isNaN(v)) p[w[0]] = v; }
    if (g === 'G90') rel = false;
    else if (g === 'G91') rel = true;
    else if (g === 'G28') { s.homes = true; at.X = at.Y = at.Z = NaN; }
    else if (g === 'G92') { for (const k of ['X', 'Y', 'Z'] as const) if (p[k] != null) at[k] = p[k]; }
    else if (g === 'G0' || g === 'G1' || g === 'G2' || g === 'G3') {
      for (const k of ['X', 'Y', 'Z'] as const) {
        if (p[k] == null) continue;
        at[k] = rel ? at[k] + p[k] : p[k];
        if (!Number.isNaN(at[k])) { box[k][0] = Math.min(box[k][0], at[k]); box[k][1] = Math.max(box[k][1], at[k]); }
      }
      if (p.E > 0 && (p.X != null || p.Y != null)) s.printing++;
    } else if ((g === 'M104' || g === 'M109') && p.S != null) { s.nozzle.push(p.S); if (g === 'M109' && p.S > 0) s.waits++; }
    else if ((g === 'M140' || g === 'M190') && p.S != null) { s.bed.push(p.S); if (g === 'M190' && p.S > 0) s.waits++; }
  }
  return s;
}

// Names of printers, to tell whose code this is. Longer names first, each match blanked so "A1" isn't found in "A1 mini".
const B = (re: string) => new RegExp(`(?<![A-Za-z0-9])(?:${re})(?![A-Za-z0-9])`, 'gi');
const MODELS: [string, RegExp][] = [
  ['Bambu Lab A1 mini', B('A1[ _-]?mini')],
  ['Bambu Lab A1', B('A1')],
  ['Bambu Lab X1 Carbon', B('X1[ _-]?(?:Carbon|C)')],
  ['Bambu Lab X1E', B('X1E')],
  ['Bambu Lab P1S', B('P1S')],
  ['Bambu Lab P1P', B('P1P')],
  ['Bambu Lab H2D', B('H2[DSC]')],
  ["a printer from another maker", B('Prusa|Creality|Ender|Voron|Elegoo|Anycubic|Sovol|Qidi|Klipper')],
];
function modelsIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const [name, re] of MODELS) text = text.replace(re, () => { found.add(name); return ' '; });
  return found;
}
const comments = (t: string) => t.split('\n').flatMap((l) => (l.includes(';') ? [l.slice(l.indexOf(';'))] : [])).join('\n');
const short = (name: string) => name.replace(/^Bambu Lab /, '');

/**
 * What is wrong, or worth a look, in code a user gave for this printer, filled in as it will be printed. `extra`: more
 * places the code came from (file names, the profile's own name), which may name a printer.
 */
export function checkOwnCode(own: Own, ps: PrinterSettings, mat: Material, extra: string[] = []): Finding[] {
  const pr = printerByName(ps.name), name = pr?.name ?? ps.name, me = short(name);
  const out: Finding[] = [];
  const add = (id: string, stop: boolean, text: string) => { if (!out.some((f) => f.id === id)) out.push({ id, stop, text }); };
  const [W, D] = ps.bed, H = ps.maxZ ?? pr?.maxZ;
  const maxNozzle = pr?.maxNozzle ?? 300, maxBed = pr?.maxBed ?? 120;
  if (own.for && own.for !== ps.name) add('printer', true, `This code was loaded for the ${short(own.for)}, and the printer is now the ${me}: it is not this printer's.`);
  // whose it says it is: the file names and profile name it came from say so for certain, its own comments only hint
  const wrong = (found: Set<string>) => [...found].filter((n) => n !== name);
  const from = modelsIn([own.from, ...extra].join('\n'));
  if (pr && wrong(from).length && !from.has(name)) add('from', true, `It came from the ${wrong(from).map(short).join(' and ')} profile, not the ${me}'s.`);
  const sample = (m: Material): Record<string, TplValue> => bambuVars(ps, m, { x0: W * 0.2, y0: D * 0.2, x1: W * 0.7, y1: D * 0.7, z1: 30, layers: 150 });
  for (const [box, label] of BOXES) {
    const src = own[box];
    if (!src?.trim()) { if (box === 'start') add('start:empty', true, 'The start code is empty. A print needs it to heat, home and prime the printer.'); continue; }
    const id = (rule: string) => `${box}:${rule}`;
    const named = modelsIn(comments(src));
    if (pr && wrong(named).length && !named.has(name)) add(id('model'), false, `${label} mentions the ${wrong(named).map(short).join(' and ')} in a comment and never the ${me}. Check it is the ${me}'s.`);
    let text: string, cold: string;
    try {
      const r = renderTemplate(src, { ...sample(mat), layer_num: 3, layer_z: 0.8 });
      if (r.unknown.length) { add(id('names'), true, `${label} uses ${r.unknown.join(', ')}, which BoardDock can't fill in yet. Slice this plate in Bambu Studio or OrcaSlicer, or take those lines out.`); continue; }
      text = r.text;
      cold = renderTemplate(src, { ...sample('PLA'), layer_num: 3, layer_z: 0.8 }).text; // the coolest filament: any heat above the printer's limit is in the code itself
    } catch (e) { add(id('render'), true, `${label} has a mistake in it: ${(e as Error).message}.`); continue; }
    const s = scan(text), c = scan(cold);
    if (box === 'start' && !s.lines) add('start:empty', true, 'The start code has nothing in it but comments and blank lines. A print needs it to heat, home and prime the printer.');
    else if (box === 'start') {
      const marker = BODY.exec(src)?.[1];
      if (marker || s.printing > MOVES_MAX || s.lines > LINES_MAX) add('start:body', true, `${label} looks like part of a sliced file, not start code: ${marker ? `it has "${marker.trim()}" notes of the kind a slicer writes into a print` : s.printing > MOVES_MAX ? `it has ${s.printing} printing moves (start code has a few for its purge lines)` : `it is ${s.lines} lines long`}. Check you copied "Machine start G-code" from the printer's settings.`);
      if ((s.nozzle.length && s.nozzle[s.nozzle.length - 1] === 0) || (s.bed.length && s.bed[s.bed.length - 1] === 0)) add('start:end', true, `${label} switches a heater off as its last heater command: that is end code, not start code. Check you didn't copy "Machine end G-code" here.`);
      else {
        if (!s.bed.some((t) => t > 0)) add('start:bed', true, `${label} never heats the bed (no M140 or M190 above 0).`);
        if (!s.nozzle.some((t) => t > 0)) add('start:nozzle', true, `${label} never heats the nozzle (no M104 or M109 above 0).`);
      }
      if (!s.homes) add('start:home', false, `${label} never homes the printer (no G28), so the printer can't know where its nozzle is.`);
      const last = [...s.nozzle].reverse().find((t) => t > 0), f = filamentOn(pr, mat);
      if (last != null && (last < f.range[0] || last > f.range[1])) add('start:range', false, `${label} ends by heating the nozzle to ${last} °C, but ${mat} prints at ${f.range[0]} to ${f.range[1]} °C.`);
    } else if (box === 'end') {
      if (BODY.test(src) || s.printing > MOVES_MAX) add('end:body', true, `${label} looks like part of a sliced file, not end code.`);
      if (s.waits) add('end:heats', false, `${label} heats something up and waits for it: that is what start code does. Check you copied "Machine end G-code" here.`);
    } else if (s.homes || s.waits || s.lines > LAYER_LINES_MAX) {
      add('layer:long', true, `${label} runs at every layer, but this one ${s.homes ? 'homes the printer' : s.waits ? 'heats and waits' : `is ${s.lines} lines long`}. Check you copied "Layer change G-code" and not something else.`);
    }
    const hot = Math.max(...c.nozzle, -Infinity), warm = Math.max(...c.bed, -Infinity);
    if (hot > maxNozzle) add(id('hot'), true, `${label} heats the nozzle to ${hot} °C, past the ${me}'s ${maxNozzle} °C.`);
    if (warm > maxBed) add(id('hotbed'), true, `${label} heats the bed to ${warm} °C, past the ${me}'s ${maxBed} °C.`);
    // where the nozzle goes: off the bed a little is Bambu's wipe and purge spot; a long way off is another printer's bed
    const edges: [string, number, number, number][] = [['X', s.x[0], 0, PAST_LOW], ['X', s.x[1], W, PAST_HIGH], ['Y', s.y[0], 0, PAST_LOW], ['Y', s.y[1], D, PAST_HIGH]];
    const past: string[] = [], far: string[] = [];
    for (const [axis, v, edge, most] of edges) {
      if (!Number.isFinite(v)) continue;
      const by = edge ? v - edge : edge - v; // how far past this edge
      const side = axis === 'X' ? (edge ? 'right' : 'left') : (edge ? 'back' : 'front');
      const words = `${axis} ${Math.round(v * 10) / 10} (${Math.round(by * 10) / 10} mm past the ${side} edge)`;
      if (by > most) far.push(words);
      else if (by > 1) past.push(words);
    }
    if (far.length) add(id('reach'), true, `${label} moves the nozzle to ${far.join(' and ')}: farther than the ${me} reaches (${W} × ${D} mm bed). That looks like a bigger printer's code.`);
    else if (past.length) add(id('past'), false, `${label} moves the nozzle off the bed: ${past.join(', ')}. Bambu's own code does this to reach its wipe and purge spot, so it is expected in the ${me}'s own code and a warning sign in another printer's.`);
    if (H != null && s.z[1] > H + 1) add(id('height'), true, `${label} lifts the nozzle to Z ${Math.round(s.z[1] * 10) / 10}, above the ${me}'s ${H} mm height.`);
    if (s.z[0] < -3) add(id('low'), true, `${label} lowers the nozzle to Z ${Math.round(s.z[0] * 10) / 10}, into the bed.`);
  }
  return out;
}

/** May the code be used: nothing that stops it, and the user has accepted everything that asks for a look. */
export const ownUsable = (own: Own, found: Finding[]) => found.every((f) => !f.stop && own.ok?.includes(f.id));

/** One line for why code isn't used, for an error message. */
export const whyNot = (own: Own, found: Finding[]) => found.filter((f) => f.stop || !own.ok?.includes(f.id)).map((f) => f.text).join(' ');

/** The printer's own code held in the project, if it may be used (else why not). Only Bambu printers have any. */
export function usableCode(ps: PrinterSettings, mat: Material): { own?: Own; why?: string } {
  const own = ps.bambu;
  if (!own || printerByName(ps.name)?.firmware !== 'bambu') return {};
  const found = checkOwnCode(own, ps, mat);
  return ownUsable(own, found) ? { own } : { why: whyNot(own, found) };
}
