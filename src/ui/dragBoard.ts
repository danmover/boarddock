// Dragging a board out of the Rails list with the pointer (mouse, finger or pen): the browser's own drag and drop
// never starts on a touch screen. Drop zones register themselves under a `data-drop` key; the board is followed by a
// small label and dropped on the innermost zone under the pointer.
import type { PointerEvent as ReactPointerEvent } from 'react';

export interface Zone {
  /** The dragged board is over the zone (again on every move, with where) or has left it. */
  over(on: boolean, x: number, y: number): void;
  drop(id: string, x: number, y: number): void;
}
const zones = new Map<string, Zone>();
export function registerZone(key: string, z: Zone): () => void {
  zones.set(key, z);
  return () => { if (zones.get(key) === z) zones.delete(key); };
}

let dragging = false;
/** True while a board is being dragged, and for a moment after: the click that ends a drag is not a click. */
export const isDragging = () => dragging;

/** Start dragging board `id` from a pointerdown: it begins to move after 5 px. `label` follows the pointer. */
export function beginDrag(e: ReactPointerEvent, id: string, label: string) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const x0 = e.clientX, y0 = e.clientY;
  let started = false, ghost: HTMLElement | null = null, cur: string | null = null;
  const zoneAt = (x: number, y: number) => { const k = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]')?.dataset.drop; return k && zones.has(k) ? k : null; };
  const to = (k: string | null, x: number, y: number) => {
    if (cur && cur !== k) zones.get(cur)?.over(false, x, y);
    cur = k;
    if (k) zones.get(k)!.over(true, x, y);
  };
  const move = (ev: PointerEvent) => {
    if (!started) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      started = dragging = true;
      ghost = document.createElement('div');
      ghost.className = 'dragghost';
      ghost.textContent = label;
      document.body.append(ghost);
      document.body.classList.add('dragging-board');
    }
    ev.preventDefault();
    ghost!.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 12}px)`;
    to(zoneAt(ev.clientX, ev.clientY), ev.clientX, ev.clientY);
  };
  const end = (ev: PointerEvent, drop: boolean) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    ghost?.remove();
    document.body.classList.remove('dragging-board');
    if (!started) return;
    const k = cur;
    to(null, ev.clientX, ev.clientY);
    if (drop && k) zones.get(k)?.drop(id, ev.clientX, ev.clientY);
    setTimeout(() => { dragging = false; }, 0);
  };
  const up = (ev: PointerEvent) => end(ev, true);
  const cancel = (ev: PointerEvent) => end(ev, false);
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
}
