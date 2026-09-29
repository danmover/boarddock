// The cluster preset and "Complete this rack": put a cluster on the rack, connect it with Auto-connect, and add what the
// wiring advice still asks for (a switch's own supply, a charger short of ports) until nothing more is asked. One undo step.
import { wiringAdvice } from '../model/links';
import { clusterBoards, clusterName, clusterParts, type ClusterOpts } from '../model/cluster';
import { addAccessory, addLinks } from './linkOps';
import { amend, putBoards, store, toast } from '../state';

/**
 * Add what the wiring advice says the rack still needs (an accessory from the library, or a box's own supply) and connect
 * it, again until nothing is asked for (at most `rounds` times). Returns how many boards it added.
 */
export function completeRack(rounds = 4): number {
  let added = 0;
  for (let i = 0; i < rounds; i++) {
    const p = store.get().project;
    if (!p) break;
    const ask = wiringAdvice(p).filter((a) => a.add);
    if (!ask.length) break;
    const before = p.modules.length;
    for (const a of ask) addAccessory(a.add!, a.count ?? 1);
    const n = (store.get().project?.modules.length ?? before) - before;
    if (!n) break; // asked for something that can't be added: stop
    added += n;
  }
  return added;
}

/**
 * The cluster preset: the Pis, a switch, a powerboard and the supplies on the rack (a new rack, or joining the one open),
 * every free plug connected, and the rest completed. One undo step, one toast.
 */
export function addCluster(o: ClusterOpts) {
  const before = store.get().project, past0 = store.get().past;
  const boards = clusterBoards(o);
  putBoards(boards, false, { stay: true });
  addLinks();
  const extra = completeRack();
  // it was one action: one ⌘Z
  store.set({ past: before ? [...past0.slice(-60), before] : [], future: [], step: 'import', view: 'library' });
  if (!before) amend((q) => { q.name = clusterName(o); }); // (a new rack is named for what it is; no undo step of its own)
  const p = store.get().project!;
  const c = clusterParts(o), pb = c.powerboards.length;
  toast(`Built a ${clusterName(o).replace(/ cluster$/, '')} cluster: ${c.pis.length} Pis${o.poe ? ' with PoE HATs' : ''}, a switch, ${pb > 1 ? `${pb} powerboards` : 'a powerboard'}${c.supplies.length ? `, ${c.supplies.length} supplies` : ''}${extra ? `, and ${extra} more the wiring asked for (the switch's supply)` : ''}; ${p.links?.length ?? 0} cables connected.${before ? ' ⌘Z undoes it all.' : ''}`);
}
