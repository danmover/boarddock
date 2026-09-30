// Turning parts by a typed or snapped angle (the rotation box): each part about its own centre, its body and the way
// its plug points together (the same as R in the board editor does for a group).
import { normDeg } from '../geom/angle';
import { editMod } from '../state';

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Turn these parts by `by` degrees (one undo step). */
export function turnParts(ids: string[], by: number) {
  editMod((m) => {
    for (const c of m.board.comps) {
      if (!ids.includes(c.id)) continue;
      c.rot = r2(normDeg(c.rot + by));
      if (c.conn) c.conn.angle = r2(normDeg(c.conn.angle + by));
    }
  });
}
