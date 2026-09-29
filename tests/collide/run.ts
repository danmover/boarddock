// Build a rack, measure what is inside what, check its layout, and hold both against the committed baseline.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generate } from '../../src/cad/assembly';
import { tongueOk } from '../../src/cad/dockplan';
import type { EdgeName, GenResult, Project } from '../../src/model/types';
import { CATS, measure, type Overlap } from './measure';
import type { Rack } from './racks';

export interface RackResult { name: string; cats: Record<string, [number, number]>; issues: string[]; worst: Overlap[]; ms: number }
export interface Baseline { racks: Record<string, { cats: Record<string, [number, number]>; issues: string[] }> }

const FILE = fileURLToPath(new URL('./baseline.json', import.meta.url));
/** How much a category may grow before the test fails: mm³ (at least), share of the baseline, and mm of depth. */
export const TOL = { vol: 0.5, share: 0.05, depth: 0.1 };

/** Problems with an automatic layout, each as a line of text (the same on every run). */
function layoutIssues(p: Project, r: GenResult): string[] {
  const out: string[] = [];
  const pr = r.report.panel;
  const name = (id?: string) => p.modules.find((m) => m.id === id)?.board.name ?? id ?? '?';
  for (const c of r.report.checks) {
    if (c.status !== 'bad') continue;
    // a tongue over its limit while another way of docking holds it
    if (/^Tongue root/.test(c.name) && c.module) {
      const m = p.modules.find((x) => x.id === c.module);
      const ways = m ? (['bottom', 'top', 'left', 'right'] as EdgeName[]).flatMap((edge) => [{ edge }, { edge, lie: 'flat' as const }]).filter((o) => tongueOk(m, o)) : [];
      out.push(`fails Check: ${name(c.module)} ${c.name}${ways.length ? ` (${ways.map((o) => `${o.edge}${o.lie ? ' flat' : ''}`).join(', ')} would pass)` : ''}`);
    } else out.push(`fails Check: ${c.group}: ${c.name}`);
  }
  for (const w of r.report.warnings) if (/overlap on the panel|runs into/.test(w)) out.push(`warns: ${w.replace(/ Move one along.*| Move or turn one.*/, '')}`);
  if (pr) {
    // (unless one dock on its own is longer than the limit: a 420 mm powerboard needs a longer rail, and the rack's
    // rails are cut to one length)
    const along = (m: (typeof pr.mounts)[number]) => { const rl = pr.rails.find((x) => x.id === m.rail); return rl?.dir === 'v' ? m.foot[3] - m.foot[1] : m.foot[2] - m.foot[0]; };
    const longest = Math.max(0, ...pr.mounts.map(along));
    if (longest <= p.panel.maxRail) for (const rl of pr.rails) if (rl.length > p.panel.maxRail + 0.5) out.push(`rail ${rl.id} is ${Math.round(rl.length)} mm, over the ${p.panel.maxRail} mm limit`);
    const inUse = new Set((p.links ?? []).flatMap((l) => [l.a, l.b].map((e) => `${e.module}/${e.ref.replace(/:2$/, '')}`)));
    for (const m of pr.modules) for (const a of m.access) if (a.ok === 'blocked' && inUse.has(`${m.id}/${a.ref}`)) out.push(`blocked: ${name(m.id)} ${a.ref} (${a.dir})`);
  }
  return [...new Set(out)].sort();
}

export function runRack(rack: Rack): RackResult {
  const t0 = Date.now();
  const p = rack.make();
  const r = generate(p);
  const m = measure(p, r);
  const cats: Record<string, [number, number]> = {};
  for (const c of CATS) if (m.cats[c].n) cats[c] = [Math.round(m.cats[c].vol * 10) / 10, Math.round(m.cats[c].depth * 100) / 100];
  const issues = rack.auto ? layoutIssues(p, r) : [];
  if (m.unmeasured.length) issues.push(`not a closed solid, so not measured: ${[...new Set(m.unmeasured)].join(', ')}`);
  return { name: rack.name, cats, issues, worst: m.worst, ms: Date.now() - t0 };
}

export function readBaseline(): Baseline {
  return existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : { racks: {} };
}

/** Write these racks' results into the baseline (on purpose only: `npm run collisions:update`). */
export function writeBaseline(results: RackResult[]) {
  const b = readBaseline();
  for (const x of results) b.racks[x.name] = { cats: x.cats, issues: x.issues };
  const sorted: Baseline = { racks: Object.fromEntries(Object.keys(b.racks).sort().map((k) => [k, b.racks[k]])) };
  writeFileSync(FILE, `${JSON.stringify(sorted, null, 1)}\n`);
}

/** What got worse than the baseline (empty: nothing), and what got better (the baseline could come down). */
export function compare(x: RackResult, b: Baseline): { worse: string[]; better: string[] } {
  const base = b.racks[x.name];
  if (!base) return { worse: [`${x.name}: not in the baseline yet (npm run collisions:update)`], better: [] };
  const worse: string[] = [], better: string[] = [];
  for (const c of CATS) {
    const [v, d] = x.cats[c] ?? [0, 0], [v0, d0] = base.cats[c] ?? [0, 0];
    if (v > v0 + Math.max(TOL.vol, TOL.share * v0)) worse.push(`${x.name}: ${c} ${v0} → ${v} mm³`);
    else if (d > d0 + TOL.depth) worse.push(`${x.name}: ${c} ${d0} → ${d} mm deep`);
    else if (v < v0 - Math.max(TOL.vol, TOL.share * v0)) better.push(`${x.name}: ${c} ${v0} → ${v} mm³`);
  }
  for (const i of x.issues) if (!base.issues.includes(i)) worse.push(`${x.name}: ${i}`);
  for (const i of base.issues) if (!x.issues.includes(i)) better.push(`${x.name}: no longer ${i}`);
  return { worse, better };
}

/** The worst few overlaps of a rack, to say where to look. */
export function worstOf(x: RackResult, n = 8): string {
  return x.worst.slice(0, n).map((w) => `  ${w.cat}: ${w.a} × ${w.b}, ${w.vol.toFixed(1)} mm³, ${w.depth.toFixed(2)} mm deep, at ${w.at.join(', ')}`).join('\n');
}
