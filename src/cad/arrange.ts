// Auto-arrange confirmed by the real router. The planner (autoplan.ts) scores layouts with a cheap stand-in for the
// cables; this builds its best layout for real and, when the build has trouble (a cable running into a dock, docks
// overlapping, a plug blocked, a failing Check) that another candidate or the classic order doesn't, builds those and
// keeps the one with least. `deep`: (a click on Auto-arrange) build both of the planner's candidates and the classic
// order and keep the cheapest of the real ones, cables and all. A pick is remembered for the same rack, so an edit that
// doesn't change the layout doesn't build twice.
import type { GenResult, Project } from '../model/types';
import { baseRef } from '../model/links';
import { generatePanel } from './panelgen';

export interface Trial { pick: number | 'classic'; result: GenResult; trouble: number; cost: number }

/** What is wrong with a build: cables touching things, docks overlapping, plugs in use that are blocked, failing Checks. */
export function troubleOf(p: Project, r: GenResult): number {
  const pr = r.report.panel;
  let n = (r.report.cables ?? []).filter((c) => c.clash).length + r.report.checks.filter((c) => c.status === 'bad').length;
  n += r.report.warnings.filter((w) => /overlap on the panel|hangs? .* off the start|not on a rail|pairs? of cables still press/.test(w)).length;
  if (pr) {
    const inUse = new Set((p.links ?? []).flatMap((l) => [l.a, l.b].map((e) => `${e.module}/${baseRef(e.ref)}`)));
    for (const m of pr.modules) for (const a of m.access) if (a.ok === 'blocked' && inUse.has(`${m.id}/${a.ref}`)) n++;
  }
  return n;
}

/** The real cost of a build, in mm of cable to be spared. */
export function realCost(r: GenResult): number {
  const cs = r.report.cables ?? [], rails = r.report.panel?.rails ?? [];
  return cs.reduce((a, c) => a + c.length, 0) + 0.5 * Math.max(0, ...cs.map((c) => c.length)) + 200 * cs.filter((c) => c.clash).length + 0.15 * rails.reduce((a, x) => a + x.length, 0);
}

const withOpts = (p: Project, o: Partial<NonNullable<Project['panel']['opts']>>): Project => ({ ...p, panel: { ...p.panel, opts: { ...p.panel.opts, ...o } } });

/** What the layout depends on: the boards, their cables and the panel's settings (not where docks were put by hand). */
function signature(p: Project): string {
  const { rails, mounts, ...rest } = p.panel;
  void rails; void mounts;
  return JSON.stringify([p.modules.map((m) => [m.id, m.board.name, m.board.comps.length, m.on, m.onMode, m.onGap]), (p.links ?? []).map((l) => [l.a, l.b, l.kind]), { ...rest, opts: { ...rest.opts, pick: undefined } }]);
}
const chosen = new Map<string, number | 'classic'>();

/** Build the panel, confirming the automatic layout. Everything but an automatic layout is one build. */
export function generateChecked(p: Project, deep = false): GenResult {
  const o = p.panel.opts;
  if (!p.panel.auto || o?.plan === 'classic' || o?.pick != null) return generatePanel(p);
  const sig = signature(p), known = chosen.get(sig);
  const build = (pick: number | 'classic'): Trial => {
    const q = pick === 'classic' ? withOpts(p, { plan: 'classic' }) : withOpts(p, { pick });
    const result = generatePanel(q);
    return { pick, result, trouble: troubleOf(p, result), cost: realCost(result) };
  };
  if (known != null && !deep) return build(known).result;
  const first = build(0);
  if (first.trouble === 0 && !deep) { remember(sig, 0); return first.result; }
  const trials = [first, build(1), build('classic')];
  // (the planner's second candidate can be the same layout as its first: then it is not built again by the cache of meshes, but is compared all the same)
  trials.sort((a, b) => a.trouble - b.trouble || (deep ? a.cost - b.cost : 0) || Number(a.pick === 'classic') - Number(b.pick === 'classic'));
  remember(sig, trials[0].pick);
  return trials[0].result;
}

function remember(sig: string, pick: number | 'classic') {
  chosen.set(sig, pick);
  if (chosen.size > 24) chosen.delete(chosen.keys().next().value!);
}
