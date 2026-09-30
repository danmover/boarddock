// The bill of materials: everything a rack is made of, and how many of each. What to print (each part, how many, and
// what one weighs), the boards, the boxes and supplies, the debug probes, the rails to cut, the cables to buy (worded
// as on the shopping list), the hardware (straps for the boxes that sit in a holder, a zip tie for each cable-tie
// anchor, standoffs and screws for a board bolted on another), the filament and the tools. It goes at the end of the
// printed build guide, in the Export step and in the download as BOM.csv. Pure: from the project and its build.
import { MATERIALS } from './library';
import { cableLines } from './cablelist';
import { stackHardware, baseOf } from './holes';
import { adapterFor, isDebugPort, isProbe } from './probes';
import { isPlugPack } from './powerdata';
import { poeHats } from './poe';
import { baseRef, findModule, isAccessory, plugName, viewOf } from './links';
import { strapBoxes } from './built';
import type { GenResult, Module, Project } from './types';

export interface BomRow { qty: number; item: string; note?: string }
export interface BomGroup { head: string; rows: BomRow[]; buy?: boolean } // buy: things to get (else what you print, have or already hold)

/** What a printed part is, by its tag, in the order the list gives them. */
const PRINT_GROUP: [string, string[]][] = [
  ['Holders', ['holder']],
  ['Dock parts', ['shoe', 'socket', 'rod']],
  ['Rail clips', ['clip']],
  ['Plug caps', ['cap']],
  ['Table stands', ['railstand', 'stand']],
  ['Stacking and linking', ['link', 'rivet']],
  ['Cable tags', ['cabletag']],
];

/** A board's name without the number that tells copies apart ("Raspberry Pi 4B #2"), to count them together. */
const kindName = (m: Module) => m.board.name.replace(/ #\d+$/, '');

/** A box's two hook-and-loop straps: each round it once, over the top, with room to fasten (cm, to the next 5). */
export const strapLength = (m: Module) => { const b = m.board.box; return b ? Math.ceil((2 * (b.w + b.h) + 80) / 50) * 5 : 30; };


export function billOfMaterials(p0: Project, res: GenResult): BomGroup[] {
  const p = viewOf(p0); // (no cables: none in the list)
  const out: BomGroup[] = [];
  const material = p.modules[0]?.holder.material ?? 'PETG', mat = MATERIALS[material] ?? MATERIALS.PETG;
  const count = <T>(xs: T[], key: (x: T) => string) => { const m = new Map<string, T[]>(); for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]); return [...m.entries()]; };

  // ---- to print: each part and how many, grouped by what it is; what one weighs ----
  let grams = 0;
  const parts = res.parts.map((x) => { const g = (x.volume / 1000) * mat.density; grams += g * x.qty; return { x, g }; });
  const kindOf = (k?: string) => PRINT_GROUP.find(([, ks]) => k && ks.includes(k))?.[0] ?? 'Other parts';
  for (const [head] of [...PRINT_GROUP, ['Other parts', []] as [string, string[]]]) {
    // parts of one name together (each holder's release rod is its own length, but a rod is a rod): how many, and
    // what one weighs (a range when they differ)
    const wt = (g: number) => (g < 1 ? g.toFixed(1) : String(Math.round(g)));
    const rows = count(parts.filter(({ x }) => kindOf(x.tag?.kind) === head), ({ x }) => x.name).map(([item, xs]) => {
      const qty = xs.reduce((a, { x }) => a + x.qty, 0), ws = [...new Set(xs.map(({ g }) => wt(g)))].sort((a, b) => +a - +b);
      return { qty, item, note: `${ws.length > 1 ? `${ws[0]} to ${ws[ws.length - 1]}` : ws[0]} g${qty > 1 ? ' each' : ''}` };
    });
    if (rows.length) out.push({ head: `Print: ${head.toLowerCase()}`, rows });
  }

  // ---- the boards, the boxes and supplies, the probes: what goes on the rack ----
  const byKind = (ms: Module[]) => count(ms, kindName).map(([item, xs]) => ({ qty: xs.length, item }));
  // (a switch's or hub's own supply came with it: nothing to buy)
  const own = (m: Module) => !!m.board.box?.pack?.own;
  const boards = p.modules.filter((m) => !isAccessory(m.board)), probes = p.modules.filter((m) => isProbe(m)), boxes = p.modules.filter((m) => isAccessory(m.board) && !isProbe(m) && !own(m));
  if (boards.length) out.push({ head: 'Boards', rows: byKind(boards) });
  if (boxes.length) out.push({ head: 'Boxes and supplies', rows: byKind(boxes).map((r) => { const m = boxes.find((x) => kindName(x) === r.item)!; return isPlugPack(m.board) ? { ...r, note: 'plugs into an outlet' } : r; }), buy: true });
  // (a J-Link's connector says which one to buy: 10-pin Cortex-M, 20-pin Cortex or the JTAG box header)
  const probeNote = (m: Module) => { const c = m.board.comps.find(isDebugPort); return c ? plugName(c.conn!.type) : undefined; };
  if (probes.length) out.push({ head: 'Debug probes and USB-serial adapters', rows: byKind(probes).map((r) => { const m = probes.find((x) => kindName(x) === r.item)!; const note = probeNote(m); return note ? { ...r, note: `${note} connector` } : r; }), buy: true });

  // ---- rails ----
  const rails = res.report.panel?.rails ?? [];
  if (rails.length) out.push({ head: 'Rails', buy: true, rows: count(rails, (r) => String(Math.round(r.length))).map(([len, xs]) => ({ qty: xs.length, item: `DIN rail (TS35 top-hat, 35 × 7.5 mm), cut to ${len} mm` })) });
  else if (p.layout === 'loose' && p.mount.kind === 'din') out.push({ head: 'Rails', buy: true, rows: [{ qty: 1, item: 'TS35 DIN rail (the 35 mm top-hat rail), long enough for the clipped holders' }] });

  // ---- cables: the shopping list's lines ("2 × 1 m USB-A to USB-C cable (numbers 3, 5)"), and what comes with parts ----
  const cl = cableLines(p, res.report.cables ?? []);
  if (cl.buy.length) out.push({ head: 'Cables', buy: true, rows: cl.buy.map((line) => { const m = /^(\d+) × (.*)$/.exec(line); return m ? { qty: +m[1], item: m[2] } : { qty: 1, item: line }; }) });
  const owned = p.modules.filter(own).map((m) => ({ qty: 1, item: m.board.name, note: `comes with the ${p.modules.find((x) => x.id === m.board.box!.pack!.own)?.board.name ?? 'box'}` }));
  if (cl.comes.length || owned.length) out.push({ head: 'Comes with the parts (nothing to buy)', rows: [...owned, ...cl.comes.map((item) => ({ qty: 1, item }))] });

  // ---- hardware ----
  const hw: BomRow[] = [];
  // (the boxes the shopping list counts: in a holder with strap loops, on the rack)
  const boxesStrapped = strapBoxes(p, res.report.panel);
  if (boxesStrapped.length) for (const [len, xs] of count(boxesStrapped, (m) => String(strapLength(m)))) hw.push({ qty: 2 * xs.length, item: `12 mm hook-and-loop strap, about ${len} cm`, note: `2 for each of ${xs.map((m) => m.board.name).join(', ')}` });
  // a zip tie through each cable-tie anchor (the loops of a box that takes ties instead of a strap count as anchors too)
  const ties = (res.report.features ?? []).filter((f) => f.kind === 'tie' && !f.refs?.includes('strap')).length;
  if (ties) hw.push({ qty: ties, item: 'zip tie, 2.5 to 3.6 mm wide, 100 mm or longer', note: 'one through each cable-tie anchor' });
  for (const m of p.modules) {
    const h = m.on && baseOf(p, m) !== m ? stackHardware(p, m) : null;
    if (!h) continue;
    const below = p.modules.find((x) => x.id === m.on)?.board.name ?? 'its board';
    hw.push({ qty: h.n, item: `${h.size} standoff, ${h.gap} mm`, note: `${m.board.name} on ${below}${h.shared ? '' : ': no holes line up, so check where yours go'}` }, { qty: h.screws, item: `${h.size} screw`, note: `a screw in each end of those standoffs` });
  }
  // a probe's ribbon onto a header of another kind needs an adapter
  const adapters = new Map<string, string[]>();
  for (const l of p.links ?? []) {
    if (l.kind !== 'debug') continue;
    const end = (r: typeof l.a) => { const m = findModule(p, r.module); return m && { m, c: m.board.comps.find((x) => x.ref === baseRef(r.ref)) }; };
    const A = end(l.a), B = end(l.b);
    if (!A?.c || !B?.c) continue;
    const [pr, bd] = isProbe(A.m) ? [A, B] : [B, A];
    const need = adapterFor(pr.c!, bd.c!);
    if (need) adapters.set(need, [...(adapters.get(need) ?? []), pr.m.board.name]);
  }
  for (const [item, who] of adapters) hw.push({ qty: who.length, item, note: who.join(', ') });
  hw.push(...poeHats(p));
  if (hw.length) out.push({ head: 'Hardware', rows: hw, buy: true });

  // ---- filament and tools ----
  out.push({ head: 'Filament', buy: true, rows: [{ qty: 1, item: `${material}, about ${Math.round(grams)} g`, note: grams > 900 ? `${Math.ceil(grams / 1000)} spools of 1 kg` : 'a 1 kg spool is plenty' }] });
  const tools: BomRow[] = [{ qty: 1, item: 'a 3D printer', note: 'every part prints without supports' }];
  if (rails.length || (p.layout === 'loose' && p.mount.kind === 'din')) tools.push({ qty: 1, item: 'a hacksaw and a file', note: 'to cut the rail and take the burr off' });
  if (ties) tools.push({ qty: 1, item: 'side cutters', note: 'to trim the zip ties' });
  if (hw.some((r) => / screw$/.test(r.item))) tools.push({ qty: 1, item: 'a small screwdriver', note: 'for the standoff screws of a board bolted on another (no printed part is screwed)' });
  out.push({ head: 'Tools', rows: tools });
  return out;
}

/** The bill of materials as a spreadsheet (CSV): one row per line, with its group. */
export function bomCsv(groups: BomGroup[]): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return ['Group,Qty,Item,Note', ...groups.flatMap((g) => g.rows.map((r) => [g.head, String(r.qty), r.item, r.note ?? ''].map(q).join(',')))].join('\n') + '\n';
}
