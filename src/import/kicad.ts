// KiCad .kicad_pcb importer (KiCad 5 to 9). Reads the Edge.Cuts outline, board thickness, footprints
// (courtyard -> body size), pads with drills (mounting holes, through-hole leads) and 3D model names.
import type { Board, Comp, Hole, Loop, V2 } from '../model/types';
import { arc3, arcCenter, bezier, chainLoops, outlineFromLoops, rad, uid } from '../geom/poly';
import { finishBoard } from './common';

export type SNode = string | SNode[];

export function parseSexpr(src: string): SNode[] {
  const out: SNode[] = [];
  const stack: SNode[][] = [out];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === '(') {
      const node: SNode[] = [];
      stack[stack.length - 1].push(node);
      stack.push(node);
      i++;
    } else if (ch === ')') {
      stack.pop();
      if (!stack.length) throw new Error('Unbalanced parentheses');
      i++;
    } else if (ch === '"') {
      let j = i + 1, s = '';
      while (j < n && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < n) { s += src[j + 1]; j += 2; } else s += src[j++];
      }
      stack[stack.length - 1].push(s);
      i = j + 1;
    } else if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') i++;
    else {
      let j = i;
      while (j < n && !' \n\r\t()"'.includes(src[j])) j++;
      stack[stack.length - 1].push(src.slice(i, j));
      i = j;
    }
  }
  return out;
}

const isNode = (x: SNode): x is SNode[] => Array.isArray(x);
const head = (x: SNode) => (isNode(x) && typeof x[0] === 'string' ? (x[0] as string) : '');
export const kids = (x: SNode[], name: string) => x.filter((c) => head(c) === name) as SNode[][];
export const kid = (x: SNode[], name: string) => x.find((c) => head(c) === name) as SNode[] | undefined;
const nums = (x: SNode[] | undefined): number[] => (x ? x.slice(1).filter((v) => typeof v === 'string').map(Number).filter((v) => !isNaN(v)) : []);
const pt = (x: SNode[] | undefined): V2 => { const v = nums(x); return [v[0] ?? 0, v[1] ?? 0]; };
const layerOf = (x: SNode[]) => { const l = kid(x, 'layer'); return l ? String(l[1]) : ''; };

/** Geometry primitive (line/arc/circle/rect/poly/curve) as polylines in the item's own frame (KiCad y-down). */
function primitivePaths(g: SNode[]): V2[][] {
  const h = head(g).replace(/^(gr|fp)_/, '');
  const s = pt(kid(g, 'start')), e = pt(kid(g, 'end'));
  switch (h) {
    case 'line': return [[s, e]];
    case 'arc': {
      const mid = kid(g, 'mid');
      if (mid) return [arc3(s, pt(mid), e)];
      // KiCad 5: start = centre, end = arc start, angle in degrees (clockwise on screen = CCW in y-down numbers)
      const ang = nums(kid(g, 'angle'))[0] ?? 0;
      return [arcCenter(s, e, ang)];
    }
    case 'circle': {
      const c = pt(kid(g, 'center')), r = Math.hypot(e[0] - c[0], e[1] - c[1]);
      return [arcCenter(c, [c[0] + r, c[1]], 360)];
    }
    case 'rect': return [[s, [e[0], s[1]], e, [s[0], e[1]], s]];
    case 'poly': {
      const pts = kids(kid(g, 'pts') ?? [], 'xy').map((p) => pt(p));
      return pts.length > 1 ? [[...pts, pts[0]]] : [];
    }
    case 'curve': {
      const p = kids(kid(g, 'pts') ?? [], 'xy').map((q) => pt(q));
      return p.length === 4 ? [bezier(p[0], p[1], p[2], p[3])] : [];
    }
  }
  return [];
}

export function importKicad(text: string, fileName = 'board.kicad_pcb'): Board {
  const root = parseSexpr(text)[0];
  if (!isNode(root) || !/kicad_pcb/.test(head(root))) throw new Error('Not a KiCad board file');
  const general = kid(root, 'general');
  const thickness = nums(kid(general ?? [], 'thickness'))[0] || 1.6;
  const title = kid(kid(root, 'title_block') ?? [], 'title');
  const name = (title && String(title[1])) || fileName.replace(/\.kicad_pcb$/i, '');

  // KiCad is y-down; convert to y-up by negating y
  const up = (p: V2): V2 => [p[0], -p[1]];
  const edgePaths: V2[][] = [];
  for (const g of root) {
    if (!isNode(g) || !/^gr_/.test(head(g)) || layerOf(g) !== 'Edge.Cuts') continue;
    for (const path of primitivePaths(g)) edgePaths.push(path.map(up));
  }

  const comps: Comp[] = [];
  const holes: Hole[] = [];
  const notes: string[] = [];
  for (const fp of root) {
    if (!isNode(fp) || (head(fp) !== 'footprint' && head(fp) !== 'module')) continue;
    const fpName = String(fp[1]);
    const at = nums(kid(fp, 'at'));
    const fx = at[0] ?? 0, fy = at[1] ?? 0, frot = at[2] ?? 0;
    const bottom = layerOf(fp).startsWith('B.');
    const a = rad(frot), ca = Math.cos(a), sa = Math.sin(a);
    // local (y-down) -> board (y-up): flip local y, rotate CCW by frot, translate
    const toBoard = (p: V2): V2 => { const lx = p[0], ly = -p[1]; return [fx + lx * ca - ly * sa, -fy + lx * sa + ly * ca]; };
    const toLocalUp = (p: V2): V2 => [p[0], -p[1]];

    let ref = '', value = '';
    for (const t of kids(fp, 'fp_text')) {
      if (t[1] === 'reference') ref = String(t[2]);
      if (t[1] === 'value') value = String(t[2]);
    }
    for (const p of kids(fp, 'property')) {
      if (p[1] === 'Reference') ref = String(p[2]);
      if (p[1] === 'Value') value = String(p[2]);
    }
    const models = kids(fp, 'model').map((m) => String(m[1]).split(/[\\/]/).pop() ?? '').join(' ');

    // body extents in the footprint frame: courtyard, else fab, else pads
    const crt: V2[] = [], fab: V2[] = [];
    for (const g of fp) {
      if (!isNode(g) || !/^fp_/.test(head(g)) || head(g) === 'fp_text') continue;
      const L = layerOf(g);
      const paths = primitivePaths(g);
      if (L === 'Edge.Cuts') for (const path of paths) edgePaths.push(path.map(toBoard));
      if (/CrtYd/.test(L)) for (const path of paths) crt.push(...path.map(toLocalUp));
      if (/Fab/.test(L)) for (const path of paths) fab.push(...path.map(toLocalUp));
    }
    const padPts: V2[] = [];
    let tht = false;
    const isMountFp = /mountinghole|mounting_hole|mount_hole|mtg|^hole/i.test(fpName.split(':').pop() ?? '');
    const padsList = kids(fp, 'pad');
    for (const pad of padsList) {
      const kind = String(pad[2]);
      const pAt = nums(kid(pad, 'at'));
      const size = nums(kid(pad, 'size'));
      const local: V2 = [pAt[0] ?? 0, pAt[1] ?? 0];
      const lu = toLocalUp(local);
      padPts.push([lu[0] - (size[0] ?? 0) / 2, lu[1] - (size[1] ?? 0) / 2], [lu[0] + (size[0] ?? 0) / 2, lu[1] + (size[1] ?? 0) / 2]);
      const drill = kid(pad, 'drill');
      if (!drill || kind === 'smd' || kind === 'connect') continue;
      const dv = nums(drill);
      const d = drill.includes('oval') ? Math.min(dv[0] ?? 0, dv[1] ?? dv[0] ?? 0) : dv[0] ?? 0;
      if (!d) continue;
      const plated = kind === 'thru_hole';
      if (plated && !isMountFp) tht = true;
      const [bx, by] = toBoard(local);
      const mountable = isMountFp || (!plated && d >= 2.0 && padsList.length <= 2) || (d >= 2.5 && padsList.length <= 2);
      if (mountable) holes.push({ id: uid('h'), x: bx, y: by, d, plated, use: 'auto' });
    }
    if (isMountFp) continue;
    const src = crt.length >= 2 ? crt : fab.length >= 2 ? fab : padPts;
    if (src.length < 2) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of src) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const shrink = crt.length >= 2 ? 0.25 : 0; // courtyard includes a 0.25 mm margin
    const w = Math.max(0.3, x1 - x0 - 2 * shrink), l = Math.max(0.3, y1 - y0 - 2 * shrink);
    const cLocal: V2 = [(x0 + x1) / 2, (y0 + y1) / 2];
    const c: V2 = [fx + cLocal[0] * ca - cLocal[1] * sa, -fy + cLocal[0] * sa + cLocal[1] * ca];
    comps.push({
      id: uid('c'), ref: ref || '?', pkg: `${fpName.split(':').pop()} ${models}`.trim(), value,
      side: bottom ? 'bottom' : 'top', x: c[0], y: c[1], rot: frot, w, l, h: 0, kind: 'generic', tht,
    });
  }

  const loops = chainLoops(edgePaths, 0.02);
  const ol = outlineFromLoops(loops);
  if (!ol) throw new Error('No closed board outline on Edge.Cuts');
  if (loops.length && edgePaths.length && loops.length === 0) notes.push('Edge.Cuts did not close; check the outline.');
  const board: Board = { name, outline: ol.outline as Loop, cutouts: ol.cutouts, thickness, holes, comps, source: `KiCad: ${fileName}`, notes };
  return finishBoard(board, { sizesKnown: true });
}
