// @vitest-environment happy-dom
// The command palette box: ⌘K / Ctrl+K or the top bar's button opens it, typing narrows the list, the arrow keys and
// Enter pick, a tap runs, Esc closes it and gives focus back; a greyed command does nothing.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CommandPalette, PaletteButton } from '../src/ui/CommandPalette';
import { closeProject, loadProject, store } from '../src/state';
import { newProject } from '../src/model/library';
import { TEMPLATES } from '../src/model/templates';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null, host: HTMLElement | null = null;
const c = { steps: [{ id: 'import' as const, label: 'Start', title: 't', text: '' }, { id: 'check' as const, label: 'Check', title: 't', text: '' }], goStep: vi.fn(), saveProject: vi.fn(), newRack: vi.fn(), look: vi.fn(), toggleTheme: vi.fn(), showKeys: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); closeProject(); loadProject(newProject(TEMPLATES.find((t) => t.id === 'rpi4')!.make())); });
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); root = null; host = null; });

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<><button id="opener">x</button><PaletteButton /><CommandPalette ctx={c} /></>); });
}
const key = (k: string, o: KeyboardEventInit = {}, target: EventTarget = window) => act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o })); });
const box = () => document.querySelector<HTMLElement>('.cmd');
const input = () => document.querySelector<HTMLInputElement>('.cmd input')!;
const type = (text: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), text);
  input().dispatchEvent(new Event('input', { bubbles: true }));
});
const titles = () => [...document.querySelectorAll('.cmd-item')].map((b) => b.firstElementChild!.childNodes[0].textContent);
const later = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });

describe('the command palette', () => {
  it('opens with Ctrl+K (and ⌘K) and again closes with it, focused on its box', async () => {
    await mount();
    expect(box()).toBeNull();
    await key('k', { ctrlKey: true });
    expect(box()).not.toBeNull();
    expect(document.activeElement).toBe(input());
    await key('k', { ctrlKey: true });
    expect(box()).toBeNull();
    await key('k', { metaKey: true });
    expect(box()).not.toBeNull();
    expect(box()!.getAttribute('role')).toBe('dialog');
  });

  it('opens from the top bar button, for touch, and a tap on a command runs it and closes the box', async () => {
    await mount();
    await act(async () => { host!.querySelector<HTMLButtonElement>('button[aria-label="Commands"]')!.click(); });
    expect(box()).not.toBeNull();
    await type('check');
    const go = [...document.querySelectorAll<HTMLButtonElement>('.cmd-item')].find((b) => b.textContent!.startsWith('Go to Check'))!;
    await act(async () => { go.click(); });
    await later();
    expect(box()).toBeNull();
    expect(c.goStep).toHaveBeenCalledWith('check');
  });

  it('narrows as you type, and Enter runs the top one; arrows move down and up', async () => {
    await mount();
    await key('k', { ctrlKey: true });
    const all = titles().length;
    await type('theme');
    expect(titles()).toEqual([`Switch to the ${store.get().theme === 'dark' ? 'light' : 'dark'} theme`]);
    expect(titles().length).toBeLessThan(all);
    await type('go to');
    expect(titles()).toEqual(['Go to Start', 'Go to Check']);
    await key('ArrowDown', {}, input());
    expect(document.querySelector('.cmd-item.on')!.textContent).toMatch(/Go to Check/);
    await key('ArrowDown', {}, input()); // (wraps)
    expect(document.querySelector('.cmd-item.on')!.textContent).toMatch(/Go to Start/);
    await key('ArrowUp', {}, input());
    await key('Enter', {}, input());
    await later();
    expect(c.goStep).toHaveBeenCalledWith('check');
  });

  it('says so when nothing matches, and Esc closes it and gives focus back', async () => {
    await mount();
    const opener = document.getElementById('opener')!;
    opener.focus();
    await key('k', { ctrlKey: true });
    await type('qqqq');
    expect(document.querySelector('.cmd-empty')!.textContent).toMatch(/Nothing matches/);
    await key('Enter', {}, input());
    expect(box()).not.toBeNull(); // (nothing to run)
    await key('Escape', {}, input());
    expect(box()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('shows what cannot be done greyed with the reason, and does nothing for it', async () => {
    await mount();
    await key('k', { ctrlKey: true });
    await type('redo');
    const b = document.querySelector<HTMLButtonElement>('.cmd-item')!;
    expect(b.disabled).toBe(true);
    expect(b.textContent).toMatch(/Nothing to redo/);
    await key('Enter', {}, input());
    expect(box()).not.toBeNull();
    expect(store.get().future).toHaveLength(0);
  });
});
