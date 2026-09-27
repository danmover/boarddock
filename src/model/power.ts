// The power budget: follow every cable that powers a board back to its charger, hub or host port, add up what the
// boards take, and compare that with what each port and each box can give. Rough figures (see powerdata.ts), so it
// warns about a charger asked for 18 A or a Pi 4 on a 2.4 A port, not about a tenth of an amp.
import type { Module, Project } from './types';
import { plugsOf, shortName, type PlugInfo } from './links';
import { amps, hostTotal, isHub, needOf, portCap, poweredHub, supplyOf, watts } from './powerdata';

export interface SourceLoad {
  module: Module;
  kind: 'charger' | 'powered hub' | 'hub' | 'host';
  load: number; // A at 5 V, at full load
  total: number; // A it can give in all
  guessed: boolean; // total is a typical figure, not the user's
  takers: { name: string; load: number }[];
  ports: { take: string; peak: number; cap: number; port: string }[]; // ports asked for more than they give
  status: 'ok' | 'warn' | 'bad';
}

const SRC = ['power-out', 'hub-down', 'host'];
type Edge = { src: PlugInfo; take: PlugInfo };

export function powerBudget(p: Project): SourceLoad[] {
  const plugs = plugsOf(p);
  const k = (r: { module: string; ref: string }) => `${r.module}/${r.ref}`;
  const by = new Map(plugs.map((x) => [k(x.ref), x]));
  const edges: Edge[] = [];
  for (const l of p.links ?? []) {
    const a = by.get(k(l.a)), b = by.get(k(l.b));
    if (!a || !b) continue;
    if (SRC.includes(a.role) && !SRC.includes(b.role)) edges.push({ src: a, take: b });
    else if (SRC.includes(b.role) && !SRC.includes(a.role)) edges.push({ src: b, take: a });
  }
  // the cable that powers each board: its power input when that is plugged in, else its USB (a Pico, a hub)
  const feed = new Map<string, Edge>();
  for (const e of edges) if (e.take.role === 'power-in' && !feed.has(e.take.module.id)) feed.set(e.take.module.id, e);
  for (const e of edges) if ((e.take.role === 'device' || e.take.role === 'hub-up') && !feed.has(e.take.module.id)) feed.set(e.take.module.id, e);
  const fed = (m: Module) => edges.filter((e) => e.src.module === m && feed.get(e.take.module.id) === e);
  const hasPowerIn = (m: Module) => plugs.some((x) => x.module === m && x.role === 'power-in');
  const memo = new Map<string, number>();
  // what a board puts on the cable that powers it; a hub without its own supply passes on what hangs off it
  const load = (m: Module, depth = 0): number => {
    if (memo.has(m.id)) return memo.get(m.id)!;
    const v = isHub(m.board)
      ? 0.1 + (poweredHub(m.board) || depth > 6 ? 0 : fed(m).reduce((a, e) => a + load(e.take.module, depth + 1), 0))
      : needOf(m.board, hasPowerIn(m)).load;
    memo.set(m.id, v);
    return v;
  };
  const peak = (m: Module) => (isHub(m.board) ? load(m) : needOf(m.board, hasPowerIn(m)).peak);

  const out: SourceLoad[] = [];
  for (const m of p.modules) {
    const es = fed(m);
    if (!es.length) continue;
    const b = m.board;
    const mine = plugs.filter((x) => x.module === m && SRC.includes(x.role)).map((x) => ({ c: x.comp, role: x.role }));
    let kind: SourceLoad['kind'], total: number, guessed = false;
    if (isHub(b) && poweredHub(b)) { kind = 'powered hub'; ({ total, guessed } = supplyOf(b, mine)); }
    else if (isHub(b)) {
      // a bus-powered hub gives what its own uplink gives
      kind = 'hub';
      const up = feed.get(m.id);
      total = up ? portCap(up.src.module.board, up.src.comp, up.src.role) : 0.5;
    } else if (es.some((e) => e.src.role === 'power-out')) { kind = 'charger'; ({ total, guessed } = supplyOf(b, mine)); }
    else { kind = 'host'; total = hostTotal(b) ?? 0.9 * mine.length; }
    const takers = es.map((e) => ({ name: e.take.module.board.name, load: load(e.take.module) }));
    const sum = takers.reduce((a, t) => a + t.load, 0);
    const ports = es.flatMap((e) => {
      const cap = portCap(b, e.src.comp, e.src.role), need = peak(e.take.module);
      return need > cap + 1e-6 ? [{ take: e.take.module.board.name, peak: need, cap, port: e.src.label }] : [];
    });
    const status = sum > total * 1.25 ? 'bad' : sum > total + 1e-6 || ports.length ? 'warn' : 'ok';
    out.push({ module: m, kind, load: sum, total, guessed, takers, ports, status });
  }
  return out;
}

/** One line per source for Check and the cable list. */
export function powerText(s: SourceLoad): { name: string; value: string; detail: string } {
  const b = s.module.board.name;
  const what = s.kind === 'host' ? `${b}'s USB ports` : b;
  const who = s.takers.length > 4 ? `${s.takers.length} boards` : s.takers.map((t) => shortName(t.name)).join(', ');
  const over = s.load > s.total + 1e-6;
  const lines = [
    `${who} take about ${amps(s.load)} at full load; ${what} ${s.kind === 'host' ? 'give' : 'gives'} about ${amps(s.total)}${s.kind === 'charger' || s.kind === 'powered hub' ? ` (${watts(s.total)} W${s.guessed ? ', a typical figure: set yours under Box' : ''})` : ''}.`,
  ];
  if (over) lines.push(s.kind === 'host' ? `A Raspberry Pi shares one current limit between its USB ports: move some boards to a charger or a powered hub.` : s.kind === 'hub' ? 'This hub has no supply of its own: use a powered hub, or give the boards on it their own charger ports.' : 'Spread the boards over another charger, or use a bigger one.');
  for (const q of s.ports) lines.push(`${shortName(q.take)} wants about ${amps(q.peak)} from ${q.port}, which gives about ${amps(q.cap)}${q.cap < 3 && q.peak >= 2.5 ? ': under load it may report low voltage and slow down (a USB-C charger port gives 3 A)' : ''}.`);
  lines.push('Figures are estimates (makers’ recommended supplies and typical draws); set a board’s own under Board › Power.');
  return { name: `Power from ${shortName(b)}`, value: `${amps(s.load)} of ${amps(s.total)}${s.ports.length ? `, ${s.ports.length} port${s.ports.length > 1 ? 's' : ''} short` : ''}`, detail: lines.join(' ') };
}
