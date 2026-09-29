// The cable kinds' colours: every kind has one, the same everywhere, and no two are close for people with red-green or
// blue-yellow colour blindness (simulated with Machado et al.'s matrices, compared in CIELAB).
import { describe, it, expect } from 'vitest';
import { KIND_COLOR, KIND_DASH, KIND_NAME, KIND_ORDER } from '../src/model/cablekinds';
import * as links from '../src/model/links';

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const unlin = (c: number) => { c = Math.max(0, Math.min(1, c)); return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055); };
const CVD: Record<string, number[][]> = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
const seen = (h: string, kind?: string) => { const r = rgb(h).map(lin); return kind ? CVD[kind].map((row) => unlin(row[0] * r[0] + row[1] * r[1] + row[2] * r[2])) : rgb(h); };
function lab(c: number[]) {
  const r = c.map(lin);
  const X = (0.4124 * r[0] + 0.3576 * r[1] + 0.1805 * r[2]) / 0.95047, Y = 0.2126 * r[0] + 0.7152 * r[1] + 0.0722 * r[2], Z = (0.0193 * r[0] + 0.1192 * r[1] + 0.9505 * r[2]) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
/** The least colour difference (CIE76) between any two kinds, as seen with this kind of vision. */
function closest(kind?: string) {
  const ks = KIND_ORDER, L = ks.map((k) => lab(seen(KIND_COLOR[k], kind)));
  let best = Infinity, pair = '';
  for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) { const d = Math.hypot(...L[i].map((v, t) => v - L[j][t])); if (d < best) { best = d; pair = `${ks[i]}/${ks[j]}`; } }
  return { best, pair };
}

describe('cable kind colours', () => {
  it('cover every kind of cable, and the rest of the app takes them from here', () => {
    const kinds = ['usb', 'power', 'video', 'net', 'audio', 'wire', 'debug', 'uart', 'jumper', 'mains'] as const;
    for (const k of kinds) {
      expect(KIND_COLOR[k]).toMatch(/^#[0-9a-f]{6}$/);
      expect(KIND_NAME[k]).toBeTruthy();
      expect(KIND_ORDER).toContain(k);
    }
    expect([...KIND_ORDER].sort()).toEqual([...kinds].sort());
    expect(new Set(kinds.map((k) => KIND_COLOR[k])).size).toBe(kinds.length);
    expect(links.KIND_COLOR).toBe(KIND_COLOR);
    expect(links.KIND_NAME).toBe(KIND_NAME);
  });

  it('are far enough apart to tell one from another, also with red-green or blue-yellow colour blindness', () => {
    expect(closest().best, closest().pair).toBeGreaterThan(20);
    for (const kind of Object.keys(CVD)) expect(closest(kind).best, `${kind}: ${closest(kind).pair}`).toBeGreaterThan(15);
  });

  it('do not lean on colour alone in the flat drawings: the kinds that are dark, pale or close have a line pattern', () => {
    for (const k of ['debug', 'uart', 'jumper', 'mains'] as const) expect(KIND_DASH[k]).toBeTruthy();
    expect(new Set(['debug', 'uart', 'jumper', 'mains'].map((k) => KIND_DASH[k as keyof typeof KIND_DASH])).size).toBe(4);
  });
});
