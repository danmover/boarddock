// @vitest-environment happy-dom
// The Wiring view on a 16-board rack, rendered in a fake DOM given the canvas of a 1400 × 900 window: it opens fitted
// at a third of full size or more (the cards wrapped to the canvas's shape, not a row per rail), and a card dropped on
// another lands in a free spot instead.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WiringView } from '../src/ui/WiringView';
import { loadProject, store } from '../src/state';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { autoLinks, numberLinks } from '../src/model/links';
import { fillWires } from '../src/model/probes';
import { autoAssign } from '../src/cad/dockplan';
import { seeded } from './collide/racks';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null, host: HTMLElement | null = null;
beforeAll(() => {
  // (a fake DOM lays nothing out) the canvas beside the steps of a 1400 × 900 window is 1020 × 848; the list stands
  // 320 px wide at its right, the toolbar 34 px tall at 58 px from its top
  const def = (k: string, f: (el: HTMLElement) => number) => Object.defineProperty(HTMLElement.prototype, k, { configurable: true, get() { return f(this as HTMLElement); } });
  def('clientWidth', () => 1020);
  def('clientHeight', () => 848);
  def('offsetLeft', (el) => (el.classList.contains('wside') ? 1020 - 12 - 320 : 0));
  def('offsetTop', (el) => (el.classList.contains('toolbar') ? 58 : 0));
  def('offsetHeight', (el) => (el.classList.contains('toolbar') ? 34 : 0));
});
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); root = null; host = null; });

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
const BOARDS = ['rpi5', 'rpi5', 'rpi5', 'rpi4', 'rpi4', 'rpi4', 'rpi_zero', 'uno', 'uno', 'mega', 'nano', 'nano', 'pico', 'pico', 'esp32', 'esp32'];

/** The rack open in the Wiring view, laid out by Auto-arrange (four docks to a rail) and Auto-connected. */
async function open() {
  const p = seeded(517, () => {
    const q = newProject(T(BOARDS[0]));
    for (const id of [...BOARDS.slice(1), 'usb_hub7', 'usb_charger6', 'usb_charger6', 'net_switch8', 'pb6', 'psu_pi5', 'psu_pi5', 'psu_pi5']) q.modules.push(newModule(T(id)));
    q.links = numberLinks(autoLinks(q)).map((l) => fillWires(q, l));
    return q;
  });
  loadProject(p);
  const mounts = autoAssign(p).map((m, i) => ({ ...m, rail: `r${Math.floor(i / 4)}`, at: i }));
  store.set({ view: 'wiring', result: { report: { panel: { rails: [...new Set(mounts.map((m) => m.rail))].map((id) => ({ id })), mounts }, cables: [] } } as any });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<WiringView />); });
  return host;
}
/** Each card's box on the canvas, as drawn. */
const cardsOf = (h: HTMLElement) => [...h.querySelectorAll<SVGGElement>('g[data-card]')].map((g) => {
  const [x, y] = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute('transform')!)!.slice(1).map(Number);
  return { id: g.getAttribute('data-card')!, g, x, y, w: Number(g.querySelector('rect')!.getAttribute('width')), h: Number(g.querySelector('rect')!.getAttribute('height')) };
});
const clash = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('the Wiring view on a 16-board rack', () => {
  it('opens fitted at a third of full size or more, with no card on another', async () => {
    const h = await open();
    const cards = cardsOf(h);
    expect(cards.length).toBe(26);
    expect(cards.some((a, i) => cards.slice(i + 1).some((b) => clash(a, b)))).toBe(false);
    // it opened at 27 % here, a row of up to seven cards per rail: now at least a third (tests/wirelayout.test.ts says why)
    const zoom = parseInt(h.querySelector<HTMLButtonElement>('button[title="Fit everything in the window"]')!.textContent!);
    expect(zoom).toBeGreaterThanOrEqual(33);
  });

  it('puts a card dropped on another in the nearest free spot', async () => {
    const h = await open();
    const [a, b] = cardsOf(h);
    const k = parseInt(h.querySelector<HTMLButtonElement>('button[title="Fit everything in the window"]')!.textContent!) / 100;
    const svg = h.querySelector('svg')!, title = a.g.querySelector('g')!;
    // drag the first card by its title onto the second
    const at = (x: number, y: number) => ({ bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y });
    await act(async () => { title.dispatchEvent(new PointerEvent('pointerdown', at(0, 0))); });
    await act(async () => { svg.dispatchEvent(new PointerEvent('pointermove', at((b.x - a.x + 20) * k, (b.y - a.y + 20) * k))); });
    await act(async () => { svg.dispatchEvent(new PointerEvent('pointerup', at((b.x - a.x + 20) * k, (b.y - a.y + 20) * k))); });
    const saved = store.get().project!.wiring!.pos!;
    const moved = { ...a, x: saved[a.id][0], y: saved[a.id][1] };
    // it moved, but onto nothing
    expect(Math.hypot(moved.x - a.x, moved.y - a.y)).toBeGreaterThan(50);
    for (const c of cardsOf(h).filter((c) => c.id !== a.id)) expect(clash(moved, { ...c, x: saved[c.id][0], y: saved[c.id][1] })).toBe(false);
    expect(cardsOf(h).find((c) => c.id === a.id)!.x).toBe(moved.x);
  });
});
