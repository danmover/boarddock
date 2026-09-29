// What to buy for the cables, one line per kind and length, worded the same everywhere (Plugs › Cables to buy, the
// Export shopping list, the download's README). A probe's ribbon and a plug pack's own lead come with them, so they
// are listed apart and never bought; jumper wires are bought by the wire; a cable to your computer is a 2 m one.
import { buyText } from './cablebuy';
import type { GenReport, Link, PlugRef, Project } from './types';
import { baseRef, cableNumbers, findModule, isAccessory, PC, plugName, plugRole, ROUTER, shortName } from './links';
import { isPlugPack } from './powerdata';

export type CableOut = NonNullable<GenReport['cables']>[number];
export interface CableLines { buy: string[]; comes: string[] }

const PLUG: Record<string, string> = { ac_au: 'AU', ac_uk: 'UK', ac_us: 'US', ac_eu: 'EU' };

/**
 * The cables to buy for these routed cables, grouped ("2 × 1 m USB-A to USB-C cable (numbers 3, 5)"), and what comes
 * with the parts. Cables that leave the rack (to your computer, a plug pack's lead) are never routed, so they are
 * added from the project's links: all of them, or on a built rack (`onlyNew`) the ones not bought then.
 */
export function cableLines(p: Project, cables: CableOut[], onlyNew = false): CableLines {
  const links = p.links ?? [];
  const nos = cableNumbers(links);
  const end = (r: PlugRef) => { const m = findModule(p, r.module); const c = m?.board.comps.find((x) => x.ref === baseRef(r.ref)); return { m, c, type: c?.conn?.type ?? '', role: m && c ? plugRole(m, c) : 'other' }; };
  const buy = new Map<string, number[]>(), comes: string[] = [];
  const add = (k: string, ns: number[]) => buy.set(k, [...(buy.get(k) ?? []), ...ns]);
  const no = (l: Link | undefined) => (l ? nos.get(l.id) ?? 0 : 0);
  const tag = (n: number) => (n ? `#${n} ` : '');
  /** A mains cable: a charger's figure-8 lead is bought (most come with one); a fixed lead or a plug pack isn't. */
  const mains = (l: Link, len?: number) => {
    const A = end(l.a), B = end(l.b), [lead, outlet] = A.role === 'mains-in' ? [A, B] : [B, A];
    const who = lead.m?.board.name ?? 'it', where = outlet.m?.board.name ?? 'its outlet';
    if (lead.m && isPlugPack(lead.m.board)) { comes.push(`${tag(no(l))}the ${who} plugs straight into the ${where}: no lead`); return; }
    if (lead.type !== 'iec_c7') { comes.push(`${tag(no(l))}the ${who}'s own lead into the ${where}`); return; }
    add(`mains lead, figure-8 (C7) to ${PLUG[outlet.type] ?? 'AU'} plug, ${len != null ? `${len} m or longer` : 'long enough to reach'} (most chargers come with one)`, [no(l)]);
  };
  for (const c of cables) {
    const l = links.find((x) => x.id === c.id);
    const n = c.no ?? no(l);
    if (c.ribbon != null) { const pr = l && [end(l.a), end(l.b)].find((e) => e.m && isAccessory(e.m.board)); comes.push(`${tag(n)}debug ribbon: comes with the ${pr?.m?.board.name ?? 'probe'} (${Math.round(c.ribbon / 10)} cm)`); continue; }
    // jumper wires are bought by the wire: one per pin they join
    if (c.kind === 'jumper') { add(`female–female jumper wire (Dupont), ${Math.round(c.buy * 100)} cm`, Array(l?.wires?.length || 3).fill(n)); continue; }
    if (c.kind === 'uart') { add(`USB to TTL serial cable, 3.3 V, with loose jumper ends (PL2303 or CP2102 type, like Adafruit 954), ${c.buy} m or longer`, [n]); continue; }
    if (!l) { add(`${c.buy} m cable`, [n]); continue; }
    if (c.kind === 'mains') { mains(l, c.buy); continue; }
    const A = end(l.a), B = end(l.b);
    // a plug pack's lead is its own
    const pack = [A, B].find((e) => e.m && isPlugPack(e.m.board));
    if (pack) { comes.push(`${tag(n)}the ${pack.m!.board.name}'s own lead (about ${((pack.m!.board.box?.pack?.lead ?? 1500) / 1000).toFixed(1)} m)`); continue; }
    add(`${buyText(c.kind ?? 'usb', c.buy, plugName(A.type), plugName(B.type))}${pi5OnA(A, B) ? " (a USB-A to C cable can't give a Pi 5 its full 5 A)" : ''}`, [n]);
  }
  // cables that leave the rack: to your computer, and a plug pack's lead and body
  const routed = new Set(cables.map((c) => c.id));
  const bought = new Set((p.built?.cableInfo ?? []).map((c) => c.no).filter((x) => x != null));
  for (const l of links) {
    if (routed.has(l.id) || (onlyNew && bought.has(no(l)))) continue;
    const A = end(l.a), B = end(l.b);
    if (!A.m || !B.m) continue;
    if (A.m.id === PC || B.m.id === PC) {
      const rack = A.m.id === PC ? B : A;
      add(`2 m ${plugName(rack.type)} to USB-A cable, to your computer (USB-C at that end if your computer only has USB-C)`, [no(l)]);
    } else if (A.m.id === ROUTER || B.m.id === ROUTER) {
      add('Ethernet cable to your router, as long as the run to it (measure it: 2 m if the router is beside the rack)', [no(l)]);
    } else if (isPlugPack(A.m.board) || isPlugPack(B.m.board)) {
      if (l.kind === 'mains') mains(l);
      else { const pk = isPlugPack(A.m.board) ? A.m : B.m, to = pk === A.m ? B.m : A.m; comes.push(`${tag(no(l))}the ${pk.board.name}'s own lead to the ${shortName(to.board.name)} (about ${((pk.board.box?.pack?.lead ?? 1500) / 1000).toFixed(1)} m: check it reaches)`); }
    }
  }
  const lines = [...buy.entries()].map(([k, ns]) => { const u = [...new Set(ns)].filter(Boolean).sort((a, b) => a - b); return `${ns.length} × ${k}${u.length ? ` (number${u.length > 1 ? 's' : ''} ${u.join(', ')})` : ''}`; });
  return { buy: lines, comes };
}

/** A Pi 5 powered through a USB-A to C cable (a USB-A port can't do USB-C PD, so never its full 5 A). */
function pi5OnA(A: { m?: { board: { name: string } }; type: string; role: string }, B: typeof A) {
  const [take, src] = A.role === 'power-in' ? [A, B] : B.role === 'power-in' ? [B, A] : [null, null];
  return !!take && !!src && /\bpi 5\b|raspberry pi 5/i.test(take.m?.board.name ?? '') && /^usb_a/.test(src.type);
}
