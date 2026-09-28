// Panel edits (all undoable). The first manual edit turns the automatic layout into editable rails and docks
// exactly where they are, so nothing jumps.
import type { EdgeName, GenResult, PanelReport, Project, RailMount, Slot, Turn } from '../model/types';
import { round, uid } from '../geom/poly';
import { appendDock, bestDock, seatBoard, dropEmptied, nearestFree, spreadOut, spreadRails, withRiders } from '../cad/dockplan';
import { baseOf, refreshStandoffs } from '../model/holes';
import { amend, edit, select, store, toast, uniqueName } from '../state';
import { mountLabels, snapshot } from '../model/built';
import { isProbe } from '../model/probes';

const rep = () => store.get().result?.report.panel ?? null;

export function materialise(p: Project) {
  if (!p.panel.auto) return;
  const r = rep();
  if (r) materialiseFrom(p, r);
}

/** Write a layout down as rails and docks you can edit (it stops being automatic). */
export function materialiseFrom(p: Project, r: PanelReport) {
  p.panel.rails = r.rails.map((x) => ({ id: x.id, x: round(x.x, 1), y: round(x.y, 1), dir: x.dir, length: null }));
  p.panel.mounts = r.mounts.map((m) => ({ id: m.id, rail: m.rail, at: round(m.at, 1), kind: m.kind, turn: m.turn, lever: m.lever, slots: m.slots.map((s) => ({ ...s })) }));
  p.panel.auto = false;
}

/**
 * Run `fn` once with the build of the project as it is now, when it is ready: for a message that needs the new layout
 * (how long a rail became, what now overlaps). Given up when another change comes first.
 */
export function afterBuild(fn: (r: GenResult) => void) {
  const p0 = store.get().project, r0 = store.get().result;
  let done = false;
  const off = store.sub(() => {
    if (done) return;
    const s = store.get();
    if (s.project !== p0) { done = true; off(); return; }
    if (!s.building && s.result && s.result !== r0) { done = true; off(); fn(s.result); }
  });
}

const railNo = (id: string) => id.replace(/^r/, '');

/**
 * An automatic layout lays the whole rack out again after every change, a new cable too. Call this just before a
 * cable edit: when the new layout needs another rail, moves a board to another rail or makes the cables to buy much
 * longer, a toast says so and offers to keep the layout as it was (with the new cable).
 */
export function watchRelayout() {
  const s0 = store.get(), p0 = s0.project, r0 = s0.result;
  if (!p0 || p0.layout !== 'panel' || !p0.panel.auto || !r0?.report.panel) return;
  const before = r0.report.panel, cable0 = (r0.report.cables ?? []).reduce((a, c) => a + c.buy, 0);
  // (the edit happens right after this call: wait for it, then for its build)
  queueMicrotask(() => afterBuild((r) => {
    const now = r.report.panel, p = store.get().project;
    if (!now || !p?.panel.auto) return;
    const railOf = (rp: PanelReport, id: string) => { const m = rp.modules.find((x) => x.id === id); return m ? rp.mounts.find((x) => x.id === m.mount)?.rail : undefined; };
    const moved = p.modules.filter((m) => !isProbe(m) && railOf(before, m.id) && railOf(now, m.id) && railOf(before, m.id) !== railOf(now, m.id));
    const cable = (r.report.cables ?? []).reduce((a, c) => a + c.buy, 0), more = cable - cable0;
    if (now.rails.length === before.rails.length && !moved.length && more < 0.3) return;
    const bits = [
      now.rails.length !== before.rails.length ? `${before.rails.length} → ${now.rails.length} rails` : '',
      moved.length ? (moved.length > 2 ? `${moved.length} boards on other rails` : moved.map((m) => `${m.board.name} to rail ${railNo(railOf(now, m.id)!)}`).join(', ')) : '',
      Math.abs(more) >= 0.3 ? `${more > 0 ? '+' : '−'}${round(Math.abs(more), 1)} m of cable to buy` : '',
    ].filter(Boolean);
    toast(`Auto-arrange laid the rack out again for the new cable: ${bits.join(', ')}. Keep the old layout to leave every board where it was (it stops being automatic). ⌘Z undoes it.`, {
      label: 'Keep the old layout', run: () => { amend((q) => materialiseFrom(q, before)); toast('Kept the layout as it was, with the new cable. Auto-arrange lays it all out again when you want.'); },
    });
  }));
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
      into.slots[k] = { module: mod, edge: host!.slots[k].edge, ...(host!.slots[k].lie ? { lie: host!.slots[k].lie } : {}) };
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

/** Move a dock to a spot on a rail; dropped onto another dock, it slides to the nearest gap beside it. */
export function placeMount(id: string, rail: string, at: number) {
  const r = rep(), dir = (rid: string) => r?.rails.find((x) => x.id === rid)?.dir;
  const own = r?.mounts.find((x) => x.id === id);
  // (turned onto a rail the other way, its reach along the rail changes: the next build says if it overlaps)
  const to = r && own && dir(own.rail) === dir(rail) ? nearestFree(r, id, rail, at) : at;
  panelEdit((p) => {
    const m = p.panel.mounts.find((x) => x.id === id);
    if (!m) return;
    pin(p, [m.rail, rail]);
    m.rail = rail;
    m.at = round(Math.max(0, to), 1);
  });
  if (Math.abs(to - at) > 1) toast(`That spot was taken: the dock went into the nearest gap, ${round(Math.abs(to - at), 0)} mm ${to > at ? 'further along' : 'back'}. ⌘Z undoes it.`);
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
  const was = r0?.modules.some((x) => x.id === moduleId);
  const msg = `${was ? 'Moved' : 'Placed'} ${name} ${was ? 'to' : 'in'} ${where.replace(/ +/g, ' ')}`;
  const left = seatNow(moduleId, target);
  toast(`${msg}${left ? '; the dock it left, empty now, went' : ''}. ⌘Z undoes it.`);
  // a board in a dock's other slot makes that dock reach further, and a new dock may land on another: slide the docks
  // along that rail if they now overlap
  if (target) settleOverlaps((pr) => ['mount' in target ? pr.mounts.find((x) => x.id === target.mount)?.rail : target.rail], (n) => `${msg}; ${n > 1 ? `${n} docks` : 'the dock'} beside it slid along the rail to make room${left ? ', and the dock it left, empty now, went' : ''}. ⌘Z undoes it.`);
}

/**
 * Once the rack is built again after a change by hand: where docks on a rail now overlap (a bigger board in a back
 * slot reaches further), slide them apart along that rail; where a dock reaches over the next rail's docks (a board
 * laid flat reaches across its rail), slide that rail and the ones beyond it across. All in the same undo step.
 * `rails`: which rails to look at (all of them when left out); `say`: the toast, given how many docks moved.
 */
export function settleOverlaps(rails?: (pr: PanelReport) => (string | undefined)[], say: (n: number) => string = (n) => `${n > 1 ? `${n} docks` : 'A dock'} slid along the rail to make room, as the new board made its dock reach further. ⌘Z undoes it.`) {
  afterBuild((r) => {
    const pr = r.report.panel;
    if (!pr || store.get().project?.panel.auto) return;
    const on = rails ? rails(pr).filter((x): x is string => !!x) : pr.rails.map((x) => x.id);
    const mountOf = (id: string) => pr.mounts.find((x) => x.id === id) ?? pr.mounts.find((x) => x.id === pr.modules.find((q) => q.id === id)?.mount);
    const railsOf = (pair: string[]) => pair.map((id) => mountOf(id)?.rail);
    const along = pr.collisions.some((pair) => { const [a, b] = railsOf(pair); return !!a && a === b && on.includes(a); });
    const across = pr.collisions.some((pair) => { const [a, b] = railsOf(pair); return !!a && !!b && a !== b && (on.includes(a) || on.includes(b)); });
    if (!along && !across) return;
    let moved: string[] = [], slid: string[] = [];
    amend((q) => { if (q.panel.auto) return; if (along) moved = spreadOut(q, pr, 2, on); if (across) slid = spreadRails(q, pr, 2); });
    const railNames = slid.map((id) => pr.rails.findIndex((x) => x.id === id) + 1).sort((a, b) => a - b);
    const rails2 = railNames.length ? `${railNames.length > 1 ? `Rails ${railNames.slice(0, -1).join(', ')} and ${railNames[railNames.length - 1]}` : `Rail ${railNames[0]}`} slid across to make room, as a board now reaches over ${railNames.length > 1 ? 'them' : 'it'}. ⌘Z undoes it.` : '';
    if (moved.length) toast(rails2 ? `${say(moved.length).replace(/ ⌘Z undoes it\.$/, '')} ${rails2}` : say(moved.length));
    else if (rails2) toast(rails2);
  });
}

/** Seat a board; returns whether a dock it left behind empty was taken out. */
function seatNow(moduleId: string, target?: { mount: string; slot: number } | { rail: string; at: number }): boolean {
  const before = store.get().project;
  let left = false;
  panelEdit((p) => {
    seatInto(p, moduleId, target);
    // the dock it came from goes when nothing is left in it (an empty dock you added yourself stays)
    // (an automatic layout has no empty docks of its own: any empty one now is the one it left)
    const n = p.panel.mounts.length;
    if (before && !before.panel.auto) dropEmptied(p, before);
    else p.panel.mounts = p.panel.mounts.filter((mt) => mt.slots.some((sl) => sl.module));
    left = p.panel.mounts.length < n;
  });
  return left;
}

function seatInto(p: Project, moduleId: string, target?: { mount: string; slot: number } | { rail: string; at: number }) {
  {
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
  }
}

export function unseat(moduleId: string) {
  panelEdit((p) => { for (const mt of p.panel.mounts) for (const sl of mt.slots) if (sl.module === moduleId) sl.module = null; });
}

export function setSlot(mountId: string, slot: number, fn: (s: Slot) => void) {
  panelEdit((p) => {
    const mt = p.panel.mounts.find((x) => x.id === mountId);
    if (!mt) return;
    while (mt.slots.length <= slot) mt.slots.push({ module: null, edge: 'auto' });
    fn(mt.slots[slot]);
    const mod = mt.slots[slot].module;
    if (mod) for (const o of p.panel.mounts) o.slots.forEach((s, i) => { if (s.module === mod && !(o === mt && i === slot)) s.module = null; });
  });
}

/**
 * After a board changes how it docks (another edge, standing or lying flat), docks along its rail slide on to clear it
 * once it is built: lying flat it hangs off its ear along the rail or across it, further than it stood.
 */
export const makeRoom = () => settleOverlaps(undefined, (n) => `${n > 1 ? `${n} docks` : 'A dock'} slid along the rail to make room, as the board now reaches further. ⌘Z undoes it.`);

/** Dock a board the way that keeps its tongue under Check's limit (shorterLever's pick), making room for it. */
export function dockShorter(mountId: string, slot: number, fix: { edge: EdgeName; lie?: 'flat' }) {
  setSlot(mountId, slot, (s) => { s.edge = fix.edge; if (fix.lie) s.lie = 'flat'; else delete s.lie; });
  makeRoom();
}

export function autoArrange() {
  const p = store.get().project;
  if (p?.built && !confirm('This rack is built. Auto-arrange lays every board out again: built boards move, and you may need new rails and docks. ⌘Z undoes it. Lay it all out again?')) return;
  edit((q) => { q.panel.auto = true; });
  select([]);
}

/**
 * Tidy a layout done by hand without starting over: docks with nothing in them go, and along each rail each dock
 * slides on just far enough to clear the one before it. Order, rails, turns and slots stay as they are.
 */
export function tidyUp() {
  const r = rep(), p0 = store.get().project;
  if (!r || !p0 || p0.layout !== 'panel') return;
  const tidy = (p: Project) => {
    const n = p.panel.mounts.length;
    p.panel.mounts = p.panel.mounts.filter((mt) => mt.slots.some((sl) => sl.module));
    return { gone: n - p.panel.mounts.length, moved: spreadOut(p, r, 2) };
  };
  // try it on a copy first: nothing to do is not an undo step
  const trial = structuredClone(p0);
  materialise(trial);
  const { gone, moved } = tidy(trial);
  if (!gone && !moved.length) { toast('Nothing to tidy: no empty docks, and nothing overlaps along a rail.'); return; }
  panelEdit((p) => { tidy(p); });
  toast(`Tidied up: ${[gone ? `${gone} empty dock${gone > 1 ? 's' : ''} taken out` : '', moved.length ? `${moved.length} dock${moved.length > 1 ? 's' : ''} slid along to clear the one before` : ''].filter(Boolean).join(', ')}. Everything else stayed where it was.${p0.built && moved.length ? " Export lists the docks that moved under What's new." : ''} ⌘Z undoes it.`);
}

export function setLever(ids: string[], lever: RailMount['lever']) {
  panelEdit((p) => { for (const m of mountsOf(p, ids)) m.lever = lever; });
}

/** Copy a board and its holder settings; on a manual panel the copy goes in a free dock slot, else a new dock at the end. */
export function duplicateModule(i: number) {
  edit((q) => {
    const src = q.modules[i];
    const copy = { ...structuredClone(src), id: Math.random().toString(36).slice(2, 9) };
    // the same numbering as adding one: "Raspberry Pi 4B" -> "Raspberry Pi 4B #2"
    const all = q.modules.map((x) => x.board.name), m = /^(.*) (?:#?(\d+)|\((\d+)\))$/.exec(src.board.name);
    copy.board.name = uniqueName(all, m && all.includes(m[1]) ? m[1] : src.board.name);
    q.modules.splice(i + 1, 0, copy);
    q.active = i + 1;
    if (q.layout === 'panel' && !q.panel.auto) seatBoard(q, copy.id);
  });
  settleOverlaps();
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

/** How a stacked board is held, and its standoff length (null: BoardDock picks it again). */
export function setStackMode(moduleId: string, mode: 'bolted' | 'towers', gap?: number | null) {
  edit((p) => {
    const m = p.modules.find((x) => x.id === moduleId);
    if (!m) return;
    m.onMode = mode;
    if (gap === null) delete m.onGap;
    else if (gap != null) m.onGap = gap;
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

/**
 * One line on where newly added boards go. With `ids` (the boards just added, on a rack laid out by hand or built),
 * where each one actually went: a free slot of a dock already there, or a new dock.
 */
export function placementNote(p: Project, ids?: string[]): string {
  if (p.layout !== 'panel') return '';
  // an unbuilt rack that lays itself out: nothing to say (the add toast stays short)
  if (p.panel.auto && !p.built) return '';
  if (p.panel.auto) return ' Auto-arrange lays out the whole rack again with it (mark the rack as built in Export to keep boards where they are).';
  const r = rep(), labels = mountLabels(r);
  const spots = (ids ?? []).map((id) => {
    const mt = p.panel.mounts.find((x) => x.slots.some((s) => s.module === id));
    if (!mt) return null;
    const m = p.modules.find((x) => x.id === id), other = mt.slots.find((s) => s.module && s.module !== id)?.module;
    const known = labels.get(mt.id);
    if (known) return `${m?.board.name ?? 'It'} went into the free slot of dock ${known}${other ? `, back to back with ${p.modules.find((x) => x.id === other)?.board.name}` : ''} (nothing new to print but its holder)`;
    const k = p.panel.rails.findIndex((x) => x.id === mt.rail) + 1;
    return `${m?.board.name ?? 'It'} got a new dock${k ? ` on rail ${k}` : ''}, in the first gap that fits or on the end of the rail (Check says if the rail gets longer)`;
  }).filter(Boolean) as string[];
  if (spots.length && spots.length <= 3) return ` ${spots.join('. ')}; the rest stay put.`;
  return ' Each goes into a free dock slot where it docks well (nothing new to print but its holder), else a new dock in the first gap on the rails or on the end of a rail, which then gets longer (Check says by how much); the rest stay put.';
}
