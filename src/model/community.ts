// Community boards: boards people added to the repo under boards/ (see boards/README.md). `npm run boards` reads
// their files with the app's own importers and writes public/boards/index.json (the list below) plus one JSON file per
// board. Both are fetched only when the library opens (the Start page and "Add a board"), and a board's own file only
// when it is added, so none of it is in the app's main bundle.
import type { Board } from './types';
import { uid } from '../geom/poly';

/** A top view for a board's tile when it has no rendered picture: numbers only, so the list stays small. */
export interface CommunitySketch {
  outline: [number, number][];
  holes: [number, number, number][]; // x, y, diameter
  parts: [number, number, number, number, number, 0 | 1][]; // x, y, w, l, rotation, 1 = a connector
}

/** One row of public/boards/index.json. */
export interface CommunityEntry {
  id: string; // the folder name under boards/
  name: string;
  maker?: string;
  url?: string;
  license?: string;
  size: [number, number]; // board width and depth, mm
  plugs: number; // connectors on it
  custom: number; // of those, how many are still "Custom connector"
  holes: number; // mounting holes
  file: string; // the board itself, next to index.json
  rev: string; // fingerprint of the board's data: what a cached copy or a rendered picture is checked against
  pic?: string; // a rendered picture, next to index.json, present only while it matches `rev`
  sketch: CommunitySketch;
}

export interface CommunityIndex { version: 1; boards: CommunityEntry[] }

const base = () => new URL('boards/', document.baseURI).href;
export const communityUrl = (file: string, rev: string) => `${base()}${file}?v=${rev}`;

let indexP: Promise<CommunityEntry[]> | null = null;
/** The list of community boards ([] when there is none, or the list can't be fetched). Fetched once, on first use. */
export function communityIndex(): Promise<CommunityEntry[]> {
  return (indexP ??= (async () => {
    if (import.meta.env.MODE === 'test') return []; // unit tests have no server to ask (a test that wants boards stubs MODE)
    try {
      const r = await fetch(`${base()}index.json`);
      if (!r.ok) return [];
      const j = (await r.json()) as Partial<CommunityIndex>;
      return Array.isArray(j?.boards) ? j.boards : [];
    } catch {
      indexP = null; // offline or not there yet: ask again next time the library opens
      return [];
    }
  })());
}

const cache = new Map<string, Promise<Board>>();
/** A fresh copy of a community board to add to a rack (its file is fetched the first time; parts and holes get new ids). */
export async function communityBoard(e: CommunityEntry): Promise<Board> {
  const key = `${e.id}:${e.rev}`;
  let p = cache.get(key);
  if (!p) {
    p = fetch(communityUrl(e.file, e.rev)).then((r) => {
      if (!r.ok) throw new Error(`${e.name}: its board file is missing (${r.status})`);
      return r.json() as Promise<Board>;
    });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  const b = structuredClone(await p);
  b.comps = b.comps.map((c) => ({ ...c, id: uid('c') }));
  b.holes = b.holes.map((h) => ({ ...h, id: uid('h') }));
  return b;
}
