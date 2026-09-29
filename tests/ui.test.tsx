// @vitest-environment happy-dom
// Small UI behaviours, rendered in a fake DOM: the whole title of a card with a checkbox is its label; a modal window
// keeps the keyboard inside it and gives it back.
import { describe, it, expect, afterEach } from 'vitest';
import { act, useRef, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Section, useModalFocus } from '../src/ui/controls';

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
