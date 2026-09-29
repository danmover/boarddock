// "My boards": boards you drew, measured or fixed up, kept in this browser to add again to any rack (a board is its
// outline, holes, parts and plugs; its holder settings stay with each rack).
import type { Board } from './types';
import { uid } from '../geom/poly';

const KEY = 'boarddock.myboards';
export interface SavedBoard { id: string; name: string; at: string; board: Board }

export function myBoards(): SavedBoard[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

const write = (list: SavedBoard[]) => { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; } };

/** Keep a copy of a board (replacing the one saved under the same name). False when the browser would not store it. */
export function saveBoard(b: Board): boolean {
  const list = myBoards(), same = list.findIndex((x) => x.name === b.name);
  const entry: SavedBoard = { id: same >= 0 ? list[same].id : uid('mb'), name: b.name, at: new Date().toISOString(), board: structuredClone(b) };
  if (same >= 0) list[same] = entry; else list.unshift(entry);
  return write(list);
}

/** Take a board off My boards; what was taken and where, so it can be put back (Undo). */
export function forgetBoard(id: string): { entry: SavedBoard; at: number } | null {
  const list = myBoards(), at = list.findIndex((x) => x.id === id);
  if (at < 0) return null;
  const [entry] = list.splice(at, 1);
  write(list);
  return { entry, at };
}

/** Put a board taken off My boards back where it was. */
export function restoreBoard(f: { entry: SavedBoard; at: number }) {
  const list = myBoards().filter((x) => x.id !== f.entry.id);
  list.splice(Math.min(f.at, list.length), 0, f.entry);
  write(list);
}

/** A fresh copy to add to a rack (new ids for its parts and holes, so two copies never share one). */
export function copyOf(s: SavedBoard): Board {
  const b = structuredClone(s.board);
  b.comps = b.comps.map((c) => ({ ...c, id: uid('c') }));
  b.holes = b.holes.map((h) => ({ ...h, id: uid('h') }));
  return b;
}
