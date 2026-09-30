// "Complete this rack": what a rack with boards on it still lacks, as a short list with what would give each: a supply
// for each Pi, outlets for everything that plugs into the wall against the powerboards' size, a switch when two or
// more boards have Ethernet, and the switch's uplink to your router.
import type { Project } from './types';
import { isAccessory, isSwitch, linkOf, plugsOf, powerShort, ROUTER } from './links';
import { isPlugPack, minOf } from './powerdata';

/** One thing missing: what to say, and what goes on the rack for it (library template ids). `own`: the new switch also brings its own supply. */
export interface Gap { kind: 'supply' | 'switch' | 'outlets' | 'uplink'; text: string; add: string[]; own?: boolean }

/** The smallest powerboards (template ids) that give at least `n` more outlets. */
function powerboardsFor(n: number): string[] {
  const out: string[] = [];
  while (n > 0) { out.push(n <= 4 ? 'pb4' : 'pb6'); n -= n <= 4 ? 4 : 6; }
  return out;
}

export function completeRack(p: Project): Gap[] {
  const gaps: Gap[] = [];
  // a supply for each Pi with no power: its own (27 W for a Pi 5, 15 W for a Pi 4), each a plug pack that needs an outlet
  const pis = powerShort(p).unserved.filter((w) => /^raspberry pi/i.test(w.plug.module.board.name) && !isAccessory(w.plug.module.board));
  const supplies = pis.map((w) => (minOf(w.need) > 3 || w.need.peak > 3 ? 'psu_pi5' : 'psu_pi4'));
  if (pis.length) gaps.push({ kind: 'supply', text: `${pis.length > 1 ? `${pis.length} Pis have` : `${pis[0].plug.module.board.name} has`} no power: ${pis.length > 1 ? 'each gets its own supply' : 'its own supply'} (a plug pack that goes in an outlet).`, add: supplies });
  // a switch or powered hub with nothing on its DC input: the supply it came with (own:<box>), also a plug pack
  const owns = p.modules.filter((m) => m.board.kind === 'box' && !isPlugPack(m.board)).filter((m) => { const dc = plugsOf(p).filter((x) => x.module === m && x.role === 'power-in-dc'); return dc.length > 0 && !dc.some((x) => linkOf(p, x.ref)); });
  for (const m of owns) gaps.push({ kind: 'supply', text: `${m.board.name}: nothing on its DC input. The supply it came with goes in an outlet, its lead to the ${m.board.name}.`, add: [`own:${m.id}`] });
  // a switch when two or more boards have Ethernet and none is on the rack: 5 ports for up to 4 boards (one port is the uplink)
  const net = plugsOf(p).filter((x) => x.role === 'net' && !isAccessory(x.module.board) && !linkOf(p, x.ref));
  const boards = new Set(net.map((x) => x.module.id)).size;
  const hasSwitch = p.modules.some((m) => isSwitch(m.board));
  let newSwitch = false;
  if (boards >= 2 && !hasSwitch) {
    newSwitch = true;
    gaps.push({ kind: 'switch', text: `${boards} boards have Ethernet and there is no switch: add one${boards > 4 ? ' (8 ports)' : ' (5 ports)'} with its own supply.`, add: [boards > 4 ? 'net_switch8' : 'net_switch5'], own: true });
  }
  // outlets: everything that plugs into the wall (chargers, plug packs, boxes with a mains lead), the supplies added here too,
  // against what the powerboards give
  const mains = plugsOf(p).filter((x) => x.role === 'mains-in' && !plugsOf(p).some((y) => y.module === x.module && y.role === 'mains-out'));
  const loads = new Set(mains.map((x) => x.module.id)).size + supplies.length + (newSwitch ? 1 : 0) + owns.length;
  const outlets = plugsOf(p).filter((x) => x.role === 'mains-out').length, boardsPB = new Set(plugsOf(p).filter((x) => x.role === 'mains-out').map((x) => x.module.id)).size;
  if (loads > outlets && (boardsPB || loads >= 3)) {
    const add = powerboardsFor(loads - outlets);
    gaps.push({ kind: 'outlets', text: `${loads} thing${loads > 1 ? 's' : ''} need a mains outlet and ${boardsPB ? `the powerboard${boardsPB > 1 ? 's give' : ' gives'} ${outlets}` : 'there is no powerboard'}: add ${add.length > 1 ? `${add.length} powerboards` : add[0] === 'pb6' ? 'a 6-outlet powerboard' : 'a 4-outlet powerboard'}.`, add });
  }
  // the switch's uplink to your router (its lead leaves the rack): Auto-connect makes it once the switch has boards on it
  if ((hasSwitch || newSwitch) && !(p.links ?? []).some((l) => l.a.module === ROUTER || l.b.module === ROUTER)) gaps.push({ kind: 'uplink', text: 'The switch has no uplink: a lead from it to your router (it leaves the rack).', add: [] });
  return gaps;
}
