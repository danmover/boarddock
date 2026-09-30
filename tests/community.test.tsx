// @vitest-environment happy-dom
// Community boards in the library (Start and "Add a board"): listed after the built-in shelves and marked community, a
// plain top view when the board has no rendered picture, the board's own file fetched only when it is added.
// (The 3D worker is stubbed; the fetches are answered from the files `npm run boards` wrote to public/boards.)
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
vi.mock('../src/worker/client', () => ({ boardPicture: async () => '', holderPicture: async () => '', runClipFea: async () => null, buildTestKit: async () => null }));
import { Library } from '../src/ui/Library';
import type { Board } from '../src/model/types';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const dir = path.resolve(__dirname, '..', 'public', 'boards');
const real = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')).boards[0];
const index = { version: 1, boards: [real, { ...real, id: 'with-pic', name: 'Pictured board', pic: 'with-pic.webp', file: 'with-pic.json' }] };
const asked: string[] = [];
globalThis.fetch = (async (url: string) => {
  const u = new URL(url), name = path.basename(u.pathname);
  asked.push(name);
  const file = name === 'index.json' ? null : path.join(dir, name === 'with-pic.json' ? real.file : name);
  if (name !== 'index.json' && !(file && fs.existsSync(file))) return { ok: false, status: 404 };
  return { ok: true, status: 200, json: async () => (file ? JSON.parse(fs.readFileSync(file, 'utf8')) : index) };
}) as any;

beforeAll(() => { vi.stubEnv('MODE', 'production'); }); // the list is only fetched when not under test
let root: Root | null = null, host: HTMLElement | null = null;
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); root = host = null; });
async function open(onAdd: (b: Board[]) => void) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<Library onAdd={onAdd} />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return host;
}

describe('community boards in the library', () => {
  it('come after the built-in shelves, marked community, and the board file is fetched only when one is added', async () => {
    const added: Board[][] = [];
    const h = await open((b) => added.push(b));
    const heads = [...h.querySelectorAll('h4')].map((x) => x.textContent);
    expect(heads[heads.length - 1]).toBe('Community boards');
    expect(heads.indexOf('Raspberry Pi')).toBeLessThan(heads.indexOf('Community boards'));
    expect([...h.querySelectorAll('[role=tab]')].map((x) => x.textContent)).toContain(`Community ${index.boards.length}`);
    const tiles = [...h.querySelectorAll('.ltile')].filter((t) => t.querySelector('.ltile-com'));
    expect(tiles.map((t) => t.querySelector('.nm')!.textContent)).toEqual([real.name, 'Pictured board']);
    expect(tiles[0].querySelector('.ltile-com')!.textContent).toBe('community');
    expect(tiles[0].querySelector('small')!.textContent).toBe('70 × 45 · 3 plugs · by BoardDock contributors');
    expect(asked).toEqual(['index.json']); // the list only: no board data yet

    // no picture: a plain top view (outline, parts, holes); a picture that exists: an <img>, and the top view if it fails to load
    const sketch = tiles[0].querySelector('svg.thumb')!;
    expect(sketch.querySelector('.th-pcb')).toBeTruthy();
    expect(sketch.querySelectorAll('.th-hole')).toHaveLength(4);
    expect(sketch.querySelectorAll('.th-conn').length).toBe(3);
    expect(tiles[0].querySelector('img')).toBeNull();
    const img = tiles[1].querySelector('img')!;
    expect(img.getAttribute('src')).toBe(`http://localhost:3000/boards/with-pic.webp?v=${real.rev}`);
    await act(async () => { img.dispatchEvent(new Event('error')); });
    expect(tiles[1].querySelector('img')).toBeNull();
    expect(tiles[1].querySelector('svg.thumb .th-pcb')).toBeTruthy();

    // adding one fetches its file and hands over a board with fresh ids
    await act(async () => { (tiles[0].querySelector('.ltile-main') as HTMLElement).click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(asked).toEqual(['index.json', real.file]);
    expect(added).toHaveLength(1);
    const b = added[0][0];
    expect(b.name).toBe(real.name);
    expect(b.holes).toHaveLength(4);
    expect(b.comps.filter((c) => c.conn).map((c) => c.conn!.type).sort()).toEqual(['header', 'jtag20', 'usb_micro_b']);
    expect(b.comps.every((c) => /^c_/.test(c.id)) && b.holes.every((x) => /^h_/.test(x.id))).toBe(true);
    // a second copy has ids of its own
    await act(async () => { (tiles[0].querySelector('.ltile-main') as HTMLElement).click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(added[1][0].comps[0].id).not.toBe(b.comps[0].id);
  });

  it('the Community shelf and the search show only them, and picking several adds them all at once', async () => {
    const added: Board[][] = [];
    const h = await open((b) => added.push(b));
    const tab = [...h.querySelectorAll<HTMLElement>('[role=tab]')].find((x) => x.textContent?.startsWith('Community'))!;
    await act(async () => { tab.click(); });
    expect([...h.querySelectorAll('h4')].map((x) => x.textContent)).toEqual(['Community boards']);
    const input = h.querySelector('input[type=search]') as HTMLInputElement;
    await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; set.call(input, 'pictured'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect([...h.querySelectorAll('.ltile .nm')].map((x) => x.textContent)).toEqual(['Pictured board']);
    await act(async () => { (h.querySelector('.qbtn') as HTMLElement).click(); (h.querySelector('.qbtn') as HTMLElement).click(); });
    const addBtn = [...h.querySelectorAll<HTMLElement>('.lib-foot .btn.primary')][0];
    expect(addBtn.textContent).toContain('Add 2 boards');
    await act(async () => { addBtn.click(); await new Promise((r) => setTimeout(r, 0)); });
    expect(added).toHaveLength(1);
    expect(added[0].map((b) => b.name)).toEqual([real.name, real.name]);
  });
});
