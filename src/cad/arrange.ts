// Auto-arrange confirmed by the real router. The planner (autoplan.ts) scores layouts with a cheap stand-in for the
// cables; this builds its best layout for real and, when the build has trouble (a cable running into a dock, docks
// overlapping, a plug blocked, a failing Check), plans again keeping the boards whose cable ran into something apart,
// and once more; failing that, the classic order. The build with least trouble wins. `deep` (a click on Auto-arrange):
// also build the planner's second candidate and keep the cheapest of the real ones, cables and all. What was chosen is
// remembered for the same rack, so an edit that doesn't change the layout doesn't build again.
import type { ArrangeOpts, GenResult, Project } from '../model/types';
import { baseRef } from '../model/links';
import { generatePanel } from './panelgen';

export interface Trial { how: Choice; result: GenResult; trouble: number; cost: number }
type Choice = { plan: 'classic' } | { pick: number; avoid: string[] };

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

/** The pairs of boards whose cable ran into something ("moduleA|moduleB"). */
const clashing = (r: GenResult) => [...new Set((r.report.cables ?? []).filter((c) => c.clash && c.ends).map((c) => c.ends!.split('|').map((e) => e.slice(0, e.indexOf('/'))).sort().join('|')))];

const withOpts = (p: Project, o: Partial<ArrangeOpts>): Project => ({ ...p, panel: { ...p.panel, opts: { ...p.panel.opts, ...o } } });

/** What the layout depends on: the boards, their cables and the panel's settings (not where docks were put by hand). */
function signature(p: Project): string {
  const { rails, mounts, ...rest } = p.panel;
  void rails; void mounts;
  return JSON.stringify([p.modules.map((m) => [m.id, m.board.name, m.board.comps.length, m.on, m.onMode, m.onGap]), (p.links ?? []).map((l) => [l.a, l.b, l.kind]), { ...rest, opts: { ...rest.opts, pick: undefined, avoid: undefined } }]);
}
const chosen = new Map<string, Choice>();

/** Build the panel, confirming the automatic layout. Everything but an automatic layout is one build. */
export function generateChecked(p: Project, deep = false): GenResult {
  const o = p.panel.opts;
  if (!p.panel.auto || o?.plan === 'classic' || o?.pick != null) return generatePanel(p);
  const sig = signature(p), known = chosen.get(sig);
  const build = (how: Choice): Trial => {
    const result = generatePanel('plan' in how ? withOpts(p, { plan: 'classic' }) : withOpts(p, { pick: how.pick, ...(how.avoid.length ? { avoid: how.avoid } : {}) }));
    return { how, result, trouble: troubleOf(p, result), cost: realCost(result) };
  };
  if (known && !deep) return build(known).result;
  const trials: Trial[] = [];
  let avoid: string[] = [];
  for (let round = 0; round < 3; round++) {
    const t = build({ pick: 0, avoid });
    trials.push(t);
    if (t.trouble === 0) break;
    const more = clashing(t.result).filter((x) => !avoid.includes(x));
    if (!more.length) break;
    avoid = [...avoid, ...more];
  }
  if (deep && trials[trials.length - 1].trouble === 0) trials.push(build({ pick: 1, avoid: (trials[trials.length - 1].how as { avoid: string[] }).avoid }));
  if (trials[0].trouble > 0 || deep) trials.push(build({ plan: 'classic' }));
  // (least trouble; then, when asked, the real cost; then the planner's own order)
  const best = trials.map((t, i) => ({ t, i })).sort((a, b) => a.t.trouble - b.t.trouble || (deep ? a.t.cost - b.t.cost : 0) || a.i - b.i)[0].t;
  chosen.set(sig, best.how);
  if (chosen.size > 24) chosen.delete(chosen.keys().next().value!);
  return best.result;
}
