// @vitest-environment happy-dom
// The "Auto-arrange options" popover: one button, every option with its tip line, remembered in the project.
import { describe, it, expect, afterEach, vi } from 'vitest';
vi.mock('../src/worker/client', () => ({ boardPicture: async () => '', holderPicture: async () => '', runClipFea: async () => null, buildTestKit: async () => null }));
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ArrangeOptions } from '../src/ui/ArrangeOptions';
import { store } from '../src/state';
import { newModule, newProject } from '../src/model/library';
import { TEMPLATES } from '../src/model/templates';
import { autoLinks, numberLinks } from '../src/model/links';
import { addAdapters, addProbes } from '../src/model/probes';
import { stackCompanions } from '../src/model/probes';
import { autoAssignClassic } from '../src/cad/dockplan';
import { planCandidates } from '../src/cad/autoplan';

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

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
const rack = () => {
  const p = newProject(T('rpi4'));
  p.modules.push(newModule(T('uno')), newModule(T('usb_hub')));
  p.links = numberLinks(autoLinks(p));
  store.set({ project: p, past: [], future: [] });
  return p;
};

function Wrap() {
  const p = store.get().project!;
  return <ArrangeOptions project={p} />;
}

describe('Auto-arrange options', () => {
  it('opens on its button, with a tip under every option', async () => {
    const p = rack();
    const h = await mount(<ArrangeOptions project={p} />);
    expect(h.querySelector('.arr-pop')).toBeNull();
    await act(async () => { h.querySelector<HTMLButtonElement>('button')!.click(); });
    const pop = h.querySelector('.arr-pop')!;
    expect(pop).not.toBeNull();
    expect(pop.querySelectorAll('.arr-row').length).toBe(11);
    for (const row of pop.querySelectorAll('.arr-row')) expect(row.querySelector('.hint')!.textContent!.length).toBeGreaterThan(20);
    // (an automatic layout: no "pack new" button, it lays everything out again as you go)
    expect(pop.textContent).toContain('laid out again as you change these');
    expect(pop.textContent).not.toContain('Pack new boards only');
  });

  it('remembers a choice in the project, and forgets the last pick of candidate', async () => {
    const p = rack();
    p.panel.opts = { pick: 1 };
    store.set({ project: p });
    const h = await mount(<Wrap />);
    await act(async () => { h.querySelector<HTMLButtonElement>('button')!.click(); });
    const box = [...h.querySelectorAll<HTMLInputElement>('.arr-row input[type=checkbox]')].find((x) => x.closest('label')!.textContent!.includes('Group like boards'))!;
    await act(async () => { box.click(); });
    expect(store.get().project!.panel.opts).toEqual({ group: true });
  });

  it('offers "pack new boards only" on a layout of your own', async () => {
    const p = rack();
    p.panel.auto = false;
    store.set({ project: p });
    const h = await mount(<Wrap />);
    await act(async () => { h.querySelector<HTMLButtonElement>('button')!.click(); });
    expect(h.querySelector('.arr-foot')!.textContent).toContain('Pack new boards only');
    expect(h.querySelector('.arr-foot')!.textContent).toContain('Applies at the next Auto-arrange');
  });
});

describe('stacking the probes', () => {
  it("puts a board's J-Links and adapters in one column, and the planner leaves the ones on top without a dock", () => {
    const p = newProject(T('example_dual_swd'));
    p.modules.push(newModule(T('rpi4')));
    addProbes(p, p.modules[0].id); addAdapters(p, p.modules[0].id);
    p.links = numberLinks([...(p.links ?? []), ...autoLinks(p)]);
    for (const m of p.modules) { delete m.on; delete m.onMode; }
    expect(p.modules.filter((m) => m.on).length).toBe(0);
    expect(stackCompanions(p)).toBe(true);
    const riders = p.modules.filter((m) => m.on && m.onMode === 'column');
    expect(riders.length).toBeGreaterThan(0);
    const c = planCandidates(p, autoAssignClassic(p), 1)[0];
    const seated = new Set(c.mounts.flatMap((m) => m.slots.map((s) => s.module)));
    for (const r of riders) expect(seated.has(r.id)).toBe(false);
  });
});
