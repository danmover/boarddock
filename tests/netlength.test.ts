// One length for all RJ45 leads: the longest route rounded up to a stock length, on the shopping list and the BOM.
import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { autoLinks, numberLinks, ROUTER } from '../src/model/links';
import { cableLines, type CableOut } from '../src/model/cablelist';
import { netSpread, oneNetBuy } from '../src/model/netlength';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
const rack = (ids: string[]) => { const p = newProject(T(ids[0])); for (const id of ids.slice(1)) p.modules.push(newModule(T(id))); return p; };

/** The routed cables of a rack's Ethernet links, `lens` mm long each (the generator does this in the app). */
function routed(p: ReturnType<typeof rack>, lens: number[]): CableOut[] {
  const nets = (p.links ?? []).filter((l) => l.kind === 'net' && l.a.module !== ROUTER && l.b.module !== ROUTER); // (the uplink to your router isn't routed)
  return nets.map((l, i) => ({ id: l.id, a: '', b: '', kind: 'net' as const, length: lens[i % lens.length], buy: [0.1, 0.15, 0.2, 0.25, 0.3, 0.5, 1, 1.5, 2, 3, 5].find((s) => s >= (lens[i % lens.length] * 1.1) / 1000)! }));
}

describe('one length for every Ethernet lead', () => {
  const p = rack(['rpi4', 'rpi4', 'rpi4', 'net_switch5', 'uno']);
  p.links = numberLinks(autoLinks(p));
  const cables = routed(p, [180, 420, 1200]);

  it('is off by default: each lead at its own length', () => {
    expect(netSpread(cables)).toEqual({ n: 3, short: 0.2, long: 1.5 });
    expect(oneNetBuy(p, cables)).toBeNull();
    const net = cableLines(p, cables).buy.filter((x) => /RJ45/.test(x));
    expect(net).toHaveLength(3);
  });

  it('on: every routed lead at the longest route, rounded up to a stock length', () => {
    const q = { ...p, oneNetLength: true };
    expect(oneNetBuy(q, cables)).toBe(1.5); // 1200 mm + 10% = 1.32 m: the next stock length is 1.5
    const net = cableLines(q, cables).buy.filter((x) => /RJ45/.test(x));
    expect(net).toHaveLength(1);
    expect(net[0]).toMatch(/^3 × 1\.5 m RJ45 to RJ45 cable \(numbers \d+, \d+, \d+\)$/);
  });

  it('leaves other cables at their own lengths and does nothing without Ethernet', () => {
    const usb: CableOut = { id: 'x', a: '', b: '', kind: 'usb', length: 200, buy: 0.3 };
    expect(oneNetBuy({ oneNetLength: true }, [usb])).toBeNull();
    expect(netSpread([usb])).toBeNull();
    const q = { ...p, oneNetLength: true };
    const others = (p.links ?? []).filter((l) => l.kind !== 'net' && l.kind !== 'power').map((l) => ({ id: l.id, a: '', b: '', kind: l.kind!, length: 200, buy: 0.3 }));
    expect(others.length).toBeGreaterThan(0);
    const ls = cableLines(q, [...cables, ...others]).buy;
    expect(ls.some((x) => /0\.3 m/.test(x))).toBe(true);
  });
});
