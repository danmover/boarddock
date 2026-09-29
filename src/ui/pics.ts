// 3D pictures that follow what they show (a board being edited, a saved board): kept up while the next renders.
import { useEffect, useRef, useState } from 'react';
import type { Board } from '../model/types';
import type { PicPart } from '../worker/client';
import { picture } from './snapshot';
import TILES from './tiles.json';

/**
 * The pictures shipped in public/tiles/ (scripts/render-tiles.mjs makes them) and, for each, the fingerprint of the 3D
 * model it shows (boardviz.ts pictureSig). It is asked for by that fingerprint, so a browser never keeps an old one;
 * tests/toolbox.test.ts fails when a model has moved on from its picture. Nothing here: render it live.
 */
export const TILE_SIG: Record<string, string> = TILES;
export const tileUrl = (id: string): string | null => (TILE_SIG[id] ? new URL(`tiles/${id}.webp?v=${TILE_SIG[id]}`, document.baseURI).href : null);

/**
 * A 3D picture that changes with what it shows: the new one is rendered once `key` has stopped changing for a
 * moment, and the old one stays up until it is ready (no flicker while you edit).
 */
export function useKeptPicture(key: string, make: () => Promise<PicPart[]>, w: number, h: number, view: [number, number, number], wait = 700): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const mk = useRef(make);
  mk.current = make;
  useEffect(() => {
    let on = true;
    const t = setTimeout(() => { picture(key, () => mk.current(), w, h, view).then((u) => on && setUrl(u)).catch(() => {}); }, url ? wait : 0);
    return () => { on = false; clearTimeout(t); };
  }, [key]);
  return url;
}

/** A cheap fingerprint of a board's shape and parts: its picture is redrawn when this changes. */
export function boardSig(b: Board): string {
  let h = 2166136261;
  const add = (v: number | string) => { const s = typeof v === 'number' ? v.toFixed(2) : v; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } };
  add(b.thickness); add(b.color ?? ''); add(b.kind ?? '');
  for (const q of b.outline) { add(q[0]); add(q[1]); }
  // (the package and value too: they decide how a part looks, a relay's box from a buzzer's can)
  for (const c of b.comps) { if (c.hidden) continue; add(c.x); add(c.y); add(c.w); add(c.l); add(c.h); add(c.rot); add(c.kind); add(c.conn?.type ?? ''); add(c.side); add(c.pkg); add(c.value ?? ''); add(c.pins?.length ?? 0); }
  for (const x of b.holes) { add(x.x); add(x.y); add(x.d); }
  return (h >>> 0).toString(36);
}

