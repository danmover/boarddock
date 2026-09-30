// What is new in the 3D scene since the rack was built, from the same What's new list Export shows: the new printed
// parts (matched by where they sit), new cables, new boards and any rail that has to be longer.
import type { GenResult, PickTag, Project } from './types';
import { delta } from './built';

export interface NewSet {
  keys: Set<string>; // placeKey of each new placement of a printed part
  cables: Set<string>; // link ids of new cables
  modules: Set<string>; // boards added since (everything of theirs: holder, board, plugs, plug pack)
  rails: Set<string>;
  any: boolean;
}

const r2 = (v: number) => Math.round(v * 20) / 20;
/** One placement of a part: what it is (its tag) and where (its matrix's translation). */
export const placeKey = (tag: PickTag | undefined, T: ArrayLike<number>) => `${tag?.kind ?? ''}|${tag?.module ?? ''}|${tag?.mount ?? ''}|${tag?.rail ?? ''}|${r2(T[12])},${r2(T[13])},${r2(T[14])}`;

/** The new things on a built rack, or null when it was never marked built. */
export function newSet(p: Project, res: GenResult): NewSet | null {
  const d = delta(p, res);
  if (!d) return null;
  const keys = new Set<string>();
  for (const pt of d.parts) {
    keys.add(placeKey(pt.tag, pt.toAssembly));
    (pt.instances ?? []).forEach((T, k) => keys.add(placeKey(pt.tags?.[k] ?? pt.tag, T)));
  }
  const built = new Set(p.built!.boards);
  const modules = new Set(p.modules.filter((m) => !built.has(m.id)).map((m) => m.id));
  const cables = new Set(d.cables.map((c) => c.id));
  const rails = new Set(d.rails.map((r) => r.id));
  return { keys, cables, modules, rails, any: d.any || modules.size > 0 };
}

/** Whether a piece of the scene (its tag and matrix) is one of the new things. */
export function isNewPiece(s: NewSet, tag: PickTag | undefined, T: ArrayLike<number>): boolean {
  if (!tag) return false;
  if (tag.module && s.modules.has(tag.module)) return true;
  if (tag.kind === 'cable') return !!tag.refs?.[0] && s.cables.has(tag.refs[0]);
  if (tag.rail && s.rails.has(tag.rail)) return true;
  return s.keys.has(placeKey(tag, T));
}
