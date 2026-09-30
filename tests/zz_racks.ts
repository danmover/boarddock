import { generate } from '../src/cad/assembly';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { autoLinks, numberLinks } from '../src/model/links';
import { addAdapters, addProbes, fillWires, markDebug, stackCompanions, uartHeaders } from '../src/model/probes';
import { seeded } from './collide/racks';
import type { Rack } from './collide/racks';
import type { Board, Project } from '../src/model/types';

// jumper wires and ribbons: the racks of TODO item 3 and what runs into what (the jumpers test's way of building)
const T = (id: string): Board => TEMPLATES.find((t) => t.id === id)!.make();
function rack(ids: string[], f?: (p: Project) => void, probes = false): Project {
  const p = newProject(T(ids[0]));
  for (const id of ids.slice(1)) p.modules.push(newModule(T(id)));
  f?.(p);
  generate(p);
  for (const m of [...p.modules]) { if (probes) addProbes(p, m.id); if (uartHeaders(m.board).length) addAdapters(p, m.id); }
  p.links = numberLinks([...(p.links ?? []), ...autoLinks(p)]).map((l) => fillWires(p, l));
  stackCompanions(p);
  return p;
}
const flat = (q: Project) => { q.panel.lie = 'flat'; };
export const EXTRA_RACKS: Rack[] = ([
  ['jtag flat +probe', () => seeded(21, () => rack(['example_jtag'], flat, true))],
  ['jtag flat', () => seeded(22, () => rack(['example_jtag'], flat))],
  ['four flat', () => seeded(23, () => rack(['example_dual_swd', 'example_jtag', 'usb_hub7', 'rpi4'], flat))],
  ['four flat +probes', () => seeded(24, () => rack(['example_dual_swd', 'example_jtag', 'usb_hub7', 'rpi4'], flat, true))],
  ['pi4 gpio uart', () => seeded(25, () => rack(['rpi4'], (q) => { const c = q.modules[0].board.comps.find((x) => x.conn && /^J_?(GPIO|8)$|GPIO/i.test(x.ref)) ?? q.modules[0].board.comps.find((x) => x.conn?.type.startsWith('pins')); if (c) markDebug(c, 'uart'); }))],
  ['dual swd standing +probes', () => seeded(26, () => rack(['example_dual_swd'], undefined, true))],
] as [string, () => Project][]).map(([name, make]) => ({ name, auto: true, make }));
