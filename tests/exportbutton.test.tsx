// @vitest-environment happy-dom
// The Export step's main button: once the start code is known (a profile's, the plain Marlin or Klipper template, the
// printer's own, or code typed in that passed the check) it slices every plate; else it downloads everything as before.
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ExportPanel } from '../src/ui/panels';
import { loadProject, store } from '../src/state';
import { newProject } from '../src/model/library';
import { TEMPLATES } from '../src/model/templates';
import { generate } from '../src/cad/assembly';
import { initKernel } from '../src/cad/kernel';
import type { PrinterSettings } from '../src/model/types';

vi.mock('../src/worker/client', () => ({ boardPicture: async () => '', holderPicture: async () => '', runClipFea: async () => null, buildTestKit: async () => null }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null, host: HTMLElement | null = null;
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); root = null; host = null; });
beforeAll(async () => { await initKernel(); });

async function open(printer: PrinterSettings) {
  const p = newProject(TEMPLATES.find((t) => t.id === 'uno')!.make());
  p.printer = printer;
  loadProject(p);
  store.set({ result: generate(p) });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<ExportPanel />); });
  return host;
}
const buttons = (h: HTMLElement) => [...h.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '');
const CORE_ONE: PrinterSettings = { name: 'Prusa CORE One', bed: [250, 220], spacing: 7, maxZ: 270 }; // plain Marlin template, no profile
const VORON: PrinterSettings = { name: 'Voron 2.4 350', bed: [350, 350], spacing: 7, maxZ: 325 }; // plain Klipper template

describe('the main Export button', () => {
  it('slices and downloads all G-code on a printer with the plain Marlin or Klipper template', async () => {
    for (const printer of [CORE_ONE, VORON]) {
      const h = await open(printer);
      expect(buttons(h), printer.name).toContain('Slice and download all G-code (.zip)');
      expect(buttons(h).some((t) => /^Download everything with the G-code/.test(t)), printer.name).toBe(true);
      await act(async () => { root?.unmount(); });
      host?.remove(); root = null; host = null;
    }
  }, 120000);

  it('waits for code typed in until it passes, and downloads everything meanwhile', async () => {
    const bad = { ...CORE_ONE, gcodeStart: 'G28\nM104 S{temp}\nM140 S{bed_temp}\nG1 X340 Y300' }; // a bigger printer's move
    const h = await open(bad);
    expect(buttons(h)).not.toContain('Slice and download all G-code (.zip)');
    expect(buttons(h)).toContain('Download everything (.zip)');
    await act(async () => { root?.unmount(); });
    host?.remove(); root = null; host = null;
    const good = { ...CORE_ONE, gcodeStart: 'G90\nM83\nM140 S{bed_temp}\nG28\nM190 S{bed_temp}\nM104 S{temp}\nM109 S{temp}\nG92 E0\nG1 X3 Y20 F6000' };
    expect(buttons(await open(good))).toContain('Slice and download all G-code (.zip)');
  }, 120000);

  it("keeps 'Download everything' for a Bambu printer that has no start code loaded yet", async () => {
    const h = await open({ name: 'Bambu Lab A1 mini', bed: [180, 180], spacing: 7, maxZ: 180 });
    expect(buttons(h)).not.toContain('Slice and download all G-code (.zip)');
    expect(buttons(h)).toContain('Download everything (.zip)');
  }, 120000);
});
