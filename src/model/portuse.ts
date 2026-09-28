// Which of a board's ports will have a plug in them, so a holder gets a cradle, cap, collar or zip-tie anchor only
// where one does some good. A port is in use when a cable to it is in the app, or you said you'll plug something into
// it yourself (a screen, a keyboard, a supply off the rack), or it is how the board gets power (its power input; a
// board with no cables in the app at all is powered through its main USB port; a debug or serial header is there for
// a probe). You can also say a port stays empty.
// Everything else is left bare: its opening in the wall is still there to plug into later. Pure.
import type { Comp, Module, Project } from './types';
import { plugRole } from './links';

export type PortUse = 'auto' | 'yes' | 'no';
export type UseWhy = 'cable' | 'yours' | 'power' | 'supply' | 'main' | 'probe' | 'unused' | 'off';

export const USE_TEXT: Record<UseWhy, string> = {
  cable: 'a cable in the app', yours: 'you plug it in yourself', power: 'its power input', supply: "the box's own supply",
  main: 'how it is powered (no cables in the app)', probe: 'a header for a probe or USB-serial adapter', unused: 'nothing plugged in', off: 'you said it stays empty',
};

const base = (r: string) => r.replace(/:2$/, '');

/** Whether each plug of a board will be used, and why. */
export function portUses(p: Project, m: Module): Map<string, UseWhy> {
  const out = new Map<string, UseWhy>();
  const cabled = new Set((p.links ?? []).flatMap((l) => [l.a, l.b].filter((e) => e.module === m.id).map((e) => base(e.ref))));
  const plugs = m.board.comps.filter((c) => c.conn && !c.hidden);
  const role = (c: Comp) => plugRole(m, c);
  const box = m.board.kind === 'box';
  // the port a board is powered through when nothing says otherwise: its power input, else its main USB
  const powerIns = plugs.filter((c) => role(c) === 'power-in' || (!box && role(c) === 'power-in-dc'));
  const main = !cabled.size && !powerIns.length ? plugs.find((c) => role(c) === 'device' || role(c) === 'hub-up') : undefined;
  for (const c of plugs) {
    const use = c.conn!.use ?? 'auto';
    let why: UseWhy;
    if (use === 'no') why = 'off';
    else if (cabled.has(c.ref)) why = 'cable';
    else if (use === 'yes') why = 'yours';
    else if (box && ['mains-in', 'other', 'power-in-dc'].includes(role(c))) why = 'supply';
    else if (powerIns[0] === c && !plugs.some((x) => x !== c && cabled.has(x.ref) && ['power-in', 'power-in-dc', 'device'].includes(role(x)))) why = 'power';
    else if (main === c) why = 'main';
    // a debug or serial header is there for a probe: protected from the start, so adding one later needs no new holder
    else if (['debug', 'uart'].includes(role(c))) why = 'probe';
    else why = 'unused';
    out.set(c.ref, why);
  }
  return out;
}

export const inUse = (why: UseWhy | undefined) => why != null && why !== 'unused' && why !== 'off';

/** The refs of the plugs in use (what a holder protects). */
export function usedRefs(p: Project, m: Module): string[] {
  return [...portUses(p, m)].filter(([, w]) => inUse(w)).map(([r]) => r).sort();
}
