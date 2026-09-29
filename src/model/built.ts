// "Mark as built": remember what was printed, cut and bought, so that after adding a board Export can list just the
// new parts, the new cables and any rail that has to be longer. Parts are recognised by their geometry, so a holder
// that did not change is not printed again.
import type { Built, GenResult, Module, PanelReport, PartOut, Project } from './types';
import { baseOf, stackMode } from './holes';
import { isProbe } from './probes';
import { isPlugPack } from './powerdata';
import { packGoes } from './links';

/**
 * The boxes that need a hook-and-loop strap: those in a holder with strap loops. A J-Link or adapter is a board, a
 * plug pack sits in an outlet and never gets a holder, and a box not on a rail (or riding one that isn't) has none.
 * `panel`: the rack's report, for which boards are on the rails; loose holders each get their own.
 */
export function strapBoxes(p: Project, panel?: PanelReport | null): Module[] {
  const seated = p.layout === 'panel' ? new Set((panel?.modules ?? []).map((s) => s.id)) : null;
  return p.modules.filter((m) => m.board.kind === 'box' && !isProbe(m) && !isPlugPack(m.board) && (!seated || seated.has(baseOf(p, m).id)));
}

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
    mounts: Object.fromEntries((res.report.panel?.mounts ?? []).map((m) => [m.id, { rail: m.rail, at: Math.round(m.at * 10) / 10 }])),
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
  slid: { dock: string; rail: string; from: number; to: number }[]; // built docks that sit somewhere else along their rail now
  spare: { name: string; qty: number }[]; // printed parts the rack no longer uses
  spareCables: { no?: number; a: string; b: string }[]; // cables it no longer uses
  plan: PlanStep[]; // the same, as the steps you would take at the rack, in order
  any: boolean;
}

/**
 * One thing to do at the rack, in the order you would do it: take boards off, swap boards, cut rails and move the
 * end blocks, move docks, clip on new docks, seat boards, plug cables in. `parts`: what to print for it.
 */
export interface PlanStep {
  kind: 'off' | 'swap' | 'cut' | 'ends' | 'move' | 'dock' | 'seat' | 'cable' | 'print';
  text: string;
  parts?: PartOut[];
}

const railText = (rep: PanelReport | null | undefined, id: string) => `rail ${Math.max(1, (rep?.rails.findIndex((r) => r.id === id) ?? 0) + 1)}`;
const qtyName = (x: { name: string; qty: number }) => `${x.name}${x.qty > 1 ? ` ×${x.qty}` : ''}`;

/** The steps of a delta, in the order you would work at the rack. */
function planOf(p: Project, res: GenResult, b: Built, d: Omit<Delta, 'plan' | 'any'>): PlanStep[] {
  const rep = res.report.panel, seats = seatLabels(rep), labels = mountLabels(rep);
  const out: PlanStep[] = [];
  const nameOf = (id: string) => p.modules.find((m) => m.id === id)?.board.name ?? b.names?.[id] ?? 'a board';
  const partsOf = (id: string) => d.parts.filter((pt) => pt.tag?.module === id);
  const used = new Set<PartOut>();
  const take = (xs: PartOut[]) => { for (const x of xs) used.add(x); return xs; };
  // a board replaced in its place keeps its id and takes a new name; one taken off and one added in the same spot is
  // a swap too
  const gone = b.boards.filter((id) => !p.modules.some((m) => m.id === id));
  const fresh = p.modules.filter((m) => !b.boards.includes(m.id));
  const swapped = new Set<string>();
  for (const id of gone) {
    const at = b.seats?.[id], into = at ? fresh.find((m) => seats.get(m.id) === at && !swapped.has(m.id)) : undefined;
    if (into) {
      swapped.add(into.id); swapped.add(id);
      out.push({ kind: 'swap', text: `Swap ${b.names?.[id] ?? 'the board'} for ${into.board.name} in ${at}: take the old one out of its holder and dock, print the new holder, seat ${into.board.name} in it and plug its holder into the same dock.`, parts: take(partsOf(into.id)) });
    } else out.push({ kind: 'off', text: `Take ${b.names?.[id] ?? 'a board'} off${at ? ` ${at}` : ''}: press its holder's button and lift it out.` });
  }
  for (const m of p.modules) {
    if (!b.boards.includes(m.id)) continue;
    const was = b.names?.[m.id], ps = partsOf(m.id);
    if (m.revision && m.revision.at > b.at) out.push({ kind: 'swap', text: `Swap in the new version of ${m.board.name}${seats.get(m.id) ? ` (${seats.get(m.id)})` : ''}: take the board out, print its new holder, and seat the new board in it.${ps.length ? '' : ' Its holder comes out the same, so there is nothing to print.'}`, parts: take(ps) });
    else if (was && was !== m.board.name && ps.length) out.push({ kind: 'swap', text: `Swap ${was} for ${m.board.name}${seats.get(m.id) ? ` in ${seats.get(m.id)}` : ''}: print the new holder, seat ${m.board.name} in it and plug it into the same dock.`, parts: take(ps) });
  }
  for (const r of d.rails) {
    out.push({ kind: 'cut', text: r.was == null ? `Cut a new ${Math.round(r.length)} mm rail for ${railText(rep, r.id)}.` : `Cut a longer rail for ${railText(rep, r.id)}: ${Math.round(r.length)} mm (yours is ${Math.round(r.was)} mm). Slide the docks across onto it in the same order.` });
    if (r.was != null && p.panel.stands !== false) out.push({ kind: 'ends', text: `Move the end block at the far end of ${railText(rep, r.id)} out to the new end, ${Math.round(r.length - r.was)} mm further.` });
  }
  // docks slid along their rail (to make room): before any new dock goes on, from the far end back so none is in the way
  for (const x of d.slid) out.push({ kind: 'move', text: `Slide dock ${x.dock} along ${x.rail} to ${Math.round(x.to)} mm from its start (it is at ${Math.round(x.from)} mm): press its shoe's release lever, move it, and let it click back on.` });
  for (const m of d.moved) out.push({ kind: 'move', text: `Move ${m.name} from ${m.from} to ${m.to}.`, parts: take(partsOf(p.modules.find((x) => x.board.name === m.name)?.id ?? '')) });
  // new docks: where their shoes clip on, from the rail's start
  const newMounts = [...new Set(d.parts.filter((pt) => pt.tag?.kind === 'shoe' || pt.tag?.kind === 'socket').flatMap((pt) => [pt.tag, ...(pt.tags ?? [])].map((t) => t?.mount)).filter(Boolean) as string[])];
  for (const id of newMounts) {
    const mt = rep?.mounts.find((x) => x.id === id);
    if (!mt) continue;
    const ps = take(d.parts.filter((pt) => (pt.tag?.kind === 'shoe' || pt.tag?.kind === 'socket') && [pt.tag, ...(pt.tags ?? [])].some((t) => t?.mount === id)).map((pt) => ({ ...pt, qty: 1 })));
    out.push({ kind: 'dock', text: `Clip a new dock (${mt.kind === 'dock' ? 'shoe and socket' : 'flat clip'}) onto ${railText(rep, mt.rail)} at ${Math.round(mt.at)} mm from its start: dock ${labels.get(id) ?? ''}.`.replace(' :', ':'), parts: ps });
  }
  for (const m of fresh) {
    if (swapped.has(m.id)) continue;
    // a plug pack has no holder: it goes in its outlet, its lead to its board
    if (isPlugPack(m.board)) { out.push({ kind: 'cable', text: `Push ${packGoes(p, m)}.` }); continue; }
    const where = m.on ? (stackMode(p, m) === 'bolted' ? `bolt it onto ${nameOf(m.on)} on its standoffs` : `press it onto the corner towers of ${nameOf(m.on)}'s holder`) : `plug the holder into ${seats.get(m.id) ?? 'its dock'}`;
    out.push({ kind: 'seat', text: `Seat ${m.board.name} in its holder and ${where}.`, parts: take(partsOf(m.id)) });
  }
  // anything else to print that belongs to a board already there (a holder that changed)
  for (const m of p.modules) {
    const ps = partsOf(m.id).filter((x) => !used.has(x));
    if (ps.length) out.push({ kind: 'print', text: `Print a new holder for ${m.board.name} (${d.why.get(ps[0]) ?? 'it changed'}) and swap it in.`, parts: take(ps) });
  }
  const rest = d.parts.filter((x) => !used.has(x));
  if (rest.length) out.push({ kind: 'print', text: `Also print: ${[...new Set(rest.map((x) => d.why.get(x) ?? 'changed'))].join(', ')}.`, parts: rest });
  if (d.cables.length) out.push({ kind: 'cable', text: `Plug in ${d.cables.length > 1 ? `${d.cables.length} cables` : 'a cable'}: ${d.cables.map((c) => (c.was != null ? `#${c.no}, now ${c.buy} m (yours is ${c.was} m)` : `${c.no != null ? `#${c.no} ` : ''}${c.a} to ${c.b} (${c.buy} m)`)).join(', ')}.` });
  if (d.spare.length || d.spareCables.length) out.push({ kind: 'off', text: `Spare now: ${[...d.spare.map(qtyName), ...d.spareCables.map((c) => (c.no != null ? `cable #${c.no}` : `the ${c.a} to ${c.b} cable`))].join(', ')}.` });
  return out;
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
    // the new ones are the placements that were not there when it was built (matched by position), each with its
    // own tag (a dock's shoe says which dock it is: only the new docks' are new)
    const pool = spots[sig];
    const all = placements(pt).map((T, k) => ({ T, tag: k ? pt.tags?.[k - 1] ?? pt.tag : pt.tag }));
    let fresh = all;
    if (pool) fresh = fresh.filter(({ T }) => { const i = pool.findIndex((q) => Math.hypot(q[0] - T[12], q[1] - T[13], q[2] - T[14]) < 1); if (i < 0) return true; pool.splice(i, 1); return false; });
    fresh = (fresh.length >= need ? fresh : all.slice(-need)).slice(0, need);
    parts.push({ ...pt, qty: need, toAssembly: fresh[0]?.T ?? pt.toAssembly, instances: fresh.slice(1).map((x) => x.T), tag: fresh[0]?.tag ?? pt.tag, tags: pt.tags && fresh.slice(1).map((x) => x.tag!) });
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
  // built docks that slid along their rail since (racks marked built before docks' places were kept: none)
  const labels = mountLabels(res.report.panel), pr = res.report.panel;
  const slid = (pr?.mounts ?? []).flatMap((m) => { const o = b.mounts?.[m.id]; return o && o.rail === m.rail && Math.abs(o.at - m.at) > 0.5 ? [{ dock: labels.get(m.id) ?? m.id, rail: railText(pr, m.rail), from: o.at, to: m.at }] : []; })
    .sort((x, y) => y.to - x.to); // (the one furthest along first, so each has room to go)
  const d = { parts, why, cables, rails, boards, removed, revised, moved, slid, spare, spareCables };
  return { ...d, plan: planOf(p, res, b, d), any: parts.length + cables.length + rails.length + removed.length + moved.length + slid.length > 0 };
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
