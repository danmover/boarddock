// The racks Auto-arrange is scored on: the collision matrix's own (by name) and a few more that ask for something
// particular of a layout (a J-Link and adapter for each board, a powerboard among boards, many alike, hubs and hosts).
import { TEMPLATES } from '../../src/model/templates';
import { newModule, newProject } from '../../src/model/library';
import { autoLinks, numberLinks } from '../../src/model/links';
import { addAdapters, addProbes } from '../../src/model/probes';
import type { Board, Project } from '../../src/model/types';
import { RACKS, seeded, type Rack } from './racks';

const T = (id: string): Board => TEMPLATES.find((t) => t.id === id)!.make();

export function rackOf(ids: string[], f?: (p: Project) => void, links = true): Project {
  const p = newProject(T(ids[0]));
  for (const id of ids.slice(1)) p.modules.push(newModule(T(id)));
  f?.(p);
  if (links) p.links = numberLinks([...(p.links ?? []), ...autoLinks(p)]);
  return p;
}

const named = (n: string) => RACKS.find((r) => r.name === n)!;

const extra: Rack[] = [
  {
    name: 'J-Link + adapter rack', auto: true, make: () => seeded(601, () => rackOf(['example_dual_swd', 'example_jtag', 'rpi4', 'uno', 'pico', 'usb_hub'], (p) => {
      addProbes(p, p.modules[0].id); addProbes(p, p.modules[1].id); addAdapters(p, p.modules[0].id);
    })),
  },
  { name: 'alike Pis', auto: true, make: () => seeded(602, () => rackOf(['rpi4', 'rpi4', 'rpi4', 'rpi4', 'rpi4', 'rpi4', 'net_switch8', 'usb_charger6'])) },
  { name: 'mains among boards', auto: true, make: () => seeded(603, () => rackOf(['pb4', 'usb_charger', 'usb_charger', 'rpi4', 'uno', 'pico', 'esp32', 'usb_hub'])) },
  { name: 'hubs and hosts', auto: true, make: () => seeded(604, () => rackOf(['rpi5', 'rpi_zero', 'rpi_zero', 'usb_hub7', 'usb_hub', 'uno', 'pico', 'esp32'])) },
];

/** What Auto-arrange is scored on (before and after), in the order of the table. */
export const LAYOUT_RACKS: Rack[] = [
  named('Pi cluster'), named('boxes'), named('busy mixed rack'), named('probes and adapters'), named('rails along (columns)'), named('rows of rails'),
  extra[0], named('pairs by Auto-arrange'), named('stacks'), named('whichever suits each'),
];
export const EXTRA_RACKS = extra;
