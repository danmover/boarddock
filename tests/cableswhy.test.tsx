// @vitest-environment happy-dom
// Plugs › Cables: each cable Auto-connect made says why, under what it is for; one you made says nothing. (The 3D
// worker is stubbed.)
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
vi.mock('../src/worker/client', () => ({ boardPicture: async () => '', holderPicture: async () => '', runClipFea: async () => null, buildTestKit: async () => null }));
import { CablesSection } from '../src/ui/panels';
import { store } from '../src/state';
import { autoLinks, numberLinks } from '../src/model/links';
import { newModule, newProject } from '../src/model/library';
import { TEMPLATES } from '../src/model/templates';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null, host: HTMLElement | null = null;
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); root = null; host = null; });

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();

describe('the Cables list', () => {
  it('says why Auto-connect made each cable, and nothing for one you made', async () => {
    const p = newProject(T('rpi4'));
    p.modules.push(newModule(T('uno')), newModule(T('usb_hub7')));
    p.links = numberLinks(autoLinks(p));
    p.links.push({ id: 'mine', a: { module: p.modules[1].id, ref: 'USB' }, b: { module: p.modules[0].id, ref: 'USB1' }, kind: 'usb', no: 99 });
    expect(p.links.filter((l) => l.auto && l.why).length).toBeGreaterThan(1);
    store.set({ project: p, past: [], future: [], sel: [], result: null });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(<CablesSection />); });
    const rows = [...host.querySelectorAll('.list .item')];
    expect(rows.length).toBe(p.links.length);
    p.links.forEach((l, i) => expect(rows[i].querySelector('.cwhy')?.textContent ?? null).toBe(l.auto ? l.why! : null));
    // the reason is in words, not a code: "The nearest free port of the Powered USB hub (about 40 cm)."
    expect(rows.some((r) => /nearest free port of the Powered USB hub/.test(r.querySelector('.cwhy')?.textContent ?? ''))).toBe(true);
  });
});
