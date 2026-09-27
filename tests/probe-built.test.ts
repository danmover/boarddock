// A J-Link added to a rack that is already built goes into the free slot of its board's dock: all that is new to
// print is its own slot holder (and what comes with it), nothing already printed changes, and its ribbon reaches.
import { it, expect, beforeAll } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { autoLinks, numberLinks } from '../src/model/links';
import { addProbes } from '../src/model/probes';
import { seatCompanion } from '../src/cad/dockplan';
import { generatePanel } from '../src/cad/panelgen';
import { initKernel } from '../src/cad/kernel';
import { delta, snapshot } from '../src/model/built';
import type { Project } from '../src/model/types';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
beforeAll(async () => { await initKernel(); });

/** What Mark as built does: freeze the layout, remember what was printed. */
function build(p: Project) {
  const r = generatePanel(p), pr = r.report.panel!;
  p.panel.rails = pr.rails.map((x) => ({ id: x.id, x: x.x, y: x.y, dir: x.dir, length: x.length }));
  p.panel.mounts = pr.mounts.map((m) => ({ id: m.id, rail: m.rail, at: m.at, kind: m.kind, turn: m.turn, lever: m.leverSide > 0 ? 'pos' as const : 'neg' as const, slots: m.slots.map((s, k) => ({ module: s.module, edge: s.module ? pr.modules.find((x) => x.id === s.module && x.mount === m.id && x.slot === k)?.edge ?? s.edge : s.edge })) }));
  p.panel.auto = false;
  p.built = snapshot(p, r);
}

it('adds a J-Link to a built rack as add-on prints only, behind its board', () => {
  const p = newProject(T('example_dual_swd'));
  p.modules.push(newModule(T('usb_hub7')));
  p.links = numberLinks(autoLinks(p));
  build(p);
  const added = addProbes(p, p.modules[0].id);
  for (const pm of added) if (!pm.on) seatCompanion(p, pm.id);
  p.links = numberLinks([...(p.links ?? []), ...autoLinks(p)]);
  const r = generatePanel(p);
  const dock = r.report.panel!.mounts.find((m) => m.slots.some((s) => s.module === p.modules[0].id))!;
  expect(dock.slots.map((s) => s.module)).toContain(added[0].id);
  expect(r.report.warnings.filter((w) => /ribbon is|Rail \d|overlap|runs into/.test(w))).toEqual([]);
  const d = delta(p, r)!;
  const printed = d.parts.map((x) => x.name);
  // the probes' own holders and rod; no new dock, shoe, socket or holder for anything already built
  expect(printed.filter((n) => /J-Link/.test(n)).length).toBe(2);
  expect(printed.some((n) => /Rail shoe|Dock socket|Holder: Dual-MCU|Holder: Powered/.test(n))).toBe(false);
  expect(d.rails).toEqual([]);
}, 120_000);
