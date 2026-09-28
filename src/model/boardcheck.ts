// Does a board, as drawn, make a holder that works? The things that quietly spoil one: a hole off the board or so
// near its edge that the pin under it hangs off, a hole under a part, two holes on top of each other, a plug whose
// mouth sits back from the edge (a plug can't reach it through the holder's wall) or faces into the board, a part off
// the board, a thickness no board has. Each comes with what to do and, where it is safe, a fix that does it. Fixes
// never move a real board's holes (they are where they are): a hole in the wrong place is set to "not used".
// Pure.
import type { Board, Comp, Hole } from './types';
import { bbox, compRect, extentAlong, inside, nearestEdge, rad, rayExit, round, uid } from '../geom/poly';
import { shapeProblem } from '../geom/shape';
import { connById } from './library';
import { isMountHole } from './holes';

export interface BoardIssue {
  id: string; // stable for the same problem, so a list can keep its place
  level: 'bad' | 'warn' | 'info';
  text: string;
  fix?: { label: string; apply: (b: Board) => void }; // edits the board in place (inside an undo step)
  at?: { hole?: string; comp?: string }; // what to select to show it
}

const STD = [2.2, 2.5, 2.7, 2.75, 3.2, 3.4, 4.3]; // M2, 2.5 tight, M2.5, Pi, M3, M3 loose, M4
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const plugNm = (c: Comp) => `${c.ref}${c.conn ? ` (${connById(c.conn.type)?.name ?? c.conn.type})` : ''}`;
const hNm = (h: Hole) => `The hole at (${round(h.x, 1)}, ${round(h.y, 1)})`;

/** How far a plug's mouth sits back from the board edge it faces (negative: past it), and how far the edge is. */
export function mouthGap(b: Board, c: Comp): { gap: number; edge: number } | null {
  if (!c.conn || c.conn.entry !== 'edge') return null;
  const a = rad(c.conn.angle), d: [number, number] = [Math.cos(a), Math.sin(a)];
  if (!inside([c.x, c.y], b.outline)) return null;
  const edge = rayExit([c.x, c.y], d, b.outline), ext = extentAlong(c, c.conn.angle);
  return Number.isFinite(edge) ? { gap: edge - ext, edge } : null;
}

export function boardIssues(b: Board): BoardIssue[] {
  if (b.kind === 'box') return [];
  const out: BoardIssue[] = [];
  const shape = shapeProblem(b.outline, b.cutouts);
  if (shape) out.push({ id: 'shape', level: 'bad', text: `The outline: ${shape}. Use Shape in the toolbar to fix its corners.` });
  if (b.thickness < 0.4 || b.thickness > 5) out.push({ id: 'thick', level: 'warn', text: `${round(b.thickness, 2)} mm is not a board's thickness (most are 1.6, some 0.8 or 1.0).`, fix: { label: 'Make it 1.6 mm', apply: (q) => { q.thickness = 1.6; } } });

  const top = b.comps.filter((c) => !c.hidden && c.side === 'top' && c.h > 0.3);
  const holes = b.holes;
  holes.forEach((h, i) => {
    const used = h.use !== 'none';
    const onBoard = inside([h.x, h.y], b.outline) && !b.cutouts.some((cu) => inside([h.x, h.y], cu));
    if (!onBoard) {
      out.push({ id: `hole-off:${h.id}`, level: 'bad', text: `${hNm(h)} is off the board.`, fix: { label: 'Remove it', apply: (q) => { q.holes = q.holes.filter((x) => x.id !== h.id); } }, at: { hole: h.id } });
      return;
    }
    const e = nearestEdge([h.x, h.y], b.outline).d, need = h.d / 2 + 0.8;
    if (used && isMountHole(h) && e < need) out.push({ id: `hole-edge:${h.id}`, level: 'warn', text: `${hNm(h)} is ${round(e, 1)} mm from the edge: the pin or post under it would hang off the board. If it really is there on your board, leave it out.`, fix: { label: 'Don’t use it', apply: (q) => { const x = q.holes.find((y) => y.id === h.id); if (x) x.use = 'none'; } }, at: { hole: h.id } });
    const over = top.find((c) => inside([h.x, h.y], compRect(c, -0.2)));
    if (used && isMountHole(h) && over) out.push({ id: `hole-under:${h.id}`, level: 'warn', text: `${over.ref} sits over ${hNm(h).toLowerCase().replace(/^the/, 'the')}: nothing can come up through it. One of them is in the wrong place, or leave the hole out.`, fix: { label: 'Don’t use the hole', apply: (q) => { const x = q.holes.find((y) => y.id === h.id); if (x) x.use = 'none'; } }, at: { hole: h.id } });
    for (const g of holes.slice(i + 1)) if (dist([h.x, h.y], [g.x, g.y]) < (h.d + g.d) / 2 - 0.1) {
      const keep = h.d >= g.d ? h : g, drop = keep === h ? g : h;
      out.push({ id: `hole-twice:${h.id}:${g.id}`, level: 'warn', text: `Two holes overlap at (${round(h.x, 1)}, ${round(h.y, 1)}): probably the same hole twice.`, fix: { label: 'Keep one', apply: (q) => { q.holes = q.holes.filter((x) => x.id !== drop.id); } }, at: { hole: drop.id } });
    }
    const near = STD.reduce((a, s) => (Math.abs(s - h.d) < Math.abs(a - h.d) ? s : a), STD[0]);
    if (used && isMountHole(h) && Math.abs(near - h.d) > 0.02 && Math.abs(near - h.d) <= 0.2) out.push({ id: `hole-size:${h.id}`, level: 'info', text: `${hNm(h)} is Ø${round(h.d, 2)}: close to the usual Ø${near}. Measured holes often read a little off.`, fix: { label: `Make it Ø${near}`, apply: (q) => { const x = q.holes.find((y) => y.id === h.id); if (x) x.d = near; } }, at: { hole: h.id } });
  });

  for (const c of b.comps) {
    if (c.hidden) continue;
    if (!inside([c.x, c.y], b.outline)) {
      out.push({ id: `part-off:${c.id}`, level: 'bad', text: `${c.ref} is off the board.`, fix: { label: 'Remove it', apply: (q) => { q.comps = q.comps.filter((x) => x.id !== c.id); } }, at: { comp: c.id } });
      continue;
    }
    const m = mouthGap(b, c);
    if (!m) continue;
    // a plug facing into the board: its mouth is far from the edge that way and close the other way
    const back = mouthGap(b, { ...c, conn: { ...c.conn!, angle: c.conn!.angle + 180 } } as Comp);
    if (back && m.gap > 6 && back.gap < 1.5) {
      out.push({ id: `plug-in:${c.id}`, level: 'bad', text: `${plugNm(c)} faces into the board: its mouth should face the edge it sits on.`, fix: { label: 'Turn it round', apply: (q) => { const x = q.comps.find((y) => y.id === c.id); if (x?.conn) x.conn.angle = (x.conn.angle + 180) % 360; } }, at: { comp: c.id } });
      continue;
    }
    const over = connById(c.conn!.type)?.overhang ?? 0.5;
    if (m.gap > 1.5) {
      const a = rad(c.conn!.angle), dx = Math.cos(a) * (m.gap + over), dy = Math.sin(a) * (m.gap + over);
      out.push({ id: `plug-back:${c.id}`, level: 'warn', text: `${plugNm(c)}'s mouth is ${round(m.gap, 1)} mm in from the edge: a plug can't reach it through the holder's wall. Plugs like it stick out about ${round(over, 1)} mm past the edge.`, fix: { label: 'Move it to the edge', apply: (q) => { const x = q.comps.find((y) => y.id === c.id); if (x) { x.x = round(x.x + dx, 3); x.y = round(x.y + dy, 3); } } }, at: { comp: c.id } });
    }
  }

  // parts on top of each other
  for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
    const A = bbox(compRect(top[i])), B = bbox(compRect(top[j]));
    const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0), oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
    if (ox <= 0.5 || oy <= 0.5) continue;
    const small = Math.min((A.x1 - A.x0) * (A.y1 - A.y0), (B.x1 - B.x0) * (B.y1 - B.y0));
    if (ox * oy > 0.35 * small) out.push({ id: `parts-over:${top[i].id}:${top[j].id}`, level: 'warn', text: `${top[i].ref} and ${top[j].ref} sit on top of each other. Check where each really is.`, at: { comp: top[j].id } });
  }

  // nothing to hold it by
  if (!holes.some((h) => h.use !== 'none' && isMountHole(h))) {
    const bb = bbox(b.outline), w = bb.x1 - bb.x0, hgt = bb.y1 - bb.y0;
    out.push({
      id: 'no-holes', level: 'info', text: 'No mounting holes: the holder holds it by its edges with its spring clips. Making this board yourself? You can add M3 holes in its corners.',
      ...(w >= 20 && hgt >= 20 ? { fix: { label: 'Add corner holes', apply: (q: Board) => { q.holes.push(...cornerHoles(q)); } } } : {}),
    });
  }
  return out;
}

/** M3 holes 3.5 mm in from each corner of the board's box, where the board is there and no part is. */
export function cornerHoles(b: Board): Hole[] {
  const bb = bbox(b.outline), inset = 3.5, d = 3.2;
  const want: [number, number][] = [[bb.x0 + inset, bb.y0 + inset], [bb.x1 - inset, bb.y0 + inset], [bb.x0 + inset, bb.y1 - inset], [bb.x1 - inset, bb.y1 - inset]];
  return want
    .filter(([x, y]) => inside([x, y], b.outline) && nearestEdge([x, y], b.outline).d >= d / 2 + 1 && !b.comps.some((c) => !c.hidden && c.side === 'top' && inside([x, y], compRect(c, d / 2 + 0.5))) && !b.holes.some((h) => dist([h.x, h.y], [x, y]) < 4))
    .map(([x, y]) => ({ id: uid('h'), x: round(x, 2), y: round(y, 2), d, plated: true, use: 'auto' as const }));
}

/** Every fix at once (the safe ones: nothing is removed but what is off the board or doubled). */
export function fixAll(b: Board): number {
  let n = 0;
  for (;;) {
    // one at a time: one fix can change the rest
    const next = boardIssues(b).find((x) => x.fix && x.id !== 'no-holes' && !x.id.startsWith('hole-size'));
    if (!next || n >= 60) return n;
    next.fix!.apply(b);
    n++;
  }
}
