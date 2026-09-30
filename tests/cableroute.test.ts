// Where cables cross the rails: the runs along v are spread a cable's width apart (nothing lies over another under a
// rail), kept out of the stand blocks, and the cable's column stays where its plug is; the cables settle beside a rail
// or a plug, not 0.8 mm into it; and a plug pack's own lead is routed from its outlet and checked against its length.
import { describe, it, expect, beforeAll } from 'vitest';
import { spreadCrossings, type Obstacle, type Route } from '../src/cad/cableroute';
import { settleCables } from '../src/cad/cablesim';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { autoLinks, numberLinks } from '../src/model/links';
import { addProbes } from '../src/model/probes';
import { generatePanel } from '../src/cad/panelgen';
import { initKernel } from '../src/cad/kernel';

const ZC = -5.5, D = 4.5;
/** A cable from a plug at (u0, v0) to one at (u1, v1): down its column, along v to the street at `lane`, along it, along v to the other column. */
function cable(u0: number, v0: number, u1: number, v1: number, lane: number): Route {
  return {
    pts: [[u0, v0, 40], [u0, v0, ZC], [u0, lane, ZC], [u1, lane, ZC], [u1, v1, ZC], [u1, v1, 40]],
    kinds: ['escape', 'cross', 'street', 'cross', 'escape'],
  };
}
const runsAlongV = (r: Route) => r.kinds.flatMap((k, i) => (k === 'cross' && Math.abs(r.pts[i][0] - r.pts[i + 1][0]) < 0.01 ? [r.pts[i][0]] : []));

describe('cables that cross the rails side by side', () => {
  it('spreads runs along v that lie closer than the cables are wide, keeping every column where it was', () => {
    // three cables crossing the same rails within a few mm of each other
    const rs = [cable(100, -200, 300, 50, -100), cable(102, -190, 320, 60, -110), cable(104.5, -205, 340, 55, -120)];
    spreadCrossings(rs.map((route) => ({ route, d: D, zc: ZC })), []);
    // the first run of each (from its column across the rails)
    const at = rs.map((r) => runsAlongV(r)[0]);
    const sorted = [...at].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(D + 2.4 - 1e-6);
    // the columns (the points the cables drop and rise at) are as they were
    expect(rs.map((r) => r.pts[1].slice(0, 2))).toEqual([[100, -200], [102, -190], [104.5, -205]]);
    expect(rs.map((r) => r.pts[r.pts.length - 2].slice(0, 2))).toEqual([[300, 50], [320, 60], [340, 55]]);
    // and the order they were laid in, so none crosses another
    expect(at[0]).toBeLessThan(at[1]);
    expect(at[1]).toBeLessThan(at[2]);
  });

  it('leaves alone runs that are already a cable width apart', () => {
    const rs = [cable(100, -200, 300, 50, -100), cable(130, -190, 320, 60, -110)];
    spreadCrossings(rs.map((route) => ({ route, d: D, zc: ZC })), []);
    expect(runsAlongV(rs[0])[0]).toBe(100);
    expect(runsAlongV(rs[1])[0]).toBe(130);
  });

  it('moves a run out of a stand block, with room to spare for cables to go over each other beside it', () => {
    const block: Obstacle = { box: [95, -150, -10, 105, -105, 2.4], label: 'table stand 1', stand: true, solid: true };
    const r = cable(100, -200, 300, 50, -100);
    spreadCrossings([{ route: r, d: D, zc: ZC }], [block]);
    const u = runsAlongV(r)[0];
    expect(u === 100).toBe(false);
    expect(Math.abs(u - 100)).toBeGreaterThan(5 + D / 2); // clear of the block's half-width and the cable's
    expect(r.pts[1].slice(0, 2)).toEqual([100, -200]);
  });
});

describe('a cable settles beside a rail or a plug', () => {
  it('a cable pressed against a rail stays out of it (no brushing into its crown)', () => {
    // a rail across at z 0..7.5, the cable laid under it at its lowest and pressed up by another laid on top
    const rail = { box: [0, -17.5, 0, 200, 17.5, 7.5], solid: true };
    const low = { id: 'a', pts: [[50, -60, -5.5], [50, 60, -5.5]], r: 2.25, pin: [5, 5] as [number, number], floor: -5.5 };
    const high = { id: 'b', pts: [[50, -60, -3], [50, 60, -3]], r: 2.25, pin: [5, 5] as [number, number] };
    const res = settleCables([low, high], [rail]);
    for (const q of res.paths[1]) if (Math.abs(q[1]) < 17) expect(q[2] + 2.25).toBeLessThan(0.3); // its top under the crown, to 0.3 mm
  });
});

describe("a plug pack's own lead", () => {
  beforeAll(async () => { await initKernel(); });
  const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
  const rack = (lead?: number) => {
    const p = newProject(T('rpi5'));
    for (const id of ['pb4', 'psu_pi5']) p.modules.push(newModule(T(id)));
    if (lead != null) p.modules[2].board.box!.pack!.lead = lead;
    p.links = numberLinks(autoLinks(p));
    return generatePanel(p);
  };

  it('runs from the powerboard outlet it is plugged into to the board, with nothing to buy, and no lead leaving the rack', () => {
    const r = rack();
    const lead = (r.report.cables ?? []).find((c) => c.kind === 'power');
    expect(lead).toBeDefined();
    expect(lead!.buy).toBe(0);
    expect(lead!.length).toBeGreaterThan(50);
    expect(lead!.b).toMatch(/USB-C supply/); // (named for the pack and the board, though it is drawn from the outlet)
    expect(r.ghosts.some((g) => /^off-rack cable .*\/J_PWR$/.test(g.name))).toBe(false);
    expect(r.report.warnings.filter((w) => /'s own lead is/.test(w))).toEqual([]);
  }, 120_000);

  it('says when the route is longer than the lead it comes with', () => {
    const w = rack(60).report.warnings.filter((x) => /'s own lead is/.test(x));
    expect(w.length).toBe(1);
    expect(w[0]).toMatch(/USB-C supply, 27 W \(5 A\)'s own lead is 0\.1 m but has to run about \d+ mm from its outlet to Raspberry Pi 5/);
  }, 120_000);
});

describe('cable tags', () => {
  beforeAll(async () => { await initKernel(); });
  it('go round the round cables only: a flat ribbon is too wide to snap a ring round', () => {
    const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
    const p = newProject(T('example_dual_swd'));
    p.modules.push(newModule(T('usb_hub7')));
    addProbes(p, p.modules[0].id);
    p.links = numberLinks([...(p.links ?? []), ...autoLinks(p)]);
    const r = generatePanel(p);
    const tagged = new Set(r.parts.filter((x) => x.tag?.kind === 'cabletag').flatMap((x) => x.tag!.refs ?? []));
    const drawn = new Set((r.report.cables ?? []).map((c) => c.id));
    const ribbons = (p.links ?? []).filter((l) => l.kind === 'debug' && drawn.has(l.id)).map((l) => l.id), usb = (p.links ?? []).filter((l) => l.kind === 'usb' && drawn.has(l.id)).map((l) => l.id);
    expect(ribbons.length).toBeGreaterThan(0);
    expect(ribbons.filter((id) => tagged.has(id))).toEqual([]);
    expect(usb.length).toBeGreaterThan(0);
    expect(usb.every((id) => tagged.has(id))).toBe(true);
  }, 120_000);
});
