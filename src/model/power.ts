// The power budget: follow every cable that powers a board back to its charger, hub or host port, add up what the
// boards take, and compare that with what each port and each box can give. Rough figures (see powerdata.ts), so it
// warns about a charger asked for 18 A or a Pi 4 on a 2.4 A port, not about a tenth of an amp.
import type { Module, Project } from './types';
import { plugsOf, sameRef, shortName, type PlugInfo } from './links';
import { amps, hostTotal, isHub, isPlugPack, minOf, needOf, portCap, poweredHub, supplyOf, watts } from './powerdata';

export interface SourceLoad {
  module: Module;
  kind: 'charger' | 'supply' | 'powered hub' | 'hub' | 'host';
  load: number; // A at 5 V, at full load
  total: number; // A it can give in all
  guessed: boolean; // total is a typical figure, not the user's
  takers: { name: string; load: number }[];
  ports: { take: string; peak: number; cap: number; port: string }[]; // ports that give less than their board needs to run
  limited: { take: string; peak: number; cap: number; port: string; why: string }[]; // enough to run, short of the board's peak (a Pi 5 on 3 A)
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
  // the least a board runs on (a Pi 5 runs on 3 A, its USB held back)
  const least = (m: Module) => (isHub(m.board) ? load(m) : minOf(needOf(m.board, hasPowerIn(m))));
  // what the port that powers a board gives (a Pi 5's USB ports give 1.6 A on a 5 A supply, 0.6 A on less)
  const fedWith = (m: Module) => { const e = feed.get(m.id); return e && e.take.role === 'power-in' ? portCap(e.src.module.board, e.src.comp, e.src.role) : undefined; };

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
    } else if (es.some((e) => e.src.role === 'power-out')) { kind = isPlugPack(b) ? 'supply' : 'charger'; ({ total, guessed } = supplyOf(b, mine)); }
    else { kind = 'host'; total = hostTotal(b, fedWith(m)) ?? 0.9 * mine.length; }
    const takers = es.map((e) => ({ name: e.take.module.board.name, load: load(e.take.module) }));
    const sum = takers.reduce((a, t) => a + t.load, 0);
    const ports = es.flatMap((e) => {
      const cap = portCap(b, e.src.comp, e.src.role), need = least(e.take.module);
      return need > cap + 1e-6 ? [{ take: e.take.module.board.name, peak: peak(e.take.module), cap, port: e.src.label }] : [];
    });
    const limited = es.flatMap((e) => {
      const cap = portCap(b, e.src.comp, e.src.role), pk = peak(e.take.module);
      return pk > cap + 1e-6 && least(e.take.module) <= cap + 1e-6 ? [{ take: e.take.module.board.name, peak: pk, cap, port: e.src.label, why: needOf(e.take.module.board, true).why }] : [];
    });
    const status = sum > total * 1.25 ? 'bad' : sum > total + 1e-6 || ports.length ? 'warn' : 'ok';
    out.push({ module: m, kind, load: sum, total, guessed, takers, ports, limited, status });
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
  for (const q of s.ports) lines.push(`${shortName(q.take)} wants about ${amps(q.peak)} from ${q.port}, which gives about ${amps(q.cap)}${q.cap < 3 && q.peak >= 2.5 ? ': under load it may report low voltage and slow down (a USB-C charger port gives 3 A). Move it to a stronger port (Plugs › Move boards to stronger ports) or add a charger' : ''}.`);
  for (const q of s.limited) lines.push(`${shortName(q.take)} runs on the ${amps(q.cap)} from ${q.port}, short of the ${amps(q.peak)} it wants (${q.why}).`);
  if (s.kind === 'powered hub') lines.push('A powered hub is counted as powered by its own supply, plugged in off the rack: check it has one.');
  lines.push('Figures are estimates (makers’ recommended supplies and typical draws); set a board’s own under Board › Power.');
  return { name: `Power from ${shortName(b)}`, value: `${amps(s.load)} of ${amps(s.total)}${s.ports.length ? `, ${s.ports.length} port${s.ports.length > 1 ? 's' : ''} too weak` : ''}${s.limited.length ? `, ${s.limited.length} held back` : ''}`, detail: lines.join(' ') };
}

/** A powerboard's mains load: what the supplies plugged into it draw from the wall, against what it may carry. */
export interface MainsLoad {
  module: Module;
  amps: number; // A at mains voltage, what BoardDock knows is plugged in
  watts: number;
  rating: number; // A it may carry in all
  guessed: boolean; // rating is a typical figure for its outlets, not the user's
  volts: number;
  outlet: string; // AU, UK, US or EU
  takers: { name: string; watts: number | null }[]; // null: BoardDock doesn't know what it draws
  status: 'ok' | 'warn' | 'bad';
}

// mains voltage and a typical powerboard rating for each outlet type (AU/NZ 10 A, UK 13 A, US 15 A, EU 16 A)
const MAINS: Record<string, { v: number; a: number; name: string }> = { ac_au: { v: 230, a: 10, name: 'AU' }, ac_uk: { v: 230, a: 13, name: 'UK' }, ac_us: { v: 120, a: 15, name: 'US' }, ac_eu: { v: 230, a: 16, name: 'EU' } };
/** A typical powerboard rating for each outlet type (A). */
export const MAINS_RATING: Record<string, number> = Object.fromEntries(Object.entries(MAINS).map(([k, v]) => [k, v.a]));
const EFFICIENCY = 0.85; // a plug pack or charger turns about 85% of what it draws into what it gives (an estimate)

/** What a box draws from the wall at full load (W), from what it gives; null when BoardDock can't tell. */
function wallWatts(p: Project, m: Module, depth = 0): number | null {
  const b = m.board;
  if (b.kind !== 'box' || !b.box) return null;
  if (b.comps.some((c) => c.conn?.type.startsWith('ac_'))) return depth > 3 ? 0 : mainsBudget(p, m.id)[0]?.watts ?? 0; // a powerboard in a powerboard: all it carries
  const dc = b.box.groups.filter((g) => g.role === 'dc-out' && g.volts && g.amps);
  if (dc.length) return dc.reduce((a, g) => a + g.volts! * g.amps! * g.count, 0) / EFFICIENCY;
  const mine = plugsOf(p).filter((x) => x.module === m && (x.role === 'power-out' || x.role === 'hub-down')).map((x) => ({ c: x.comp, role: x.role }));
  if (!mine.length && !b.box.supply) return null;
  return (supplyOf(b, mine).total * 5) / EFFICIENCY;
}

/** The mains load on every powerboard (or only the one with id `only`). */
export function mainsBudget(p: Project, only?: string): MainsLoad[] {
  const plugs = plugsOf(p), by = new Map(plugs.map((x) => [`${x.ref.module}/${x.ref.ref}`, x]));
  const out: MainsLoad[] = [];
  for (const m of p.modules) {
    if (only && m.id !== only) continue;
    const outlet = m.board.comps.find((c) => c.conn?.type.startsWith('ac_'))?.conn?.type;
    if (!outlet) continue;
    const t = MAINS[outlet] ?? MAINS.ac_au;
    const takers: MainsLoad['takers'] = [];
    for (const l of p.links ?? []) {
      const a = by.get(`${l.a.module}/${l.a.ref}`), b = by.get(`${l.b.module}/${l.b.ref}`);
      if (!a || !b) continue;
      const [o, lead] = a.module === m && a.role === 'mains-out' ? [a, b] : b.module === m && b.role === 'mains-out' ? [b, a] : [null, null];
      if (!o || !lead || lead.module === m) continue;
      takers.push({ name: lead.module.board.name, watts: wallWatts(p, lead.module, 1) });
    }
    // its own USB ports, when they power something
    if (plugs.some((x) => x.module === m && x.role === 'power-out' && (p.links ?? []).some((l) => sameRef(l.a, x.ref) || sameRef(l.b, x.ref))))
      takers.push({ name: `its own USB ports`, watts: (supplyOf(m.board, []).total * 5) / EFFICIENCY });
    if (!takers.length) continue;
    const watts = takers.reduce((a, x) => a + (x.watts ?? 0), 0), amp = watts / t.v, rating = m.board.box?.rating ?? t.a;
    out.push({ module: m, amps: amp, watts, rating, guessed: m.board.box?.rating == null, volts: t.v, outlet: t.name, takers, status: amp > rating + 1e-6 ? 'bad' : amp > 0.8 * rating ? 'warn' : 'ok' });
  }
  return out;
}

/** One line per powerboard for Check. */
export function mainsText(s: MainsLoad): { name: string; value: string; detail: string } {
  const known = s.takers.filter((x) => x.watts != null), unknown = s.takers.filter((x) => x.watts == null);
  const who = known.length > 4 ? `${known.length} supplies` : known.map((x) => shortName(x.name)).join(', ');
  const lines = [
    `${who || 'Nothing BoardDock knows'} ${known.length > 1 ? 'draw' : 'draws'} about ${Math.round(s.watts)} W from the wall at full load, about ${Math.round(s.amps * 100) / 100} A at ${s.volts} V; the powerboard may carry ${s.rating} A${s.guessed ? ` (a typical figure for a ${s.outlet} powerboard: check the label on yours)` : ''}.`,
  ];
  if (unknown.length) lines.push(`BoardDock doesn't know what ${unknown.map((x) => shortName(x.name)).join(', ')} ${unknown.length > 1 ? 'draw' : 'draws'}: add ${unknown.length > 1 ? 'them' : 'it'} from the label${unknown.length > 1 ? 's' : ''}.`);
  if (s.status !== 'ok') lines.push(s.status === 'bad' ? 'That is more than it may carry: move some supplies to another powerboard, each plugged into its own wall socket.' : 'That is close to what it may carry: leave room for anything else you plug in.');
  lines.push('Only what is plugged in on the rack is counted (estimates, from what each supply gives at about 85% efficiency): add anything else on this powerboard yourself.');
  return { name: `Mains on ${shortName(s.module.board.name)}`, value: `about ${Math.round(s.amps * 100) / 100} A of ${s.rating} A`, detail: lines.join(' ') };
}
