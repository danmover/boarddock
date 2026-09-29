// @vitest-environment happy-dom
// The board editor's Measure popup, rendered with the real editor (the 3D worker stubbed, the drawing given a size):
// measuring two holes opens it with the number focused and selected, its checkbox is an ordinary one, and it sits
// beside the dimension line instead of over it.
import { readFileSync } from 'fs';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
vi.mock('../src/worker/client', () => ({ boardPicture: async () => '', holderPicture: async () => '', runClipFea: async () => null, buildTestKit: async () => null }));
import { BoardEditor } from '../src/ui/BoardEditor';
import { loadProject } from '../src/state';
import { newProject } from '../src/model/library';
import { TEMPLATES } from '../src/model/templates';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const W = 900, H = 600;
let root: Root | null = null, host: HTMLElement | null = null;
beforeAll(() => {
  // a drawing of a known size (a fake DOM lays nothing out)
  Element.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, left: 0, top: 0, width: W, height: H, right: W, bottom: H, toJSON() { return this; } } as DOMRect; };
  (globalThis as any).ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} };
});
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); root = null; host = null; });

/** Client position of a point on the board (mm), the way the editor's own toWorld reads it back. */
function client(svg: SVGSVGElement, x: number, y: number): { clientX: number; clientY: number } {
  const [vx, vy, vw, vh] = svg.getAttribute('viewBox')!.split(' ').map(Number);
  const s = Math.max(vw / W, vh / H), ox = vx + (vw - W * s) / 2, oy = vy + (vh - H * s) / 2;
  return { clientX: (x - ox) / s, clientY: (-y - oy) / s };
}

async function measureHoles() {
  const p = newProject(TEMPLATES.find((t) => t.id === 'proto_5x7')!.make());
  loadProject(p);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<BoardEditor tool="measure" setTool={() => {}} />); });
  const svg = host.querySelector<SVGSVGElement>('svg.bcanvas')!;
  const [h0, h1] = p.modules[0].board.holes; // (2, 2) and (68, 2): along x
  // (act without await: the popup and its effects are in, but no timer has run yet, as in the browser right after the click)
  for (const h of [h0, h1]) act(() => { svg.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, ...client(svg, h.x, h.y) })); });
  // the browser now finishes the mouse-down by moving focus off whatever had it; a beat later the popup takes it back
  (document.activeElement as HTMLElement | null)?.blur?.();
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return { svg, h: host };
}

describe('the Measure popup', () => {
  it('opens with its number focused and selected, even though the click that made it moves focus', async () => {
    const { h } = await measureHoles();
    const input = h.querySelector<HTMLInputElement>('.dimedit input.mono')!;
    expect(input).not.toBeNull();
    expect(input.value).toBe('66.00');
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, input.value.length]);
  });

  it('has an ordinary checkbox for the holes in line, apart from the number field', async () => {
    const { h } = await measureHoles();
    const box = h.querySelector<HTMLInputElement>('.dimedit-mates input');
    expect(box).not.toBeNull();
    expect(box!.type).toBe('checkbox');
    expect(box!.closest('label')!.textContent).toMatch(/holes? in line with it/);
    // with the app's own stylesheet: the number field is 84 px wide, the checkbox the 16 px box every checkbox is
    const css = document.createElement('style');
    css.textContent = readFileSync('src/styles.css', 'utf8');
    document.head.appendChild(css);
    try {
      const num = h.querySelector<HTMLInputElement>('.dimedit input.mono')!;
      expect(getComputedStyle(num).width).toBe('84px');
      expect(getComputedStyle(box!).width).toBe('16px');
      expect(getComputedStyle(box!).height).toBe('16px');
    } finally { css.remove(); }
  });

  it('sits beside the dimension line, on the side away from what it measures, not over it', async () => {
    // (a fake DOM lays nothing out: the popup is 236 × 120 here)
    const size = (k: 'offsetWidth' | 'offsetHeight', v: number) => Object.defineProperty(HTMLElement.prototype, k, { configurable: true, get() { return (this as HTMLElement).classList.contains('dimedit') ? v : 0; } });
    size('offsetWidth', 236); size('offsetHeight', 120);
    try {
      const { svg, h } = await measureHoles();
      const pop = h.querySelector<HTMLElement>('.dimedit')!;
      const left = parseFloat(pop.style.left), top = parseFloat(pop.style.top);
      // the dimension is along x, its label (on the line) in the middle of the two holes
      const lab = svg.querySelector('g.dimlab')!.getAttribute('transform')!.match(/translate\(([-\d.e]+),([-\d.e]+)\)/)!;
      const at = client(svg, +lab[1], -+lab[2]);
      // the popup is centred on the label and clear of the line (the label's pill is 18 px high) on one side of it...
      expect(left + 118).toBeCloseTo(at.clientX, 0);
      const above = top + 120 <= at.clientY - 9, below = top >= at.clientY + 9;
      expect(above || below).toBe(true);
      // ...on the side of the line away from the two holes it measures: they are near the bottom edge and the line is
      // above them, so the popup is above the line
      expect(client(svg, 0, 2).clientY).toBeGreaterThan(at.clientY);
      expect(above).toBe(true);
    } finally {
      delete (HTMLElement.prototype as any).offsetWidth; delete (HTMLElement.prototype as any).offsetHeight;
    }
  });
});
