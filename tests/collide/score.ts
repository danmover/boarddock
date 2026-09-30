// Scores a built rack's layout: how good the arrangement is, not whether parts collide. Every number comes from a real
// build (generate): the cables as the router lays them, the rails and docks as the generator packed them. Used by
// tests/layout.test.ts and `tests/collide/layoutscores.ts` (the before/after table).
import { baseRef, plugRole } from '../../src/model/links';
import { isPlugPack, isHub } from '../../src/model/powerdata';
import { isProbe } from '../../src/model/probes';
import type { GenResult, Project } from '../../src/model/types';
import { layoutIssues } from './run';
import { measure, total } from './measure';

export interface LayoutScore {
  cables: number;
  total: number; // mm of cable, all of them (a probe's own ribbon too)
  longest: number; // mm
  buy: number; // m to buy
  overStock: number; // cables longer than the stock they come in (a ribbon: the probe's; jumper wires 300 mm; the rest 1 m)
  crossings: number; // pairs of cables whose straight plug-to-plug lines cross on the rack
  underRails: number; // cables that pass under a rail that is neither of their own
  clashes: number; // cables the router says touch something
  collision: number; // mm³ of things inside things, in the routed build (only when asked for)
  railLen: number; // mm of rail, all rails
  rails: number;
  docks: number;
  footprint: number; // mm² of the rack: the bounding box of its rails and docks
  hostDist: number; // mm of cable from each hub, Pi Zero or probe to what it hangs off, all together
  hostMax: number;
  mainsNear: number; // pairs of a mains item (powerboard) and a low-voltage board closer than 50 mm
  hard: number; // hard failures: a failing Check, docks overlapping, a plug in use that is blocked, a rail over its limit
  cost: number; // all of it in mm of cable
  issues: string[];
}

/** The weights that turn a score into one number (mm of cable to be spared). */
export const WEIGHTS = { total: 1, longest: 0.5, overStock: 150, crossing: 60, underRail: 40, clash: 200, mains: 100, railLen: 0.15, footprint: 0.002, hard: 5000, collision: 2 };

const NEAR_MAINS = 50;

/** Score a build. `collide`: also measure the volume of collisions (slow: exact solids). */
export function scoreLayout(p: Project, r: GenResult, collide = false): LayoutScore {
  const pr = r.report.panel, cables = r.report.cables ?? [];
  const issues = layoutIssues(p, r);
  const rails = pr?.rails ?? [];
  const vert = rails.filter((x) => x.dir === 'v').length > rails.length / 2;
  const uv = (q: number[]) => (vert ? [q[1], -q[0]] : [q[0], q[1]]);
  const modOf = (id: string) => p.modules.find((m) => m.id === id);
  const stock = (c: NonNullable<GenResult['report']['cables']>[number]) => (c.ribbon != null ? c.ribbon : c.kind === 'jumper' ? 300 : 1000);
  const plugAt = (e: string) => { const q = pr?.plugs?.[e]; return q ? uv(q) : null; };
  const ends = (c: (typeof cables)[number]) => c.ends?.split('|') ?? [];
  // rails: across coordinate and along range
  const railV = (x: (typeof rails)[number]) => (vert ? -x.x : x.y), railU = (x: (typeof rails)[number]): [number, number] => { const u0 = vert ? x.y : x.x; return [u0, u0 + x.length]; };
  const railOfMod = (id: string) => { const m = pr?.modules.find((x) => x.id === id); return m ? pr!.mounts.find((x) => x.id === m.mount)?.rail : undefined; };

  let crossings = 0, underRails = 0;
  const segs = cables.map((c) => { const [a, b] = ends(c).map(plugAt); return a && b ? { c, a, b } : null; }).filter((x): x is NonNullable<typeof x> => !!x);
  const ccw = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const s = segs[i], t = segs[j];
    if (ends(s.c).some((e) => ends(t.c).includes(e))) continue;
    if (ccw(s.a, s.b, t.a) * ccw(s.a, s.b, t.b) < 0 && ccw(t.a, t.b, s.a) * ccw(t.a, t.b, s.b) < 0) crossings++;
  }
  for (const s of segs) {
    const own = new Set(ends(s.c).map((e) => railOfMod(e.slice(0, e.indexOf('/')))));
    const v0 = Math.min(s.a[1], s.b[1]), v1 = Math.max(s.a[1], s.b[1]), u0 = Math.min(s.a[0], s.b[0]), u1 = Math.max(s.a[0], s.b[0]);
    if (rails.some((x) => !own.has(x.id) && railV(x) > v0 + 5 && railV(x) < v1 - 5 && railU(x)[0] < u1 && railU(x)[1] > u0)) underRails++;
  }

  // a hub, a Pi Zero or a probe from what it hangs off: its uplink or debug cable, and a column's ribbons and jumpers
  const hosted = (c: (typeof cables)[number]) => {
    if (c.kind === 'debug' || c.kind === 'jumper' || c.kind === 'uart') return true;
    if (c.kind !== 'usb') return false;
    return ends(c).some((e) => {
      const i = e.indexOf('/'), m = modOf(e.slice(0, i)), comp = m?.board.comps.find((x) => x.ref === baseRef(e.slice(i + 1)));
      if (!m || !comp) return false;
      const role = plugRole(m, comp);
      return (role === 'hub-up' || role === 'device') && (isHub(m.board) || isProbe(m) || /zero/i.test(m.board.name));
    });
  };
  const host = cables.filter(hosted);

  // mains: a powerboard against the boards near it
  const outlets = (id: string) => !!modOf(id)?.board.comps.some((c) => c.conn?.type.startsWith('ac_'));
  const foot = (id: string) => pr?.modules.find((x) => x.id === id)?.foot;
  let mainsNear = 0;
  for (const m of p.modules) {
    if (!outlets(m.id) || !foot(m.id)) continue;
    const f = foot(m.id)!;
    for (const o of p.modules) {
      if (o === m || o.board.kind === 'box' || isPlugPack(o.board) || !foot(o.id)) continue;
      const g = foot(o.id)!, dx = Math.max(0, f[0] - g[2], g[0] - f[2]), dy = Math.max(0, f[1] - g[3], g[1] - f[3]);
      if (Math.hypot(dx, dy) < NEAR_MAINS) mainsNear++;
    }
  }

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const m of pr?.mounts ?? []) { x0 = Math.min(x0, m.foot[0]); y0 = Math.min(y0, m.foot[1]); x1 = Math.max(x1, m.foot[2]); y1 = Math.max(y1, m.foot[3]); }
  for (const x of rails) { const [a, b] = x.dir === 'h' ? [x.x, x.x + x.length] : [x.y, x.y + x.length]; if (x.dir === 'h') { x0 = Math.min(x0, a); x1 = Math.max(x1, b); } else { y0 = Math.min(y0, a); y1 = Math.max(y1, b); } }
  const footprint = isFinite(x0) ? (x1 - x0) * (y1 - y0) : 0;

  const S: LayoutScore = {
    cables: cables.length,
    total: cables.reduce((s, c) => s + c.length, 0),
    longest: Math.max(0, ...cables.map((c) => c.length)),
    buy: Math.round(cables.reduce((s, c) => s + c.buy, 0) * 100) / 100,
    overStock: cables.filter((c) => c.length > stock(c)).length,
    crossings, underRails,
    clashes: cables.filter((c) => c.clash).length,
    collision: collide ? Math.round(total(measure(p, r)) * 10) / 10 : 0,
    railLen: rails.reduce((s, x) => s + x.length, 0),
    rails: rails.length,
    docks: pr?.mounts.length ?? 0,
    footprint: Math.round(footprint),
    hostDist: host.reduce((s, c) => s + c.length, 0),
    hostMax: Math.max(0, ...host.map((c) => c.length)),
    mainsNear,
    hard: issues.length,
    cost: 0,
    issues,
  };
  S.cost = costOf(S);
  return S;
}

export function costOf(s: LayoutScore, w = WEIGHTS): number {
  return Math.round(w.total * s.total + w.longest * s.longest + w.overStock * s.overStock + w.crossing * s.crossings + w.underRail * s.underRails + w.clash * s.clashes
    + w.mains * s.mainsNear + w.railLen * s.railLen + w.footprint * s.footprint + w.hard * s.hard + w.collision * s.collision);
}

/** One row of the before/after table. */
export function scoreLine(name: string, s: LayoutScore): string {
  const f = (n: number) => String(Math.round(n));
  return [name.padEnd(28), f(s.cables).padStart(3), f(s.total).padStart(6), f(s.longest).padStart(5), s.overStock, s.crossings, s.underRails, s.clashes, s.collision.toFixed(1).padStart(6), f(s.railLen).padStart(5), s.rails, s.docks,
    f(s.footprint / 100).padStart(6), f(s.hostDist).padStart(5), s.mainsNear, s.hard, f(s.cost).padStart(7)].join(' ');
}
export const SCORE_HEAD = ['rack'.padEnd(28), 'cab', 'total', 'long', 'ovr', 'crs', 'und', 'cls', 'coll', 'rail', 'r', 'dk', 'foot/100', 'host', 'mn', 'hd', 'cost'].join(' ');
