// The flexure table: every printed part that springs (a latch beam, a clip arm, a hinge leaf) or is meant to deform
// once (a barb that clicks in, a crush rib), with its strain at rest and at full deflection from the 2D FEA, and the
// rule each has to meet. One table for the whole rack: each area adds its own flexures by registering a provider (see
// `PROVIDERS`), and `tests/flexures.test.ts` holds every row to the rule.
//
// The rule (a clip mechanism should be a spring that does not take a set, however often it is used):
//  - 'spring' (works on every use): at most 1% strain at full deflection, against the 2% PETG can take once
//    (PLA: 1.5%, so its rows are held to 0.75%), and at most 0.2% at rest. A part that presses permanently (an
//    anti-rattle leaf, a preloaded pad) has to stay under the rest limit: that is what keeps it from creeping or
//    taking a set. Retention comes from a hook face, not from a preload.
//  - 'once' (deforms on assembly, by design: a crush rib, a barb that clicks in): at most 1.5% strain at full
//    deflection, and no rest limit (it is unloaded, or has already given, after that one use). It must say so:
//    `note` says what deforms and when.
// Strains are the FEA's 3 x 3 pixel averaged peaks (`peak`), the way the dock FEA reports them; `p99` (the 99th
// percentile of the part) is kept beside it because a pixel corner on a fillet can read high.
import type { DockFeaCase } from './dockfea';

/** The limits every row is held to (strain as a fraction: 0.01 = 1%). */
export const FLEX_RULE = {
  /** most a 'spring' may strain at rest */
  rest: 0.002,
  /** most a 'spring' may strain at full deflection, PETG (a PLA row is held to `spring * 0.75`) */
  spring: 0.01,
  /** most a 'once' feature may strain at full deflection */
  once: 0.015,
} as const;

export type FlexKind = 'spring' | 'once';

export interface Flexure {
  /** short unique id, e.g. 'socket-latch' */
  id: string;
  /** what it is, for people: 'Socket latch beam' */
  name: string;
  /** where it lives: 'socket', 'rail shoe', 'holder', 'board clip' */
  part: string;
  kind: FlexKind;
  /** material name and modulus (MPa) the FEA used */
  material: string;
  E: number;
  /** strain at rest, installed (peak, fraction) */
  rest: number;
  /** strain at full deflection (peak, fraction), and the same at the 99th percentile */
  full: number;
  fullP99?: number;
  /** what full deflection is: 'nose out 1.8 mm (holder pushed in)' */
  deflection: string;
  /** what the rest state is: 'nose in its groove, nothing pushing' */
  restState: string;
  /** for a 'once' feature: what deforms and when; anything else worth saying */
  note?: string;
  /** further load cases with a strain the rule also cares about, e.g. { label: '20 N pull on the holder', strain: 0.004 } */
  also?: { label: string; strain: number }[];
}

/** What is wrong with a row against the rule (an empty list: it meets it). */
export function flexureIssues(f: Flexure): string[] {
  const out: string[] = [];
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  if (!(f.full >= 0) || !(f.rest >= 0)) return [`${f.id}: strain missing or negative`];
  if (f.kind === 'spring') {
    const lim = f.E >= 3000 ? FLEX_RULE.spring * 0.75 : FLEX_RULE.spring;
    if (f.rest > FLEX_RULE.rest) out.push(`${f.id}: ${pct(f.rest)} at rest (${f.restState}), over ${pct(FLEX_RULE.rest)}: it would creep and take a set`);
    if (f.full > lim) out.push(`${f.id}: ${pct(f.full)} at full deflection (${f.deflection}), over ${pct(lim)}`);
  } else {
    if (f.full > FLEX_RULE.once) out.push(`${f.id}: ${pct(f.full)} at full deflection (${f.deflection}), over ${pct(FLEX_RULE.once)} for a one-time feature`);
    if (!f.note) out.push(`${f.id}: a 'once' feature has to say what deforms and when (note)`);
  }
  for (const a of f.also ?? []) {
    const lim = f.E >= 3000 ? FLEX_RULE.spring * 0.75 : FLEX_RULE.spring;
    if (a.strain > lim) out.push(`${f.id}: ${pct(a.strain)} under ${a.label}, over ${pct(lim)}`);
  }
  return out;
}

/** Builds a Flexure row from one of the dock FEA's cases (one strain reading each for rest and full). */
export function fromCase(c: DockFeaCase, base: Omit<Flexure, 'rest' | 'full' | 'fullP99'> & { rest?: number }): Flexure {
  return { ...base, rest: base.rest ?? 0, full: c.peakStrain, fullP99: c.p99Strain };
}

/**
 * A source of rows. `run` solves what it needs (each area's FEA, which can take seconds) and returns its rows. Add one
 * line to `PROVIDERS` for a new area; nothing else in this file changes.
 */
export interface FlexureProvider { area: string; run: (opts: { E: number; nu: number; h: number; material: string }) => Promise<Flexure[]> | Flexure[] }

/** Every area's provider. The dock's (socket latch, release rod's barb, tongue ribs) is registered from `dockflex.ts`. */
export const PROVIDERS: FlexureProvider[] = [];

/** All rows, from every provider (PETG unless `E` says otherwise). */
export async function flexureTable(opts: { E?: number; nu?: number; h?: number; material?: string } = {}): Promise<Flexure[]> {
  const o = { E: opts.E ?? 2100, nu: opts.nu ?? 0.38, h: opts.h ?? 0.1, material: opts.material ?? (opts.E && opts.E >= 3000 ? 'PLA' : 'PETG') };
  const rows: Flexure[] = [];
  for (const p of PROVIDERS) rows.push(...(await p.run(o)));
  return rows;
}

/** The table as text, one row a flexure, for the console and the docs. */
export function formatTable(rows: Flexure[]): string {
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`.padStart(6);
  const w = Math.max(...rows.map((r) => r.id.length), 4);
  const head = `${'id'.padEnd(w)}  kind    rest    full    p99   deflection`;
  return [head, ...rows.map((r) => `${r.id.padEnd(w)}  ${r.kind.padEnd(6)} ${pct(r.rest)} ${pct(r.full)} ${r.fullP99 === undefined ? '     -' : pct(r.fullP99)}   ${r.deflection}`)].join('\n');
}
