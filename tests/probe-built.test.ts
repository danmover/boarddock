// A J-Link added to a rack that is already built goes into the free slot of its board's dock, or a dock of its own
// when it would push the built docks along: nothing already printed changes.
import { it, expect, beforeAll } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { autoLinks, numberLinks } from '../src/model/links';
import { addProbes } from '../src/model/probes';
import { ownDocks, seatCompanion } from '../src/cad/dockplan';
import { generatePanel } from '../src/cad/panelgen';
import { initKernel } from '../src/cad/kernel';
import { delta, snapshot } from '../src/model/built';
import type { Project } from '../src/model/types';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
beforeAll(async () => { await initKernel(); });

/** What Mark as built does: freeze the layout, remember what was printed. */
function build(p: Project) {
  p.panel.opts = { plan: 'classic' }; // (the classic packing: the hub beside the board, which is what this test is about)
  const r = generatePanel(p), pr = r.report.panel!;
  delete p.panel.opts;
  p.panel.rails = pr.rails.map((x) => ({ id: x.id, x: x.x, y: x.y, dir: x.dir, length: x.length }));
  p.panel.mounts = pr.mounts.map((m) => ({ id: m.id, rail: m.rail, at: m.at, kind: m.kind, turn: m.turn, lever: m.leverSide > 0 ? 'pos' as const : 'neg' as const, slots: m.slots.map((s, k) => ({ module: s.module, edge: s.module ? pr.modules.find((x) => x.id === s.module && x.mount === m.id && x.slot === k)?.edge ?? s.edge : s.edge })) }));
  p.panel.auto = false;
  p.built = snapshot(p, r);
}

it('adds a J-Link to a built rack as add-on prints only, in a dock of its own when there is no room behind its board', () => {
  const p = newProject(T('example_dual_swd'));
  p.modules.push(newModule(T('usb_hub7')));
  p.links = numberLinks(autoLinks(p));
  build(p);
  const added = addProbes(p, p.modules[0].id, ['J_SWD1']);
  for (const pm of added) if (!pm.on) seatCompanion(p, pm.id);
  p.links = numberLinks([...(p.links ?? []), ...autoLinks(p)]);
  let r = generatePanel(p);
  // it stands on its long edge, its USB plug out along the rail: behind the board it reaches over the hub beside it, so
  // (as the app does once the rack is built again) it gets a dock of its own rather than push the built docks along
  expect(r.report.warnings.filter((w) => /overlap/.test(w)).length).toBe(1);
  expect(ownDocks(p, r.report.panel!)).toEqual([added[0].id]);
  r = generatePanel(p);
  expect(r.report.panel!.mounts.find((m) => m.slots.some((s) => s.module === added[0].id))!.slots.map((s) => s.module)).toEqual([added[0].id, null]);
  expect(r.report.warnings.filter((w) => /overlap|runs into/.test(w))).toEqual([]);
  // from there its 200 mm ribbon doesn't reach, and it says so (and how to fix it)
  expect(r.report.warnings.filter((w) => /ribbon is 200 mm but has to run/.test(w)).map((w) => /J_SWD1.*set its length in Plugs/.test(w))).toEqual([true]);
  const d = delta(p, r)!;
  const printed = d.parts.map((x) => x.name);
  // the J-Link's own holder and rod, and its dock; nothing for anything already built
  expect(printed.filter((n) => /J-Link|Release rod|Rail shoe|Dock socket/.test(n)).length).toBe(4);
  expect(printed.some((n) => /Holder: Dual-MCU|Holder: Powered/.test(n))).toBe(false);
  // (its dock goes on the end of the rail, which gets longer: that is the one thing to cut again)
  expect(d.rails.map((x) => x.id)).toEqual(['r1']);
  expect(d.rails[0].length).toBeGreaterThan(d.rails[0].was ?? 0);
}, 120_000);
