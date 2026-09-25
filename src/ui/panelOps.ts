// Panel edits (all undoable). The first manual edit turns the automatic layout into editable rails and docks
// exactly where they are, so nothing jumps.
import type { EdgeName, Project, RailMount, Turn } from '../model/types';
import { round, uid } from '../geom/poly';
import { appendDock, bestDock } from '../cad/dockplan';
import { edit, select, store } from '../state';

const rep = () => store.get().result?.report.panel ?? null;

export function materialise(p: Project) {
  if (!p.panel.auto) return;
  const r = rep();
  if (!r) return;
  p.panel.rails = r.rails.map((x) => ({ id: x.id, x: round(x.x, 1), y: round(x.y, 1), dir: x.dir, length: null }));
  p.panel.mounts = r.mounts.map((m) => ({ id: m.id, rail: m.rail, at: round(m.at, 1), kind: m.kind, turn: m.turn, lever: m.lever, slots: m.slots.map((s) => ({ ...s })) }));
  p.panel.auto = false;
}

/** Fix the position of every mount on these rails, so moving one doesn't make the rest re-pack. */
function pin(p: Project, rails: string[]) {
  const r = rep();
  for (const m of p.panel.mounts) if (rails.includes(m.rail) && m.at == null) {
    const at = r?.mounts.find((x) => x.id === m.id)?.at;
    if (at != null) m.at = round(at, 1);
  }
}

export function panelEdit(fn: (p: Project) => void) {
  edit((p) => { materialise(p); fn(p); });
}

const mountsOf = (p: Project, ids: string[]) => p.panel.mounts.filter((m) => ids.includes(m.id));

export function turnMounts(ids: string[], delta: number) {
  panelEdit((p) => { for (const m of mountsOf(p, ids)) m.turn = ((((m.turn + delta) % 360) + 360) % 360) as Turn; });
}

export function swapSlots(ids: string[]) {
  panelEdit((p) => { for (const m of mountsOf(p, ids)) if (m.kind === 'dock') m.slots = [m.slots[1] ?? { module: null, edge: 'auto' }, m.slots[0]]; });
}

export function setKind(ids: string[], kind: RailMount['kind']) {
  panelEdit((p) => {
    for (const m of mountsOf(p, ids)) {
      m.kind = kind;
      if (kind === 'flat' && m.slots[1]?.module) {
        // the back board gets its own dock right after this one
        const back = m.slots[1].module;
        m.slots[1] = { module: null, edge: 'auto' };
        p.panel.mounts.splice(p.panel.mounts.indexOf(m) + 1, 0, { id: uid('d'), rail: m.rail, at: null, kind: 'dock', turn: m.turn, slots: [{ module: back, edge: 'auto' }, { module: null, edge: 'auto' }] });
      }
      if (kind === 'dock' && m.slots.length < 2) m.slots.push({ module: null, edge: 'auto' });
    }
  });
}

export function removeMounts(ids: string[]) {
  panelEdit((p) => { p.panel.mounts = p.panel.mounts.filter((m) => !ids.includes(m.id)); });
  select([]);
}

export function removeRails(ids: string[]) {
  panelEdit((p) => {
    p.panel.rails = p.panel.rails.filter((r) => !ids.includes(r.id));
    p.panel.mounts = p.panel.mounts.filter((m) => !ids.includes(m.rail));
  });
  select([]);
}

/** Move mounts along their rails by d mm. */
export function nudge(ids: string[], d: number) {
  panelEdit((p) => {
    const ms = mountsOf(p, ids);
    pin(p, [...new Set(ms.map((m) => m.rail))]);
    for (const m of ms) m.at = round(Math.max(0, (m.at ?? 0) + d), 1);
  });
}

export function placeMount(id: string, rail: string, at: number) {
  panelEdit((p) => {
    const m = p.panel.mounts.find((x) => x.id === id);
    if (!m) return;
    pin(p, [m.rail, rail]);
    m.rail = rail;
    m.at = round(Math.max(0, at), 1);
  });
}

export function moveRail(id: string, dx: number, dy: number) {
  panelEdit((p) => {
    const r = p.panel.rails.find((x) => x.id === id);
    if (r) { r.x = round(r.x + dx, 1); r.y = round(r.y + dy, 1); }
  });
}

export function addRail(dir: 'h' | 'v') {
  const r = rep();
  let id = '';
  panelEdit((p) => {
    const feet = r?.mounts.map((m) => m.foot) ?? [];
    const x0 = feet.length ? Math.min(...feet.map((f) => f[0])) : 0, x1 = feet.length ? Math.max(...feet.map((f) => f[2])) : 0;
    const y0 = feet.length ? Math.min(...feet.map((f) => f[1])) : 0;
    const n = p.panel.rails.reduce((a, x) => Math.max(a, +x.id.replace(/\D/g, '') || 0), 0) + 1;
    id = `r${n}`;
    p.panel.rails.push(dir === 'h' ? { id, x: round(x0, 0), y: round(y0 - 90, 0), dir, length: 200 } : { id, x: round(x1 + 90, 0), y: round(y0, 0), dir, length: 200 });
  });
  select([{ kind: 'rail', id }]);
}

export function setRail(id: string, fn: (r: Project['panel']['rails'][number]) => void) {
  panelEdit((p) => { const r = p.panel.rails.find((x) => x.id === id); if (r) fn(r); });
}

export function addDock(rail?: string, at?: number) {
  let id = '';
  panelEdit((p) => {
    const rid = rail ?? p.panel.rails[p.panel.rails.length - 1]?.id;
    if (!rid) return;
    id = uid('d');
    if (at != null) pin(p, [rid]);
    p.panel.mounts.push({ id, rail: rid, at: at != null ? round(at, 1) : null, kind: 'dock', turn: 90, slots: [{ module: null, edge: 'auto' }, { module: null, edge: 'auto' }] });
  });
  if (id) select([{ kind: 'mount', id }]);
}

/** Seat a board: in a given slot, in a new dock at a rail position, or at the end of the last rail. */
export function seat(moduleId: string, target?: { mount: string; slot: number } | { rail: string; at: number }) {
  panelEdit((p) => {
    for (const mt of p.panel.mounts) for (const sl of mt.slots) if (sl.module === moduleId) sl.module = null;
    const m = p.modules.find((x) => x.id === moduleId);
    if (!m) return;
    if (!target) { appendDock(p, moduleId); return; }
    if ('mount' in target) {
      const mt = p.panel.mounts.find((x) => x.id === target.mount);
      if (mt) { while (mt.slots.length <= target.slot) mt.slots.push({ module: null, edge: 'auto' }); mt.slots[target.slot] = { module: moduleId, edge: 'auto' }; }
      return;
    }
    const rail = p.panel.rails.find((r) => r.id === target.rail);
    if (!rail) return;
    pin(p, [rail.id]);
    const o = bestDock(m, rail.dir, 0);
    p.panel.mounts.push({ id: uid('d'), rail: rail.id, at: round(target.at, 1), kind: 'dock', turn: o.turn, slots: [{ module: moduleId, edge: o.edge }, { module: null, edge: 'auto' }] });
  });
}

export function unseat(moduleId: string) {
  panelEdit((p) => { for (const mt of p.panel.mounts) for (const sl of mt.slots) if (sl.module === moduleId) sl.module = null; });
}

export function setSlot(mountId: string, slot: number, fn: (s: { module: string | null; edge: EdgeName | 'auto' }) => void) {
  panelEdit((p) => {
    const mt = p.panel.mounts.find((x) => x.id === mountId);
    if (!mt) return;
    while (mt.slots.length <= slot) mt.slots.push({ module: null, edge: 'auto' });
    fn(mt.slots[slot]);
    const mod = mt.slots[slot].module;
    if (mod) for (const o of p.panel.mounts) o.slots.forEach((s, i) => { if (s.module === mod && !(o === mt && i === slot)) s.module = null; });
  });
}

export function autoArrange() {
  edit((p) => { p.panel.auto = true; });
  select([]);
}

export function setLever(ids: string[], lever: RailMount['lever']) {
  panelEdit((p) => { for (const m of mountsOf(p, ids)) m.lever = lever; });
}

/** Copy a board and its holder settings; on a manual panel the copy gets a dock at the end of the last rail. */
export function duplicateModule(i: number) {
  edit((q) => {
    const src = q.modules[i];
    const copy = { ...structuredClone(src), id: Math.random().toString(36).slice(2, 9) };
    const n = q.modules.filter((x) => x.board.name.replace(/ \(\d+\)$/, '') === src.board.name.replace(/ \(\d+\)$/, '')).length + 1;
    copy.board.name = `${src.board.name.replace(/ \(\d+\)$/, '')} (${n})`;
    q.modules.splice(i + 1, 0, copy);
    q.active = i + 1;
    if (q.layout === 'panel' && !q.panel.auto) appendDock(q, copy.id);
  });
}
