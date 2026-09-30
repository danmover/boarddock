// Auto-arrange on a layout with locks: docks and rails that are locked stay exactly as they are, and every other board is
// seated again the way a board added to a hand-made layout is (a free slot in a dock where its plugs stay reachable,
// pairs back to back, else a new dock on a rail that is not locked; the boards connected to each other side by side).
import type { Project } from '../model/types';
import { lockedDocks } from '../model/locks';
import { isPlugPack } from '../model/powerdata';
import { orderByLinks, seatBoard, seatCompanions } from './dockplan';

/**
 * Seat again every board that is not in a locked dock, on a layout laid out by hand (write an automatic one down first).
 * Docks that are not locked go, empty ones too; locked docks and rails are not touched, and nothing goes in a locked
 * dock's free slot or on a locked rail. Mutates the project; returns the ids of the boards it seated.
 */
export function arrangeAround(p: Project): string[] {
  const P = p.panel, docks = lockedDocks(p);
  P.mounts = P.mounts.filter((mt) => docks.has(mt.id));
  const held = new Set(P.mounts.flatMap((mt) => mt.slots.map((s) => s.module)));
  // a board stacked on another rides on its holder; a plug pack lives in an outlet: neither has a dock
  const todo = p.modules.filter((m) => !held.has(m.id) && !m.on && !isPlugPack(m.board));
  const ids = orderByLinks(p, todo).map((m) => m.id);
  for (const id of ids) seatBoard(p, id);
  seatCompanions(p);
  return ids;
}
