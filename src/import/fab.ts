// Fabrication outputs, which every EDA tool can export (Altium, KiCad, Eagle/Fusion, EasyEDA, OrCAD, DipTrace...):
//   - Gerber RS-274X board outline (Edge.Cuts / .GKO / .GM1 / profile)
//   - Excellon NC drill (plated and non-plated)
//   - Pick & place / centroid / .pos (component positions, packages, sides)
import type { Board, Comp, Hole, V2 } from '../model/types';
import { arcPts, bbox, chainLoops, inside, outlineFromLoops, uid } from '../geom/poly';
import { finishBoard } from './common';

// ---------------- Gerber ----------------
export interface GerberResult { paths: V2[][]; isProfile: boolean; units: 'mm' | 'in' }

export function parseGerber(text: string): GerberResult {
  let intD = 3, decD = 6, zeroOmit: 'L' | 'T' = 'L', absolute = true;
  let scale = 1; // to mm
  let units: 'mm' | 'in' = 'mm';
  let x = 0, y = 0, interp = 1, multiQuadrant = true;
  const paths: V2[][] = [];
  let cur: V2[] | null = null;
  const isProfile = /%TF\.FileFunction,Profile/i.test(text);
  const num = (s: string) => {
    if (s.includes('.')) return parseFloat(s) * scale;
    const neg = s.startsWith('-');
    let d = s.replace(/^[+-]/, '');
    if (zeroOmit === 'T') d = d.padEnd(intD + decD, '0');
    const v = parseInt(d, 10) / 10 ** decD;
    return (neg ? -v : v) * scale;
  };
  const flush = () => { if (cur && cur.length > 1) paths.push(cur); cur = null; };
  // split into commands; extended (%...%) blocks may contain several '*'-terminated commands
  const tokens = text.replace(/\r/g, '').split(/(%[^%]*%)/);
  for (const tok of tokens) {
    if (tok.startsWith('%')) {
      const body = tok.slice(1, -1);
      let m;
      if ((m = body.match(/FS([LTD])?([AI])?X(\d)(\d)Y(\d)(\d)/))) {
        zeroOmit = m[1] === 'T' ? 'T' : 'L';
        absolute = m[2] !== 'I';
        intD = +m[3];
        decD = +m[4];
      }
      if (/MOIN/.test(body)) { scale = 25.4; units = 'in'; }
      if (/MOMM/.test(body)) { scale = 1; units = 'mm'; }
      continue;
    }
    for (let cmd of tok.split('*')) {
      cmd = cmd.trim().replace(/\s+/g, '');
      if (!cmd) continue;
      if (/^G04/.test(cmd) || /^M0[02]/.test(cmd)) { if (/^M0[02]/.test(cmd)) flush(); continue; }
      if (/G70/.test(cmd)) { scale = 25.4; units = 'in'; }
      if (/G71/.test(cmd)) { scale = 1; units = 'mm'; }
      if (/G74/.test(cmd)) multiQuadrant = false;
      if (/G75/.test(cmd)) multiQuadrant = true;
      const g = cmd.match(/G0?([123])(?!\d)/);
      if (g) interp = +g[1];
      if (/G3[67]/.test(cmd)) flush();
      const cx = cmd.match(/X([+-]?[\d.]+)/), cy = cmd.match(/Y([+-]?[\d.]+)/);
      const ci = cmd.match(/I([+-]?[\d.]+)/), cj = cmd.match(/J([+-]?[\d.]+)/);
      const d = cmd.match(/D0?([123])(?!\d)/);
      let nx = x, ny = y;
      if (cx) nx = absolute ? num(cx[1]) : x + num(cx[1]);
      if (cy) ny = absolute ? num(cy[1]) : y + num(cy[1]);
      const op = d ? +d[1] : cx || cy ? 1 : 0; // coordinate without D is a modal D01 in old files
      if (op === 2) { flush(); x = nx; y = ny; continue; }
      if (op === 3) { flush(); x = nx; y = ny; continue; }
      if (op !== 1) continue;
      if (!cur) cur = [[x, y]];
      if (interp === 1) cur.push([nx, ny]);
      else {
        const I = ci ? num(ci[1]) : 0, J = cj ? num(cj[1]) : 0;
        cur.push(...gerberArc([x, y], [nx, ny], I, J, interp === 3, multiQuadrant).slice(1));
      }
      x = nx;
      y = ny;
    }
  }
  flush();
  return { paths, isProfile, units };
}

function gerberArc(s: V2, e: V2, I: number, J: number, ccwDir: boolean, multi: boolean): V2[] {
  let c: V2 = [s[0] + I, s[1] + J];
  if (!multi) {
    // single-quadrant: I/J unsigned, pick the centre that is equidistant and gives <= 90 deg
    let best = c, err = Infinity;
    for (const [si, sj] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const cc: V2 = [s[0] + si * Math.abs(I), s[1] + sj * Math.abs(J)];
      const d = Math.abs(Math.hypot(s[0] - cc[0], s[1] - cc[1]) - Math.hypot(e[0] - cc[0], e[1] - cc[1]));
      if (d < err) { err = d; best = cc; }
    }
    c = best;
  }
  const r = Math.hypot(s[0] - c[0], s[1] - c[1]);
  const a0 = Math.atan2(s[1] - c[1], s[0] - c[0]);
  let a1 = Math.atan2(e[1] - c[1], e[0] - c[0]);
  let sweep = a1 - a0;
  if (ccwDir) { if (sweep <= 1e-9) sweep += Math.PI * 2; } else if (sweep >= -1e-9) sweep -= Math.PI * 2;
  if (!multi && Math.abs(sweep) > Math.PI / 2 + 1e-3) sweep = ccwDir ? sweep - Math.PI * 2 : sweep + Math.PI * 2;
  return arcPts(c[0], c[1], r, a0, sweep);
}

// ---------------- Excellon ----------------
export interface DrillHit { x: number; y: number; d: number; plated: boolean }

export function parseExcellon(text: string, platedHint?: boolean): DrillHit[] {
  let metric = true, lz = true;
  let intD = 3, decD = 3;
  const tools = new Map<string, number>();
  let tool = '';
  let plated = platedHint ?? !/NPTH|NON[_ -]?PLATED|TYPE=NON_PLATED|FileFunction,NonPlated/i.test(text);
  const hits: DrillHit[] = [];
  let x = 0, y = 0;
  let fmtSeen = false;
  const val = (s: string) => {
    let v: number;
    if (s.includes('.')) v = parseFloat(s);
    else {
      const neg = s.startsWith('-');
      let d = s.replace(/^[+-]/, '');
      if (lz) d = d.padEnd(intD + decD, '0'); // leading zeros kept, trailing suppressed
      v = parseInt(d, 10) / 10 ** decD;
      if (neg) v = -v;
    }
    return metric ? v : v * 25.4;
  };
  for (let line of text.replace(/\r/g, '').split('\n')) {
    line = line.trim();
    if (!line) continue;
    let m;
    if ((m = line.match(/FILE_FORMAT=(\d):(\d)/i))) { intD = +m[1]; decD = +m[2]; fmtSeen = true; }
    if (/TYPE=PLATED/i.test(line)) plated = true;
    if (/TYPE=NON_PLATED/i.test(line)) plated = false;
    if (line.startsWith(';')) continue;
    if ((m = line.match(/^(METRIC|INCH)(?:,(LZ|TZ))?(?:,(0*)\.(0*))?/))) {
      metric = m[1] === 'METRIC';
      if (m[2]) lz = m[2] === 'LZ';
      if (m[3] !== undefined && m[4] !== undefined) { intD = m[3].length; decD = m[4].length; fmtSeen = true; }
      else if (!fmtSeen) { intD = metric ? 3 : 2; decD = metric ? 3 : 4; }
      continue;
    }
    if (/^M71/.test(line)) { metric = true; if (!fmtSeen) { intD = 3; decD = 3; } }
    if (/^M72/.test(line)) { metric = false; if (!fmtSeen) { intD = 2; decD = 4; } }
    if ((m = line.match(/^T(\d+)(?:F[\d.]+|S[\d.]+|B[\d.]+|H[\d.]+|Z[+-]?[\d.]+)*C([\d.]+)/))) {
      tools.set(String(+m[1]), metric ? parseFloat(m[2]) : parseFloat(m[2]) * 25.4);
      continue;
    }
    if ((m = line.match(/^T(\d+)$/))) { tool = String(+m[1]); continue; }
    const mx = line.match(/X([+-]?[\d.]+)/), my = line.match(/Y([+-]?[\d.]+)/);
    if ((mx || my) && !/^G0?0|^M15|^M16/.test(line)) {
      // G85 slot: first coordinate pair is the start, keep only the start (a slot is not a mounting hole)
      const first = line.split('G85')[0];
      const fx = first.match(/X([+-]?[\d.]+)/), fy = first.match(/Y([+-]?[\d.]+)/);
      if (fx) x = val(fx[1]);
      if (fy) y = val(fy[1]);
      const d = tools.get(tool);
      if (d) hits.push({ x, y, d, plated });
    } else if (mx || my) {
      if (mx) x = val(mx[1]);
      if (my) y = val(my[1]);
    }
  }
  return hits;
}

/** Excellon files without explicit format guess wrong by powers of ten; pick the scale that puts holes on the board. */
export function fitHoles(hits: DrillHit[], outline: V2[]): DrillHit[] {
  if (!hits.length) return hits;
  const b = bbox(outline);
  let best = hits, bestScore = -1;
  for (const k of [1, 10, 0.1, 100, 0.01, 25.4, 1 / 25.4]) {
    const s = hits.map((h) => ({ ...h, x: h.x * k, y: h.y * k }));
    const score = s.filter((h) => h.x >= b.x0 - 0.5 && h.x <= b.x1 + 0.5 && h.y >= b.y0 - 0.5 && h.y <= b.y1 + 0.5).length;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}

// ---------------- Pick & place ----------------
export interface Placement { ref: string; pkg: string; value: string; x: number; y: number; rot: number; side: 'top' | 'bottom' }

export function parsePnP(text: string): Placement[] {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  const splitLine = (l: string): string[] => {
    if (l.includes('\t')) return l.split('\t').map((s) => s.trim().replace(/^"|"$/g, ''));
    if (l.includes(',')) return (l.match(/("([^"]*)"|[^,]*)(,|$)/g) ?? []).map((s) => s.replace(/,$/, '').trim().replace(/^"|"$/g, '')).filter((_, i, a) => i < a.length - 1 || a[i] !== '');
    return l.trim().split(/\s+/);
  };
  let unitMil = /unit\s*=\s*(mil|inch)/i.test(text) || /\(mil\)/i.test(text);
  let hdr = -1;
  let cols: string[] = [];
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const c = splitLine(lines[i].replace(/^#\s*/, '')).map((s) => s.toLowerCase());
    if (c.some((s) => /^(designator|ref|refdes|reference|part|component|name)/.test(s)) && c.some((s) => /(^x$|mid ?x|center-?x|posx|pos x|ref ?x|x\s*\(|^x[(\s])/.test(s))) {
      hdr = i;
      cols = c;
      break;
    }
  }
  const find = (...res: RegExp[]) => { for (const re of res) { const k = cols.findIndex((c) => re.test(c)); if (k >= 0) return k; } return -1; };
  let iRef = 0, iX = 1, iY = 2, iRot = 3, iPkg = -1, iVal = -1, iSide = -1;
  if (hdr >= 0) {
    iRef = find(/^designator/, /^ref/, /^part/, /^component/, /^name/);
    iX = find(/mid ?x/, /center-?x/, /^posx/, /^pos x/, /^x\b/, /^x\s*\(/, /ref ?x/);
    iY = find(/mid ?y/, /center-?y/, /^posy/, /^pos y/, /^y\b/, /^y\s*\(/, /ref ?y/);
    iRot = find(/^rot/, /angle/, /orient/);
    iPkg = find(/footprint/, /^package/, /pattern/, /^pkg/);
    iVal = find(/^val/, /comment/, /^part ?number/, /description/);
    iSide = find(/^side/, /^layer/, /^tb$/);
    if (cols.some((c) => /\(mil\)|mils/.test(c))) unitMil = true;
  }
  const out: Placement[] = [];
  for (let i = hdr + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith('#') || /^(designator|ref)/i.test(lines[i].trim())) continue;
    const c = splitLine(lines[i]);
    const pn = (s?: string) => {
      if (!s) return NaN;
      const v = parseFloat(s.replace(/mm|mil/i, ''));
      return /mil/i.test(s) ? v * 0.0254 : v;
    };
    const x = pn(c[iX]), y = pn(c[iY]);
    if (!c[iRef] || isNaN(x) || isNaN(y)) continue;
    const sideRaw = iSide >= 0 ? (c[iSide] ?? '') : '';
    out.push({
      ref: c[iRef], pkg: iPkg >= 0 ? c[iPkg] ?? '' : hdr < 0 ? c[5] ?? '' : '', value: iVal >= 0 ? c[iVal] ?? '' : hdr < 0 ? c[4] ?? '' : '',
      x: unitMil ? x * 0.0254 : x, y: unitMil ? y * 0.0254 : y, rot: parseFloat(c[iRot]) || 0,
      side: /^(b|bot|bottom|bottomlayer|bottom layer)$/i.test(sideRaw.trim()) || /bottom/i.test(sideRaw) ? 'bottom' : 'top',
    });
  }
  return out;
}

// ---------------- combine ----------------
export interface FabFiles { name: string; text: string }

export function classifyFabFile(f: FabFiles): 'outline' | 'gerber' | 'drill' | 'pnp' | 'other' {
  const n = f.name.toLowerCase();
  const t = f.text.slice(0, 4000);
  if (/\.(drl|xln|exc|drd|tap|nc)$/.test(n) || (/^M48/m.test(t) && /T\d+C[\d.]/.test(f.text.slice(0, 20000)))) return 'drill';
  if (/%FS|G04|%MO/.test(t)) {
    if (/edge[_.-]?cuts|outline|profile|\.gko$|\.gm1$|\.gml$|\.gm$|\.oln$|boardoutline|mechanical ?1|keep-?out/.test(n) || /FileFunction,Profile/i.test(t)) return 'outline';
    return 'gerber';
  }
  if (/(pos|pnp|pick|place|centroid|cpl|xy|mnt|assembly).*\.(csv|txt|pos|tsv|xy)$|\.pos$|\.mnt$|\.mnb$/.test(n) || /designator|refdes|mid ?x|center-?x|posx/i.test(t)) return 'pnp';
  return 'other';
}

export function importFab(files: FabFiles[], name = 'Board'): Board {
  const outlineFiles = files.filter((f) => classifyFabFile(f) === 'outline');
  if (!outlineFiles.length) throw new Error('No board outline Gerber found (Edge.Cuts, .GKO, .GM1 or a Profile file).');
  let loops: V2[][] = [];
  for (const f of outlineFiles) {
    const g = parseGerber(f.text);
    loops = loops.concat(chainLoops(g.paths, 0.05));
    if (loops.length) break;
  }
  const ol = outlineFromLoops(loops);
  if (!ol) throw new Error('The outline Gerber does not form a closed shape.');
  const notes: string[] = [];
  const holes: Hole[] = [];
  const leadPts: DrillHit[] = [];
  for (const f of files.filter((f) => classifyFabFile(f) === 'drill')) {
    const hits = fitHoles(parseExcellon(f.text, /npth|non[_ -]?plated/i.test(f.name) ? false : undefined), ol.outline);
    for (const h of hits) {
      if (!inside([h.x, h.y], ol.outline)) continue;
      if (h.d >= 2.0 || (!h.plated && h.d >= 1.9)) holes.push({ id: uid('h'), x: h.x, y: h.y, d: h.d, plated: h.plated, use: 'auto' });
      else if (h.plated && h.d >= 0.6) leadPts.push(h);
    }
  }
  const comps: Comp[] = [];
  const pnp = files.filter((f) => classifyFabFile(f) === 'pnp').flatMap((f) => parsePnP(f.text));
  if (pnp.length) {
    // PnP files sometimes use a different origin: if most parts fall outside, shift by the bbox difference
    const inCount = pnp.filter((p) => inside([p.x, p.y], ol.outline)).length;
    let dx = 0, dy = 0;
    if (inCount < pnp.length * 0.6) {
      const bo = bbox(ol.outline), bp = bbox(pnp.map((p) => [p.x, p.y] as V2));
      dx = (bo.x0 + bo.x1) / 2 - (bp.x0 + bp.x1) / 2;
      dy = (bo.y0 + bo.y1) / 2 - (bp.y0 + bp.y1) / 2;
      notes.push('Pick-and-place origin differed from the Gerber origin; parts were centred on the board. Check positions.');
    }
    for (const p of pnp) comps.push({ id: uid('c'), ref: p.ref, pkg: p.pkg, value: p.value, side: p.side, x: p.x + dx, y: p.y + dy, rot: p.rot, w: 0, l: 0, h: 0, kind: 'generic', tht: false });
  } else notes.push('No pick-and-place file: add components (connectors, tall parts) by hand, or import a PnP/centroid file.');
  // through-hole lead points mark THT parts (leads stick out under the board)
  const board: Board = { name, outline: ol.outline, cutouts: ol.cutouts, thickness: 1.6, holes, comps, source: `Gerber/drill: ${files.map((f) => f.name).join(', ')}`, notes };
  const off = bbox(ol.outline); // finishBoard moves the board so its bbox starts at 0,0
  const done = finishBoard(board, { sizesKnown: false });
  for (const h0 of leadPts) {
    const h = { x: h0.x - off.x0, y: h0.y - off.y0, d: h0.d };
    const owner = done.comps.find((c) => Math.abs(h.x - c.x) < c.w / 2 + 1.5 && Math.abs(h.y - c.y) < c.l / 2 + 1.5);
    if (owner) owner.tht = true;
    else done.comps.push({ id: uid('c'), ref: 'THT', pkg: `lead ${h.d.toFixed(2)}`, side: 'top', x: h.x, y: h.y, rot: 0, w: h.d + 0.6, l: h.d + 0.6, h: 0, kind: 'generic', tht: true, hidden: true });
  }
  if (leadPts.length) done.notes.push(`${leadPts.length} through-hole leads found: they set the clearance under the board.`);
  done.notes.push('Board thickness is not in Gerbers: 1.6 mm assumed.');
  return done;
}
