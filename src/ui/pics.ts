// 3D pictures that follow what they show (a board being edited, a saved board): kept up while the next renders.
import { useEffect, useRef, useState } from 'react';
import type { Board } from '../model/types';
import type { PicPart } from '../worker/client';
import { picture } from './snapshot';

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
  for (const c of b.comps) { if (c.hidden) continue; add(c.x); add(c.y); add(c.w); add(c.l); add(c.h); add(c.rot); add(c.kind); add(c.conn?.type ?? ''); add(c.side); }
  for (const x of b.holes) { add(x.x); add(x.y); add(x.d); }
  return (h >>> 0).toString(36);
}

