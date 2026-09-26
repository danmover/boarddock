// App state: the project (undoable, autosaved) plus UI state. Tiny external store + useSyncExternalStore.
import { useSyncExternalStore } from 'react';
import type { Board, Feature, GenResult, Module, Project } from './model/types';
import { activeModule, migrate, newModule, newProject } from './model/library';
import { appendDock } from './cad/dockplan';

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
export type Layer = 'holders' | 'docks' | 'caps' | 'rails' | 'boards' | 'plugs' | 'cables';
export type Sel = SelItem[];
export type View = 'assembly' | 'print' | 'editor' | 'panel' | 'wiring';

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
}

const KEY = 'boarddock.project.v1';

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
  layers: { holders: true, docks: true, caps: true, rails: true, boards: true, plugs: true, cables: true },
  toast: null,
  theme: (typeof localStorage !== 'undefined' && (localStorage.getItem('boarddock.theme') as 'dark' | 'light')) || 'dark',
};
if (state.project) state.step = 'board';
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

export function useApp<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(store.sub, () => sel(state), () => sel(state));
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function persist(p: Project | null) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      if (p) localStorage.setItem(KEY, JSON.stringify(p));
      else localStorage.removeItem(KEY);
    } catch {
      /* storage full or unavailable */
    }
  }, 400);
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

/** Replace the active board (keeps holder settings), or start a project. */
export function setBoard(b: Board) {
  const cur = state.project;
  let p: Project;
  if (cur) {
    p = structuredClone(cur);
    const m = activeModule(p);
    const nm = newModule(b, m.holder);
    for (const mt of p.panel?.mounts ?? []) for (const sl of mt.slots) if (sl.module === m.id) { sl.module = nm.id; sl.edge = 'auto'; }
    p.modules[p.active] = nm;
    p.mount = { ...p.mount, at: null };
  } else p = newProject(b);
  store.set({ project: p, past: cur ? [...state.past, cur] : [], future: [], sel: [], step: 'board', view: 'assembly', result: null });
  persist(p);
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
export function putBoards(bs: Board[], replace: boolean) {
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
  for (const b of bs) {
    p.modules.push(newModule(b, activeModule(p).holder));
    if (p.layout === 'panel' && !p.panel.auto) appendDock(p, p.modules[p.modules.length - 1].id);
  }
  p.active = first;
  store.set({ project: p, past: [...state.past, cur], future: [], sel: [], step: 'board', view: 'assembly', replaceMode: false });
  persist(p);
}

export function loadProject(raw: unknown) {
  const p = migrate(raw);
  store.set({ project: p, past: [], future: [], sel: [], step: 'board', result: null });
  persist(p);
}

export function undo() {
  if (!state.past.length || !state.project) return;
  const prev = state.past[state.past.length - 1];
  store.set({ project: prev, past: state.past.slice(0, -1), future: [state.project, ...state.future] });
  persist(prev);
}

export function redo() {
  if (!state.future.length || !state.project) return;
  const next = state.future[0];
  store.set({ project: next, past: [...state.past, state.project], future: state.future.slice(1) });
  persist(next);
}

export function closeProject() {
  store.set({ project: null, past: [], future: [], result: null, sel: [], step: 'import' });
  persist(null);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string) {
  clearTimeout(toastTimer);
  store.set({ toast: msg });
  toastTimer = setTimeout(() => store.set({ toast: null }), 4200);
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
