// How much of the cables is inside something, measured exactly (manifold solids), for the real-router confirm of an
// automatic layout (arrange.ts). The router works on bounding boxes and lets a cable brush one by a little; this
// intersects each settled cable with what is near it: holders, docks, rails, stands, boards, plugs that are not its
// own, and other cables. Solids are made only for what is near a cable, so it is a fraction of the whole collision
// measure the tests make (tests/collide/measure.ts, which counts everything and is the reference).
import type { GenResult, MeshData, PickTag, Project } from '../model/types';
import { isPlugPack } from '../model/powerdata';
import { fromMesh, type MF } from './kernel';

type Cls = 'holder' | 'cap' | 'stand' | 'rail' | 'board' | 'plug' | 'cable';
const PRINTED: Partial<Record<PickTag['kind'], Cls>> = { holder: 'holder', rod: 'holder', clip: 'holder', shoe: 'holder', socket: 'holder', link: 'holder', rivet: 'holder', stand: 'holder', cap: 'cap', railstand: 'stand' };

interface Item { cls: Cls; obj: string; mesh: MeshData; T?: number[]; lo: number[]; hi: number[]; mf?: MF | null }

function boundsOf(m: MeshData, T?: number[]) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const p = m.pos;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    const q = T ? [T[0] * x + T[4] * y + T[8] * z + T[12], T[1] * x + T[5] * y + T[9] * z + T[13], T[2] * x + T[6] * y + T[10] * z + T[14]] : [x, y, z];
    for (let a = 0; a < 3; a++) { if (q[a] < lo[a]) lo[a] = q[a]; if (q[a] > hi[a]) hi[a] = q[a]; }
  }
  return { lo, hi };
}

/** The volume (mm³) of every settled cable that lies inside a holder, dock, rail, stand, board, another cable or a plug not its own (`worst` collects the pairs above 0.5 mm³). */
export function cableOverlap(p: Project, r: GenResult, worst?: string[]): number {
  const items: Item[] = [];
  const add = (cls: Cls, obj: string, mesh: MeshData, T?: number[]) => { if (mesh.idx.length) items.push({ cls, obj, mesh, T, ...boundsOf(mesh, T) }); };
  for (const pt of [...r.parts, ...(r.display ?? [])]) {
    [pt.toAssembly, ...(pt.instances ?? [])].forEach((T, i) => {
      const tag = i ? pt.tags?.[i - 1] ?? pt.tag : pt.tag;
      const cls = tag ? PRINTED[tag.kind] : undefined;
      if (cls) add(cls, `${pt.id}#${i}`, pt.displayMesh ?? pt.mesh, T);
    });
  }
  for (const g of r.ghosts) {
    const t = g.tag;
    if (!t || /^clash/.test(g.name)) continue;
    if (t.kind === 'board' || t.kind === 'parts') { if (g.mat !== 'silk' && g.mat !== 'trace' && g.mat !== 'copper') add('board', `board ${t.module}`, g.mesh); }
    else if (t.kind === 'plug') { if (g.mat === 'cable') add('cable', `lead ${t.module}/${t.refs?.[0] ?? ''}`, g.mesh); else add('plug', `${t.module}/${(t.refs?.[0] ?? '').replace(/:2$/, '')}`, g.mesh); }
    else if (t.kind === 'rail') add('rail', `rail ${t.rail ?? ''}`, g.mesh);
    else if (t.kind === 'cable') add('cable', `cable ${t.refs?.[0] ?? g.name}`, g.mesh);
    else if (t.kind === 'stand') add('holder', t.module ?? g.name, g.mesh);
  }
  // a cable runs into its own plugs' boots: that is where it is meant to be; so does an off-rack lead into its plug, and
  // the cable of a plug pack into the outlet the pack is plugged into (as tests/collide/measure.ts allows)
  const base = (ref: string) => ref.replace(/:2$/, '');
  const outletOf = new Map<string, string>();
  for (const l of p.links ?? []) if (l.kind === 'mains') for (const [pk, o] of [[l.a, l.b], [l.b, l.a]]) if (p.modules.some((m) => m.id === pk.module && isPlugPack(m.board))) outletOf.set(pk.module, `${o.module}/${base(o.ref)}`);
  const ends = new Map((p.links ?? []).map((l) => [`cable ${l.id}`, [`${l.a.module}/${base(l.a.ref)}`, `${l.b.module}/${base(l.b.ref)}`, ...[l.a, l.b].flatMap((e) => (l.kind !== 'mains' && outletOf.has(e.module) ? [outletOf.get(e.module)!] : []))]]));
  const own = (obj: string) => (obj.startsWith('lead ') ? [obj.slice(5).replace(/:2$/, '')] : ends.get(obj) ?? []);
  const solid = (it: Item) => (it.mf === undefined ? (it.mf = fromMesh(it.mesh, it.T)) : it.mf);
  const near = (a: Item, b: Item) => [0, 1, 2].every((k) => a.lo[k] < b.hi[k] && b.lo[k] < a.hi[k]);
  let vol = 0;
  const cables = items.filter((i) => i.cls === 'cable');
  for (const c of cables) {
    for (const o of items) {
      if (o === c || o.obj === c.obj || (o.cls === 'cable' && items.indexOf(o) < items.indexOf(c))) continue;
      if (o.cls === 'plug' && own(c.obj).includes(o.obj)) continue;
      if (!near(c, o)) continue;
      const a = solid(c), b = solid(o);
      if (!a || !b) continue;
      const v = a.intersect(b).volume();
      if (v > 1e-3) { vol += v; if (worst && v > 0.5) worst.push(`${c.obj} x ${o.obj} (${o.cls}) ${v.toFixed(1)}`); }
    }
  }
  return vol;
}
