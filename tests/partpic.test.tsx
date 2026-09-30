// @vitest-environment happy-dom
// A toolbox tile's picture: the shipped one when there is one (public/tiles/, tiles.json), and for a contributed connector
// (parts/) that nobody has rendered a picture of, a plain drawing made from its look instead of a blank or a live 3D render.
import { describe, it, expect, afterEach, vi } from 'vitest';
vi.mock('../src/worker/client', () => ({ boardPicture: async () => '', holderPicture: async () => '', runClipFea: async () => null, buildTestKit: async () => null }));
vi.mock('../src/model/parts.json', () => ({
  default: {
    v: 1, names: [],
    types: [{ id: 'jack635', label: '6.35 mm (1/4 in) audio jack', entry: 'edge', body: { w: 14, l: 20, h: 12 }, plug: { w: 16, h: 16, len: 30, cable: 6 }, role: 'audio',
      look: [{ box: 'black', from: [0, 0, 0], to: [1, 1, 1] }, { mouth: 'round', at: [0.5, 0.5], size: [0.62, 0.62], depth: 0.8 }, { pins: 'gold', n: 1, pitch: 1, d: 1.4, at: [0.5, 0.2, 0.5], len: 0.45, axis: 'y' }] }],
  },
}));
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PartPic } from '../src/ui/Toolbox';
import { PALETTE } from '../src/model/palette';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null, host: HTMLElement | null = null;
async function mount(node: ReactNode) {
  (window as any).happyDOM?.setURL('http://localhost/');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(node); });
  return host;
}
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); root = null; host = null; });

describe('a toolbox tile\'s picture', () => {
  it('a contributed connector without a rendered picture shows a drawing made from its look', async () => {
    const it = PALETTE.find((x) => x.id === 'edge_jack635')!;
    expect(it.group).toBe('Contributed');
    const h = await mount(<PartPic item={it} />);
    const svg = h.querySelector('svg.pic.icon');
    expect(svg?.getAttribute('data-type')).toBe('jack635');
    expect(svg?.querySelectorAll('rect,ellipse').length).toBeGreaterThan(3); // the outline, the housing, the round mouth, the contact
    expect(h.querySelector('img')).toBeNull();
  });

  it('a built-in one shows its shipped picture, asked for by the fingerprint of its model', async () => {
    const it = PALETTE.find((x) => x.id === 'edge_usb_c')!;
    const h = await mount(<PartPic item={it} />);
    const img = h.querySelector('img.pic');
    expect(img?.getAttribute('src')).toMatch(/tiles\/pal\/edge_usb_c\.webp\?v=\w+/);
    expect(h.querySelector('svg.icon')).toBeNull();
  });
});
