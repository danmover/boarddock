// @vitest-environment happy-dom
// Plugs › Debug and serial: every board's debug and UART headers listed, one button adds a J-Link and an adapter for
// every header without, and the bench sheet prints.
import { describe, it, expect, afterEach, vi } from 'vitest';
vi.mock('../src/worker/client', () => ({ boardPicture: async () => '', holderPicture: async () => '', runClipFea: async () => null, buildTestKit: async () => null }));
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TEMPLATES } from '../src/model/templates';
import { putBoards, store } from '../src/state';
import { PlugsPanel } from '../src/ui/panels';
import { printBenchSheet } from '../src/ui/DebugPanel';
import { isProbe } from '../src/model/probes';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null, host: HTMLElement | null = null;
async function mount(node: ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(node); });
  return host;
}
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); root = null; host = null; });

describe('Plugs › Debug and serial', () => {
  it('lists the headers of every board, adds the missing J-Links and adapters in one press, and prints a bench sheet', async () => {
    putBoards(['example_dual_swd', 'example_jtag'].map((id) => TEMPLATES.find((t) => t.id === id)!.make()), true);
    const h = await mount(<PlugsPanel />);
    const heading = () => [...h.querySelectorAll('h3')].find((x) => /^Debug and serial/.test(x.textContent ?? ''))!;
    // every board's headers, not only the one being edited, and what is missing
    expect(heading().textContent).toMatch(/Debug and serial · 5 headers/);
    expect(h.textContent).toMatch(/No J-Link on it\. Red stripe \(pin 1\) on the bottom-left pin of J_SWD1/);
    const add = [...h.querySelectorAll<HTMLButtonElement>('button')].find((b) => /Add 3 J-Links \+ 2 adapters/.test(b.textContent ?? ''))!;
    expect(add).toBeTruthy();
    await act(async () => { add.click(); });
    const p = store.get().project!;
    expect(p.modules.filter(isProbe).length).toBe(5);
    expect(p.modules.length).toBe(7);
    // nothing to add now, and each header names what is on it
    expect([...h.querySelectorAll<HTMLButtonElement>('button')].some((b) => /^\s*Add \d/.test(b.textContent ?? ''))).toBe(false);
    expect(h.textContent).toMatch(/J-Link/);
    expect(h.textContent).toMatch(/To buy for these/);
    // the sheet goes into the page that prints
    const print = vi.fn();
    (window as any).print = print; // (the fake DOM has none)
    printBenchSheet();
    const sheet = document.getElementById('printguide')!;
    expect(print).toHaveBeenCalledTimes(1);
    expect(sheet.querySelectorAll('tbody tr').length).toBe(5);
    expect(sheet.textContent).toMatch(/Dual-MCU controller/);
    expect(sheet.textContent).toMatch(/debug bench sheet/);
    sheet.remove();
  });
});
