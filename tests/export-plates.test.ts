// Print plates: every part sits on the bed (a rivet used to hang 1.3 mm below it), and the facet check measures
// real reaches from the part's own bottom.
import { describe, it, expect, beforeAll } from 'vitest';
import { initKernel, freeAll, box, unionMF, toMesh } from '../src/cad/kernel';
import { generate } from '../src/cad/assembly';
import { packPlates, placedMesh, printability } from '../src/cad/export';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import type { MeshData } from '../src/model/types';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
const minZ = (m: MeshData) => { let z = Infinity; for (let i = 2; i < m.pos.length; i += 3) z = Math.min(z, m.pos[i]); return z; };

describe('print plates', () => {
  beforeAll(async () => { await initKernel(); });

  it('every part on a back-to-back plate rests on the bed, rivets too', () => {
    const p = newProject(T('uno')); p.layout = 'loose'; p.mount.kind = 'none';
    p.modules.push(newModule(T('uno'))); p.arrange.mode = 'back';
    const g = generate(p);
    freeAll();
    const rivet = g.parts.find((x) => x.tag?.kind === 'rivet')!;
    expect(minZ(rivet.mesh)).toBeCloseTo(0, 4);
    for (const pl of packPlates(g.parts, p.printer.bed, 6)) for (const it of pl.items) expect(minZ(placedMesh(it, p.printer.bed, pl.used)), it.part.name).toBeCloseTo(0, 4);
  }, 120000);

  it('a part given below the bed is still put on it', () => {
    const m = toMesh(box(0, 0, -2, 10, 10, 3));
    freeAll();
    const part = { id: 'x', name: 'x', qty: 1, mesh: m, toAssembly: [], volume: 500, size: [10, 10, 5] as [number, number, number], color: '#fff' };
    const [pl] = packPlates([part], [180, 180], 6);
    expect(minZ(placedMesh(pl.items[0], [180, 180], pl.used))).toBeCloseTo(0, 5);
  });

  it("the facet check measures from the part's own bottom, and a ledge by how far it reaches", () => {
    // a 10 mm cantilever on a post, the whole thing sunk 1.3 mm under z = 0
    const m = toMesh(unionMF([box(0, 0, 0, 4, 4, 6), box(0, 0, 6, 14, 4, 7)]).translate([0, 0, -1.3]));
    freeAll();
    const q = printability(m);
    expect(q.span).toBeGreaterThan(9.5);
    expect(q.span).toBeLessThan(10.5);
    // the bottom face is on the bed, not a bridge
    expect(q.flat).toBeLessThan(10 * 4 + 1);
  });
});
