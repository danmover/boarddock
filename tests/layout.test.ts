// Auto-arrange as a scored layout: the scoring harness, the planner against the classic order on real builds (cables as
// the router lays them), determinism, speed, each Auto-arrange option changing a layout the way it should, and "pack new
// boards only" leaving everything that was placed where it is (locks included).
import { describe, it, expect, beforeAll } from 'vitest';
import { initKernel } from '../src/cad/kernel';
import { generatePanel } from '../src/cad/panelgen';
import { generateChecked } from '../src/cad/arrange';
import { appendDock, autoAssignClassic, seatBoard } from '../src/cad/dockplan';
import { lastPlan, planCandidates, type PlanStats } from '../src/cad/autoplan';
import { packNew } from '../src/cad/packnew';
import { cableToBuy } from '../src/model/links';
import { newModule } from '../src/model/library';
import { TEMPLATES } from '../src/model/templates';
import { autoLinks, numberLinks } from '../src/model/links';
import type { ArrangeOpts, Project, RailMount } from '../src/model/types';
import { LAYOUT_RACKS, EXTRA_RACKS, rackOf } from './collide/layoutracks';
import { freeze, seeded } from './collide/racks';
import { costOf, scoreLayout, WEIGHTS } from './collide/score';

beforeAll(async () => { await initKernel(); });

const rackNamed = (n: string) => [...LAYOUT_RACKS, ...EXTRA_RACKS].find((r) => r.name === n)!;
const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();

/** The planner on a rack (no build): its best layout and what it comes to by its own measures. */
function plan(p: Project, o?: ArrangeOpts) {
  if (o) p.panel.opts = { ...p.panel.opts, ...o };
  const c = planCandidates(p, autoAssignClassic(p), 2);
  return { mounts: c[0].mounts, st: lastPlan as PlanStats };
}
const modOf = (p: Project, id: string | null) => p.modules.find((m) => m.id === id);
const hasOutlets = (p: Project, mt: RailMount) => mt.slots.some((s) => modOf(p, s.module)?.board.comps.some((c) => c.conn?.type.startsWith('ac_')));

describe('the scoring harness', () => {
  it('scores a build: cables, crossings, rails, footprint, hosts, mains and failures, in one cost', () => {
    const p = rackNamed('mains among boards').make();
    const s = scoreLayout(p, generatePanel(p));
    expect(s.cables).toBeGreaterThan(3);
    expect(s.total).toBeGreaterThan(s.longest);
    expect(s.longest).toBeGreaterThan(0);
    expect(s.railLen).toBeGreaterThan(200);
    expect(s.rails).toBeGreaterThanOrEqual(1);
    expect(s.footprint).toBeGreaterThan(0);
    expect(s.hostDist).toBeGreaterThan(0);
    expect(s.hostMax).toBeLessThanOrEqual(s.longest);
    expect(s.mainsNear).toBeGreaterThanOrEqual(0);
    expect(s.hard).toBe(s.issues.length);
    expect(costOf(s)).toBe(s.cost);
    // the cost is all of it in mm of cable
    expect(s.cost).toBeGreaterThanOrEqual(WEIGHTS.total * s.total + WEIGHTS.longest * s.longest - 1);
  }, 120_000);
});

describe('Auto-arrange against the classic order (real builds)', () => {
  const SET = ['Pi cluster', 'boxes', 'busy mixed rack', 'probes and adapters', 'rails along (columns)', 'J-Link + adapter rack'];
  const rows: { name: string; before: ReturnType<typeof scoreLayout>; after: ReturnType<typeof scoreLayout> }[] = [];
  for (const name of SET) {
    it(`${name}: no worse than the classic order`, () => {
      const before = (() => { const p = rackNamed(name).make(); p.panel.opts = { plan: 'classic' }; return scoreLayout(p, generatePanel(p)); })();
      const p = rackNamed(name).make();
      const after = scoreLayout(p, generateChecked(p));
      rows.push({ name, before, after });
      expect(after.hard, after.issues.join('; ')).toBeLessThanOrEqual(before.hard);
      expect(after.cost, `${name}: ${before.cost} -> ${after.cost}`).toBeLessThanOrEqual(before.cost + 25);
    }, 300_000);
  }
  it('and better in total', () => {
    expect(rows.length).toBe(SET.length);
    const b = rows.reduce((a, r) => a + r.before.cost, 0), a = rows.reduce((x, r) => x + r.after.cost, 0);
    expect(a).toBeLessThan(0.9 * b);
    // the cables in particular: shorter, and fewer crossings
    expect(rows.reduce((x, r) => x + r.after.total, 0)).toBeLessThan(0.85 * rows.reduce((x, r) => x + r.before.total, 0));
    expect(rows.reduce((x, r) => x + r.after.crossings, 0)).toBeLessThan(rows.reduce((x, r) => x + r.before.crossings, 0));
  });
});

describe('the planner', () => {
  it('lays a rack out the same way every time, whatever Math.random does', () => {
    const a = plan(rackNamed('busy mixed rack').make()).mounts;
    Math.random(); Math.random();
    const b = plan(rackNamed('busy mixed rack').make()).mounts;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    // (and not because it does nothing: it is not the classic order)
    const p = rackNamed('busy mixed rack').make();
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(autoAssignClassic(p)));
  });

  it('takes under a second for the 16-board rack', () => {
    const ms = [0, 1, 2].map(() => { plan(rackNamed('Pi cluster').make()); return lastPlan!.ms; });
    // (the best of three: a busy machine can stall one)
    expect(Math.min(...ms), `${ms.join(', ')} ms`).toBeLessThan(1000);
    expect(lastPlan!.evals).toBeGreaterThan(1000);
    expect(lastPlan!.cost).toBeLessThan(lastPlan!.classic);
  });

  it('keeps every board in one dock, pairs only where the option allows, and rails within the limit', () => {
    const p = rackNamed('Pi cluster').make();
    const { mounts } = plan(p);
    const seen = mounts.flatMap((m) => m.slots.map((s) => s.module).filter(Boolean));
    expect(new Set(seen).size).toBe(seen.length);
    const base = p.modules.filter((m) => !m.on && m.board.kind !== 'box' || (m.board.kind === 'box' && !m.board.box?.pack));
    expect(seen.length).toBe(base.length);
    const rows = new Map<number, number>();
    for (const m of mounts) rows.set(m.row!, (rows.get(m.row!) ?? 0) + 1);
    expect(rows.size).toBeGreaterThan(1);
    const noPairs = plan(rackNamed('pairs by Auto-arrange').make(), { plan: 'smart' }).mounts;
    const q = rackNamed('pairs by Auto-arrange').make(); q.panel.pairs = false;
    const alone = plan(q).mounts;
    expect(alone.every((m) => m.slots.filter((s) => s.module).length === 1)).toBe(true);
    expect(noPairs.some((m) => m.slots.filter((s) => s.module).length === 2)).toBe(true);
  });

  it('puts a column of probes right beside its board (and lets them go free when asked)', () => {
    const p = rackNamed('J-Link + adapter rack').make();
    const { mounts } = plan(p);
    const target = (id: string) => { for (const l of p.links ?? []) { const o = l.a.module === id ? l.b : l.b.module === id ? l.a : null; const m = o && modOf(p, o.module); if (m && !m.board.role && m.board.kind !== 'box') return m.id; } return null; };
    mounts.forEach((mt, i) => {
      const probes = mt.slots.map((s) => s.module).filter((id): id is string => !!id && !!modOf(p, id)?.board.role);
      if (!probes.length || probes.length < mt.slots.filter((s) => s.module).length) return;
      const t = target(probes[0]);
      const near = [mounts[i - 1], mounts[i], mounts[i + 1], mounts[i - 2], mounts[i + 2]].filter(Boolean).some((m) => m.slots.some((s) => s.module === t));
      expect(near, `${modOf(p, probes[0])!.board.name} is not beside its board`).toBe(true);
    });
    expect(plan(rackNamed('J-Link + adapter rack').make(), { probes: 'free' }).mounts.length).toBeGreaterThan(0);
  });

  describe('options', () => {
    const wide = (name: string, o: ArrangeOpts) => { const p = rackNamed(name).make(); p.panel.maxRail = 800; return plan(p, o); };
    it('mains at the left, the right or the bottom', () => {
      for (const at of ['left', 'right', 'bottom'] as const) {
        const p = rackNamed('mains among boards').make(); p.panel.maxRail = 800;
        const { mounts } = plan(p, { mains: at });
        const k = mounts.findIndex((m) => hasOutlets(p, m));
        expect(k).toBeGreaterThanOrEqual(0);
        const row = mounts[k].row!, rowsN = Math.max(...mounts.map((m) => m.row!));
        if (at === 'left') expect(mounts.findIndex((m) => m.row === row)).toBe(k);
        if (at === 'right') expect(mounts.map((m) => m.row).lastIndexOf(row)).toBe(k);
        if (at === 'bottom') expect(row).toBe(rowsN);
      }
    });
    it('keeps the powerboard from being among low-voltage boards: at most a board or two within 50 mm of it', () => {
      const on = wide('mains among boards', { mains: 'auto' }).st.detail.mains;
      expect(on).toBeLessThanOrEqual(2);
    });
    it('groups like boards: side by side, turned the same way', () => {
      const p = rackNamed('alike Pis').make(); p.panel.pairs = false;
      const { mounts, st } = plan(p, { group: true });
      const pis = mounts.map((m, i) => (modOf(p, m.slots[0].module)?.board.name.startsWith('Raspberry Pi 4') ? i : -1)).filter((i) => i >= 0);
      expect(pis.length).toBe(6);
      expect(pis[pis.length - 1] - pis[0]).toBe(5);
      expect(new Set(pis.map((i) => `${mounts[i].turn}${mounts[i].slots[0].edge}`)).size).toBe(1);
      expect(st.detail.alike).toBe(0);
    });
    it('spreads hot boards apart, and toward the top', () => {
      const off = plan(rackNamed('busy mixed rack').make()).st.detail, on = plan(rackNamed('busy mixed rack').make(), { heat: true }).st.detail;
      expect(on.hot).toBeLessThanOrEqual(off.hot);
      expect(on.hotRow).toBeLessThanOrEqual(off.hotRow);
    });
    it('keeps hosts and their devices close, more than when it does not matter', () => {
      const hosted = (p: Project, lens: number[]) => (p.links ?? []).reduce((a, l, i) => a + (l.kind === 'usb' && (lens[i] ?? 0) ? lens[i] : 0), 0);
      const p1 = rackNamed('hubs and hosts').make(), on = plan(p1, { hosts: true }).st.detail;
      const p2 = rackNamed('hubs and hosts').make(), off = plan(p2, { hosts: false }).st.detail;
      expect(hosted(p1, on.lens)).toBeLessThanOrEqual(hosted(p2, off.lens) + 1);
    });
    it('fits stock cable lengths', () => {
      const buy = (o: ArrangeOpts) => plan(rackNamed('boxes').make(), o).st.detail.lens.reduce((a, l) => a + (l ? cableToBuy(l * 1.05) : 0), 0);
      expect(buy({ stock: true })).toBeLessThanOrEqual(buy({ stock: false }) + 1e-9);
    });
    it('makes fewer docks when asked for the fewest parts', () => {
      const off = plan(rackNamed('Pi cluster').make()).st.detail.docks, on = plan(rackNamed('Pi cluster').make(), { fewParts: true }).st.detail.docks;
      expect(on).toBeLessThanOrEqual(off);
    });
    it('puts the shortest rails first when it must be compact, the shortest cables when asked', () => {
      const c = plan(rackNamed('boxes').make(), { goal: 'compact' }).st.detail, k = plan(rackNamed('boxes').make(), { goal: 'cables' }).st.detail;
      const sum = (d: typeof c) => d.lens.reduce((a, l) => a + (l || 0), 0);
      // (a search, not a sum: within 3 % either way)
      expect(c.railLen).toBeLessThanOrEqual(k.railLen * 1.03);
      expect(sum(k)).toBeLessThanOrEqual(sum(c) * 1.03);
    });
    it('keeps what you touch clear of neighbours when it must be easy to reach', () => {
      const a = plan(rackNamed('Pi cluster').make()).st.detail.reach, b = plan(rackNamed('Pi cluster').make(), { goal: 'reach' }).st.detail.reach;
      expect(b).toBeLessThanOrEqual(a);
    });
    it('leaves room to grow: free rail after the last dock on each rail', () => {
      const len = (spare: number) => { const p = rackNamed('pairs by Auto-arrange').make(); p.panel.opts = { spare }; return generatePanel(p).report.panel!.rails.reduce((a, r) => a + r.length, 0); };
      expect(len(2)).toBeGreaterThan(len(0) + 60);
    }, 120_000);
  });
});

describe('pack new boards only', () => {
  /** A rack laid out and frozen by hand, then three boards added that are on no rail yet. */
  function grown(seed: number) {
    return seeded(seed, () => {
      const p = rackOf(['rpi4', 'uno', 'pico', 'usb_hub7'], (q) => { q.panel.maxRail = 300; });
      freeze(p);
      for (const id of ['esp32', 'rpi5', 'nano']) p.modules.push(newModule(T(id)));
      p.links = numberLinks([...(p.links ?? []), ...autoLinks(p)]);
      return p;
    });
  }
  const snapshot = (p: Project) => JSON.stringify({ rails: p.panel.rails, mounts: p.panel.mounts });

  it('places only the boards that were not placed, and leaves every dock and rail as it was', () => {
    const p = grown(701);
    const before = structuredClone(p.panel);
    const rep = generatePanel(p).report.panel!;
    expect(rep.unplaced.length).toBe(3);
    const placed = packNew(p, rep);
    expect(placed.map((x) => x.module).sort()).toEqual(p.modules.slice(4).map((m) => m.id).sort());
    // (what was there is exactly as it was: docks, their places, turns, slots and rails; a rail may only be made longer)
    for (const mt of before.mounts) {
      const now = p.panel.mounts.find((x) => x.id === mt.id)!;
      expect(now.rail).toBe(mt.rail); expect(now.at).toBe(mt.at); expect(now.turn).toBe(mt.turn); expect(now.kind).toBe(mt.kind);
      mt.slots.forEach((s, i) => { if (s.module) expect(now.slots[i]).toEqual(s); });
    }
    for (const r of before.rails) { const now = p.panel.rails.find((x) => x.id === r.id)!; expect([now.x, now.y, now.dir]).toEqual([r.x, r.y, r.dir]); }
    // every board is on a rail now, and the build has nothing overlapping
    const r2 = generatePanel(p);
    expect(r2.report.panel!.unplaced).toEqual([]);
    expect(r2.report.warnings.filter((w) => /overlap on the panel/.test(w))).toEqual([]);
  }, 120_000);

  it('puts a new board by the board it is cabled to: shorter cables than putting each on the end, and as good as seating it in a free slot', () => {
    const p = grown(702), q = grown(702), e = grown(702);
    packNew(p, generatePanel(p).report.panel!);
    for (const m of q.modules.slice(4)) seatBoard(q, m.id);
    for (const m of e.modules.slice(4)) appendDock(e, m.id);
    const a = scoreLayout(p, generatePanel(p)), b = scoreLayout(q, generatePanel(q)), c = scoreLayout(e, generatePanel(e));
    // (against the end of the rail, clearly; against `seatBoard`, which also looks for a free slot near the board it is cabled
    // to, within the 30 mm or so each cable is out by when placed without the router)
    expect(a.total, `${a.total} against ${c.total} mm on the end`).toBeLessThan(c.total);
    expect(a.total, `${a.total} against ${b.total} mm in a free slot`).toBeLessThanOrEqual(b.total * 1.05);
    expect(a.hard).toBeLessThanOrEqual(Math.min(b.hard, c.hard));
  }, 120_000);

  it('leaves a locked rail alone: nothing added to it, no change to its docks or its length', () => {
    const p = grown(703);
    const rep = generatePanel(p).report.panel!;
    const rail = p.panel.rails[0];
    (p as { locks?: unknown }).locks = { rails: [rail.id] };
    const frozen = JSON.parse(snapshot(p));
    const placed = packNew(p, rep);
    expect(placed.length).toBe(3);
    expect(JSON.stringify(p.panel.mounts.filter((m) => m.rail === rail.id))).toBe(JSON.stringify(frozen.mounts.filter((m: RailMount) => m.rail === rail.id)));
    expect(JSON.stringify(p.panel.rails.find((r) => r.id === rail.id))).toBe(JSON.stringify(frozen.rails.find((r: { id: string }) => r.id === rail.id)));
    expect(placed.every((x) => x.rail !== rail.id)).toBe(true);
  }, 120_000);

  it('leaves a locked dock alone: no board goes into its free slot', () => {
    const p = grown(705);
    const rep = generatePanel(p).report.panel!;
    // every dock with a free back slot is locked: none may take a board
    const open = p.panel.mounts.filter((m) => m.kind === 'dock' && m.slots.some((s, i) => i > 0 && !s.module));
    expect(open.length).toBeGreaterThan(0);
    (p as { locks?: unknown }).locks = { docks: open.map((m) => m.id) };
    const before = JSON.stringify(open);
    packNew(p, rep);
    expect(JSON.stringify(p.panel.mounts.filter((m) => open.some((o) => o.id === m.id)))).toBe(before);
  }, 120_000);

  it('does nothing when every board is placed', () => {
    const p = seeded(704, () => { const q = rackOf(['rpi4', 'uno']); freeze(q); return q; });
    const rep = generatePanel(p).report.panel!, s = snapshot(p);
    expect(packNew(p, rep)).toEqual([]);
    expect(snapshot(p)).toBe(s);
  }, 120_000);
});
