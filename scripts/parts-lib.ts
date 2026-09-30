// The engine behind `npm run parts` (scripts/parts.mjs is the command line): reads every JSON file in parts/, checks it,
// and produces the compact data the app reads (src/model/parts.json) plus a report saying what each file does. Nothing
// here is bundled into the app. See parts/README.md (people) and parts/AGENTS.md (AI jobs).
//
// Two kinds of file in parts/:
//   names-<anything>.json   part numbers or footprint names that mean an existing connector type
//   type-<id>.json          a new connector type: size, plug, wiring role, and a look built from simple shapes
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALSO, CONNECTORS, connById, sizedConn } from '../src/model/library';
import { CONTRIB_TYPES, LOOK_MATS, WIRING_ROLES, globRegex, sizeHint, toConnType, type LookShape, type NameGroup, type PartsData, type TypeDef } from '../src/model/contributed';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const inRange = (v: unknown, lo: number, hi: number): v is number => isNum(v) && v >= lo && v <= hi;
const isInt = (v: unknown, lo: number, hi: number): v is number => inRange(v, lo, hi) && Number.isInteger(v);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** The library's own connector types (the contributed ones are not: a contribution may not reuse their ids, but it may replace them by regenerating). */
const builtinTypes = () => CONNECTORS.filter((c) => !CONTRIB_TYPES.some((x) => x.id === c.id));
const builtinIds = () => builtinTypes().map((c) => c.id);

// ---- names ----

/** Parts that are no connector and must never be read as one: a name that would also match one of these is refused. */
const NOT_CONNECTORS = ['R_0603_1608Metric', 'C_0402_1005Metric', 'LED_0805_2012Metric', 'SOT-23-5', 'SOIC-8_3.9x4.9mm_P1.27mm', 'TSSOP-16', 'QFN-32-1EP_5x5mm_P0.5mm', 'D_SMA', 'DO-214AC_SMA', 'TB6612FNG', 'ESP32-WROOM-32', 'STM32F103C8T6', 'AMS1117-3.3', 'Crystal_SMD_3225-4Pin', 'Fuse_1206_3216Metric', 'L_1210_3225Metric', 'Battery_CR2032', 'SW_PUSH_6mm', 'Relay_THT_Omron_G5LE', 'HDMI_ESD_TPD12S016', 'FT232RL', 'USB2514B'];
let corpus: string[] | undefined;
/** The list above, and the rows marked "-" (no connector at all) in tests/connector-names.tsv, the names sample the library is tested against. */
function notConnectors(): string[] {
  if (corpus) return corpus;
  corpus = [...NOT_CONNECTORS];
  try {
    const rows = fs.readFileSync(fileURLToPath(new URL('../tests/connector-names.tsv', import.meta.url)), 'utf8').split('\n');
    for (const l of rows) if (l.startsWith('-\t')) corpus.push(l.split('\t')[1]);
  } catch { /* no sample next to the scripts: the list above only */ }
  return corpus;
}
/** Words too general to name any connector, even on a connector's reference. */
const GENERIC = new Set(['connector', 'conn', 'jack', 'plug', 'socket', 'port', 'header', 'pin', 'pins', 'input', 'output', 'power', 'data', 'signal', 'male', 'female', 'cable', 'wire', 'board']);

/**
 * What is wrong with one name (a part number or footprint name, `*` and `?` allowed), or null. A name that is only a
 * plain word (HDMI, Ethernet, SMA) is refused unless `weak`: such words also name chips and diodes, so the library counts
 * them only on a connector's reference (J1, CN2, HDMI1), which is what "weak" asks for.
 */
export function checkName(n: unknown, weak = false): string | null {
  if (typeof n !== 'string') return 'is not text';
  if (n !== n.trim()) return 'has spaces at its start or end';
  if (!n) return 'is empty';
  if (n.length > 60) return 'is longer than 60 characters';
  if (!/^[A-Za-z0-9 _.+()/#:,*?-]+$/.test(n)) return 'has a character other than letters, digits, space and _ . - + ( ) / # : , * ?';
  const core = n.replace(/[*?]/g, '').replace(/^[\s_.:/,+()#-]+|[\s_.:/,+()#-]+$/g, '');
  if (weak) {
    if (core.length < 3) return 'is too short for a weak name (3 characters at least)';
    if (GENERIC.has(core.toLowerCase())) return `"${core}" is far too general: it would make every part with a J reference and that word a connector of this type`;
    return null;
  }
  if (core.length < 4) return `is too short: only ${core.length} character${core.length === 1 ? '' : 's'} besides * and ?, which would match parts that are no connector. Give a longer part number or footprint name`;
  if (/^[A-Za-z]+$/.test(core)) return `is a plain word ("${core}"): chips, diodes and modules carry such words too. Give a part number or a footprint name, or list it under "weak" (then it only counts on a connector's reference such as J1, CN2 or ${core.toUpperCase()}1)`;
  if (/^\d+$/.test(core) && core.length < 5) return 'is a bare short number, which turns up in many part names. Give the whole part number or footprint name';
  let re: RegExp;
  try { re = globRegex([n]); } catch { return 'cannot be used as a pattern'; }
  const bad = notConnectors().find((x) => re.test(x));
  return bad ? `would also match "${bad}", which is no connector. Make it longer or more exact` : null;
}

/** The built-in connector type a name already means (without any contribution), or undefined. */
function builtinSays(name: string): string | undefined {
  const t = name.replace(/[*?]/g, 'X');
  const spaced = t.replace(/_/g, ' ');
  const says = (r?: RegExp) => !!r && (r.test(t) || r.test(spaced));
  return builtinTypes().find((c) => c.id !== 'custom' && says(c.match))?.id ?? ALSO.find(([r]) => says(r))?.[1];
}

const norm = (n: string) => n.toLowerCase().replace(/[\s_-]+/g, '-');
const NAME_KEYS = ['type', 'names', 'weak', 'pins', 'rows', 'pitch', 'note', 'source'];

// ---- one file ----

interface Ctx { ids: Set<string>; seen: Map<string, { type: string; file: string; weak: boolean }>; errors: string[]; warnings: string[] }

/** The names of a group (or of a type file), checked; the ones that pass. */
function checkNames(list: unknown, weak: boolean, type: string, where: string, file: string, ctx: Ctx, lines: string[]): string[] {
  if (list === undefined) return [];
  if (!Array.isArray(list)) { ctx.errors.push(`${file}: ${where} must be a list of names such as ["ACME-1234", "ACME-12*"]`); return []; }
  const ok: string[] = [];
  list.forEach((n, i) => {
    const bad = checkName(n, weak);
    if (bad) { ctx.errors.push(`${file}: ${where}[${i}] ${JSON.stringify(n)} ${bad}`); return; }
    const key = `${weak ? 'w:' : ''}${norm(n)}`, prev = ctx.seen.get(key);
    if (prev && prev.type !== type) { ctx.errors.push(`${file}: ${where}[${i}] "${n}" is also given for type ${prev.type} in ${prev.file}: one name cannot mean two types`); return; }
    if (prev) { ctx.warnings.push(`${file}: ${where}[${i}] "${n}" is listed twice (also in ${prev.file})`); return; }
    ctx.seen.set(key, { type, file, weak });
    if (!weak) {
      const b = builtinSays(n);
      if (b === type) ctx.warnings.push(`${file}: "${n}" is already recognised as ${type} by the library's own patterns: not needed`);
      else if (b) ctx.warnings.push(`${file}: the library's own patterns read "${n}" as ${b}; this file makes it ${type} (yours wins)`);
    }
    ok.push(n);
  });
  lines.push(...ok.map((n) => `    ${weak ? 'weak ' : 'name '} ${n}`));
  return ok;
}

function checkGroup(g: unknown, at: string, file: string, ctx: Ctx, lines: string[]): NameGroup | null {
  if (!isObj(g)) { ctx.errors.push(`${file}: ${at} must be an object such as { "type": "rj45", "names": ["ACME-1234"] }`); return null; }
  const before = ctx.errors.length;
  for (const k of Object.keys(g)) if (!NAME_KEYS.includes(k)) ctx.errors.push(`${file}: ${at} has unknown key "${k}" (keys: ${NAME_KEYS.join(', ')})`);
  const type = g.type;
  if (typeof type !== 'string' || !ctx.ids.has(type) || type === 'custom') ctx.errors.push(`${file}: ${at} has type ${JSON.stringify(type)}; use one of: ${[...ctx.ids].filter((x) => x !== 'custom').join(', ')} (npm run parts -- --types says what each is)`);
  if (g.names === undefined && g.weak === undefined) ctx.errors.push(`${file}: ${at} has neither "names" nor "weak": list the part numbers or footprint names it is for`);
  if (g.pins !== undefined && !isInt(g.pins, 1, 80)) ctx.errors.push(`${file}: ${at}.pins must be a whole number of contacts, 1 to 80`);
  if (g.rows !== undefined && !(g.rows === 1 || g.rows === 2)) ctx.errors.push(`${file}: ${at}.rows must be 1 or 2`);
  if (g.rows !== undefined && g.pins === undefined) ctx.errors.push(`${file}: ${at}.rows needs "pins"`);
  if (g.pitch !== undefined && !inRange(g.pitch, 0.4, 12)) ctx.errors.push(`${file}: ${at}.pitch must be the distance between contacts in mm, 0.4 to 12`);
  for (const k of ['note', 'source']) if (g[k] !== undefined && (typeof g[k] !== 'string' || g[k].length > 300)) ctx.errors.push(`${file}: ${at}.${k} must be text of at most 300 characters`);
  if (ctx.errors.length > before) return null;
  const names = checkNames(g.names, false, type, `${at}.names`, file, ctx, lines), weak = checkNames(g.weak, true, type, `${at}.weak`, file, ctx, lines);
  if (ctx.errors.length > before) return null;
  const out: NameGroup = { type };
  if (names.length) out.names = names;
  if (weak.length) out.weak = weak;
  if (g.pins !== undefined) {
    out.pins = g.pins;
    if (g.rows !== undefined) out.rows = g.rows;
    if (g.pitch !== undefined) out.pitch = g.pitch;
    // (does the width of this type follow its pins? a type whose width is fixed ignores them, and a file that says otherwise is misleading)
    const t = builtinTypes().find((x) => x.id === type) ?? (ctx.ids.has(type) ? undefined : connById(type));
    if (t && sizedConn(t, `${sizeHint({ type, weak: false, pins: g.pins, rows: g.rows, pitch: g.pitch }, false)}X`).body.w === t.body.w) ctx.warnings.push(`${file}: ${at}: the width of ${type} does not follow its pins, so "pins" and "pitch" change nothing there`);
  } else if (g.pitch !== undefined) ctx.warnings.push(`${file}: ${at}.pitch is used only together with "pins"`);
  if (!out.names && !out.weak) return null;
  return out;
}

const TYPE_KEYS = ['id', 'label', 'plugName', 'entry', 'body', 'plug', 'zc', 'overhang', 'tht', 'role', 'offRack', 'cradle', 'note', 'source', 'look', 'names', 'weak'];
const SHAPES = ['box', 'mouth', 'barrel', 'pins'];

/** The look of a type: every shape checked against the body, and the shapes together must fill it (the toolbox says the body's size). */
function checkLook(look: unknown, body: { w: number; l: number; h: number }, file: string, errors: string[]): LookShape[] | null {
  if (!Array.isArray(look) || !look.length || look.length > 12) { errors.push(`${file}: "look" must be a list of 1 to 12 shapes: box, mouth, barrel, pins (parts/README.md shows each)`); return null; }
  const n0 = errors.length, out: LookShape[] = [];
  const { w, l, h } = body;
  const ext = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z1: -Infinity };
  const grow = (x0: number, x1: number, y0: number, y1: number, z1: number) => { ext.x0 = Math.min(ext.x0, x0); ext.x1 = Math.max(ext.x1, x1); ext.y0 = Math.min(ext.y0, y0); ext.y1 = Math.max(ext.y1, y1); ext.z1 = Math.max(ext.z1, z1); };
  const frac = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every((x) => inRange(x, 0, 1));
  const mat = (v: unknown) => (LOOK_MATS as readonly string[]).includes(v as string);
  let solids = 0;
  look.forEach((s, i) => {
    const at = `look[${i}]`, e = (m: string) => errors.push(`${file}: ${at} ${m}`);
    if (!isObj(s)) return e('must be an object such as { "box": "metal", "from": [0, 0, 0], "to": [1, 1, 1] }');
    const kind = SHAPES.filter((k) => k in s);
    if (kind.length !== 1) return e(`must have exactly one of ${SHAPES.map((k) => `"${k}"`).join(', ')}`);
    const k = kind[0], allowed: Record<string, string[]> = { box: ['box', 'from', 'to'], mouth: ['mouth', 'at', 'size', 'depth'], barrel: ['barrel', 'at', 'd', 'y', 'bore'], pins: ['pins', 'n', 'pitch', 'd', 'at', 'len', 'axis'] };
    for (const key of Object.keys(s)) if (!allowed[k].includes(key)) e(`has unknown key "${key}" (a ${k} has: ${allowed[k].join(', ')})`);
    if (k !== 'mouth' && !mat(s[k])) e(`"${k}" must be a material: ${LOOK_MATS.join(', ')}`);
    if (k === 'box') {
      if (!frac(s.from, 3) || !frac(s.to, 3)) return e('"from" and "to" must be [x, y, z] as fractions of the body, each 0 to 1');
      if (![0, 1, 2].every((j) => s.to[j] > s.from[j])) return e('"to" must be larger than "from" in x, y and z');
      solids++;
      grow(s.from[0] * w, s.to[0] * w, s.from[1] * l, s.to[1] * l, s.to[2] * h);
    } else if (k === 'mouth') {
      if (s.mouth !== 'rect' && s.mouth !== 'round') e('"mouth" must be "rect" or "round"');
      if (!frac(s.at, 2)) e('"at" must be [x, z] as fractions of the width and height, each 0 to 1');
      if (!(Array.isArray(s.size) && s.size.length === 2 && s.size.every((x: unknown) => inRange(x, 0.05, 0.95)))) e('"size" must be [width, height] as fractions of the body, each 0.05 to 0.95');
      if (!inRange(s.depth, 0.05, 1)) e('"depth" must be a fraction of the length, 0.05 to 1');
      if (!solids) e('cuts into the shapes before it, and there is none yet: put a box (the housing) first');
    } else if (k === 'barrel') {
      if (!frac(s.at, 2)) return e('"at" must be [x, z] as fractions of the width and height, each 0 to 1');
      if (!inRange(s.d, 0.05, 1)) return e('"d" (the diameter) must be a fraction of the smaller of width and height, 0.05 to 1');
      if (!(frac(s.y, 2) && s.y[1] > s.y[0])) return e('"y" must be [from, to] along the length, as fractions, "to" larger');
      if (s.bore !== undefined && !inRange(s.bore, 0.05, 0.95)) e('"bore" must be the hollow\'s diameter as a fraction of the barrel\'s, 0.05 to 0.95');
      const r = (s.d * Math.min(w, h)) / 2, cx = s.at[0] * w, cz = s.at[1] * h;
      if (cx - r < -0.05 || cx + r > w + 0.05 || cz - r < -0.05 || cz + r > h + 0.05) return e(`sticks out of the body (a ${r2(2 * r)} mm barrel at x ${r2(cx)}, z ${r2(cz)} mm in a ${w} x ${h} mm face): make "d" smaller or move "at"`);
      solids++;
      grow(cx - r, cx + r, s.y[0] * l, s.y[1] * l, cz + r);
    } else {
      const up = (s.axis ?? 'z') === 'z';
      if (!isInt(s.n, 1, 40)) e('"n" must be a whole number of pins, 1 to 40');
      if (!inRange(s.pitch, 0.5, 10)) e('"pitch" must be the distance between pins in mm, 0.5 to 10');
      if (!inRange(s.d, 0.1, 3)) e('"d" (the pin\'s width) must be in mm, 0.1 to 3');
      if (!frac(s.at, 3)) e('"at" must be [x, y, z] as fractions of the body, each 0 to 1');
      if (!inRange(s.len, 0.02, 1)) e('"len" must be the pins\' length as a fraction, 0.02 to 1');
      if (s.axis !== undefined && s.axis !== 'y' && s.axis !== 'z') e('"axis" must be "y" or "z"');
      if (errors.length > n0 && errors.some((m) => m.startsWith(`${file}: ${at} `))) return;
      const half = ((s.n - 1) / 2) * s.pitch + s.d / 2, cx = s.at[0] * w;
      if (cx - half < -0.05 || cx + half > w + 0.05) return e(`its ${s.n} pins at ${s.pitch} mm stretch ${r2(2 * half)} mm across a ${w} mm body: fewer pins, a smaller pitch or a different "at"`);
      if ((up ? s.at[2] : s.at[1]) + s.len > 1.0001) return e(`runs out of the body: ${up ? '"at"[2] + "len"' : '"at"[1] + "len"'} must be at most 1`);
      grow(cx - half, cx + half, up ? s.at[1] * l - s.d / 2 : s.at[1] * l, up ? s.at[1] * l + s.d / 2 : (s.at[1] + s.len) * l, up ? (s.at[2] + s.len) * h : s.at[2] * h + s.d / 2);
    }
    out.push(s as LookShape);
  });
  if (errors.length > n0) return null;
  if (!solids) { errors.push(`${file}: "look" needs a box or a barrel: pins alone are not a part`); return null; }
  // the toolbox and the lists say the body is w x l x h: the drawing must reach all of it (and not pass it)
  if (ext.x1 - ext.x0 < w - 0.25) errors.push(`${file}: the shapes of "look" together are ${r2(ext.x1 - ext.x0)} mm across, but the body is ${w} mm wide: make a box span x from 0 to 1, or change body.w`);
  if (ext.y1 - ext.y0 < l - 0.25) errors.push(`${file}: the shapes of "look" together are ${r2(ext.y1 - ext.y0)} mm long, but the body is ${l} mm long: make a box span y from 0 to 1, or change body.l`);
  if (ext.z1 < h - 0.3) errors.push(`${file}: the shapes of "look" reach ${r2(ext.z1)} mm high, but the body is ${h} mm high: make a box reach z 1, or change body.h`);
  return errors.length > n0 ? null : out;
}

function checkType(j: unknown, file: string, idFromFile: string, ctx: Ctx, lines: string[]): TypeDef | null {
  const errors = ctx.errors, n0 = errors.length, e = (m: string) => errors.push(`${file}: ${m}`);
  if (!isObj(j)) { e('must be a JSON object (see parts/README.md, a new connector type)'); return null; }
  for (const k of Object.keys(j)) if (!TYPE_KEYS.includes(k)) e(`unknown key "${k}" (keys: ${TYPE_KEYS.join(', ')})`);
  if (typeof j.id !== 'string' || !/^[a-z][a-z0-9_]{1,23}$/.test(j.id)) e('"id" must be lower case letters, digits and _, starting with a letter (2 to 24 characters), such as "jack635"');
  else if (j.id !== idFromFile) e(`"id" is "${j.id}" but the file is called type-${idFromFile}.json: the file must be type-${j.id}.json`);
  else if (builtinIds().includes(j.id) || j.id === 'none') e(`"id" ${j.id} is taken by a connector type the library has (npm run parts -- --types): choose another`);
  if (typeof j.label !== 'string' || j.label.trim().length < 3 || j.label.length > 48) e('"label" must be text of 3 to 48 characters, the name shown in the toolbox');
  if (j.plugName !== undefined && (typeof j.plugName !== 'string' || !j.plugName || j.plugName.length > 30)) e('"plugName" must be text of at most 30 characters, such as "6.35 mm plug"');
  if (j.entry !== 'edge' && j.entry !== 'top') e('"entry" must be "edge" (the plug goes in through the board edge) or "top" (from above)');
  const bodyOk = isObj(j.body) && Object.keys(j.body).length === 3 && ['w', 'l', 'h'].every((k) => inRange(j.body[k], 0.5, 150));
  if (!bodyOk) e('"body" must be { "w": mm, "l": mm, "h": mm } with each 0.5 to 150: w across the mouth, l along the way the plug goes in, h above the board');
  const pl = j.plug;
  if (!(isObj(pl) && Object.keys(pl).length === 4 && ['w', 'h', 'len'].every((k) => inRange(pl[k], 0.5, 150)) && inRange(pl.cable, 0, 15))) e('"plug" must be { "w": mm, "h": mm, "len": mm, "cable": mm }: the mating plug (w across, h up, len along the way in, cable its lead\'s thickness)');
  if (bodyOk && j.zc !== undefined && !inRange(j.zc, 0, j.body.h)) e('"zc" must be the height of the plug\'s axis above the board, 0 up to the body\'s height');
  if (j.overhang !== undefined && !inRange(j.overhang, 0, 20)) e('"overhang" must be how far the body overhangs the board edge in mm, 0 to 20');
  for (const k of ['tht', 'cradle']) if (j[k] !== undefined && typeof j[k] !== 'boolean') e(`"${k}" must be true or false`);
  if (!(WIRING_ROLES as readonly string[]).includes(j.role)) e(`"role" must be one of: ${WIRING_ROLES.join(', ')} (which built-in kind of port it is wired like: net like RJ45, usb like USB-C, power like a DC jack, audio, video, mains-in, wire like a terminal block, other)`);
  for (const [k, max] of [['offRack', 60], ['note', 200], ['source', 300]] as const) if (j[k] !== undefined && (typeof j[k] !== 'string' || !j[k] || j[k].length > max)) e(`"${k}" must be text of at most ${max} characters`);
  const look = j.look === undefined ? undefined : bodyOk ? checkLook(j.look, j.body, file, errors) : null;
  const id = typeof j.id === 'string' ? j.id : idFromFile;
  const names = checkNames(j.names, false, id, 'names', file, ctx, lines), weak = checkNames(j.weak, true, id, 'weak', file, ctx, lines);
  if (errors.length > n0) return null;
  const t: TypeDef = { id: j.id, label: j.label.trim(), ...(j.plugName ? { plugName: j.plugName } : {}), entry: j.entry, body: { w: j.body.w, l: j.body.l, h: j.body.h }, plug: { w: j.plug.w, h: j.plug.h, len: j.plug.len, cable: j.plug.cable }, role: j.role };
  if (j.zc !== undefined) t.zc = j.zc;
  if (j.overhang !== undefined) t.overhang = j.overhang;
  if (j.tht) t.tht = true;
  if (j.offRack) t.offRack = j.offRack;
  if (j.cradle) t.cradle = true;
  if (j.note) t.note = j.note;
  if (look) t.look = look;
  if (names.length) t.names = names;
  if (weak.length) t.weak = weak;
  return t;
}

// ---- the folder ----

export interface Built { data: PartsData; errors: string[]; warnings: string[]; report: string; files: number }

const FILE_NAMES = /^names-[A-Za-z0-9._-]+\.json$/, FILE_TYPE = /^type-([A-Za-z0-9_]+)\.json$/;
/** The files that hold contributions: every file in the folder itself (not README.md, AGENTS.md or the sub-folders, such as examples/). */
export function partsFiles(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((f) => f.isFile() && !f.name.startsWith('.') && !/\.md$/i.test(f.name)).map((f) => f.name).sort() : [];
}

/** Read and check every file in `dir`, and make the data the app reads from them. */
export function readParts(dir: string): Built {
  const errors: string[] = [], warnings: string[] = [], L: string[] = [];
  const rel = (f: string) => path.relative(process.cwd(), path.join(dir, f)) || f;
  const files = partsFiles(dir);
  const parsed = new Map<string, unknown>();
  for (const f of files) {
    let why: string | null = !FILE_NAMES.test(f) && !FILE_TYPE.test(f) ? 'not a parts file. Names go in names-<anything>.json, a new connector type in type-<id>.json (parts/README.md)' : null;
    if (!why) try { parsed.set(f, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch (e) { why = `not valid JSON (${(e as Error).message})`; }
    if (why) { errors.push(`${rel(f)}: ${why}`); L.push(rel(f), `  ERROR     ${why}`); }
  }
  // (types first: a names file may name a type that another file defines)
  const ctx: Ctx = { ids: new Set(builtinIds()), seen: new Map(), errors, warnings };
  for (const f of files) { const m = FILE_TYPE.exec(f), j = parsed.get(f); if (m && isObj(j) && j.id === m[1] && !ctx.ids.has(m[1])) ctx.ids.add(m[1]); }
  const types: TypeDef[] = [], groups: NameGroup[] = [];
  for (const f of files.filter((x) => parsed.has(x))) {
    const at = rel(f), lines: string[] = [], e0 = errors.length, w0 = warnings.length, m = FILE_TYPE.exec(f), j = parsed.get(f);
    let head = '';
    if (m) {
      const t = checkType(j, at, m[1], ctx, lines);
      if (t) { types.push(t); head = `  ${t.id.padEnd(10)} ${t.label}: ${t.entry === 'edge' ? 'on an edge' : 'from above'}, ${t.body.w} x ${t.body.l} x ${t.body.h} mm, wired as ${t.role}, ${t.look ? `look of ${t.look.length} shape${t.look.length > 1 ? 's' : ''}` : 'no look (drawn as a plain connector)'}`; }
    } else {
      const list = Array.isArray(j) ? j : [j];
      if (!list.length) errors.push(`${at}: the list is empty`);
      list.forEach((g, i) => { const one = checkGroup(g, Array.isArray(j) ? `[${i}]` : 'the file', at, ctx, lines); if (one) groups.push(one); });
      head = `  names for ${[...new Set(list.filter(isObj).map((g) => g.type))].join(', ')}`;
    }
    const after = (x: string) => x.slice(x.indexOf(': ') + 2);
    L.push(at, ...(head ? [head] : []), ...lines, ...warnings.slice(w0).map((w) => `  WARNING   ${after(w)}`), ...errors.slice(e0).map((x) => `  ERROR     ${after(x)}`));
  }
  // (groups of the same type, pins, rows and pitch become one)
  const merged = new Map<string, NameGroup>();
  for (const g of groups) {
    const key = JSON.stringify([g.type, g.pins ?? 0, g.rows ?? 0, g.pitch ?? 0]), m = merged.get(key);
    if (!m) merged.set(key, { ...g, ...(g.names ? { names: [...g.names] } : {}), ...(g.weak ? { weak: [...g.weak] } : {}) });
    else { if (g.names) m.names = [...(m.names ?? []), ...g.names]; if (g.weak) m.weak = [...(m.weak ?? []), ...g.weak]; }
  }
  const byText = (a: string, b: string) => a.localeCompare(b, 'en');
  const sortNames = <G extends { names?: string[]; weak?: string[] }>(g: G): G => { if (g.names) g.names = [...new Set(g.names)].sort(byText); if (g.weak) g.weak = [...new Set(g.weak)].sort(byText); return g; };
  const names = [...merged.values()].map(sortNames).sort((a, b) => byText(a.type, b.type) || (a.pins ?? 0) - (b.pins ?? 0) || (a.rows ?? 0) - (b.rows ?? 0) || (a.pitch ?? 0) - (b.pitch ?? 0));
  for (const t of types) sortNames(t);
  types.sort((a, b) => byText(a.id, b.id));
  const n = names.reduce((s, g) => s + (g.names?.length ?? 0) + (g.weak?.length ?? 0), 0);
  L.push('', `${files.length} file${files.length === 1 ? '' : 's'}: ${n} name${n === 1 ? '' : 's'}, ${types.length} new type${types.length === 1 ? '' : 's'}, ${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`);
  return { data: { v: 1, names, types }, errors, warnings, report: L.join('\n'), files: files.length };
}

/** The data as the compact JSON the app reads: one line per name group and per type, so two contributions rarely touch the same line. */
export function dump(d: PartsData): string {
  const list = (a: unknown[]) => (a.length ? `[\n${a.map((x) => '  ' + JSON.stringify(x)).join(',\n')}\n]` : '[]');
  return `{"v":1,"names":${list(d.names)},"types":${list(d.types)}}\n`;
}

/** What is wrong with the generated file, for --check: it is missing, or not what the folder makes. */
export function stale(d: PartsData, file: string): boolean {
  try { return fs.readFileSync(file, 'utf8') !== dump(d); } catch { return true; }
}

/** The connector types, roles and materials a file may use, for `--types`. */
export function typeList(): string {
  const contrib = new Set(CONTRIB_TYPES.map((c) => c.id));
  return [
    'Connector types a names file may map to ("type"):',
    ...CONNECTORS.filter((c) => c.id !== 'custom').map((c) => `  ${c.id.padEnd(12)} ${c.name}, ${c.entry === 'edge' ? 'plug enters through the board edge' : 'plug enters from above'}${contrib.has(c.id) ? ' (contributed)' : ''}`),
    '', `Wiring roles for a new type ("role"): ${WIRING_ROLES.join(', ')}`,
    `Materials for a look: ${LOOK_MATS.join(', ')}`,
  ].join('\n');
}

export { toConnType };
