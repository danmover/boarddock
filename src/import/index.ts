// One entry point for every supported input. Accepts several files at once (e.g. a Gerber set), archives (zip,
// tgz, tar, nested in each other) and dropped folders. When the files hold the board in several formats, the
// fullest one is read first, and if it fails the next is tried; the board's notes say which file was used.
import { strFromU8 } from 'fflate';
import type { Board } from '../model/types';
import { importKicad } from './kicad';
import { importFab, classifyFabFile, type FabFiles } from './fab';
import { importEagle, importIdf, importDxf } from './other';
import { importStep } from './step';
import { importEagleBinary, isEagleBinary } from './eaglebin';
import { importBoardView, sniffBoardView } from './boardview';
import { importIpc2581, isIpc2581 } from './ipc2581';
import { findOdb, importOdb } from './odb';
import { importGencad, isGencad } from './gencad';
import { allegroMessage, isAllegroBrd } from './allegro';
import { expandAll, isArchiveName, type InFile } from './archive';

export type { InFile } from './archive';

export const ACCEPT = '.kicad_pcb,.brd,.bdv,.bv,.bvr,.emn,.emp,.idf,.step,.stp,.dxf,.zip,.tgz,.tar,.gz,.xml,.cvg,.cad,.gbr,.gko,.gm1,.gml,.gtl,.gbl,.drl,.xln,.txt,.csv,.pos,.tsv,.ger,.gtp,.gbp,.gts,.gbs,.gto,.gbo,.json';

export const FORMATS = [
  ['KiCad', '.kicad_pcb (outline, holes, courtyards, 3D model names)'],
  ['Allegro, OrCAD, PADS, Xpedition, Altium and others', 'IPC-2581 .xml, ODB++ (.tgz or zip), GenCAD .cad, IDF, or STEP'],
  ['Altium / OrCAD / EasyEDA / any tool', 'STEP of the board, or a fab zip: Gerber outline + NC drill + pick & place'],
  ['Eagle / Fusion Electronics', '.brd (XML, and the binary files of Eagle 5 and older)'],
  ['Board viewers (OpenBoardView formats)', '.brd, .bdv, .bvr (outline, and parts as the spread of their pins)'],
  ['IDF 3.0', '.emn + .emp (outline, holes, parts with real heights)'],
  ['DXF', 'board outline drawing; holes from round cut-outs'],
] as const;

const head = (f: InFile, n = 4000) => strFromU8(f.bytes.subarray(0, n));
const text = (f: InFile) => strFromU8(f.bytes);
const isEagleXml = (f: InFile) => /\.brd$/i.test(f.name) && /<eagle/i.test(head(f, 2000));
const isIpc = (f: InFile) => /\.(xml|cvg)$/i.test(f.name) && isIpc2581(head(f));
const isGc = (f: InFile) => /\.(cad|gcd|gencad)$/i.test(f.name) && isGencad(head(f, 2000));
const isIdf = (f: InFile) => /\.(emn|idf|brd_idf)$/i.test(f.name) || (/\.(txt|brd)$/i.test(f.name) && /^\s*\.HEADER[\s\S]*BOARD_FILE/.test(head(f, 200)));
const inOdb = (f: InFile) => /(^|\/)(steps|matrix|misc|fonts|symbols|wheels)\//i.test((f.path ?? '').replace(/\\/g, '/')); // a file of an ODB++ job tree

/** What kind of board file this is, for splitting a drop into boards (null: a helper file, like a Gerber layer). */
function boardKind(f: InFile): string | null {
  if (/\.kicad_pcb$/i.test(f.name)) return 'kicad';
  if (/\.(step|stp)$/i.test(f.name)) return 'step';
  if (/\.dxf$/i.test(f.name)) return 'dxf';
  if (/\.(emn|idf)$/i.test(f.name)) return 'idf';
  const bk = brdKind(f);
  if (bk === 'eagle-xml') return 'eagle';
  if (bk === 'eagle-bin') return 'eagle-bin';
  if (bk === 'boardview') return 'boardview';
  if (isIpc(f)) return 'ipc';
  if (isGc(f)) return 'gencad';
  return null;
}

const BRD_FILE = /\.(brd|bdv|bvr?)$/i;

/**
 * What a .brd (or board-viewer) file really is, by its content: Eagle XML (6 and later), binary Eagle (5 and
 * older), a board-viewer file, Cadence Allegro (its version tag at byte 0xf8, as OpenBoardView checks it), or unknown.
 */
export function brdKind(f: InFile): 'eagle-xml' | 'eagle-bin' | 'boardview' | 'allegro' | null {
  if (!BRD_FILE.test(f.name)) return null;
  const b = f.bytes;
  if (/<eagle/i.test(strFromU8(b.slice(0, 2000)))) return 'eagle-xml';
  if (isEagleBinary(b)) return 'eagle-bin';
  if (sniffBoardView(b)) return 'boardview';
  const tag = String.fromCharCode(b[0xf8] ?? 0, b[0xf9] ?? 0, b[0xfa] ?? 0);
  if (tag === 'all' || tag === 'vie') return 'allegro';
  return null;
}
const base = (n: string) => n.replace(/\.[^.]+$/, '').toLowerCase();

/**
 * Split one drop into boards. Loose files: every KiCad, STEP, DXF, IDF, IPC-2581 or GenCAD file (with the files
 * of the same name, such as an .emp) and every Eagle .brd is a board of its own; loose Gerber, drill and
 * pick-and-place files together make one board. An archive or a dropped folder is one board, read from whichever
 * of its files tells the most, unless it holds several board files of the same kind (a zip of three KiCad boards).
 */
export function groupFiles(files: InFile[]): InFile[][] {
  const groups: InFile[][] = [];
  const split = (list: InFile[], rest: InFile[]) => {
    const heads = list.filter((f) => boardKind(f));
    const used = new Set<InFile>();
    for (const h of heads) {
      if (used.has(h)) continue;
      const g = list.filter((f) => !used.has(f) && (f === h || base(f.name) === base(h.name)));
      g.forEach((f) => used.add(f));
      groups.push(g);
    }
    rest.push(...list.filter((f) => !used.has(f)));
  };
  // one bundle: several boards only when one kind of board file comes more than once
  const bundle = (inner: InFile[]) => {
    const count = new Map<string, number>();
    for (const x of inner) { const k = boardKind(x); if (k) count.set(k, (count.get(k) ?? 0) + 1); }
    if ([...count.values()].some((n) => n > 1)) { const rest: InFile[] = []; split(inner, rest); if (rest.length) groups.push(rest); }
    else if (inner.length) groups.push(inner);
  };
  const loose: InFile[] = [];
  const folders = new Map<string, InFile[]>();
  for (const f of files) {
    if (isArchiveName(f.name)) { bundle(expandAll([f])); continue; }
    const top = (f.path ?? '').replace(/\\/g, '/').match(/^([^/]+)\//)?.[1];
    if (top) { if (!folders.has(top)) folders.set(top, []); folders.get(top)!.push(f); } else loose.push(f);
  }
  for (const fl of folders.values()) bundle(expandAll(fl));
  const rest: InFile[] = [];
  split(loose, rest);
  if (rest.length) groups.push(rest);
  return groups;
}

/** Import every board in a drop; files that fail are reported, the rest still come in. */
export async function importMany(files: InFile[]): Promise<{ boards: Board[]; errors: string[] }> {
  const boards: Board[] = [], errors: string[] = [];
  for (const g of groupFiles(files)) {
    try { boards.push(await importFiles(g)); } catch (e: any) { errors.push(`${g.map((f) => f.name).slice(0, 3).join(', ')}${g.length > 3 ? '…' : ''}: ${e?.message ?? e}`); }
  }
  return { boards, errors };
}

export async function importFiles(files: InFile[]): Promise<Board> {
  return tidy(await readBoard(files), files);
}

/** A file name made readable: "psu_plate" -> "Psu plate", "lora-Edge_Cuts" -> "Lora". */
export function niceName(stem: string): string {
  const s = stem.replace(/[-_. ](edge[_. ]?cuts|f[_. ]?cu|b[_. ]?cu|gko|gm1|outline|board|pcb|gerbers?|fab|outputs?|cpl|pos|top|bottom|drill)$/i, '').replace(/[_]+|(?<=[a-z0-9])-(?=[a-z])/gi, ' ').replace(/\s+/g, ' ').trim() || stem;
  return s === s.toLowerCase() ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Board names from file names read like names, and hole sizes lose float noise (3.1999999 -> 3.2). */
function tidy(b: Board, files: InFile[]): Board {
  const stems = expandAll(files).map((f) => f.name.replace(/\.[^.]+$/, ''));
  if (stems.includes(b.name) || /[-_](edge|f_cu|b_cu)/i.test(b.name)) {
    // a Gerber set: the part of the names every file shares ("lora-Edge_Cuts", "lora-F_Cu", "lora" -> "lora")
    let pre = stems[0] ?? b.name;
    for (const x of stems) while (pre && !x.startsWith(pre)) pre = pre.slice(0, -1);
    pre = pre.replace(/[-_. ]+$/, '');
    b = { ...b, name: niceName(pre.length >= 2 && stems.length > 1 ? pre : b.name) };
  }
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { ...b, holes: b.holes.map((h) => ({ ...h, x: r(h.x), y: r(h.y), d: r(h.d) })) };
}

/** One way of reading the board from the files at hand. */
interface Candidate { fmt: string; label: string; read: () => Board | Promise<Board> }
/** An error whose short reason is given separately, for the notes of a board read from another file. */
class ReadError extends Error { brief: string; constructor(msg: string, brief: string) { super(msg); this.brief = brief; } }

/**
 * Every way the files could give a board, fullest first: KiCad, STEP, IPC-2581, ODB++, IDF, Eagle XML, binary
 * Eagle, board viewers (then Allegro and unknown .brd files, which only answer), GenCAD, Gerber + drill + pick-and-place, DXF.
 */
function candidates(all: InFile[], group: string): Candidate[] {
  const out: Candidate[] = [];
  const each = (fmt: string, pick: (f: InFile) => boolean, read: (f: InFile) => Board | Promise<Board>) => { for (const f of all.filter(pick)) out.push({ fmt, label: f.path ?? f.name, read: () => read(f) }); };
  each('KiCad', (f) => /\.kicad_pcb$/i.test(f.name), (f) => importKicad(text(f), f.name));
  each('STEP', (f) => /\.(step|stp)$/i.test(f.name), (f) => importStep(f.bytes, f.name));
  each('IPC-2581', isIpc, (f) => importIpc2581(text(f), f.name));
  for (const job of findOdb(all)) out.push({ fmt: 'ODB++', label: job.root ? job.root.replace(/\/$/, '') : `the ODB++ job in ${group}`, read: () => importOdb(job, group) });
  each('IDF', isIdf, (f) => {
    const emp = all.find((g) => /\.emp$/i.test(g.name) && base(g.name) === base(f.name)) ?? all.find((g) => /\.emp$/i.test(g.name));
    return importIdf(text(f), emp ? text(emp) : '', f.name);
  });
  each('Eagle', isEagleXml, (f) => importEagle(text(f), f.name));
  each('binary Eagle', (f) => brdKind(f) === 'eagle-bin', (f) => importEagleBinary(f.bytes, f.name));
  each('board viewer', (f) => brdKind(f) === 'boardview', (f) => importBoardView(f.bytes, f.name));
  each('Allegro .brd', (f) => /\.brd$/i.test(f.name) && !isEagleXml(f) && !isIdf(f) && (brdKind(f) === 'allegro' || isAllegroBrd(f.bytes)), (f) => {
    throw new ReadError(allegroMessage(f.name, f.bytes), 'it is a Cadence Allegro board, whose format is not published');
  });
  each('.brd', (f) => BRD_FILE.test(f.name) && brdKind(f) === null && !isIdf(f) && !isAllegroBrd(f.bytes), () => {
    throw new ReadError('This .brd is not an Eagle board (XML or binary) or a board-viewer file BoardDock knows. Export STEP, IDF or Gerber + drill from the program that made it.', 'it is a .brd BoardDock does not know');
  });
  each('GenCAD', isGc, (f) => importGencad(text(f), f.name));
  // Gerber + drill + pick-and-place: every loose text file that is not one of the formats above
  const fabIn = all.filter((f) => !/\.(pdf|png|jpe?g|step|stp|zip|tgz|tar|gz|kicad_pcb|emn|emp|brd|bdv|bvr?|dxf|cad|json)$/i.test(f.name) && !inOdb(f) && !isIpc(f) && f.bytes.length < 60e6);
  const outlines = fabIn.filter((f) => classifyFabFile({ name: f.name, text: head(f, 20000) }) === 'outline');
  if (outlines.length) {
    const nm = all.length === 1 ? all[0].name : group;
    out.push({
      fmt: 'Gerber + drill', label: `${fabIn.length} Gerber, drill and placement file${fabIn.length > 1 ? 's' : ''}`,
      read: () => { const fab: FabFiles[] = fabIn.map((f) => ({ name: f.name, text: text(f) })); return importFab(fab, nm.replace(/\.[^.]+$/, '').replace(/[-_](gerbers?|fab|outputs?)$/i, '') || 'Board'); },
    });
  }
  each('DXF', (f) => /\.dxf$/i.test(f.name), (f) => importDxf(text(f), f.name));
  return out;
}

const firstSentence = (s: string) => (s.match(/^[\s\S]*?[.!?](?=\s|$)/)?.[0] ?? s).replace(/\.$/, '');

async function readBoard(files: InFile[]): Promise<Board> {
  const all = expandAll(files);
  const group = files[0]?.name ?? 'Board';
  const cands = candidates(all, group);
  const failed: { c: Candidate; e: any }[] = [];
  for (const c of cands) {
    let b: Board;
    try { b = await c.read(); } catch (e: any) { failed.push({ c, e }); continue; }
    if (cands.length > 1) b = { ...b, notes: [...b.notes, ...whichFile(c, cands, failed)] };
    return b;
  }
  if (failed.length === 1) throw failed[0].e instanceof Error ? failed[0].e : new Error(String(failed[0].e));
  if (failed.length > 1) throw new Error(`None of the files could be read. ${failed.map(({ c, e }) => `${c.label} (${c.fmt}): ${e?.message ?? e}`).join(' ')}`);
  if (all.some((f) => /\.pcbdoc$/i.test(f.name))) throw new Error('Altium .PcbDoc is a binary format. In Altium use File > Export > STEP 3D (best), or File > Fabrication Outputs > IPC-2581 or ODB++, or open the fab outputs (Gerber + NC Drill + Pick and Place) as one zip.');
  if (all.some((f) => /\.(asc|pcb)$/i.test(f.name))) throw new Error('PADS and other native board files cannot be read. In PADS Layout use File › Export for IPC-2581, ODB++ or IDF, or send the Gerber, drill and pick-and-place files.');
  throw new Error('No board outline found. Supported: KiCad .kicad_pcb, STEP, IPC-2581 .xml, ODB++ (.tgz, .zip or folder), IDF .emn, Eagle .brd (XML or binary), board-viewer .brd / .bdv / .bvr, GenCAD .cad, Gerber outline + drill (+ pick & place), DXF.');
}

/** Notes for a board read from one of several files: which one, which failed and why, and which were not needed. */
function whichFile(used: Candidate, all: Candidate[], failed: { c: Candidate; e: any }[]): string[] {
  const notes = [`Read from ${used.label} (${used.fmt}).`];
  for (const { c, e } of failed) notes.push(`${c.label} (${c.fmt}) was tried first but could not be read: ${e instanceof ReadError ? e.brief : firstSentence(String(e?.message ?? e))}.`);
  const rest = all.slice(all.indexOf(used) + 1);
  if (rest.length) notes.push(`Also there, not needed: ${rest.map((c) => `${c.label} (${c.fmt})`).join(', ')}. BoardDock reads the format that tells it most: KiCad, then STEP, IPC-2581, ODB++, IDF, Eagle, GenCAD, board viewers, Gerbers with drill and pick-and-place, DXF.`);
  return notes;
}
