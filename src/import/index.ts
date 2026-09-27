// One entry point for every supported input. Accepts several files at once (e.g. a Gerber set) and zip archives.
import { unzipSync, strFromU8 } from 'fflate';
import type { Board } from '../model/types';
import { importKicad } from './kicad';
import { importFab, classifyFabFile, type FabFiles } from './fab';
import { importEagle, importIdf, importDxf } from './other';
import { importStep } from './step';

export interface InFile { name: string; bytes: Uint8Array }

export const ACCEPT = '.kicad_pcb,.brd,.emn,.emp,.idf,.step,.stp,.dxf,.zip,.gbr,.gko,.gm1,.gml,.gtl,.gbl,.drl,.xln,.txt,.csv,.pos,.tsv,.ger,.gtp,.gbp,.gts,.gbs,.gto,.gbo,.json';

export const FORMATS = [
  ['KiCad', '.kicad_pcb (outline, holes, courtyards, 3D model names)'],
  ['Altium / OrCAD / EasyEDA / any tool', 'STEP of the board, or a fab zip: Gerber outline + NC drill + pick & place'],
  ['Eagle / Fusion Electronics', '.brd'],
  ['IDF 3.0', '.emn + .emp (outline, holes, parts with real heights)'],
  ['DXF', 'board outline drawing; holes from round cut-outs'],
] as const;

function expand(files: InFile[]): InFile[] {
  const out: InFile[] = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const z = unzipSync(f.bytes);
      for (const [n, b] of Object.entries(z)) if (b.length && !n.endsWith('/') && !/__MACOSX/.test(n)) out.push({ name: n.split('/').pop()!, bytes: b });
    } else out.push(f);
  }
  return out;
}

const BOARD_FILE = /\.(kicad_pcb|step|stp|dxf|emn|idf)$/i;
const base = (n: string) => n.replace(/\.[^.]+$/, '').toLowerCase();

/**
 * Split one drop into boards: every KiCad, STEP, DXF or IDF file (with the .emp of the same name) and every Eagle
 * .brd is a board of its own; a zip is one board unless it holds several board files; loose Gerber, drill and
 * pick-and-place files together make one board. Files sharing a board file's name go with it.
 */
export function groupFiles(files: InFile[]): InFile[][] {
  const groups: InFile[][] = [];
  const loose: InFile[] = [];
  const isEagle = (f: InFile) => /\.brd$/i.test(f.name) && /<eagle/i.test(strFromU8(f.bytes.slice(0, 2000)));
  const split = (list: InFile[], rest: InFile[]) => {
    const heads = list.filter((f) => BOARD_FILE.test(f.name) || isEagle(f));
    const used = new Set<InFile>();
    for (const h of heads) {
      if (used.has(h)) continue;
      const g = list.filter((f) => !used.has(f) && (f === h || base(f.name) === base(h.name)));
      g.forEach((f) => used.add(f));
      groups.push(g);
    }
    rest.push(...list.filter((f) => !used.has(f)));
  };
  for (const f of files) {
    if (!/\.zip$/i.test(f.name)) { loose.push(f); continue; }
    const inner = expand([f]);
    if (inner.filter((x) => BOARD_FILE.test(x.name) || isEagle(x)).length > 1) { const rest: InFile[] = []; split(inner, rest); if (rest.length) groups.push(rest); }
    else groups.push(inner);
  }
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
  const stems = expand(files).map((f) => f.name.replace(/\.[^.]+$/, ''));
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

async function readBoard(files: InFile[]): Promise<Board> {
  const all = expand(files);
  const by = (re: RegExp) => all.find((f) => re.test(f.name));
  const text = (f: InFile) => strFromU8(f.bytes);
  const kicad = by(/\.kicad_pcb$/i);
  if (kicad) return importKicad(text(kicad), kicad.name);
  const step = by(/\.(step|stp)$/i);
  if (step) return importStep(step.bytes, step.name);
  const emn = by(/\.(emn|idf|brd_idf)$/i) ?? all.find((f) => /^\s*\.HEADER[\s\S]*BOARD_FILE/.test(text(f).slice(0, 200)));
  if (emn) return importIdf(text(emn), by(/\.emp$/i) ? text(by(/\.emp$/i)!) : '', emn.name);
  const brd = all.find((f) => /\.brd$/i.test(f.name) && /<eagle/i.test(text(f).slice(0, 2000)));
  if (brd) return importEagle(text(brd), brd.name);
  const fab: FabFiles[] = all.filter((f) => !/\.(pdf|png|jpg|step|stp|zip)$/i.test(f.name) && f.bytes.length < 60e6).map((f) => ({ name: f.name, text: text(f) }));
  if (fab.some((f) => classifyFabFile(f) === 'outline')) {
    const base = files[0]?.name.replace(/\.[^.]+$/, '').replace(/[-_](gerbers?|fab|outputs?)$/i, '') || 'Board';
    return importFab(fab, base);
  }
  const dxf = by(/\.dxf$/i);
  if (dxf) return importDxf(text(dxf), dxf.name);
  if (by(/\.pcbdoc$/i)) throw new Error('Altium .PcbDoc is a binary format. In Altium use File > Export > STEP 3D (best), or open the fab outputs (Gerber + NC Drill + Pick and Place) as one zip.');
  if (by(/\.brd$/i)) throw new Error('This .brd is a binary (Eagle 5 or older, or Allegro) file. Export IDF, STEP or Gerber + drill instead.');
  throw new Error('No board outline found. Supported: KiCad .kicad_pcb, STEP, IDF .emn, Eagle .brd, Gerber outline + drill (+ pick & place), DXF.');
}
