import { it, expect } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { addProbes } from '../src/model/probes';
import { appendDock } from '../src/cad/dockplan';
import { generatePanel } from '../src/cad/panelgen';
import { initKernel } from '../src/cad/kernel';
const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
it('a rack laid out by hand: new probes go into the free back slot of their board when there is room', async () => {
  await initKernel();
  const p = newProject(T('example_dual_swd'));
  p.modules.push(newModule(T('usb_hub7')));
  p.panel.pairs = false;
  const r0 = generatePanel(p);
  p.panel.rails = r0.report.panel!.rails.map((r) => ({ id: r.id, x: r.x, y: r.y, dir: r.dir, length: r.length }));
  p.panel.mounts = r0.report.panel!.mounts.map((m) => ({ id: m.id, rail: m.rail, at: m.at, kind: m.kind, turn: m.turn, slots: m.slots, lever: m.lever }));
  p.panel.auto = false;
  // room on both sides of the board's dock, the way a rack laid out by hand often has it
  p.panel.rails[0].length = (p.panel.rails[0].length ?? 300) + 200;
  for (const m of p.panel.mounts) m.at = (m.at ?? 0) + (m.kind === 'flat' ? 180 : 100);
  const added = addProbes(p, p.modules[0].id);
  for (const pm of added) if (!pm.on) appendDock(p, pm.id);
  const r = generatePanel(p);
  const name = (id: string | null) => p.modules.find((m) => m.id === id)?.board.name ?? '-';
  const docks = r.report.panel!.mounts.map((m) => m.slots.map((s) => name(s.module).replace(/\s*\(.*\)$/, '')).join(' | '));
  expect(docks).toContain('Dual-MCU controller | J-Link');
  expect(r.report.warnings.join('\n')).not.toMatch(/overlap|Nothing clips|runs into/);
}, 120000);
