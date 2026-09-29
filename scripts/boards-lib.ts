// The engine behind `npm run boards` (scripts/boards.mjs is the command line): turns each folder under boards/ into a
// board the app offers. It reads the folder's files with the app's own importers, applies the hints in board.json,
// and produces a report per board plus the data the app lazy-loads (public/boards/index.json and one JSON file per
// board). Nothing here is bundled into the app. See boards/README.md (people) and boards/AGENTS.md (AI jobs).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { convertForeign, importFiles, type Converter, type InFile } from '../src/import';
import { aimConnector } from '../src/import/common';
import { CONNECTORS, connSetup } from '../src/model/library';
import { applyHoleRoles, isMountHole } from '../src/model/holes';
import { bbox } from '../src/geom/poly';
import type { Board, Comp, Hole } from '../src/model/types';
import type { CommunityEntry, CommunityIndex } from '../src/model/community';

// ---- board.json ----

/** What to change about one part, by its reference (J3). */
export interface PartHint {
  type?: string; // a connector id (npm run boards -- --types), or "none" for a part that is no connector
  angle?: number; // an edge connector: the direction its plug comes from, degrees (0: out of the right edge, 90: top, 180: left, -90: bottom); found from the nearest edge if left out
  size?: [number, number, number]; // body width, depth and height, mm
  hide?: boolean; // leave the part out
  note?: string; // free text for people (why it is Custom, which part number it is); printed in the report
}
/** A hole is [x, y] or [x, y, diameter], in the board's own mm, as the report prints them. */
export type HoleSpec = [number, number] | [number, number, number];

export interface BoardJson {
  name?: string; // shown in the app (default: the name in the file)
  maker?: string; // who makes or designed it
  url?: string; // where it comes from
  license?: string; // e.g. "MIT", "CERN-OHL-P-2.0", "CC-BY-4.0", "used with permission"
  source?: string; // a note on where the files came from, if not the URL
  files?: string[]; // which files to read (default: every file in the folder except board.json, docs and pictures)
  thickness?: number; // board thickness, mm, if the file's is wrong
  parts?: Record<string, PartHint>; // by reference
  footprints?: Record<string, string>; // a regular expression on the footprint name -> a connector id, for every part that matches
  holes?: { use?: HoleSpec[]; ignore?: [number, number][] }; // use: exactly these are mounting holes (any not in the file are added; give a diameter); ignore: leave these alone
  copper?: boolean; // keep the copper tracks for the 3D view (the file gets much bigger)
  listed?: boolean; // false: build and check it, but keep it out of the app (default true)
  notes?: string[]; // extra notes shown with the board in the app
}
const KEYS = ['name', 'maker', 'url', 'license', 'source', 'files', 'thickness', 'parts', 'footprints', 'holes', 'copper', 'listed', 'notes'];
const PART_KEYS = ['type', 'angle', 'size', 'hide', 'note'];
const NEAR = 0.6; // mm: how close a hole in board.json must be to one in the file to mean it

const TYPE_IDS = CONNECTORS.map((c) => c.id);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isXY = (v: unknown): v is [number, number] => Array.isArray(v) && v.length >= 2 && isNum(v[0]) && isNum(v[1]);

/** Problems with board.json itself (a typo in a key, a connector id that does not exist), each saying what to write instead. */
export function checkHints(j: any): string[] {
  const e: string[] = [];
  if (!j || typeof j !== 'object' || Array.isArray(j)) return ['board.json must be a JSON object'];
  for (const k of Object.keys(j)) if (!KEYS.includes(k)) e.push(`board.json: unknown key "${k}" (keys: ${KEYS.join(', ')})`);
  for (const k of ['name', 'maker', 'url', 'license', 'source']) if (j[k] !== undefined && typeof j[k] !== 'string') e.push(`board.json: "${k}" must be a string`);
  if (j.thickness !== undefined && !(isNum(j.thickness) && j.thickness > 0 && j.thickness < 10)) e.push('board.json: "thickness" must be a number of mm, such as 1.6');
  if (j.files !== undefined && !(Array.isArray(j.files) && j.files.every((f: unknown) => typeof f === 'string'))) e.push('board.json: "files" must be a list of file names');
  if (j.notes !== undefined && !(Array.isArray(j.notes) && j.notes.every((f: unknown) => typeof f === 'string'))) e.push('board.json: "notes" must be a list of strings');
  const type = (where: string, t: unknown) => { if (typeof t !== 'string' || !(t === 'none' || TYPE_IDS.includes(t))) e.push(`board.json: ${where} has connector type ${JSON.stringify(t)}; use one of: ${TYPE_IDS.join(', ')}, none`); };
  for (const [ref, h] of Object.entries<any>(j.parts ?? {})) {
    if (!h || typeof h !== 'object') { e.push(`board.json: parts.${ref} must be an object such as { "type": "usb_c" }`); continue; }
    for (const k of Object.keys(h)) if (!PART_KEYS.includes(k)) e.push(`board.json: parts.${ref} has unknown key "${k}" (keys: ${PART_KEYS.join(', ')})`);
    if (h.type !== undefined) type(`parts.${ref}`, h.type);
    if (h.angle !== undefined && !isNum(h.angle)) e.push(`board.json: parts.${ref}.angle must be a number of degrees`);
    if (h.size !== undefined && !(Array.isArray(h.size) && h.size.length === 3 && h.size.every(isNum))) e.push(`board.json: parts.${ref}.size must be [width, depth, height] in mm`);
  }
  for (const [rx, t] of Object.entries<any>(j.footprints ?? {})) {
    try { new RegExp(rx, 'i'); } catch { e.push(`board.json: footprints "${rx}" is not a valid regular expression`); }
    type(`footprints "${rx}"`, t);
  }
  const H = j.holes;
  if (H !== undefined) {
    if (!H || typeof H !== 'object') e.push('board.json: "holes" must be an object with "use" and/or "ignore"');
    else {
      for (const k of Object.keys(H)) if (!['use', 'ignore'].includes(k)) e.push(`board.json: holes has unknown key "${k}" (keys: use, ignore)`);
      for (const k of ['use', 'ignore']) if (H[k] !== undefined && !(Array.isArray(H[k]) && H[k].every(isXY))) e.push(`board.json: holes.${k} must be a list of [x, y] positions in mm${k === 'use' ? ' (or [x, y, diameter])' : ''}`);
    }
  }
  return e;
}

// ---- reading the folder ----

const SKIP = /^(board\.json|readme(\..*)?|licen[sc]e(\..*)?|\.DS_Store|Thumbs\.db)$|\.(md|markdown|png|jpe?g|gif|webp|svg|pdf|html?)$/i;

function readFolder(dir: string, only?: string[]): InFile[] {
  const out: InFile[] = [];
  const walk = (d: string, rel: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else if (only ? only.includes(r) : !SKIP.test(e.name)) out.push({ name: e.name, bytes: new Uint8Array(fs.readFileSync(path.join(d, e.name))), ...(rel ? { path: r } : {}) });
    }
  };
  walk(dir, '');
  return out;
}

/** KiCad 10's command line, when it is installed: it turns a Cadence Allegro .brd into a .kicad_pcb. */
function kicadCli(): string | null {
  const names = process.platform === 'win32' ? ['kicad-cli.exe'] : ['kicad-cli'];
  const dirs = [...(process.env.PATH ?? '').split(path.delimiter), '/usr/bin', '/usr/local/bin', '/snap/bin', '/Applications/KiCad/KiCad.app/Contents/MacOS'];
  for (const d of dirs) for (const n of names) { const p = path.join(d, n); try { if (fs.statSync(p).isFile()) return p; } catch { /* not there */ } }
  return null;
}
const kicadConverter = (cli: string): Converter => async (name, bytes) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boarddock-boards-')), src = path.join(dir, 'board.brd'), out = path.join(dir, 'board.kicad_pcb');
  try {
    fs.writeFileSync(src, bytes);
    let err = '';
    for (const extra of [[], ['--format', 'allegro']]) {
      try { execFileSync(cli, ['pcb', 'import', ...extra, '--output', out, src], { stdio: 'pipe', timeout: 120000 }); err = ''; break; } catch (e: any) { err = String(e?.stderr ?? e?.message ?? e).trim().split('\n').slice(-2).join(' '); }
    }
    return fs.existsSync(out) ? { text: fs.readFileSync(out, 'utf8') } : { error: err || `KiCad saved no board for ${name}` };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

/** The importers read Eagle XML with the browser's DOMParser: borrow happy-dom's when running under Node. */
async function ensureDom() {
  if (typeof (globalThis as any).DOMParser !== 'undefined') return;
  try { const { Window } = await import('happy-dom'); (globalThis as any).DOMParser = new (Window as any)().DOMParser; } catch { /* only Eagle XML needs it */ }
}

// ---- building one board ----

export interface Built {
  slug: string;
  name: string;
  listed: boolean;
  errors: string[];
  warnings: string[];
  report: string; // the text to print
  board?: Board; // the finished board (no errors)
  entry?: Omit<CommunityEntry, 'pic'>;
}

/** A footprint name without the 3D model file names the KiCad importer appends. */
const bare = (pkg: string) => pkg.replace(/ [^ ]*\.(step|stp|wrl)\b.*$/i, '');
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
const typeName = (id: string) => CONNECTORS.find((c) => c.id === id)?.name ?? id;
const near = (h: { x: number; y: number }, p: [number, number]) => Math.hypot(h.x - p[0], h.y - p[1]) <= NEAR;
const isPlug = (c: Comp) => !!c.conn && !c.hidden;

/** Everything the report says, and the finished board. `dir` is the board's folder; its name is the board's id. */
export async function buildBoard(dir: string): Promise<Built> {
  const slug = path.basename(path.resolve(dir));
  const rel = (p: string) => `${path.basename(path.dirname(path.resolve(dir)))}/${slug}${path.resolve(p) === path.resolve(dir) ? '' : `/${path.basename(p)}`}`; // boards/<slug>, boards/<slug>/board.json
  const errors: string[] = [], warnings: string[] = [], info: string[] = [];
  const st: { board?: Board; source: string; hinted: Set<string>; notes: Record<string, string> } = { source: '', hinted: new Set(), notes: {} }; // what has been read so far, for the report
  const done = (extra: Partial<Built> = {}): Built => {
    const b = { slug, name: extra.name ?? slug, listed: true, errors, warnings, report: '', ...extra } as Built;
    b.report = formatReport(b);
    return b;
  };
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) errors.push(`The folder name "${slug}" is the board's id: use lower case letters, digits and dashes, e.g. "acme-sensor-v2"`);

  const hintFile = path.join(dir, 'board.json');
  if (!fs.existsSync(hintFile)) { errors.push(`${rel(hintFile)} is missing: add one (see boards/README.md)`); return done(); }
  let hints: BoardJson;
  try { hints = JSON.parse(fs.readFileSync(hintFile, 'utf8')); } catch (e: any) { errors.push(`${rel(hintFile)} is not valid JSON: ${e.message}`); return done(); }
  errors.push(...checkHints(hints));
  if (errors.length) return done();
  for (const [ref, h] of Object.entries(hints.parts ?? {})) if (h.note) st.notes[ref] = h.note;

  const listed = hints.listed !== false;
  let files: InFile[];
  try {
    files = readFolder(dir, hints.files);
    for (const f of hints.files ?? []) if (!files.some((x) => (x.path ?? x.name) === f)) errors.push(`board.json lists the file "${f}", which is not in ${rel(dir)}`);
  } catch (e: any) { errors.push(`Cannot read ${rel(dir)}: ${e.message}`); return done({ listed }); }
  if (errors.length) return done({ listed });
  if (!files.length) { errors.push(`${rel(dir)} has no board files: add the .kicad_pcb (or IPC-2581 .xml, ODB++, GenCAD .cad, IDF, Eagle .brd, or Gerber + drill + pick-and-place files)`); return done({ listed }); }

  // the app's own importer
  await ensureDom();
  let imported: Board;
  try {
    try { imported = await importFiles(files); } catch (e: any) {
      const cli = files.some((f) => /\.brd$/i.test(f.name)) ? kicadCli() : null;
      if (!cli) throw e;
      const errs: string[] = [];
      const conv = await convertForeign(files, kicadConverter(cli), errs);
      if (errs.length) throw new Error(errs.join(' '));
      imported = await importFiles(conv);
      info.push('An Allegro .brd was converted with kicad-cli; keep the .kicad_pcb it made in this folder so nobody needs KiCad again.');
    }
  } catch (e: any) {
    errors.push(`Could not read the files: ${e?.message ?? e}`);
    if (files.some((f) => /\.(step|stp)$/i.test(f.name))) errors.push('(STEP files cannot be read by this script outside the browser: add a KiCad, IPC-2581, ODB++, GenCAD, IDF or Gerber source as well.)');
    return done({ listed });
  }
  let board: Board = structuredClone(imported);
  st.board = board;
  st.source = board.source;
  for (const n of board.notes) (/could not be read|did not close/i.test(n) ? warnings : info).push(n);

  // the hints: parts, then the holes (whose roles depend on the parts)
  const hinted = st.hinted;
  const setType = (c: Comp, id: string, h?: PartHint) => {
    if (id === 'none') { const { conn: _c, ...rest } = c; return { ...rest, kind: c.kind === 'connector' ? ('generic' as const) : c.kind }; }
    const t = CONNECTORS.find((x) => x.id === id)!;
    let out: Comp = { ...c, kind: id === 'header' ? 'header' : 'connector', conn: connSetup(t, h?.angle ?? c.conn?.angle ?? 0) };
    if (h?.angle === undefined) out = aimConnector(out, board);
    return out;
  };
  const shown = (c: Comp) => c.ref;
  for (const [rx, id] of Object.entries(hints.footprints ?? {})) {
    const re = new RegExp(rx, 'i');
    const hit = board.comps.filter((c) => re.test(`${c.pkg} ${c.value ?? ''}`));
    if (!hit.length) errors.push(`board.json: footprints "${rx}" matches no part. Footprints in the file: ${[...new Set(board.comps.map((c) => bare(c.pkg)))].slice(0, 12).join('; ')}`);
    board.comps = board.comps.map((c) => (re.test(`${c.pkg} ${c.value ?? ''}`) ? (hinted.add(c.ref), setType(c, id)) : c));
  }
  for (const [ref, h] of Object.entries(hints.parts ?? {})) {
    if (!board.comps.some((c) => c.ref === ref)) { errors.push(`board.json: parts.${ref} matches no part. References in the file: ${board.comps.map(shown).slice(0, 30).join(', ')}`); continue; }
    board.comps = board.comps.map((c) => {
      if (c.ref !== ref) return c;
      hinted.add(ref);
      let out = h.type ? setType(c, h.type, h) : c;
      if (h.angle !== undefined && out.conn) out = { ...out, conn: { ...out.conn, angle: h.angle } };
      if (h.size) out = { ...out, w: h.size[0], l: h.size[1], h: h.size[2] };
      if (h.hide) out = { ...out, hidden: true };
      return out;
    });
  }
  if (hints.thickness) board.thickness = hints.thickness;
  applyHoleRoles(board, [], true);
  const H = hints.holes;
  for (const p of H?.ignore ?? []) {
    const hit = board.holes.filter((h) => near(h, p));
    if (!hit.length) errors.push(`board.json: holes.ignore [${p}] matches no hole. Holes in the file: ${holeList(board.holes)}`);
    for (const h of hit) { h.role = 'free'; h.why = 'ignored in board.json'; h.use = 'auto'; }
  }
  if (H?.use) {
    const chosen = new Set<Hole>();
    for (const p of H.use as HoleSpec[]) {
      let h = board.holes.find((x) => near(x, [p[0], p[1]]));
      if (!h) {
        if (!isNum(p[2])) { errors.push(`board.json: holes.use [${p[0]}, ${p[1]}] matches no hole and has no diameter to add one (write [x, y, diameter]). Holes in the file: ${holeList(board.holes)}`); continue; }
        h = { id: `h${board.holes.length + 1}`, x: p[0], y: p[1], d: p[2], plated: false, use: 'auto' };
        board.holes.push(h);
      }
      chosen.add(h);
      h.role = 'mount'; h.why = 'a mounting hole, listed in board.json'; h.use = 'auto';
    }
    for (const h of board.holes) if (!chosen.has(h) && h.role === 'mount') { h.role = 'free'; h.why = 'not in holes.use of board.json'; }
  }
  if (errors.length) return done({ name: hints.name ?? board.name, listed });

  // checks
  const bb = bbox(board.outline), w = bb.x1 - bb.x0, l = bb.y1 - bb.y0;
  if (Math.max(w, l) > 600 || Math.min(w, l) < 5) warnings.push(`The outline is ${r1(w)} x ${r1(l)} mm: that looks wrong (wrong units, or the wrong layer used as the outline?).`);
  if (board.outline.length > 1500) warnings.push(`The outline has ${board.outline.length} corners: very fine curves make a heavy board. Export it with fewer segments if you can.`);
  const mount = board.holes.filter(isMountHole);
  if (!mount.length) warnings.push(board.holes.length ? 'None of the holes is a mounting hole. If the board has some, name them in board.json: "holes": { "use": [[x, y], ...] }.' : 'The file has no holes, so the holder will grip the board by its edges. If the board has mounting holes, add them: "holes": { "use": [[x, y, diameter], ...] }.');
  const plugs = board.comps.filter(isPlug);
  const custom = plugs.filter((c) => c.conn!.type === 'custom' && hints.parts?.[c.ref]?.type !== 'custom');
  for (const c of custom) warnings.push(`${c.ref} is a "custom" connector (footprint "${bare(c.pkg)}"${c.value ? `, value "${c.value}"` : ''}). If it is one of the kinds in the list, add "parts": { "${c.ref}": { "type": "<id>" } } to board.json (ids: npm run boards -- --types). If none fits, report its part number for the connector library and accept it with { "type": "custom", "note": "<part number>" }.`);
  if (!hints.license && !hints.source) warnings.push('board.json has no "license" or "source": say where the files come from and under what terms they may be shared.');
  if (!hints.maker && !hints.url) warnings.push('board.json has no "maker" or "url": say who the board is by, so the app can credit them.');

  // the finished board
  const name = hints.name ?? board.name;
  const credit = [hints.maker && `by ${hints.maker}`, hints.license && `licence ${hints.license}`, hints.url].filter(Boolean).join(', ');
  board = {
    ...board, name, source: `Community board ${slug} (${st.source})`,
    notes: [`Community board${credit ? `, ${credit}` : ''}.${hints.source ? ` ${hints.source}` : ''}`, ...(hints.notes ?? []), ...board.notes],
  };
  st.board = board;
  delete board.ack; delete board.dims; delete board.photo;
  if (!hints.copper) { delete board.traces; delete board.vias; }
  board.comps.forEach((c, i) => { c.id = `c${i + 1}`; });
  board.holes.forEach((h, i) => { h.id = `h${i + 1}`; });
  const json = dump(board);
  const rev = createHash('sha1').update(json).digest('hex').slice(0, 10);
  const step = Math.max(1, Math.ceil(board.outline.length / 200));
  const entry: Built['entry'] = {
    id: slug, name, ...(hints.maker ? { maker: hints.maker } : {}), ...(hints.url ? { url: hints.url } : {}), ...(hints.license ? { license: hints.license } : {}),
    size: [r1(w), r1(l)], plugs: plugs.length, custom: custom.length, holes: mount.length, file: `${slug}.json`, rev,
    sketch: {
      outline: board.outline.filter((_, i) => i % step === 0).map(([x, y]) => [r1(x), r1(y)]),
      holes: board.holes.map((h) => [r1(h.x), r1(h.y), r1(h.d)]),
      parts: board.comps.filter((c) => !c.hidden && (c.conn || c.h >= 1)).slice(0, 120).map((c) => [r1(c.x), r1(c.y), r1(c.w), r1(c.l), Math.round(c.rot), c.conn ? 1 : 0]),
    },
  };
  return done({ name, listed, board, entry });

  function holeList(hs: Hole[]) { return hs.map((h) => `(${r2(h.x)}, ${r2(h.y)}) d${r2(h.d)}`).join('; ') || 'none'; }
  function formatReport(b: Built): string {
    const bd = st.board;
    const L: string[] = [`${rel(dir)}: ${b.name}${st.source ? ` (${st.source})` : ''}${b.listed ? '' : '  [not listed in the app]'}`];
    if (bd) {
      const bx = bbox(bd.outline);
      L.push(`  outline     ${r1(bx.x1 - bx.x0)} x ${r1(bx.y1 - bx.y0)} mm, ${bd.outline.length} corners, ${bd.cutouts.length} cut-outs, ${bd.thickness} mm thick`);
      L.push(`  holes       ${bd.holes.length} found, ${bd.holes.filter(isMountHole).length} to mount by`);
      for (const h of bd.holes) L.push(`    ${`(${r2(h.x)}, ${r2(h.y)})`.padEnd(16)} d${r2(h.d)}  ${(h.role ?? 'mount').padEnd(8)} ${h.why ?? ''}`);
      const ps = bd.comps.filter(isPlug);
      L.push(`  connectors  ${ps.length}`);
      for (const c of ps) {
        const t = c.conn!, how = st.hinted.has(c.ref) ? 'by hint' : t.type === 'custom' ? 'NOT IDENTIFIED' : 'by name';
        const note = st.notes[c.ref];
        L.push(`    ${c.ref.padEnd(8)} ${t.type.padEnd(12)} ${(t.entry === 'edge' ? `edge ${t.angle}\u00b0` : 'top').padEnd(9)} ${how.padEnd(14)} ${bare(c.pkg)}${note ? `  (${note})` : ''}`);
      }
      const others = bd.comps.filter((c) => !c.conn && !c.hidden).length, hid = bd.comps.filter((c) => c.hidden).length;
      L.push(`  other parts ${others}${hid ? `, ${hid} hidden` : ''}`);
    }
    for (const n of info) L.push(`  note        ${n}`);
    for (const w of b.warnings) L.push(`  WARNING     ${w}`);
    for (const e of b.errors) L.push(`  ERROR       ${e}`);
    L.push(`  result      ${b.errors.length ? 'FAILED' : b.warnings.length ? `ok, ${b.warnings.length} warning${b.warnings.length > 1 ? 's' : ''}` : 'ok'}`);
    return L.join('\n');
  }
}

/** A board as the compact JSON the app fetches: numbers to 3 decimals, one line. */
export function dump(b: Board): string {
  return JSON.stringify(b, (_k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)) + '\n';
}

// ---- the generated files ----

export interface Plan { files: Map<string, string>; remove: string[] }

/**
 * What public/boards should hold. A full run (`only` unset) makes it match the folders exactly; a run on one board
 * changes only that board's file and row. A row gets a picture only while public/boards/<id>.webp was rendered from
 * the board as it is now (tiles.json in there says which revision each picture shows).
 */
export function plan(built: Built[], out: string, only?: string): Plan {
  const files = new Map<string, string>(), remove: string[] = [];
  const read = (f: string) => { try { return JSON.parse(fs.readFileSync(path.join(out, f), 'utf8')); } catch { return null; } };
  const tiles: Record<string, string> = read('tiles.json') ?? {};
  const ok = built.filter((b) => b.listed && b.entry && b.board);
  const rows: CommunityEntry[] = ok.map((b) => {
    const e = b.entry!;
    files.set(e.file, dump(b.board!));
    return { ...e, ...(tiles[e.id] === e.rev && fs.existsSync(path.join(out, `${e.id}.webp`)) ? { pic: `${e.id}.webp` } : {}) };
  });
  const old = (read('index.json') as CommunityIndex | null)?.boards ?? [];
  const keep = only ? old.filter((r) => r.id !== only) : [];
  const all = [...keep, ...rows].sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id));
  const idx = `{"version":1,"boards":[\n${all.map((r) => '  ' + JSON.stringify(r)).join(',\n')}\n]}\n`;
  files.set('index.json', idx);
  // an unlisted (or, in a run on one board, changed) board's old file goes
  for (const b of built) if (!(b.listed && b.entry)) remove.push(`${b.slug}.json`);
  if (!only) {
    const live = new Set(all.map((r) => r.id));
    if (fs.existsSync(out)) for (const f of fs.readdirSync(out)) {
      const m = f.match(/^(.+)\.(json|webp)$/);
      if (m && !['index', 'tiles'].includes(m[1]) && !live.has(m[1])) remove.push(f);
    }
    const t2 = Object.fromEntries(Object.entries(tiles).filter(([id]) => live.has(id)));
    if (Object.keys(t2).length !== Object.keys(tiles).length) files.set('tiles.json', JSON.stringify(t2, null, 1) + '\n');
  }
  return { files, remove: [...new Set(remove)] };
}

/** Files that differ from the plan: what `--check` reports. */
export function stale(p: Plan, out: string): string[] {
  const bad: string[] = [];
  for (const [f, text] of p.files) { let now = ''; try { now = fs.readFileSync(path.join(out, f), 'utf8'); } catch { /* missing */ } if (now !== text) bad.push(f); }
  for (const f of p.remove) if (fs.existsSync(path.join(out, f))) bad.push(f);
  return bad;
}

export function apply(p: Plan, out: string) {
  fs.mkdirSync(out, { recursive: true });
  for (const [f, text] of p.files) fs.writeFileSync(path.join(out, f), text);
  for (const f of p.remove) fs.rmSync(path.join(out, f), { force: true });
}

/** The folders under `root` that hold a board (every sub-folder; loose files such as README.md are not boards). */
export function boardFolders(root: string): string[] {
  return fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => path.join(root, e.name)).sort() : [];
}

/** Connector ids and names, for `--types` (what "type" may be in board.json). */
export function typeList(): string {
  return CONNECTORS.filter((c) => c.id !== 'custom').map((c) => `  ${c.id.padEnd(12)} ${typeName(c.id)}, ${c.entry === 'edge' ? 'plug enters through the board edge' : 'plug enters from above'}`).join('\n')
    + '\n  none         not a connector at all\n  custom       a connector the library has none for (name its part number in "note")';
}
