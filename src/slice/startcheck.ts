// Checking a Bambu Lab printer's own start, end and layer-change code before BoardDock trusts it. It comes from outside
// (pasted, opened from a profile file, or read from the user's slicer) and goes into every plate's G-code, where a wrong
// move or temperature can drive the nozzle into the printer's frame or overheat it. So it is filled in the way it will
// be printed and read back move by move, and used only when it looks like start code for this printer. The rules are
// BoardDock's own (nothing of Bambu's is copied); the limits are printers.ts'. Pure.
// Start and end code typed into the Export step for any other printer (or over a Bambu printer's Kiri:Moto profile) gets
// the same treatment in checkPlainCode: it is Kiri:Moto's {temp} and {bed_temp} kind of code, so it is filled in with the
// filament's temperatures and read the same way.
import type { Material, PrinterSettings } from '../model/types';
import { filamentOn, printerByName, type Printer } from '../model/printers';
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
  cmds: Set<string>; // every command word seen (G28, M104, START_PRINT...)
}

/** Read G-code a move at a time: where the nozzle goes (absolute or relative moves), what it is heated to. */
function scan(text: string): Scan {
  const s: Scan = { lines: 0, printing: 0, x: [Infinity, -Infinity], y: [Infinity, -Infinity], z: [Infinity, -Infinity], nozzle: [], bed: [], homes: false, waits: 0, cmds: new Set() };
  const at = { X: NaN, Y: NaN, Z: NaN }, box = { X: s.x, Y: s.y, Z: s.z };
  let rel = false;
  for (const raw of text.split('\n')) {
    const code = raw.split(';')[0].trim().toUpperCase();
    if (!code) continue;
    s.lines++;
    const [g, ...ws] = code.split(/\s+/);
    s.cmds.add(g);
    const p: Record<string, number> = {};
    for (const w of ws) { const v = Number(w.slice(1)); if (!Number.isNaN(v)) p[w[0]] = v; }
    if (g === 'SET_HEATER_TEMPERATURE') { // Klipper: SET_HEATER_TEMPERATURE HEATER=extruder TARGET=210
      const t = Number(/TARGET=([-\d.]+)/.exec(code)?.[1]);
      if (!Number.isNaN(t)) (/HEATER=HEATER_BED|HEATER=BED/.test(code) ? s.bed : s.nozzle).push(t);
    } else if (g === 'G90') rel = false;
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
    } else if (g === 'M104' || g === 'M109') { const t = p.S ?? (g === 'M109' ? p.R : undefined); if (t != null) { s.nozzle.push(t); if (g === 'M109' && t > 0) s.waits++; } }
    else if (g === 'M140' || g === 'M190') { const t = p.S ?? (g === 'M190' ? p.R : undefined); if (t != null) { s.bed.push(t); if (g === 'M190' && t > 0) s.waits++; } }
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
function modelsIn(text: string, models = MODELS): Set<string> {
  const found = new Set<string>();
  for (const [name, re] of models) text = text.replace(re, () => { found.add(name); return ' '; });
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
  else if (!own.for) add('printer:unknown', false, `It doesn't say which printer it was loaded for (it was kept by an older version of BoardDock). Check it is the ${me}'s, or load it again.`);
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
export const ownUsable = (own: Own | { ok?: string[] }, found: Finding[]) => found.every((f) => !f.stop && own.ok?.includes(f.id));

/** One line for why code isn't used, for an error message. */
export const whyNot = (own: Own | { ok?: string[] }, found: Finding[]) => found.filter((f) => f.stop || !own.ok?.includes(f.id)).map((f) => f.text).join(' ');

/** The printer's own code held in the project, if it may be used (else why not). Only Bambu printers have any. */
export function usableCode(ps: PrinterSettings, mat: Material): { own?: Own; why?: string } {
  const own = ps.bambu;
  if (!own || printerByName(ps.name)?.firmware !== 'bambu') return {};
  const found = checkOwnCode(own, ps, mat);
  return ownUsable(own, found) ? { own } : { why: whyNot(own, found) };
}

// ---- start and end code typed in for Kiri:Moto (any printer that isn't using its own code)

/** What Kiri:Moto fills in for {name} in start and end code (its engine's own list). */
const KIRI_NAMES = new Set(['temp', 'temp_bed', 'bed_temp', 'fan_speed', 'fan_speed_base', 'speed', 'nozzle', 'tool', 'layer', 'layers', 'z_max', 'minx', 'maxx', 'miny', 'maxy', 'top', 'left', 'right', 'bottom', 'progress', 'total_time', 'remain_time', 'model_labels', 'retract_speed', 'retract_distance', 'travel_speed', 'oid', 'oname']);
/** Commands only a Bambu Lab printer knows (its AMS, its own leveling and its lidar). */
const BAMBU_ONLY = new Set(['M1002', 'M1004', 'M1005', 'M1006', 'M1007', 'M620', 'M621', 'M622', 'M623', 'M975', 'M976', 'M977', 'M981', 'M991']);
/** How far past the bed's edge start code may go on a printer that isn't a Bambu: Prusa's prime line is 3 mm in front; 25 mm and more is another printer's bed. */
const PLAIN_QUIET = 4, PLAIN_FAR = 25;
/** Nozzle and bed limits when the printer's maker's aren't known, and how far a bed target may be from the filament's. */
const NOZZLE_DEFAULT = 300, BED_DEFAULT = 120, BED_OFF = 30;

// Printers named in comments, the Bambu ones and other makers': whose code this says it is.
const PLAIN_MODELS: [string, RegExp][] = [
  ...MODELS.slice(0, 7),
  ['Prusa CORE One', B('CORE[ _-]?One')],
  ['Prusa XL', B('Prusa[ _-]?XL')],
  ['Prusa MK3', B('MK3S?\\+?|MK2S?')],
  ['Prusa MK4', B('MK4S?')],
  ['Prusa MINI', B('MINI\\+?')],
  ['Creality K1', B('K1[CM]?')],
  ['Creality Ender-3', B('Ender[ _-]?3?')],
  ['Voron', B('Voron')],
  ['Elegoo Neptune', B('Neptune')],
  ['Anycubic Kobra', B('Kobra')],
  ['Sovol SV06', B('SV06')],
  ['Qidi', B('Qidi|Q1[ _-]?Pro')],
];
const isMine = (label: string, pr: Printer) => (label.startsWith('Bambu Lab') ? label === pr.name : !pr.name.startsWith('Bambu') && new RegExp(PLAIN_MODELS.find(([n]) => n === label)![1].source, 'i').test(pr.name));

/** The code's {names} filled in as Kiri:Moto would, for reading it. `unknown`: names (and Orca/Prusa [names]) it can't fill in. */
function fillKiri(src: string, temp: number, bed: number): { text: string; unknown: string[] } {
  const unknown: string[] = [];
  const text = src.split('\n').map((line) => {
    const i = line.indexOf(';'), code = i < 0 ? line : line.slice(0, i);
    const filled = code.replace(/\{([^{}]*)\}/g, (m, k: string) => {
      const n = k.trim();
      if (/^[A-Za-z_]+$/.test(n)) { if (KIRI_NAMES.has(n)) return n === 'temp' ? String(temp) : n === 'bed_temp' || n === 'temp_bed' ? String(bed) : n === 'z_max' ? '30' : n === 'layers' ? '100' : '0'; }
      else if (/layer/.test(n) && !/^(if|elsif|else|endif)\b/.test(n)) return '0'; // Kiri's { layer == 0 } and {layer-1}
      unknown.push(m);
      return '?';
    }).replace(/\[[A-Za-z_]\w*\]/g, (m) => { unknown.push(m); return '?'; });
    return filled + (i < 0 ? '' : line.slice(i));
  }).join('\n');
  return { text, unknown };
}

/**
 * What is wrong, or worth a look, in the start and end code typed in for a printer (Export › G-code › Start and end
 * G-code): the rules for a Bambu printer's own code, for Kiri:Moto's kind of code ({temp} and {bed_temp} for the
 * filament's temperatures). Moves are read against the bed, heater targets against the filament and the printer, and it
 * has to look like this printer's, and like start (or end) code. An empty box is the profile's own code and isn't checked.
 */
export function checkPlainCode(ps: PrinterSettings, mat: Material, code: { start?: string; end?: string }): Finding[] {
  const pr = printerByName(ps.name), name = pr?.name ?? ps.name;
  const out: Finding[] = [];
  const add = (id: string, stop: boolean, text: string) => { if (!out.some((f) => f.id === id)) out.push({ id, stop, text }); };
  const [W, D] = ps.bed, H = ps.maxZ ?? pr?.maxZ;
  const maxNozzle = pr?.maxNozzle ?? NOZZLE_DEFAULT, maxBed = pr?.maxBed ?? BED_DEFAULT;
  const f = filamentOn(pr, mat), bambu = pr?.firmware === 'bambu';
  for (const [box, label] of [['start', 'The start code'], ['end', 'The end code']] as const) {
    const src = code[box];
    if (!src?.trim()) continue;
    const id = (rule: string) => `${box}:${rule}`;
    const r = fillKiri(src, f.nozzle, f.bed);
    if (r.unknown.length) { add(id('names'), true, `${label} uses ${[...new Set(r.unknown)].join(', ')}, which the slicer here doesn't fill in (it fills in {temp} and {bed_temp}). Put the numbers in, or slice this plate in your own slicer.`); continue; }
    const s = scan(r.text);
    // whose it says it is
    const foreign = [...s.cmds].filter((c) => BAMBU_ONLY.has(c));
    if (!bambu && foreign.length) add(id('bambu'), true, `${label} uses ${foreign.join(', ')}, which only a Bambu Lab printer knows: that is a Bambu Lab printer's code, and this printer is the ${name}.`);
    const macros = [...s.cmds].filter((c) => !/^[GMT]\d/.test(c) && c !== 'SET_HEATER_TEMPERATURE');
    if (pr?.firmware === 'marlin' && macros.length) add(id('klipper'), false, `${label} uses ${macros.slice(0, 3).join(', ')}, which look like Klipper commands, and the ${name} runs Marlin. Check they are its own.`);
    if (pr) {
      // (a Bambu printer's own profile code says P1S or A1 whichever of them it is: only other makers count there)
      const all = [...modelsIn(comments(src), PLAIN_MODELS)].filter((n) => !bambu || !n.startsWith('Bambu Lab')), named = all.filter((n) => !isMine(n, pr));
      if (named.length && named.length === all.length) add(id('model'), false, `${label} mentions the ${named.map(short).join(' and ')} in a comment and never the ${name}. Check it is the ${name}'s.`);
    }
    if (box === 'start') {
      const marker = BODY.exec(src)?.[1];
      if (marker || s.printing > MOVES_MAX || s.lines > LINES_MAX) add('start:body', true, `${label} looks like part of a sliced file, not start code: ${marker ? `it has "${marker.trim()}" notes of the kind a slicer writes into a print` : s.printing > MOVES_MAX ? `it has ${s.printing} printing moves (start code has a few for its purge lines)` : `it is ${s.lines} lines long`}. Check you copied the start code from the printer's settings.`);
      if (!s.lines) add('start:empty', true, 'The start code has nothing in it but comments and blank lines. A print needs it to heat, home and prime the printer.');
      else if (!macros.length) { // (a macro such as START_PRINT sets the temperatures itself)
        if ((s.nozzle.length && s.nozzle[s.nozzle.length - 1] === 0) || (s.bed.length && s.bed[s.bed.length - 1] === 0)) add('start:end', true, `${label} switches a heater off as its last heater command: that is end code, not start code. Check you didn't copy the end code here.`);
        else {
          if (!s.bed.some((t) => t > 0)) add('start:bed', true, `${label} never heats the bed (no M140 or M190 above 0).`);
          if (!s.nozzle.some((t) => t > 0)) add('start:nozzle', true, `${label} never heats the nozzle (no M104 or M109 above 0).`);
        }
      }
      if (s.lines && !s.homes && !macros.length) add('start:home', false, `${label} never homes the printer (no G28), so the printer can't know where its nozzle is.`);
      const last = [...s.nozzle].reverse().find((t) => t > 0), warm = [...s.bed].reverse().find((t) => t > 0);
      if (last != null && (last < f.range[0] || last > f.range[1])) add('start:range', false, `${label} ends by heating the nozzle to ${last} °C, but ${mat} prints at ${f.range[0]} to ${f.range[1]} °C.`);
      if (warm != null && Math.abs(warm - f.bed) > BED_OFF) add('start:bedrange', false, `${label} ends by heating the bed to ${warm} °C, but ${mat} wants about ${f.bed} °C.`);
    } else {
      if (BODY.test(src) || s.printing > MOVES_MAX) add('end:body', true, `${label} looks like part of a sliced file, not end code.`);
      if (s.waits) add('end:heats', false, `${label} heats something up and waits for it: that is what start code does. Check you copied the end code here.`);
    }
    const hot = Math.max(...s.nozzle, -Infinity), hotBed = Math.max(...s.bed, -Infinity);
    if (hot > maxNozzle) add(id('hot'), true, `${label} heats the nozzle to ${hot} °C, past the ${name}'s ${maxNozzle} °C${pr?.maxNozzle ? '' : ' (what most printers stop at)'}.`);
    if (hotBed > maxBed) add(id('hotbed'), true, `${label} heats the bed to ${hotBed} °C, past the ${name}'s ${maxBed} °C${pr?.maxBed ? '' : ' (what most printers stop at)'}.`);
    // where the nozzle goes: the bed's edge, and a few mm past it for a prime line; well off it is another printer's bed
    // (Bambu's profile code goes 48 mm past the left edge to its wipe spot: no note for that)
    const low = bambu ? PAST_LOW : PLAIN_FAR, high = bambu ? PAST_HIGH : PLAIN_FAR, quiet = bambu ? 50 : PLAIN_QUIET;
    const edges: [string, number, number, number][] = [['X', s.x[0], 0, low], ['X', s.x[1], W, high], ['Y', s.y[0], 0, low], ['Y', s.y[1], D, high]];
    const past: string[] = [], far: string[] = [];
    for (const [axis, v, edge, most] of edges) {
      if (!Number.isFinite(v)) continue;
      const by = edge ? v - edge : edge - v;
      const side = axis === 'X' ? (edge ? 'right' : 'left') : (edge ? 'back' : 'front');
      const words = `${axis} ${Math.round(v * 10) / 10} (${Math.round(by * 10) / 10} mm past the ${side} edge)`;
      if (by > most) far.push(words);
      else if (by > quiet) past.push(words);
    }
    if (far.length) add(id('reach'), true, `${label} moves the nozzle to ${far.join(' and ')}: farther than the ${name} reaches (${W} × ${D} mm bed). That looks like a bigger printer's code.`);
    else if (past.length) add(id('past'), false, `${label} moves the nozzle off the bed: ${past.join(', ')}. Check that is where your ${name} purges or parks.`);
    if (H != null && s.z[1] > H + 1) add(id('height'), true, `${label} lifts the nozzle to Z ${Math.round(s.z[1] * 10) / 10}, above the ${name}'s ${H} mm height.`);
    if (s.z[0] < -3) add(id('low'), true, `${label} lowers the nozzle to Z ${Math.round(s.z[0] * 10) / 10}, into the bed.`);
  }
  return out;
}

/** The start and end code typed in for the printer, if there is any: what the check found, and why it isn't used (unset when it is). */
export function usablePlain(ps: PrinterSettings, mat: Material): { found: Finding[]; why?: string } {
  if (!ps.gcodeStart?.trim() && !ps.gcodeEnd?.trim()) return { found: [] };
  const found = checkPlainCode(ps, mat, { start: ps.gcodeStart, end: ps.gcodeEnd }), ok = { ok: ps.gcodeOk };
  return ownUsable(ok, found) ? { found } : { found, why: whyNot(ok, found) };
}
