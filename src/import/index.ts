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

export async function importFiles(files: InFile[]): Promise<Board> {
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
