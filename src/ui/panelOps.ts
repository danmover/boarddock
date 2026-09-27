// Panel edits (all undoable). The first manual edit turns the automatic layout into editable rails and docks
// exactly where they are, so nothing jumps.
import type { EdgeName, Project, RailMount, Turn } from '../model/types';
import { round, uid } from '../geom/poly';
import { appendDock, bestDock, withRiders } from '../cad/dockplan';
import { baseOf, refreshStandoffs } from '../model/holes';
import { edit, select, store, toast, uniqueName } from '../state';
import { mountLabels, snapshot } from '../model/built';

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
  // a board added to a laid-out rack lands where the generator found room (maybe on another rail, maybe in another
  // dock's empty slot): write that down first, so it stays there once anything else moves
  for (const m of [...p.panel.mounts]) if (m.place === 'free' && m.at == null && r) {
    const x = r.mounts.find((q) => q.id === m.id);
    if (x) { m.rail = x.rail; m.at = round(x.at, 1); delete m.place; continue; }
    const mod = m.slots.find((sl) => sl.module)?.module;
    const host = mod ? r.mounts.find((q) => q.slots.some((sl) => sl.module === mod)) : null;
    const into = host && p.panel.mounts.find((q) => q.id === host.id);
    if (into && mod) {
      const k = host!.slots.findIndex((sl) => sl.module === mod);
      into.slots[k] = { module: mod, edge: host!.slots[k].edge };
      p.panel.mounts.splice(p.panel.mounts.indexOf(m), 1);
    }
  }
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
  const r0 = rep(), p0 = store.get().project;
  const name = p0?.modules.find((x) => x.id === moduleId)?.board.name ?? 'The board';
  const where = !target ? 'a new dock at the end of the rails' : 'mount' in target
    ? `dock ${mountLabels(r0).get(target.mount) ?? ''}${(r0?.mounts.find((x) => x.id === target.mount)?.slots.length ?? 1) > 1 ? (target.slot ? ' (back)' : ' (front)') : ''}`
    : `a new dock on rail ${Math.max(1, (r0?.rails.findIndex((x) => x.id === target.rail) ?? 0) + 1)}`;
  seatNow(moduleId, target);
  toast(`${r0?.modules.some((x) => x.id === moduleId) ? 'Moved' : 'Placed'} ${name} ${r0?.modules.some((x) => x.id === moduleId) ? 'to' : 'in'} ${where.replace(/ +/g, ' ')}. ⌘Z undoes it.`);
}

function seatNow(moduleId: string, target?: { mount: string; slot: number } | { rail: string; at: number }) {
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
    // the same numbering as adding one: "Raspberry Pi 4B" -> "Raspberry Pi 4B 2"
    const all = q.modules.map((x) => x.board.name), m = /^(.*) (?:(\d+)|\((\d+)\))$/.exec(src.board.name);
    copy.board.name = uniqueName(all, m && all.includes(m[1]) ? m[1] : src.board.name);
    q.modules.splice(i + 1, 0, copy);
    q.active = i + 1;
    if (q.layout === 'panel' && !q.panel.auto) appendDock(q, copy.id);
  });
}

/** Put a board in a new dock at the end of a rail. */
export function appendToRail(moduleId: string, railId: string) {
  panelEdit((p) => {
    for (const mt of p.panel.mounts) for (const sl of mt.slots) if (sl.module === moduleId) sl.module = null;
    const m = p.modules.find((x) => x.id === moduleId);
    const rail = p.panel.rails.find((r) => r.id === railId);
    if (!m || !rail) return;
    m.on = null;
    pin(p, [rail.id]);
    const o = bestDock(withRiders(p, m), rail.dir, 0);
    p.panel.mounts.push({ id: uid('d'), rail: rail.id, at: null, kind: 'dock', turn: o.turn, slots: [{ module: moduleId, edge: o.edge }, { module: null, edge: 'auto' }] });
  });
}

/** A new rail with this board docked on it. */
export function newRailWith(moduleId: string, dir: 'h' | 'v') {
  addRail(dir);
  const r = store.get().project!.panel.rails;
  appendToRail(moduleId, r[r.length - 1].id);
}

/** Stack a board on top of another (null: back onto its own dock). Refuses loops. */
export function stackOn(moduleId: string, baseId: string | null) {
  const p0 = store.get().project!;
  const m0 = p0.modules.find((x) => x.id === moduleId), b0 = baseId ? p0.modules.find((x) => x.id === baseId) : null;
  if (!m0 || (baseId && (!b0 || baseOf(p0, b0) === m0 || b0 === m0))) return false;
  const apply = (p: Project) => {
    const m = p.modules.find((x) => x.id === moduleId)!;
    // whatever sat on the target goes on top of the new board, so the stack stays a single column
    if (baseId) for (const x of p.modules) if (x.on === baseId && x.id !== moduleId) x.on = moduleId;
    for (const x of p.modules) if (x.on === moduleId && !baseId) x.on = m.on ?? null;
    const oldBelow = m.on;
    m.on = baseId;
    if (baseId) for (const mt of p.panel.mounts) for (const sl of mt.slots) if (sl.module === moduleId) sl.module = null;
    for (const id of [oldBelow, baseId]) { const x = p.modules.find((q) => q.id === id); if (x) refreshStandoffs(p, x); }
  };
  if (p0.panel.auto) edit(apply);
  else panelEdit((p) => { apply(p); if (!baseId && !p.panel.mounts.some((mt) => mt.slots.some((s) => s.module === moduleId))) appendDock(p, moduleId); });
  return true;
}

/** Quick automatic layouts. */
export function quickLayout(kind: 'row' | 'rows' | 'cols') {
  edit((p) => {
    p.panel.auto = true;
    p.panel.rowDir = kind === 'cols' ? 'v' : 'h';
    p.panel.maxRail = kind === 'row' ? 2000 : p.panel.maxRail >= 2000 ? 400 : p.panel.maxRail;
  });
  select([]);
}

/** How a stacked board is held, and its standoff length. */
export function setStackMode(moduleId: string, mode: 'bolted' | 'towers', gap?: number) {
  edit((p) => {
    const m = p.modules.find((x) => x.id === moduleId);
    if (!m) return;
    m.onMode = mode;
    if (gap != null) m.onGap = gap;
    const below = p.modules.find((x) => x.id === m.on);
    if (below) refreshStandoffs(p, below);
  });
}

/**
 * Mark the rack as built: every rail keeps its length, every dock its place, turn, lever side and board edges, and
 * what was printed, cut and bought is remembered. Boards added later go into free spots without moving the rest,
 * and Export can list only what's new.
 */
export function markBuilt() {
  const { project, result, building } = store.get();
  if (!project || !result) return;
  // the result must be the one for the project as it is now, or an older layout would be written back
  if (building) { toast('Still building your last change: try again in a moment.'); return; }
  const r = result.report.panel;
  edit((p) => {
    if (p.layout === 'panel' && r) {
      p.panel.rails = r.rails.map((x) => ({ id: x.id, x: x.x, y: x.y, dir: x.dir, length: x.length }));
      p.panel.mounts = r.mounts.map((m) => ({
        id: m.id, rail: m.rail, at: m.at, kind: m.kind, turn: m.turn, lever: m.leverSide > 0 ? 'pos' : 'neg',
        slots: m.slots.map((s, k) => ({ module: s.module, edge: s.module ? r.modules.find((x) => x.id === s.module && x.mount === m.id && x.slot === k)?.edge ?? s.edge : s.edge })),
      }));
      p.panel.auto = false;
    }
    p.built = snapshot(p, result);
  });
  toast('Marked as built. New boards now go into free spots and leave the rest where they are; Export lists only what is new.');
}

export function unmarkBuilt() {
  edit((p) => { delete p.built; });
}

/**
 * A warning when a new board's holder will not fit the printer's bed (roughly: the board plus its walls), said
 * when the board is added rather than four steps later in Check.
 */
export function bedNote(p: Project, boards: { name: string; outline: [number, number][] }[]): string {
  const [bx, by] = p.printer.bed;
  const big = boards.filter((b) => {
    const xs = b.outline.map((q) => q[0]), ys = b.outline.map((q) => q[1]);
    const w = Math.max(...xs) - Math.min(...xs) + 8, h = Math.max(...ys) - Math.min(...ys) + 8;
    return !((w <= bx && h <= by) || (w <= by && h <= bx));
  });
  if (!big.length) return '';
  return ` ${big.length === 1 ? `${big[0].name}'s holder` : `The holders of ${big.map((b) => b.name).join(', ')}`} will not fit the ${p.printer.name} bed (${bx} × ${by} mm): a printer with a bigger bed can be picked in Export.`;
}

/** One line on where a newly added board goes. */
export function placementNote(p: Project): string {
  if (p.layout !== 'panel') return '';
  if (p.panel.auto) return ' Auto-arrange lays out the whole rack again with it (mark the rack as built in Export to keep boards where they are).';
  return ' It goes into an empty dock slot if one fits (nothing new to print but its holder), else the first free spot on the rails, near a board it is cabled to; the rest stay put.';
}
