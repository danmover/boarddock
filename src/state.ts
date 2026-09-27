// App state: the project (undoable, autosaved) plus UI state. Tiny external store + useSyncExternalStore.
import { useSyncExternalStore } from 'react';
import type { Board, Feature, GenResult, Module, PartOut, Project } from './model/types';
import { activeModule, migrate, newModule, newProject } from './model/library';
import { appendDock } from './cad/dockplan';
import { describeChange } from './model/diff';
import { carryOver, compareBoards } from './model/revision';

export { activeModule };

export type Step = 'import' | 'board' | 'plugs' | 'holder' | 'mount' | 'check' | 'export';
/**
 * Something selected: a hole or part in the board editor, a dock or rail on the panel, or anything picked in the
 * 3D view (a whole board and its holder, or one feature of a holder such as a plug cradle).
 */
export type SelItem = {
  kind: 'hole' | 'comp' | 'mount' | 'rail' | 'module' | 'feature' | 'link' | 'railstand';
  id: string;
  module?: string; // feature: the board it belongs to
  fkind?: Feature['kind'] | 'plug' | 'clip'; // feature kind
  refs?: string[]; // feature: connector refs or hole ids
};
export type Layer = 'holders' | 'docks' | 'caps' | 'rails' | 'boards' | 'plugs' | 'cables' | 'labels';
export type Sel = SelItem[];
export type View = 'assembly' | 'print' | 'editor' | 'panel' | 'wiring' | 'library';

export interface State {
  project: Project | null;
  past: Project[];
  future: Project[];
  step: Step;
  view: View;
  sel: Sel;
  result: GenResult | null;
  building: boolean;
  error: string | null;
  showGhosts: boolean;
  theme: 'dark' | 'light';
  replaceMode: boolean; // next import replaces the board being edited instead of adding
  layers: Record<Layer, boolean>; // what the 3D view shows
  toast: string | null;
  toastAction: { label: string; run: () => void } | null;
  addSheet: boolean; // the Add board sheet is open
  printParts: PartOut[] | null; // what Export will print, when it is not everything (the print view shows the same)
  exportPick: string[] | null; // Export opens with just these boards picked (after swapping in a new version of one)
}

const KEY = 'boarddock.project.v1';

function savedTheme(): 'dark' | 'light' | null {
  try {
    const t = localStorage.getItem('boarddock.theme');
    return t === 'dark' || t === 'light' ? t : null;
  } catch {
    return null;
  }
}

function load(): Project | null {
  try {
    const s = localStorage.getItem(KEY);
    return s ? migrate(JSON.parse(s)) : null;
  } catch {
    return null;
  }
}

let state: State = {
  project: typeof localStorage !== 'undefined' ? load() : null,
  past: [],
  future: [],
  step: 'import',
  view: 'assembly',
  sel: [],
  result: null,
  building: false,
  error: null,
  showGhosts: true,
  replaceMode: false,
  layers: { holders: true, docks: true, caps: true, rails: true, boards: true, plugs: true, cables: true, labels: true },
  toast: null,
  toastAction: null,
  addSheet: false,
  printParts: null,
  exportPick: null,
  theme: savedTheme() ?? (typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'),
};
// a saved project opens on Start, which shows the rack and the ways on (add a board, cables, what's new to print)
const subs = new Set<() => void>();

export const store = {
  get: () => state,
  set(patch: Partial<State> | ((s: State) => Partial<State>)) {
    const p = typeof patch === 'function' ? patch(state) : patch;
    state = { ...state, ...p };
    subs.forEach((f) => f());
  },
  sub(f: () => void) {
    subs.add(f);
    return () => subs.delete(f);
  },
};

/** Read the store in a component. `sel` must return values already in the state (or primitives): a new object or
 * array on every call makes React re-render forever. */
export function useApp<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(store.sub, () => sel(state), () => sel(state));
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pending: { p: Project | null } | null = null;
let saveFailed = false;
function writeNow() {
  clearTimeout(saveTimer);
  if (!pending) return;
  const { p } = pending;
  pending = null;
  try {
    if (p) localStorage.setItem(KEY, JSON.stringify(p));
    else localStorage.removeItem(KEY);
    saveFailed = false;
  } catch {
    // storage full or unavailable: say so once, the project file still works
    if (!saveFailed) toast('Autosave failed (browser storage is full or blocked). Save the project file with ⌘S to keep your work.');
    saveFailed = true;
  }
}
function persist(p: Project | null) {
  pending = { p };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, 400);
}
// closing the tab or window keeps the last edit
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', writeNow);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') writeNow(); });
}

/** Change the project through a mutating function on a copy (undoable). */
export function edit(fn: (p: Project) => void) {
  const cur = state.project;
  if (!cur) return;
  const next = structuredClone(cur);
  fn(next);
  store.set({ project: next, past: [...state.past.slice(-60), cur], future: [] });
  persist(next);
}

/** Record `prev` as an undo step for changes already applied with store.set (e.g. a drag). */
export function commitFrom(prev: Project) {
  store.set({ past: [...state.past.slice(-60), prev], future: [] });
  persist(state.project);
}

/** Change the active module (board + holder) through a mutating function on a copy (undoable). */
export function editMod(fn: (m: Module, p: Project) => void) {
  edit((p) => fn(activeModule(p), p));
}

/** `base`, or "base 2", "base 3"… whichever is not taken yet. */
export function uniqueName(taken: Iterable<string>, base: string): string {
  const t = new Set(taken);
  let name = base;
  for (let k = 2; t.has(name); k++) name = `${base} ${k}`;
  return name;
}

/** What the last replace kept and dropped, for the message that follows it. */
export let lastReplace = '';

/** Replace the active board (keeps holder settings), or start a project. */
export function setBoard(b: Board) {
  const cur = state.project;
  let p: Project;
  lastReplace = '';
  if (cur) {
    p = structuredClone(cur);
    const m = activeModule(p);
    // the same kind of board keeps its number ("Raspberry Pi 4B 2" stays that); anything else gets a free name
    const old = m.board.name;
    const others = p.modules.filter((x) => x !== m).map((x) => x.board.name);
    const name = old === b.name || old.startsWith(`${b.name} `) && /^\d+$/.test(old.slice(b.name.length + 1)) ? old : uniqueName(others, b.name);
    if (name !== b.name) b = { ...b, name };
    // the new board takes the old one's place and id: its dock, the boards stacked on it and its cables stay;
    // only cables to plugs the new board doesn't have are dropped
    const nm = { ...newModule(b, m.holder), id: m.id, on: m.on };
    for (const mt of p.panel?.mounts ?? []) for (const sl of mt.slots) if (sl.module === m.id) sl.edge = 'auto';
    const has = (ref: string) => b.comps.some((c) => c.ref === ref.replace(/:2$/, ''));
    const mine = (p.links ?? []).filter((l) => l.a.module === m.id || l.b.module === m.id).length;
    p.links = (p.links ?? []).filter((l) => (l.a.module !== m.id || has(l.a.ref)) && (l.b.module !== m.id || has(l.b.ref)));
    const kept = (p.links ?? []).filter((l) => l.a.module === m.id || l.b.module === m.id).length;
    const docked = p.layout === 'panel' && p.panel.mounts.some((mt) => mt.slots.some((sl) => sl.module === m.id));
    lastReplace = `${docked ? ' It keeps the dock' : ' It keeps its place'}${kept ? ` and ${kept} cable${kept > 1 ? 's' : ''}` : ''}${mine - kept ? `; ${mine - kept} cable${mine - kept > 1 ? 's' : ''} to plugs it doesn't have ${mine - kept > 1 ? 'were' : 'was'} dropped` : ''}.`;
    p.modules[p.active] = nm;
    p.mount = { ...p.mount, at: null };
  } else p = newProject(b);
  store.set({ project: p, past: cur ? [...state.past, cur] : [], future: [], sel: [], step: 'board', view: 'editor', result: null });
  persist(p);
}

/**
 * Swap in a new version of a board (one undo step): it keeps its id, name, dock and stack, its holder settings, the
 * cables to plugs it still has and the choices made on the old version (plug protection, hidden parts, hole roles
 * set by hand). Returns what changed, or null when there is no such board.
 */
export function reviseBoard(id: string, b: Board): { changes: string[]; kept: number; dropped: number; name: string } | null {
  const cur = state.project;
  const m0 = cur?.modules.find((x) => x.id === id);
  if (!cur || !m0) return null;
  const changes = compareBoards(m0.board, b);
  let kept = 0, dropped = 0;
  edit((p) => {
    const m = p.modules.find((x) => x.id === id)!;
    const nb = { ...carryOver(m.board, b), name: m.board.name };
    const has = (ref: string) => nb.comps.some((c) => c.ref === ref.replace(/:2$/, '') && c.conn);
    const mine = (p.links ?? []).filter((l) => l.a.module === id || l.b.module === id);
    p.links = (p.links ?? []).filter((l) => (l.a.module !== id || has(l.a.ref)) && (l.b.module !== id || has(l.b.ref)));
    kept = (p.links ?? []).filter((l) => l.a.module === id || l.b.module === id).length;
    dropped = mine.length - kept;
    m.revision = { at: new Date().toISOString(), from: m.board.source, to: b.source, changes };
    m.board = nb;
    m.original = structuredClone(b);
  });
  return { changes, kept, dropped, name: m0.board.name };
}

/** Add another board to the project. */
export function addBoard(b: Board) {
  putBoards([b], false);
}

/**
 * Put imported boards into the project in one undoable step: added (the default once there is a project), or with
 * `replace` the first one takes the place of the board being edited and the rest are added. The first new board
 * becomes the one being edited.
 */
export function putBoards(bs: Board[], replace: boolean, opts: { stay?: boolean } = {}) {
  if (!bs.length) return;
  const cur = state.project;
  if (!cur || replace) {
    setBoard(bs[0]);
    if (bs.length > 1) { const past = state.past; putBoards(bs.slice(1), false); store.set({ past }); }
    store.set({ replaceMode: false });
    return;
  }
  const p = structuredClone(cur);
  const first = p.modules.length;
  for (const b0 of bs) {
    // a second Pi 4B becomes "Raspberry Pi 4B 2", so every list, label and cable says which one
    const name = uniqueName(p.modules.map((m) => m.board.name), b0.name);
    const b = name === b0.name ? b0 : { ...b0, name };
    p.modules.push(newModule(b, activeModule(p).holder));
    if (p.layout === 'panel' && !p.panel.auto) appendDock(p, p.modules[p.modules.length - 1].id);
  }
  p.active = first;
  store.set({ project: p, past: [...state.past, cur], future: [], sel: [], replaceMode: false, ...(opts.stay ? {} : { step: 'board' as const, view: 'editor' as const }) });
  persist(p);
}

/** Open a project file. The rack that was open stays one ⌘Z away. */
export function loadProject(raw: unknown) {
  const p = migrate(raw);
  const cur = state.project;
  store.set({ project: p, past: cur ? [...state.past.slice(-60), cur] : [], future: [], sel: [], step: 'import', result: null });
  persist(p);
}

/** Switch the board being edited: not an edit, so undo and redo are left alone. */
export function setActive(i: number) {
  const cur = state.project;
  if (!cur || cur.active === i || i < 0 || i >= cur.modules.length) return;
  const p = { ...cur, active: i };
  store.set({ project: p });
  persist(p);
}

/** Take a board out of a project (a draft being edited): its dock slot, its cables and its place in a stack go too. */
export function dropModule(p: Project, id: string): boolean {
  const i = p.modules.findIndex((x) => x.id === id);
  if (i < 0 || p.modules.length <= 1) return false;
  const m = p.modules[i];
  p.modules.splice(i, 1);
  for (const x of p.modules) if (x.on === m.id) x.on = m.on ?? null;
  for (const mt of p.panel.mounts) for (const sl of mt.slots) if (sl.module === m.id) sl.module = null;
  p.links = (p.links ?? []).filter((l) => l.a.module !== m.id && l.b.module !== m.id);
  if (i < p.active) p.active--;
  p.active = Math.max(0, Math.min(p.active, p.modules.length - 1));
  return true;
}

export function undo() {
  if (!state.past.length || !state.project) return;
  const prev = state.past[state.past.length - 1], cur = state.project;
  store.set({ project: prev, past: state.past.slice(0, -1), future: [cur, ...state.future] });
  persist(prev);
  toast(`Undid: ${describeChange(prev, cur)}.${state.past.length ? '' : ' That was the first change.'}`);
}

export function redo() {
  if (!state.future.length || !state.project) return;
  const next = state.future[0], cur = state.project;
  store.set({ project: next, past: [...state.past, cur], future: state.future.slice(1) });
  persist(next);
  toast(`Redid: ${describeChange(cur, next)}.`);
}

export function closeProject() {
  store.set({ project: null, past: [], future: [], result: null, sel: [], step: 'import' });
  persist(null);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** When the current toast appeared (the toast shows how long it has left). */
export let toastAt = 0;
/** The undo depth when the toast appeared: its Undo button only shows while no other edit has happened since. */
export let toastPast = -1;
export function toast(msg: string, action?: { label: string; run: () => void }) {
  clearTimeout(toastTimer);
  toastAt = Date.now();
  toastPast = state.past.length;
  store.set({ toast: msg, toastAction: action ?? null });
  toastTimer = setTimeout(() => store.set({ toast: null }), Math.min(9000, 3200 + msg.length * 30));
}

/** Selection helpers: set, toggle (Shift/Cmd-click) or add to the selection. */
export function select(items: SelItem[], mode: 'set' | 'toggle' | 'add' = 'set') {
  const cur = state.sel;
  let next: Sel;
  if (mode === 'set') next = items;
  else if (mode === 'add') next = [...cur, ...items.filter((i) => !cur.some((c) => c.id === i.id))];
  else {
    next = [...cur];
    for (const i of items) {
      const k = next.findIndex((c) => c.id === i.id);
      if (k >= 0) next.splice(k, 1);
      else next.push(i);
    }
  }
  store.set({ sel: next });
}

export const isSel = (sel: Sel, id: string) => sel.some((s) => s.id === id);
