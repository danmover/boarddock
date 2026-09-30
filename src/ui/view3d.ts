// What the 3D view shows on top of its layers: the selection on its own (Isolate) or with the rest see-through (X-ray),
// what's new since the rack was built, and the mains zones. Kept outside the view so the toolbar and the command palette
// (⌘K) reach the same switches.
import { useSyncExternalStore } from 'react';
import { store, toast, type SelItem } from '../state';

export type FocusMode = 'isolate' | 'xray';
export interface View3d {
  focus: { mode: FocusMode; items: SelItem[] } | null;
  news: boolean; // tint what is new since the rack was built, the rest see-through
  zones: boolean; // shade the mains zones
}

const ZONES_KEY = 'boarddock.zones';
let state: View3d = { focus: null, news: false, zones: (() => { try { return localStorage.getItem(ZONES_KEY) !== 'off'; } catch { return true; } })() };
const subs = new Set<() => void>();

export const view3d = {
  get: () => state,
  set(patch: Partial<View3d>) { state = { ...state, ...patch }; subs.forEach((f) => f()); },
  sub(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
};

export function useView3d<T>(sel: (s: View3d) => T): T {
  return useSyncExternalStore(view3d.sub, () => sel(state), () => sel(state));
}

/**
 * Isolate or X-ray what is selected (again with the same mode: leave it). With nothing selected, an active focus keeps
 * its items and only changes mode. False when there is nothing to focus on.
 */
export function toggleFocus(mode: FocusMode): boolean {
  const f = state.focus, sel = store.get().sel;
  if (f?.mode === mode) { view3d.set({ focus: null }); return true; }
  const items = sel.length ? sel : f?.items ?? [];
  if (!items.length) { toast('Pick something in the 3D view first: a board, a dock, a rail or a cable.'); return false; }
  view3d.set({ focus: { mode, items: items.map((i) => ({ ...i })) } });
  return true;
}

export const leaveFocus = () => { if (state.focus) view3d.set({ focus: null }); };

export function setZones(on: boolean) {
  view3d.set({ zones: on });
  try { localStorage.setItem(ZONES_KEY, on ? 'on' : 'off'); } catch { /* private window */ }
}
