// Mains against low-voltage: which boards carry mains (outlets, mains inlets and leads, plug packs), the zone round
// each, and a Check line when a mains outlet, inlet, lead or plug pack sits close to a low-voltage board or cable.
import type { Check, Comp, GenResult, MainsZone, Module, Project } from './types';
import { connById } from './library';
import { plugRole, shortName } from './links';
import { isPlugPack } from './powerdata';

/**
 * How close is too close, mm. This is BoardDock's own rule of thumb, not a figure from a standard: what is safe depends
 * on the voltage, the plugs and the cables' insulation. The zones and the Check line both use it.
 */
export const NEAR_MM = 10;

type Rect = [number, number, number, number];
const MAINS_TYPE = /^(ac_|iec_c\d+$|mains_lead$)/;

/** A mains outlet, a mains inlet (C7, C14) or a mains lead. */
export function isMainsComp(m: Module, c: Comp): boolean {
  if (!c.conn || c.hidden) return false;
  const r = plugRole(m, c);
  return r === 'mains-in' || r === 'mains-out' || MAINS_TYPE.test(c.conn.type);
}
/** A board with a mains outlet, inlet or lead, or a plug pack. */
export const isMainsModule = (m: Module) => isPlugPack(m.board) || m.board.comps.some((c) => isMainsComp(m, c));

const gapRect = (a: Rect, b: Rect) => Math.hypot(Math.max(0, a[0] - b[2], b[0] - a[2]), Math.max(0, a[1] - b[3], b[1] - a[3]));
const grow = (r: Rect, d: number): Rect => [r[0] - d, r[1] - d, r[2] + d, r[3] + d];
/** Distance from a point to a box: a footprint and a range of heights. */
const ptBox = (q: number[], r: Rect, z: [number, number]) => Math.hypot(Math.max(r[0] - q[0], 0, q[0] - r[2]), Math.max(r[1] - q[1], 0, q[1] - r[3]), Math.max(z[0] - q[2], 0, q[2] - z[1]));

/** At most about `n` of a mesh's vertices, evenly spread. */
function sample(pos: ArrayLike<number>, n = 300): number[][] {
  const cnt = Math.floor(pos.length / 3), k = Math.max(1, Math.ceil(cnt / n)), out: number[][] = [];
  for (let i = 0; i < cnt; i += k) out.push([pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]]);
  return out;
}
const bbox = (pts: number[][]): Rect => [Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1]))];
/** The least distance between two clouds of points (3D). Clouds whose boxes are further apart than `cap` skip the work. */
function minDist(a: number[][], b: number[][], cap: number): number {
  if (!a.length || !b.length || gapRect(bbox(a), bbox(b)) > cap) return Infinity;
  let best = Infinity;
  for (const p of a) for (const q of b) { const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); if (d < best) best = d; }
  return best;
}

export interface Issue { mains: string; other: string; gap: number; module: string }

/** Where a board sits in the panel frame (a stacked board: its base's footprint; a plug pack, with no holder: its own model). */
function place(p: Project, res: GenResult, m: Module): { rect: Rect; top: number } | null {
  const rep = res.report.panel;
  for (let x: Module | undefined = m, k = 0; x && k < 8; x = p.modules.find((y) => y.id === x!.on), k++) {
    const pm = rep?.modules.find((q) => q.id === x!.id);
    if (pm) return { rect: [pm.foot[0], pm.foot[1], pm.foot[2], pm.foot[3]], top: pm.z1 };
  }
  const pts = res.ghosts.filter((g) => g.tag?.module === m.id && g.tag.kind !== 'cable').flatMap((g) => sample(g.mesh.pos, 200));
  return pts.length ? { rect: bbox(pts), top: Math.max(...pts.map((q) => q[2])) } : null;
}

/** The zone round each mains board, and what is close to what, on a rack laid out on rails. */
export function mainsZones(p: Project, res: GenResult): { zones: MainsZone[]; issues: Issue[]; mains: boolean } {
  const rep = res.report.panel;
  const none = { zones: [], issues: [], mains: false };
  if (!rep) return none;
  const mm = p.modules.filter(isMainsModule), lv = p.modules.filter((m) => !isMainsModule(m));
  if (!mm.length) return none;
  const name = (m: Module) => shortName(m.board.name);
  const zones: MainsZone[] = [];
  // what is on mains: outlets, inlets and leads, each a small box (plug points from the build), and plug packs' bodies
  const els: { label: string; module: string; box?: { rect: Rect; z: [number, number] }; pts?: number[][] }[] = [];
  for (const m of mm) {
    const at = place(p, res, m);
    const parts: string[] = [];
    if (at) {
      const packed = isPlugPack(m.board);
      if (packed) { els.push({ label: `the ${name(m)}`, module: m.id, box: { rect: at.rect, z: [0, at.top] } }); parts.push('plug pack'); }
      for (const c of m.board.comps.filter((x) => isMainsComp(m, x))) {
        const q = rep.plugs?.[`${m.id}/${c.ref}`];
        const role = plugRole(m, c);
        parts.push(role === 'mains-out' ? 'outlets' : 'mains lead');
        if (!q || packed) continue;
        const t = connById(c.conn!.type), h = Math.max(t.plug?.w ?? 0, t.plug?.len ?? 0, c.w, c.l) / 2;
        els.push({ label: `${role === 'mains-out' ? 'outlet' : 'mains inlet'} ${c.ref} on the ${name(m)}`, module: m.id, box: { rect: [q[0] - h, q[1] - h, q[0] + h, q[1] + h], z: [q[2] - h, q[2] + h] } });
      }
      zones.push({ module: m.id, name: m.board.name, rect: grow(at.rect, NEAR_MM), z: [0, Math.max(at.top, 5)], what: [...new Set(parts)].join(' and ') || 'mains' });
    }
  }
  // cables: mains leads against every other cable
  const kinds = new Map((res.report.cables ?? []).map((c) => [c.id, c]));
  const ends = (id: string) => (kinds.get(id)?.ends ?? '').split('|').map((e) => e.split('/')[0]);
  const cab = new Map<string, number[][]>();
  for (const g of res.ghosts) { const id = g.tag?.kind === 'cable' ? g.tag.refs?.[0] : undefined; if (id) cab.set(id, [...(cab.get(id) ?? []), ...sample(g.mesh.pos, 250)]); }
  const tag = (id: string) => { const c = kinds.get(id); return `${c?.no ? `the cable #${c.no}` : 'a cable'}${c ? ` (${c.a} to ${c.b})` : ''}`; };
  for (const [id, pts] of cab) if (kinds.get(id)?.kind === 'mains') els.push({ label: `mains lead ${kinds.get(id)?.no ? `#${kinds.get(id)!.no} ` : ''}(${kinds.get(id)!.a} to ${kinds.get(id)!.b})`, module: ends(id)[0], pts });
  const lvCables = [...cab].filter(([id]) => kinds.get(id) && kinds.get(id)!.kind !== 'mains');
  const lvPlace = lv.map((m) => ({ m, at: place(p, res, m) })).filter((x): x is { m: Module; at: { rect: Rect; top: number } } => !!x.at);
  const issues: Issue[] = [];
  for (const e of els) {
    for (const { m, at } of lvPlace) {
      if (m.id === e.module) continue;
      const g = e.box ? gapRect(e.box.rect, at.rect) : Math.min(...e.pts!.map((q) => ptBox(q, at.rect, [-5, at.top])));
      if (g < NEAR_MM) issues.push({ mains: e.label, other: `the ${name(m)}`, gap: g, module: e.module });
    }
    for (const [id, pts] of lvCables) {
      if (ends(id).includes(e.module)) continue; // (a cable of the same board sits next to its own plugs)
      const g = e.box ? Math.min(...pts.map((q) => ptBox(q, e.box!.rect, e.box!.z))) : minDist(e.pts!, pts, NEAR_MM);
      if (g < NEAR_MM) issues.push({ mains: e.label, other: tag(id), gap: g, module: e.module });
    }
  }
  issues.sort((a, b) => a.gap - b.gap);
  return { zones, issues, mains: true };
}

/** The Check line: what is close, or that nothing is (only when the rack has mains on it). */
export function mainsCheck(issues: Issue[]): Check {
  const why = `${NEAR_MM} mm is BoardDock's own rule of thumb, not a figure from a standard: how far apart is safe depends on your voltage, your plugs and how well your cables are insulated. Mains zones are shaded orange in the Rails and 3D views.`;
  if (!issues.length) return { group: 'Power', name: 'Mains near low-voltage', value: 'clear', status: 'ok', detail: `no mains outlet, inlet, lead or plug pack comes within ${NEAR_MM} mm of a low-voltage board or cable. ${why}` };
  const top = issues.slice(0, 5).map((i) => `${i.mains} is ${i.gap < 1 ? 'touching' : `${Math.round(i.gap)} mm from`} ${i.other}`);
  return {
    group: 'Power', name: 'Mains near low-voltage', value: `${issues.length} close`, status: 'warn', module: issues[0].module,
    detail: `${top.join('; ')}${issues.length > 5 ? `; ${issues.length - 5} more` : ''}. Move them further apart on the rails, or run the cables in separate bundles. ${why}`,
  };
}

/** Put the zones and the Check line on a fresh build's report (a build with no mains gets neither). */
export function addMainsZones(p: Project, res: GenResult): void {
  try {
    const z = mainsZones(p, res);
    if (!z.mains) return;
    res.report.zones = z.zones;
    res.report.checks.push(mainsCheck(z.issues));
  } catch { /* the zones are extra: never fail a build for them */ }
}
