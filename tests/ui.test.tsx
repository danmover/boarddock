// @vitest-environment happy-dom
// Small UI behaviours, rendered in a fake DOM: the whole title of a card with a checkbox is its label.
import { describe, it, expect, afterEach } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Section } from '../src/ui/controls';

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
