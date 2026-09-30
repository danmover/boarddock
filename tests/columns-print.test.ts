// The repo's print check (0.2 mm layers in the print pose) on every part of the J-Link and adapter columns: the
// holders (their pegs, crush-rib holes and landings, the tongue under a column, the slot body of a board nothing clips
// in), and the long release rod. Each must print without support, with no thin walls or shut slots worth a word, and
// lie flat on the plate on something wider than a sliver.
import { describe, it, expect, beforeAll } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { autoLinks, numberLinks } from '../src/model/links';
import { addAdapters, addProbes, isProbe } from '../src/model/probes';
import { generatePanel } from '../src/cad/panelgen';
import { freeAll, initKernel } from '../src/cad/kernel';
import { layerCheck, verdict } from '../src/cad/printcheck';
import type { PartOut, Project } from '../src/model/types';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
beforeAll(async () => { await initKernel(); });

/** The parts that belong to the J-Links and adapters of a rack (their holders, the rod down their column, caps). */
function gearParts(p: Project): PartOut[] {
  const ids = new Set(p.modules.filter((m) => isProbe(m)).map((m) => m.id));
  const parts = generatePanel(p).parts.filter((x) => x.tag?.module && ids.has(x.tag.module));
  const seen = new Set<string>();
  return parts.filter((x) => { const k = `${x.name}|${x.size.map((v) => v.toFixed(0))}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

const racks: Record<string, () => Project> = {
  // a J-Link and an adapter in one column beside a board (the adapter's board has no room for spring clips: a slot)
  'J-Link and adapter': () => { const p = newProject(T('example_jtag')); p.modules.push(newModule(T('usb_hub7'))); addProbes(p, p.modules[0].id); addAdapters(p, p.modules[0].id); p.links = numberLinks([...(p.links ?? []), ...autoLinks(p)]); return p; },
  // two 10-pin J-Links and an adapter, a column each
  'two J-Links and an adapter': () => { const p = newProject(T('example_dual_swd')); p.modules.push(newModule(T('usb_hub7'))); addProbes(p, p.modules[0].id); addAdapters(p, p.modules[0].id); p.links = numberLinks([...(p.links ?? []), ...autoLinks(p)]); return p; },
  // a column of three (a holder with a foot and a landing in the middle) and lone ones from the library
  'a column of three and lone ones': () => {
    const p = newProject(T('jlink'));
    for (const id of ['ftdi', 'ftdi']) p.modules.push(newModule(T(id)));
    p.modules[1].on = p.modules[0].id; p.modules[1].onMode = 'column';
    p.modules[2].on = p.modules[1].id; p.modules[2].onMode = 'column';
    p.modules.push(newModule(T('jlink')), newModule(T('ftdi')));
    return p;
  },
};

describe('the J-Link and adapter parts print clean, lying flat', () => {
  for (const [name, make] of Object.entries(racks)) {
    it(name, () => {
      const parts = gearParts(make());
      // holders, and one rod down a column
      expect(parts.filter((x) => /^Holder:/.test(x.name)).length).toBeGreaterThanOrEqual(2);
      expect(parts.some((x) => /^Release rod/.test(x.name))).toBe(true);
      for (const pt of parts) {
        const r = layerCheck(pt.mesh)!;
        freeAll();
        expect(r, pt.name).not.toBeNull();
        const v = verdict(r);
        expect(v.status, `${pt.name}: ${v.detail}`).toBe('ok');
        expect(r.islands, `${pt.name} starts in mid-air`).toEqual([]);
        expect(r.cantilever?.reach ?? 0, `${pt.name} overhang`).toBeLessThan(2);
        expect(r.bridge?.span ?? 0, `${pt.name} bridge`).toBeLessThan(12);
        expect(r.slope, `${pt.name} flat roof`).toBeNull();
        expect(r.thin?.area ?? 0, `${pt.name} walls under a line`).toBeLessThan(1);
        // (the only slit is the tip of a countersink's groove: under 3 mm² in one layer, filled in and harmless)
        expect(r.gaps?.area ?? 0, `${pt.name} has a slot that prints shut`).toBeLessThan(3);
        // lying flat: on a foot, not standing on an edge (the rod is a long flat strip; a holder is a slab)
        expect(r.firstLayer, `${pt.name} foot`).toBeGreaterThan(0.1 * r.maxLayer);
        expect(pt.size[2], `${pt.name} height`).toBeLessThan(/^Release rod/.test(pt.name) ? 10 : 18);
        expect(pt.size[0] * pt.size[1], `${pt.name} on the plate`).toBeGreaterThan(pt.size[2] * 20);
      }
    }, 300_000);
  }
});
