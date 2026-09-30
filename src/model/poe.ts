// Power over Ethernet: a switch whose ports give power, and boards (a Pi with a PoE HAT) that take it there. A board on
// a PoE port needs no supply of its own: Auto-connect leaves its USB-C free, the power budget counts what it takes
// against the switch's PoE budget, and the shopping list has the HAT. Rough figures, like powerdata.ts (a HAT turns
// about 85% of what the switch sends into 5 V).
import type { Board, Comp, Link, Module, Project } from './types';
import { plugsOf, shortName, type PlugInfo } from './links';
import { needOf } from './powerdata';
import { assign } from './assign';

/** What one PoE+ (802.3at) port gives at most, W. */
export const POE_PORT_W = 30;
/** What an 802.3af port gives, W: the typical figure per port when a switch's own total isn't known. */
export const POE_AF_W = 15.4;
const HAT_EFFICIENCY = 0.85;

const isRj45 = (c: Comp) => c.conn?.type === 'rj45' && !c.hidden;
/** A board that a PoE HAT can go on: not a box or a probe, and it has an Ethernet port. */
export const canFitPoe = (b: Board) => b.kind !== 'box' && !b.role && b.comps.some(isRj45);
/** A board with a PoE HAT fitted (Board › Power): it takes its power from a PoE port. */
export const takesPoe = (b: Board) => canFitPoe(b) && !!b.poe;

/** A PoE port of a switch: an Ethernet port in a row marked as giving power. */
export const isPoePort = (b: Board, c: Comp) => b.kind === 'box' && isRj45(c) && !!b.box?.groups.some((g) => g.poe && g.refs?.includes(c.ref));
export const poePortsOf = (b: Board) => b.comps.filter((c) => isPoePort(b, c));
export const isPoeSwitch = (b: Board) => poePortsOf(b).length > 0;

/** What a switch gives over all its PoE ports together, W: its own figure, or about 60% of its ports at 15.4 W. */
export function poeTotal(b: Board): { total: number; guessed: boolean } {
  if (b.box?.poe) return { total: b.box.poe, guessed: false };
  return { total: Math.round(poePortsOf(b).length * POE_AF_W * 0.6), guessed: true };
}

/** What a board takes from the switch over PoE, W: its 5 V load, and what the HAT loses. */
export const poeWatts = (b: Board): number => Math.round(((needOf(b, true).load * 5) / HAT_EFFICIENCY) * 10) / 10;

const key = (x: PlugInfo) => `${x.ref.module}/${x.ref.ref}`;

/** A cable that powers a board over PoE: from a PoE port of a switch to the Ethernet port of a board with a PoE HAT. */
export interface PoeFeed { link: Link; take: PlugInfo; src: PlugInfo; watts: number }
export function poeFeeds(p: Project, plugs: PlugInfo[] = plugsOf(p)): PoeFeed[] {
  const by = new Map(plugs.map((x) => [key(x), x]));
  const out: PoeFeed[] = [];
  for (const l of p.links ?? []) {
    const a = by.get(`${l.a.module}/${l.a.ref}`), b = by.get(`${l.b.module}/${l.b.ref}`);
    if (!a || !b) continue;
    const [src, take] = isPoePort(a.module.board, a.comp) ? [a, b] : isPoePort(b.module.board, b.comp) ? [b, a] : [null, null];
    if (src && take && isRj45(take.comp) && takesPoe(take.module.board)) out.push({ link: l, take, src, watts: poeWatts(take.module.board) });
  }
  return out;
}
/** The boards powered over PoE now (their Ethernet is on a PoE port): they need no supply. */
export const poeFedIds = (p: Project): Set<string> => new Set(poeFeeds(p).map((f) => f.take.module.id));
/** Is this cable a PoE feed (it carries power: Cat5e or better)? */
export const isPoeLink = (p: Project, l: Link) => poeFeeds(p).some((f) => f.link.id === l.id);

/**
 * Which free Ethernet port of a board with a PoE HAT goes on which free PoE port of a switch: the cheapest pairing in
 * all by cable (`reach`), no switch asked for more than it gives (the farthest boards come off, and get a supply as
 * before), no board asked of a port for more than one gives.
 */
export function poeAssign(p: Project, plugs: PlugInfo[], taken: Set<string>, reach: (a: PlugInfo, b: PlugInfo) => number): (readonly [PlugInfo, PlugInfo])[] {
  const fed = poeFedIds(p);
  // one Ethernet port for each board: its first free one
  const boards = plugs.filter((x, i) => x.role === 'net' && !taken.has(key(x)) && isRj45(x.comp) && takesPoe(x.module.board) && !fed.has(x.module.id) && poeWatts(x.module.board) <= POE_PORT_W
    && plugs.findIndex((y) => y.module === x.module && y.role === 'net' && !taken.has(key(y)) && isRj45(y.comp)) === i);
  const ports = plugs.filter((x) => x.role === 'net' && !taken.has(key(x)) && isPoePort(x.module.board, x.comp));
  if (!boards.length || !ports.length) return [];
  let got = assign(boards.map((a) => ports.map((b) => (a.module === b.module ? Infinity : reach(a, b))))).map((j, i) => (j >= 0 ? ([boards[i], ports[j]] as const) : null)).filter(Boolean) as (readonly [PlugInfo, PlugInfo])[];
  // a switch never asked for more than it gives: minus what its PoE ports already carry, the farthest boards come off
  const used = new Map<string, number>();
  for (const f of poeFeeds(p, plugs)) used.set(f.src.module.id, (used.get(f.src.module.id) ?? 0) + f.watts);
  for (const m of new Set(got.map(([, s]) => s.module))) {
    const room = poeTotal(m.board).total - (used.get(m.id) ?? 0);
    const mine = () => got.filter(([, s]) => s.module === m);
    while (mine().reduce((t, [a]) => t + poeWatts(a.module.board), 0) > room + 1e-6) {
      const far = mine().sort((x, y) => reach(y[0], y[1]) - reach(x[0], x[1]))[0];
      got = got.filter((x) => x !== far);
    }
  }
  return got;
}

/** A PoE switch's load: what the boards on its PoE ports take against what it gives. */
export interface PoeLoad {
  module: Module;
  load: number; // W the boards take from it
  total: number; // W it gives in all
  guessed: boolean; // total is a typical figure, not the user's
  takers: { name: string; watts: number }[];
  over: { name: string; watts: number }[]; // boards that want more than one port gives
  status: 'ok' | 'warn' | 'bad';
}

/** The PoE load on every switch that powers a board. */
export function poeBudget(p: Project): PoeLoad[] {
  const feeds = poeFeeds(p), out: PoeLoad[] = [];
  for (const m of new Set(feeds.map((f) => f.src.module))) {
    const mine = feeds.filter((f) => f.src.module === m), { total, guessed } = poeTotal(m.board);
    const takers = mine.map((f) => ({ name: f.take.module.board.name, watts: f.watts })), load = Math.round(takers.reduce((t, x) => t + x.watts, 0) * 10) / 10;
    const over = takers.filter((x) => x.watts > POE_PORT_W);
    out.push({ module: m, load, total, guessed, takers, over, status: load > total + 1e-6 ? 'bad' : load > 0.8 * total || over.length ? 'warn' : 'ok' });
  }
  return out;
}

const w = (x: number) => `${Math.round(x * 10) / 10} W`;
/** One line per PoE switch for Check and the cable list. */
export function poeText(s: PoeLoad): { name: string; value: string; detail: string } {
  const who = s.takers.length > 4 ? `${s.takers.length} boards` : s.takers.map((t) => shortName(t.name)).join(', ');
  const lines = [`${who} take about ${w(s.load)} over PoE at full load (their 5 V load, and what a PoE HAT loses); the ${shortName(s.module.board.name)} gives about ${w(s.total)} in all${s.guessed ? ' (a typical figure: set yours under Box › Power over Ethernet)' : ''}.`];
  if (s.status === 'bad') lines.push('That is more than it gives: it shuts ports down. Put some boards on another PoE switch, or give them a USB-C supply each (untick their PoE HAT).');
  else if (s.load > 0.8 * s.total) lines.push('That is close to what it gives: leave room for anything else you put on its PoE ports.');
  for (const o of s.over) lines.push(`${shortName(o.name)} wants about ${w(o.watts)}, more than one PoE+ port gives (${POE_PORT_W} W): give it a supply.`);
  lines.push('Figures are estimates: set a board’s own under Board › Power.');
  return { name: `PoE from ${shortName(s.module.board.name)}`, value: `${w(s.load)} of ${w(s.total)}${s.over.length ? `, ${s.over.length} too hungry for a port` : ''}`, detail: lines.join(' ') };
}

/** The PoE HATs to buy: one for each board that has the option on, grouped by kind of board. */
export function poeHats(p: Project): { qty: number; item: string; note: string }[] {
  const by = new Map<string, number>();
  for (const m of p.modules) if (takesPoe(m.board)) by.set(m.board.name.replace(/ #\d+$/, ''), (by.get(m.board.name.replace(/ #\d+$/, '')) ?? 0) + 1);
  return [...by].map(([name, qty]) => ({ qty, item: `PoE HAT for the ${name} (802.3at, fits its 4-pin PoE header)`, note: 'it powers the board from its Ethernet cable: no USB-C supply for it' }));
}

/** What the rack still needs for PoE, with the accessory (a library template id) that would give it. */
export function poeAdvice(p: Project): { text: string; add?: string; count?: number }[] {
  const plugs = plugsOf(p), out: { text: string; add?: string; count?: number }[] = [];
  const fed = poeFedIds(p);
  const want = p.modules.filter((m) => takesPoe(m.board) && !fed.has(m.id));
  if (want.length) {
    const names = want.length > 3 ? `${want.length} boards` : want.map((m) => shortName(m.board.name)).join(', '), them = want.length > 1 ? 'they need' : 'it needs';
    const sws = p.modules.filter((m) => isPoeSwitch(m.board));
    if (!sws.length) out.push({ text: `${names} ${want.length > 1 ? 'have' : 'has'} a PoE HAT and there is no PoE switch in the rack: add one, or ${them} a USB-C supply.`, add: 'net_switch8poe', count: 1 });
    else {
      // what the PoE switches have left, in ports and in watts: how many of these boards they can still power
      const taken = new Set((p.links ?? []).flatMap((l) => [`${l.a.module}/${l.a.ref}`, `${l.b.module}/${l.b.ref}`]));
      const ports = plugs.filter((x) => x.role === 'net' && isPoePort(x.module.board, x.comp) && !taken.has(key(x))).length;
      const load = new Map(poeBudget(p).map((b) => [b.module.id, b.load]));
      let watts = sws.reduce((t, m) => t + Math.max(0, poeTotal(m.board).total - (load.get(m.id) ?? 0)), 0), fit = 0;
      for (const m of [...want].sort((a, b) => poeWatts(a.board) - poeWatts(b.board))) if (fit < ports && poeWatts(m.board) <= watts + 1e-6) { fit++; watts -= poeWatts(m.board); }
      if (fit < want.length) out.push({ text: `${names} ${want.length > 1 ? 'have' : 'has'} a PoE HAT but the PoE switch${sws.length > 1 ? 'es' : ''} can power only ${fit} of ${want.length}: ${ports} PoE port${ports === 1 ? '' : 's'} free, and ${Math.round(sws.reduce((t, m) => t + Math.max(0, poeTotal(m.board).total - (load.get(m.id) ?? 0)), 0))} W to give of the ${Math.round(want.reduce((t, m) => t + poeWatts(m.board), 0))} W ${them}. Add another PoE switch, or give the rest a USB-C supply.`, add: 'net_switch8poe', count: 1 });
    }
  }
  // a board plugged into a PoE port with no HAT gets nothing from it
  for (const l of p.links ?? []) {
    const ends = [l.a, l.b].map((r) => { const m = p.modules.find((x) => x.id === r.module); return { m, c: m?.board.comps.find((x) => x.ref === r.ref) }; });
    const [sw, bd] = ends[0].m && ends[0].c && isPoePort(ends[0].m.board, ends[0].c) ? ends : ends[1].m && ends[1].c && isPoePort(ends[1].m.board, ends[1].c) ? [ends[1], ends[0]] : [null, null];
    if (sw && bd?.m && bd.c && isRj45(bd.c) && canFitPoe(bd.m.board) && !bd.m.board.poe) out.push({ text: `${shortName(bd.m.board.name)} is on a PoE port of the ${shortName(sw.m!.board.name)} but has no PoE HAT: fit one (tick “PoE HAT fitted” under Board › Power) or give it a supply.` });
  }
  return out;
}
