// "Mark as built": remember what was printed, cut and bought, so that after adding a board Export can list just the
// new parts, the new cables and any rail that has to be longer. Parts are recognised by their geometry, so a holder
// that did not change is not printed again.
import type { Built, GenResult, PartOut, Project } from './types';

/** Every placement of a part in the rack (the first one, then its instances). */
const placements = (pt: PartOut) => [pt.toAssembly, ...(pt.instances ?? [])].slice(0, Math.max(1, pt.qty));

/** Stable signature of a printed part: its name, size and a hash of its mesh. */
export function partSig(pt: PartOut): string {
  const a = pt.mesh.pos, ix = pt.mesh.idx;
  let h = 2166136261;
  // every coordinate (to 0.05 mm, so float noise between builds doesn't count) and the triangle count
  for (let i = 0; i < a.length; i++) { h ^= Math.round(a[i] * 20); h = Math.imul(h, 16777619); }
  h ^= a.length; h = Math.imul(h, 16777619);
  h ^= ix.length; h = Math.imul(h, 16777619);
  return `${pt.name}|${pt.size.map((v) => v.toFixed(1)).join('x')}|${(h >>> 0).toString(36)}`;
}

type Cable = NonNullable<GenResult['report']['cables']>[number];
/** A cable is the same cable while it joins the same two plugs with the same kind and length (renaming a board doesn't change it). */
export const cableSig = (c: Cable) => `${(c.ends ?? `${c.a}|${c.b}`).split('|').sort().join(' | ')}|${c.kind}|${c.buy}`;

export function snapshot(p: Project, res: GenResult): Built {
  const parts: Record<string, number> = {}, places: Record<string, number[][]> = {};
  for (const pt of res.parts) {
    const sig = partSig(pt);
    parts[sig] = (parts[sig] ?? 0) + pt.qty;
    places[sig] = [...(places[sig] ?? []), ...placements(pt).map((T) => [T[12], T[13], T[14]])];
  }
  return {
    at: new Date().toISOString(),
    parts,
    places,
    cables: (res.report.cables ?? []).map(cableSig),
    rails: (res.report.panel?.rails ?? []).map((r) => ({ id: r.id, length: r.length })),
    boards: p.modules.map((m) => m.id),
  };
}

export interface Delta {
  parts: PartOut[]; // only the ones to print, with qty = how many more
  cables: Cable[];
  rails: { id: string; length: number; was: number | null }[]; // rails to cut (new, or longer than before)
  boards: string[]; // names of boards added since
  any: boolean;
}

/** What is new since the rack was built. */
export function delta(p: Project, res: GenResult): Delta | null {
  const b = p.built;
  if (!b) return null;
  const left = { ...b.parts };
  const spots = Object.fromEntries(Object.entries(b.places ?? {}).map(([k, v]) => [k, [...v]]));
  const parts: PartOut[] = [];
  for (const pt of res.parts) {
    const sig = partSig(pt), have = left[sig] ?? 0, need = pt.qty - have;
    left[sig] = Math.max(0, have - pt.qty);
    if (need <= 0) continue;
    // the new ones are the placements that were not there when it was built (matched by position)
    const pool = spots[sig];
    let fresh = placements(pt);
    if (pool) fresh = fresh.filter((T) => { const i = pool.findIndex((q) => Math.hypot(q[0] - T[12], q[1] - T[13], q[2] - T[14]) < 1); if (i < 0) return true; pool.splice(i, 1); return false; });
    fresh = (fresh.length >= need ? fresh : placements(pt).slice(-need)).slice(0, need);
    parts.push({ ...pt, qty: need, toAssembly: fresh[0] ?? pt.toAssembly, instances: fresh.slice(1) });
  }
  const had = new Set(b.cables);
  const cables = (res.report.cables ?? []).filter((c) => !had.has(cableSig(c)));
  const rails = (res.report.panel?.rails ?? []).map((r) => ({ id: r.id, length: r.length, was: b.rails.find((x) => x.id === r.id)?.length ?? null })).filter((r) => r.was == null || r.length > r.was + 0.5);
  const boards = p.modules.filter((m) => !b.boards.includes(m.id)).map((m) => m.board.name);
  return { parts, cables, rails, boards, any: parts.length + cables.length + rails.length > 0 };
}

/**
 * Just the parts for some boards: their holders, caps, rods and clips (boards stacked on them included by the
 * caller), optionally the shoe and socket of every dock that carries one of them, optionally the table stands.
 */
export function partsFor(res: GenResult, boards: Set<string>, opts: { docks: boolean; stands: boolean }): PartOut[] {
  const mounts = res.report.panel?.mounts ?? [];
  const dockOf = (id?: string) => !!id && mounts.some((m) => m.id === id && m.slots.some((s) => s.module && boards.has(s.module)));
  const out: PartOut[] = [];
  for (const pt of res.parts) {
    const tags = [pt.tag, ...(pt.tags ?? [])];
    let n = 0;
    for (let i = 0; i < pt.qty; i++) {
      const t = tags[i] ?? pt.tag;
      if (t?.kind === 'railstand' ? opts.stands : t?.kind === 'shoe' || t?.kind === 'socket' ? opts.docks && dockOf(t.mount) : t?.module ? boards.has(t.module) : false) n++;
    }
    if (n) out.push({ ...pt, qty: n, instances: pt.instances?.slice(0, n - 1) });
  }
  return out;
}
