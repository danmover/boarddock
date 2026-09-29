// @vitest-environment happy-dom
// The "Add a board" window: it takes the keyboard when it opens, keeps Tab and Shift+Tab inside it, closes on Escape,
// and gives focus back to the button that opened it, whichever way it closes. (The 3D worker is stubbed: no pictures.)
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
vi.mock('../src/worker/client', () => ({ boardPicture: async () => '', holderPicture: async () => '', runClipFea: async () => null, buildTestKit: async () => null }));
import { AddBoardSheet } from '../src/ui/AddBoard';
import { loadProject, store } from '../src/state';
import { newProject } from '../src/model/library';
import { TEMPLATES } from '../src/model/templates';
import { tabbables } from '../src/ui/controls';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null, host: HTMLElement | null = null;
async function setup(replace = false) {
  host = document.createElement('div');
  document.body.appendChild(host);
  const opener = document.createElement('button');
  opener.textContent = 'Add';
  host.appendChild(opener);
  const behind = document.createElement('button');
  host.appendChild(behind);
  const sheetHost = document.createElement('div');
  host.appendChild(sheetHost);
  root = createRoot(sheetHost);
  store.set({ project: null, addSheet: false, replaceMode: false });
  if (replace) loadProject(newProject(TEMPLATES.find((t) => t.id === 'uno')!.make()));
  await act(async () => { root!.render(<AddBoardSheet />); });
  opener.focus();
  await act(async () => { store.set({ addSheet: true, replaceMode: replace }); });
  return { opener, behind, dialog: () => document.querySelector<HTMLElement>('[role=dialog]') };
}
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); root = null; host = null; store.set({ addSheet: false, replaceMode: false }); });
const key = (k: string, shift = false) => { const e = new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true }); (document.activeElement ?? document.body).dispatchEvent(e); return e; };

describe('the Add a board window', () => {
  it('takes the keyboard when it opens, and Tab wraps round its own controls in both directions', async () => {
    const { dialog, behind } = await setup();
    const d = dialog()!;
    expect(document.activeElement).toBe(d);
    const all = tabbables(d);
    expect(all.length).toBeGreaterThan(10); // the close button, drop area, draw, search, shelves and every board
    expect(all.every((x) => d.contains(x))).toBe(true);
    await act(async () => { key('Tab'); });
    expect(document.activeElement).toBe(all[0]);
    // from the last control on, Tab goes back round to the first
    all[all.length - 1].focus();
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(all[0]);
    // and Shift+Tab from the first goes to the last, never to the page behind
    expect(key('Tab', true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(all[all.length - 1]);
    // strayed out to the page: Tab comes back in
    behind.focus();
    key('Tab');
    expect(document.activeElement).toBe(all[0]);
  });

  it('closes on Escape and hands focus back to the button that opened it', async () => {
    const { dialog, opener } = await setup();
    await act(async () => { key('Escape'); });
    expect(store.get().addSheet).toBe(false);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('hands focus back when a board is picked, and when the shade round it is clicked', async () => {
    const { dialog, opener } = await setup();
    const tile = dialog()!.querySelector<HTMLElement>('.ltile-main')!;
    await act(async () => { tile.click(); });
    expect(store.get().addSheet).toBe(false);
    expect(store.get().project?.modules.length).toBe(1);
    expect(document.activeElement).toBe(opener);
    opener.focus();
    await act(async () => { store.set({ addSheet: true }); });
    expect(document.activeElement).toBe(dialog());
    await act(async () => { document.querySelector<HTMLElement>('.sheet-veil')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('hands focus back after Replace with… too (a different way of closing)', async () => {
    const { dialog, opener } = await setup(true);
    expect(dialog()!.getAttribute('aria-label')).toMatch(/^Replace /);
    await act(async () => { dialog()!.querySelector<HTMLElement>('.ltile-main')!.click(); });
    expect(dialog()).toBeNull();
    expect(store.get().project!.modules.length).toBe(1);
    expect(store.get().project!.modules[0].board.name).not.toMatch(/Uno/);
    expect(document.activeElement).toBe(opener);
  });
});
