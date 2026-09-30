// The layout lock and change receipts. A dock, a rail or the whole layout can be locked: Auto-arrange, Tidy up, docks
// sliding to make room, probes moving to their board and every other automatic change leave it where it is. Each
// automatic change writes a receipt, a line saying what it did ("Auto-arrange moved Pi 4 #2 from rail 1 to rail 2"),
// kept in the project, so the list is undone with the change by the usual undo. Pure: no store here.
import type { Locks, PanelReport, Project, RailMount, Receipt } from './types';

export const RECEIPTS_KEEP = 40;

const clone = <T,>(x: T): T => structuredClone(x);

export const hasLocks = (p: Pick<Project, 'locks'>) => !!p.locks && (!!p.locks.all || !!p.locks.docks?.length || !!p.locks.rails?.length);
/** The rails that are locked: all of them when the whole layout is. */
export function lockedRails(p: Project): Set<string> {
  return new Set(p.locks?.all ? p.panel.rails.map((r) => r.id) : p.locks?.rails ?? []);
}
/** The docks that are locked: the ones locked one by one, every dock on a locked rail, all of them when the whole layout is. */
export function lockedDocks(p: Project): Set<string> {
  if (!p.locks) return new Set();
  const rails = lockedRails(p), ids = new Set(p.locks.docks ?? []);
  for (const m of p.panel.mounts) if (p.locks.all || rails.has(m.rail)) ids.add(m.id);
  return ids;
}
export const isDockLocked = (p: Project, id: string) => !!p.locks && lockedDocks(p).has(id);
export const isRailLocked = (p: Project, id: string) => !!p.locks && lockedRails(p).has(id);
/** The boards sitting in a locked dock, with the boards stacked on them. */
export function lockedModules(p: Project): Set<string> {
  const out = new Set<string>(), docks = lockedDocks(p);
  for (const m of p.panel.mounts) if (docks.has(m.id)) for (const s of m.slots) if (s.module) out.add(s.module);
  for (let changed = true; changed;) { changed = false; for (const m of p.modules) if (m.on && out.has(m.on) && !out.has(m.id)) { out.add(m.id); changed = true; } }
  return out;
}

/** Lock or unlock the whole layout (`kind` 'all', no id), a dock or a rail. Mutates the project's `locks`. */
export function setLock(p: Project, kind: 'all' | 'dock' | 'rail', id: string | null, on: boolean) {
  const L: Locks = p.locks ?? {};
  if (kind === 'all') { if (on) L.all = true; else delete L.all; }
  else {
    const key = kind === 'dock' ? 'docks' : 'rails', list = new Set(L[key] ?? []);
    if (!id) return;
    if (on) list.add(id); else list.delete(id);
    if (list.size) L[key] = [...list]; else delete L[key];
  }
  if (hasLocks({ locks: L })) p.locks = L; else delete p.locks;
}

/** Drop locks on docks and rails that are gone (a dock removed, a layout made automatic again). */
export function pruneLocks(p: Project) {
  if (!p.locks) return;
  const L = p.locks;
  if (L.docks) L.docks = L.docks.filter((id) => p.panel.mounts.some((m) => m.id === id));
  if (L.rails) L.rails = L.rails.filter((id) => p.panel.rails.some((r) => r.id === id));
  if (!L.docks?.length) delete L.docks;
  if (!L.rails?.length) delete L.rails;
  if (!hasLocks(p)) delete p.locks;
}

/** A rail for new docks when every rail is locked, clear of the others (the way "New rail" places one). */
export function freshRail(p: Project): Project['panel']['rails'][number] {
  const P = p.panel, n = P.rails.reduce((a, r) => Math.max(a, +r.id.replace(/\D/g, '') || 0), 0) + 1;
  const dir = P.rowDir;
  return dir === 'h'
    ? { id: `r${n}`, x: P.rails.length ? Math.min(...P.rails.map((r) => r.x)) : 0, y: (P.rails.length ? Math.min(...P.rails.map((r) => r.y)) : 0) - 90, dir, length: null }
    : { id: `r${n}`, x: (P.rails.length ? Math.max(...P.rails.map((r) => r.x)) : 0) + 90, y: P.rails.length ? Math.min(...P.rails.map((r) => r.y)) : 0, dir, length: null };
}

/**
 * After an automatic change (`after`, made from `before`): put back whatever it did to a locked rail or dock. A locked
 * dock (with what is in it) and a locked rail come back as they were, a board in a locked dock is in no other, and a
 * change that turned the layout automatic is undone (an automatic layout can't leave anything where it is). Mutates
 * `after`; returns what it put back ("dock 1.2", "rail 2", "the whole layout"; `name` says what a dock or rail is called).
 */
export function enforceLocks(before: Project, after: Project, name: (kind: 'dock' | 'rail', id: string) => string = (k, id) => `${k} ${id}`): string[] {
  if (!hasLocks(before)) return [];
  const A = after.panel, B = before.panel, notes: string[] = [];
  after.locks = clone(before.locks);
  if (A.auto && !B.auto) {
    A.auto = false; A.rails = clone(B.rails); A.mounts = clone(B.mounts);
    return ['the whole layout'];
  }
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  const rails = lockedRails(before), docks = lockedDocks(before);
  for (const r of B.rails) {
    if (!rails.has(r.id)) continue;
    const i = A.rails.findIndex((x) => x.id === r.id);
    if (i >= 0 && same(A.rails[i], r)) continue;
    if (i >= 0) A.rails[i] = clone(r); else A.rails.push(clone(r));
    notes.push(name('rail', r.id));
  }
  for (const m of B.mounts) {
    if (!docks.has(m.id)) continue;
    const i = A.mounts.findIndex((x) => x.id === m.id);
    if (i >= 0 && same(A.mounts[i], m)) continue;
    if (i >= 0) A.mounts[i] = clone(m); else A.mounts.push(clone(m));
    notes.push(name('dock', m.id));
  }
  // a board in a locked dock is in no other one; a board that is gone leaves its slot empty
  const held = new Set<string>(), gone = (id: string | null) => !!id && !after.modules.some((x) => x.id === id);
  for (const m of B.mounts) if (docks.has(m.id)) for (const s of m.slots) if (s.module) held.add(s.module);
  for (const m of A.mounts) for (const s of m.slots) if (s.module && ((!docks.has(m.id) && held.has(s.module)) || gone(s.module))) s.module = null;
  return notes;
}

/** Where each board sits, by rail number (1, 2, ...): from the build of an automatic layout (`rep`), or from the rails and docks written down. */
export type Places = Map<string, { rail: number }>;
export function placesOf(p: Project, rep?: PanelReport | null): Places {
  const out: Places = new Map();
  if (p.panel.auto && rep) {
    for (const m of rep.modules) { const mt = rep.mounts.find((x) => x.id === m.mount); const k = mt ? rep.rails.findIndex((r) => r.id === mt.rail) : -1; if (k >= 0) out.set(m.id, { rail: k + 1 }); }
    return out;
  }
  for (const mt of p.panel.mounts as RailMount[]) {
    const k = p.panel.rails.findIndex((r) => r.id === mt.rail);
    if (k >= 0) for (const s of mt.slots) if (s.module) out.set(s.module, { rail: k + 1 });
  }
  return out;
}

/** The receipts for boards that changed rail between two layouts: one line each, or one for all when there are many. */
export function describeMoves(what: string, before: Places, after: Places, nameOf: (id: string) => string): string[] {
  const moved = [...after].filter(([id, a]) => before.has(id) && before.get(id)!.rail !== a.rail).map(([id, a]) => ({ id, from: before.get(id)!.rail, to: a.rail }));
  const put = [...after].filter(([id]) => !before.has(id)).map(([id, a]) => ({ id, to: a.rail }));
  const line = (m: { id: string; from: number; to: number }) => `${nameOf(m.id)} from rail ${m.from} to rail ${m.to}`;
  const out: string[] = [];
  if (moved.length && moved.length <= 3) out.push(...moved.map((m) => `${what} moved ${line(m)}`));
  else if (moved.length) out.push(`${what} moved ${moved.length} boards to other rails (${moved.slice(0, 3).map(line).join(', ')}, and ${moved.length - 3} more)`);
  if (put.length && put.length <= 3) out.push(...put.map((m) => `${what} put ${nameOf(m.id)} on rail ${m.to}`));
  else if (put.length) out.push(`${what} put ${put.length} boards on rails`);
  const rb = new Set([...before.values()].map((x) => x.rail)).size, ra = new Set([...after.values()].map((x) => x.rail)).size;
  if (ra !== rb) out.push(`${what} used ${ra} rail${ra === 1 ? '' : 's'} where there were ${rb}`);
  return out;
}

/** Write receipts into the project (newest last, the oldest dropped past RECEIPTS_KEEP). */
export function addReceipts(p: Project, what: string, texts: string[], at = new Date().toISOString()) {
  const list = texts.filter(Boolean);
  if (!list.length) return;
  p.receipts = [...(p.receipts ?? []), ...list.map((text): Receipt => ({ at, what, text }))].slice(-RECEIPTS_KEEP);
}
