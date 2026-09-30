// "Copy to…": one board's settings onto other boards, all of them or just the ones picked: the holder's options, the
// plug options of each connector (cradle, cap, guard, tie anchor) and which ports are marked "a plug will be in it" or
// "stays empty". Connectors are matched by name and type, so it works between boards of the same kind and, for the
// ports they share, between others. What is each board's own stays: its label, the clearances under it, its dock.
import type { HolderSettings, Module, Project } from './types';
import { kindName } from './diff';

export interface CopyWhat { holder: boolean; plugs: boolean; marks: boolean }
export interface CopyResult { boards: number; ports: number; missed: number } // ports: connector settings copied; missed: ports of the source a board has no match for

/** What a holder copies: the look and the build of it. Not the label, and not the clearances under this board's own parts. */
const HOLDER_KEYS = ['style', 'wall', 'base', 'gap', 'pattern', 'cell', 'rib', 'wallAbove', 'chamfer', 'material', 'feat', 'tabLip', 'grip', 'notches', 'release'] as const;

/** Give `to` the holder options of `from` (a colour or grip left unset there is unset here too). */
export function copyHolder(from: HolderSettings, to: HolderSettings) {
  const h = to as unknown as Record<string, unknown>;
  for (const k of HOLDER_KEYS) { if (from[k] === undefined) delete h[k]; else h[k] = structuredClone(from[k]); }
  if (from.color) to.color = from.color; else delete to.color;
}

/** The other boards, the ones of the same kind first: what "Copy to…" offers, and which of them are ticked to start with. */
export function copyTargets(p: Project, fromId: string): { same: Module[]; others: Module[] } {
  const me = p.modules.find((m) => m.id === fromId);
  if (!me) return { same: [], others: [] };
  const kin = kindName(p, me.board.name), rest = p.modules.filter((m) => m.id !== fromId);
  return { same: rest.filter((m) => kindName(p, m.board.name) === kin), others: rest.filter((m) => kindName(p, m.board.name) !== kin) };
}

/** Copy the chosen settings of board `fromId` onto the boards `toIds`, in place. */
export function copySettings(p: Project, fromId: string, toIds: string[], what: CopyWhat): CopyResult {
  const src = p.modules.find((m) => m.id === fromId), res: CopyResult = { boards: 0, ports: 0, missed: 0 };
  if (!src) return res;
  const srcPorts = src.board.comps.filter((c) => c.conn && !c.hidden);
  for (const m of p.modules) {
    if (m.id === fromId || !toIds.includes(m.id)) continue;
    res.boards++;
    if (what.holder) copyHolder(src.holder, m.holder);
    if (!what.plugs && !what.marks) continue;
    for (const s of srcPorts) {
      const c = m.board.comps.find((x) => x.ref === s.ref && x.conn?.type === s.conn!.type);
      if (!c?.conn) { res.missed++; continue; }
      if (what.plugs) { c.conn.cradle = s.conn!.cradle; c.conn.cap = s.conn!.cap; c.conn.guard = s.conn!.guard; c.conn.tie = s.conn!.tie; }
      if (what.marks) { if (s.conn!.use) c.conn.use = s.conn!.use; else delete c.conn.use; }
      res.ports++;
    }
  }
  return res;
}

/** The toast for a copy, in words. */
export function copyText(from: string, r: CopyResult, what: CopyWhat): string {
  const bits = [what.holder && 'holder options', what.plugs && 'cradles, caps, guards and tie anchors', what.marks && 'marked ports'].filter(Boolean) as string[];
  const list = bits.length > 1 ? `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}` : bits[0] ?? 'nothing';
  return `Copied ${list} from ${from} to ${r.boards} board${r.boards === 1 ? '' : 's'}${r.missed && (what.plugs || what.marks) ? ` (${r.missed} port${r.missed === 1 ? '' : 's'} had no match on the boards that lack ${r.missed === 1 ? 'it' : 'them'}, and stayed as they were)` : ''}. ⌘Z undoes it.`;
}
