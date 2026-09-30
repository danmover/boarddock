// @vitest-environment happy-dom
// Small UI behaviours, rendered in a fake DOM: the whole title of a card with a checkbox is its label; a modal window
// keeps the keyboard inside it and gives it back.
import { describe, it, expect, afterEach, vi } from 'vitest';
vi.mock('../src/worker/client', () => ({ boardPicture: async () => '', holderPicture: async () => '', runClipFea: async () => null, buildTestKit: async () => null }));
import { act, useRef, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Section, useModalFocus } from '../src/ui/controls';
import { forgetBoard, myBoards, restoreBoard, saveBoard } from '../src/model/myboards';
import { TEMPLATES } from '../src/model/templates';
import { PRINTERS } from '../src/model/library';
import { putBoards, rememberPrinter, select, store } from '../src/state';
import { PlugsPanel } from '../src/ui/panels';
import { portUses } from '../src/model/portuse';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null, host: HTMLElement | null = null;
/** Render into the document and let effects settle. */
async function mount(node: ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(node); });
  return host;
}
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); root = null; host = null; });

describe('a card with a checkbox in its title', () => {
  it('toggles from a click anywhere on the title, not only on the box', async () => {
    const seen: boolean[] = [];
    const h = await mount(<Section title="DIN rail clip" toggle={{ value: false, onChange: (v) => seen.push(v) }}><p>body</p></Section>);
    const box = h.querySelector<HTMLInputElement>('h3 input[type=checkbox]')!;
    const label = box.closest('label')!;
    // the title's words are inside the box's own label, so clicking them clicks the box
    expect(label.textContent).toBe('DIN rail clip');
    await act(async () => { label.querySelector('span')!.click(); });
    expect(seen).toEqual([true]);
    await act(async () => { box.click(); });
    expect(seen).toEqual([true, true]);
  });

  it('is just a title without one', async () => {
    const h = await mount(<Section title="Layout"><p>body</p></Section>);
    expect(h.querySelector('h3 label')).toBeNull();
    expect(h.querySelector('h3')!.textContent).toBe('Layout');
  });
});

/** A button that opens a window with some controls, a disabled and a hidden one at its end, and a button behind it. */
function Demo({ closed }: { closed: () => void }) {
  const [open, setOpen] = useState(false);
  const win = useRef<HTMLDivElement>(null);
  useModalFocus(open, win, () => { closed(); setOpen(false); });
  return (
    <div>
      <button id="opener" onClick={() => setOpen(true)}>Open</button>
      {open && <div id="win" role="dialog" tabIndex={-1} ref={win}>
        <button id="first">First</button><input id="mid" /><a id="link" href="#x">Link</a>
        <button id="last" onClick={() => setOpen(false)}>Close</button><button id="off" disabled>Off</button><input id="hid" type="file" hidden />
      </div>}
      <button id="behind">Behind</button>
    </div>
  );
}

describe('a modal window', () => {
  const key = (k: string, shift = false) => { const e = new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true }); (document.activeElement ?? document.body).dispatchEvent(e); return e; };
  const at = () => document.activeElement?.id;
  const open = async () => {
    let closed = 0;
    const h = await mount(<Demo closed={() => closed++} />);
    const opener = h.querySelector<HTMLElement>('#opener')!;
    opener.focus();
    await act(async () => { opener.click(); });
    return { h, opener, closed: () => closed };
  };

  it('takes the keyboard when it opens, on the window itself so the first Tab lands on its first control', async () => {
    await open();
    expect(at()).toBe('win');
    await act(async () => { key('Tab'); });
    expect(at()).toBe('first');
  });

  it('wraps Tab and Shift+Tab round the controls that can be reached, never out to the page behind', async () => {
    await open();
    const path: (string | undefined)[] = [];
    // (the browser would do the plain steps itself: only the wraps are the window's to make)
    for (const id of ['first', 'mid', 'link', 'last']) { document.getElementById(id)!.focus(); path.push(key('Tab').defaultPrevented ? 'wrapped' : 'natural'); }
    expect(path).toEqual(['natural', 'natural', 'natural', 'wrapped']);
    expect(at()).toBe('first'); // from the last back to the first
    key('Tab', true);
    expect(at()).toBe('last'); // and from the first back to the last reachable one (not the disabled or hidden ones after it)
    document.getElementById('win')!.focus();
    key('Tab', true);
    expect(at()).toBe('last');
    document.getElementById('behind')!.focus(); // strayed out somehow: the next Tab brings it back in
    key('Tab');
    expect(at()).toBe('first');
  });

  it('closes on Escape, and focus goes back to the button that opened it', async () => {
    const { h, opener, closed } = await open();
    await act(async () => { key('Escape'); });
    expect(closed()).toBe(1);
    expect(h.querySelector('#win')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('gives focus back when it closes by another way too, and stops listening once closed', async () => {
    const { h, opener } = await open();
    await act(async () => { h.querySelector<HTMLElement>('#last')!.click(); });
    expect(h.querySelector('#win')).toBeNull();
    expect(document.activeElement).toBe(opener);
    const e = key('Tab');
    expect(e.defaultPrevented).toBe(false);
  });
});

describe('My boards', () => {
  it('puts a board taken off My boards back where it was (Undo)', () => {
    localStorage.clear();
    for (const id of ['uno', 'pico', 'esp32']) saveBoard(TEMPLATES.find((t) => t.id === id)!.make());
    const names = myBoards().map((x) => x.name);
    const f = forgetBoard(myBoards()[1].id)!;
    expect(myBoards().map((x) => x.name)).toEqual([names[0], names[2]]);
    restoreBoard(f);
    expect(myBoards().map((x) => x.name)).toEqual(names);
    expect(forgetBoard('nothing')).toBeNull();
  });
});

describe('your printer', () => {
  it('a new rack is for the printer picked last (on Start or in Export)', () => {
    localStorage.clear();
    const other = PRINTERS[PRINTERS.length - 1];
    expect(other.name).not.toBe(PRINTERS[0].name);
    store.set({ project: null, past: [], future: [], sel: [] });
    putBoards([TEMPLATES.find((t) => t.id === 'uno')!.make()], true);
    expect(store.get().project!.printer.name).toBe(PRINTERS[0].name);
    rememberPrinter(other.name);
    store.set({ project: null, past: [], future: [], sel: [] });
    putBoards([TEMPLATES.find((t) => t.id === 'uno')!.make()], true);
    expect(store.get().project!.printer).toMatchObject({ name: other.name, bed: other.bed });
  });
});

describe('labels where off-rack leads go', () => {
  it('on a crowded view, the nearest keep their place and those that would lie on them are left out', async () => {
    const { keepApart } = await import('../src/ui/liveFx');
    // two far apart, a third on top of the second but further away, a fourth on top of the first and nearer
    const ls = [{ x: 0, y: 0, hw: 0.1, hh: 0.03, d: 500 }, { x: 0.5, y: 0.5, hw: 0.1, hh: 0.03, d: 300 }, { x: 0.52, y: 0.51, hw: 0.1, hh: 0.03, d: 400 }, { x: 0.05, y: 0.01, hw: 0.1, hh: 0.03, d: 200 }];
    expect(keepApart(ls)).toEqual([false, true, false, true]);
    expect(keepApart([ls[0], ls[1]])).toEqual([true, true]);
  });

  it('fade as the view goes out: all while the rack is whole in view, none once it is far off', async () => {
    const { labelFade } = await import('../src/ui/liveFx');
    expect(labelFade(3.5)).toBe(1);
    expect(labelFade(5)).toBe(1);
    expect(labelFade(6.5)).toBeCloseTo(0.5, 5);
    expect(labelFade(8)).toBe(0);
    expect(labelFade(20)).toBe(0);
  });
});

describe('framing a box with the camera', () => {
  it('backs off far enough for a long row seen from the front, in a wide and in a tall window', async () => {
    const THREE = await import('three');
    const { cornerDist } = await import('../src/ui/frame');
    const row = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(700, 60, 30));
    for (const aspect of [1.7, 0.5]) {
      const cam = new THREE.PerspectiveCamera(32, aspect);
      const d = new THREE.Vector3(0, -1, 0.22).normalize();
      const dist = cornerDist(cam, row, d, 1.3);
      // put the camera there: all 8 corners land inside the picture
      cam.up.set(0, 0, 1);
      const ctr = row.getCenter(new THREE.Vector3());
      cam.position.copy(ctr).addScaledVector(d, dist);
      cam.lookAt(ctr);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      for (let i = 0; i < 8; i++) {
        const q = new THREE.Vector3(i & 1 ? 700 : 0, i & 2 ? 60 : 0, i & 4 ? 30 : 0).project(cam);
        expect(Math.abs(q.x)).toBeLessThan(1);
        expect(Math.abs(q.y)).toBeLessThan(1);
      }
    }
  });
});

describe("an empty port's protection", () => {
  it('ticking a cradle on a port nothing is plugged into says it will be plugged in', async () => {
    putBoards([TEMPLATES.find((t) => t.id === 'uno')!.make()], true);
    const p0 = store.get().project!, dc = p0.modules[0].board.comps.find((c) => c.conn?.type === 'barrel')!;
    expect(portUses(p0, p0.modules[0]).get(dc.ref)).toBe('unused');
    await act(async () => { select([{ kind: 'comp', id: dc.id }]); });
    const h = await mount(<PlugsPanel />);
    const tick = [...h.querySelectorAll<HTMLLabelElement>('label')].find((l) => /^Guard collar/.test(l.textContent ?? ''))!;
    expect(h.textContent).toMatch(/This port is empty, so nothing is printed for it/);
    await act(async () => { tick.querySelector('input')!.click(); });
    const p1 = store.get().project!, c1 = p1.modules[0].board.comps.find((c) => c.id === dc.id)!;
    expect([c1.conn!.guard, c1.conn!.use, portUses(p1, p1.modules[0]).get(dc.ref)]).toEqual([true, 'yes', 'yours']);
  });
});

describe('wording for the way in', () => {
  it('says tap and press and hold on a touch screen, and leaves a mouse alone', async () => {
    const { say } = await import('../src/ui/touch');
    expect(say('Click a picture, or drop its files.', true)).toBe('Tap a picture, or drop its files.');
    expect(say('click the first corner · double-click to close · the name shows on hover', true)).toBe('tap the first corner · double-tap to close · the name shows on press and hold');
    expect(say('Click a picture', false)).toBe('Click a picture');
  });
});
