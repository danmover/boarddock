// "Mark as built": remember what was printed, cut and bought, so that after adding a board Export can list just the
// new parts, the new cables and any rail that has to be longer. Parts are recognised by their geometry, so a holder
// that did not change is not printed again.
import type { Built, GenResult, PanelReport, PartOut, Project } from './types';

/** Docks and flat clips numbered the way you count them on the rack: rail 1, second dock = "1.2". */
export function mountLabels(panel: PanelReport | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!panel) return out;
  panel.rails.forEach((r, ri) => {
    panel.mounts.filter((m) => m.rail === r.id).sort((a, b) => a.at - b.at).forEach((m, k) => out.set(m.id, `${ri + 1}.${k + 1}`));
  });
  return out;
}

/** Where each board sits: "dock 1.3 back", "clip 2.1". */
export function seatLabels(panel: PanelReport | null | undefined): Map<string, string> {
  const out = new Map<string, string>(), lab = mountLabels(panel);
  for (const m of panel?.modules ?? []) {
    const mt = panel!.mounts.find((x) => x.id === m.mount);
    if (!mt) continue;
    out.set(m.id, `${mt.kind === 'dock' ? 'dock' : 'clip'} ${lab.get(mt.id) ?? mt.id}${mt.kind === 'dock' && mt.slots.length > 1 ? (m.slot ? ' back' : ' front') : ''}`);
  }
  return out;
}

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
    names: Object.fromEntries(p.modules.map((m) => [m.id, m.board.name])),
    seats: Object.fromEntries(seatLabels(res.report.panel)),
    cableInfo: (res.report.cables ?? []).map((c) => ({ sig: cableSig(c), no: c.no, a: c.a, b: c.b, buy: c.buy })),
  };
}

export interface Delta {
  parts: PartOut[]; // only the ones to print, with qty = how many more
  why: Map<PartOut, string>; // why each has to be printed: "new board", "Pi 4B 2 replaced", "changed shape"
  cables: (Cable & { was?: number })[]; // cables to buy; was: the length (m) of the cable with that number before
  rails: { id: string; length: number; was: number | null }[]; // rails to cut (new, or longer than before)
  boards: string[]; // names of boards added since
  removed: string[]; // boards taken off since
  revised: string[]; // boards with a new version swapped in since
  moved: { name: string; from: string; to: string }[]; // boards that sit somewhere else now
  spare: { name: string; qty: number }[]; // printed parts the rack no longer uses
  spareCables: { no?: number; a: string; b: string }[]; // cables it no longer uses
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
  const now = res.report.cables ?? [];
  const info = b.cableInfo ?? [];
  // a cable whose route got shorter keeps the one you have (it still reaches); only new or longer ones are to buy
  // a probe's ribbon comes with the probe: never on the list to buy
  const cables: Delta['cables'] = now.filter((c) => c.ribbon == null && !had.has(cableSig(c))).map((c): Delta['cables'][number] => { const o = info.find((x) => c.no != null && x.no === c.no); return o ? { ...c, was: o.buy } : c; })
    .filter((c) => c.was == null || c.buy > c.was);
  const nowSigs = new Set(now.map(cableSig));
  // a cable is spare when no cable on the rack has its number any more (one that changed length is still in use)
  const spareCables = info.filter((x) => !nowSigs.has(x.sig) && !now.some((c) => c.no != null && c.no === x.no)).map((x) => ({ no: x.no, a: x.a, b: x.b }));
  const rails = (res.report.panel?.rails ?? []).map((r) => ({ id: r.id, length: r.length, was: b.rails.find((x) => x.id === r.id)?.length ?? null })).filter((r) => r.was == null || r.length > r.was + 0.5);
  const boards = p.modules.filter((m) => !b.boards.includes(m.id)).map((m) => m.board.name);
  const removed = b.boards.filter((id) => !p.modules.some((m) => m.id === id)).map((id) => b.names?.[id] ?? 'a board');
  const seats = seatLabels(res.report.panel);
  const moved = p.modules.filter((m) => b.boards.includes(m.id) && b.seats?.[m.id] && seats.get(m.id) && b.seats[m.id] !== seats.get(m.id)).map((m) => ({ name: m.board.name, from: b.seats![m.id], to: seats.get(m.id)! }));
  const spare = Object.entries(left).filter(([, n]) => n > 0).map(([sig, n]) => ({ name: sig.split('|')[0], qty: n }));
  // a stand spacer whose comb now needs fewer slots: the printed one (with a slot to spare) still does the job
  const comb = (n: string) => /^(.*), comb for (\d+) cables?$/.exec(n);
  for (const pt of [...parts]) {
    const m = comb(pt.name);
    if (!m) continue;
    const old = spare.find((x) => { const o = comb(x.name); return o && o[1] === m[1] && +o[2] >= +m[2] && x.qty > 0; });
    if (!old) continue;
    const k = Math.min(old.qty, pt.qty);
    old.qty -= k;
    if (pt.qty - k > 0) parts.splice(parts.indexOf(pt), 1, { ...pt, qty: pt.qty - k, instances: pt.instances?.slice(0, pt.qty - k - 1) });
    else parts.splice(parts.indexOf(pt), 1);
  }
  for (let i = spare.length - 1; i >= 0; i--) if (spare[i].qty <= 0) spare.splice(i, 1);
  // why a part is on the list: its board is new, was replaced (another board in the same place), or it changed
  const why = new Map<PartOut, string>();
  for (const pt of parts) {
    const id = pt.tag?.module, m = id ? p.modules.find((x) => x.id === id) : null;
    if (!m) why.set(pt, pt.tag?.kind === 'railstand' ? 'the stands changed' : pt.tag?.kind === 'shoe' || pt.tag?.kind === 'socket' ? 'a new dock' : pt.tag?.kind === 'cabletag' ? 'a new cable' : 'changed');
    else if (!b.boards.includes(m.id)) why.set(pt, `new: ${m.board.name}`);
    else if (m.revision && m.revision.at > b.at) why.set(pt, `new version of ${m.board.name}`);
    else if (b.names?.[m.id] && b.names[m.id] !== m.board.name) why.set(pt, `${b.names[m.id]} became ${m.board.name}`);
    else if (moved.some((x) => x.name === m.board.name)) why.set(pt, `${m.board.name} moved`);
    else why.set(pt, `${m.board.name} changed`);
  }
  const revised = p.modules.filter((m) => b.boards.includes(m.id) && m.revision && m.revision.at > b.at).map((m) => m.board.name);
  return { parts, why, cables, rails, boards, removed, revised, moved, spare, spareCables, any: parts.length + cables.length + rails.length + removed.length + moved.length > 0 };
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
