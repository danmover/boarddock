// ODB++ (a job folder, usually shipped as a .tgz or .zip). Allegro, OrCAD, PADS, Xpedition, Altium and others
// export it. Read: the step's profile (outline and cut-outs), the drill layers' holes, the component layers
// (comp_+_top / comp_+_bot) with each part's place, turn and pins, and the packages in eda/data for body sizes.
// Units are inch or mm per file (a UNITS line), else the job's misc/info, else inch (the ODB++ default).
import type { Board, Loop, V2 } from '../model/types';
import { arcCenter, outlineFromLoops } from '../geom/poly';
import { finishBoard } from './common';
import { isMountPkg, sortHoles, toComp, type Placed, type RawHole } from './place';
import type { InFile } from './archive';

export interface OdbJob { root: string; step: string; files: InFile[] }

const PROFILE = /^(.*\/)?steps\/([^/]+)\/profile$/i;

/** ODB++ jobs among the files: one per step folder with a profile (a panel step is skipped when a board step exists). */
export function findOdb(all: InFile[]): OdbJob[] {
  const jobs = new Map<string, OdbJob[]>();
  for (const f of all) {
    const m = (f.path ?? f.name).replace(/\\/g, '/').match(PROFILE);
    if (!m) continue;
    const root = m[1] ?? '';
    const files = all.filter((g) => (g.path ?? g.name).replace(/\\/g, '/').toLowerCase().startsWith(root.toLowerCase()));
    if (!jobs.has(root)) jobs.set(root, []);
    jobs.get(root)!.push({ root, step: m[2], files });
  }
  const out: OdbJob[] = [];
  for (const steps of jobs.values()) {
    // prefer the step with parts; a panel (array) step comes last
    const has = (j: OdbJob) => j.files.some((f) => new RegExp(`steps/${esc(j.step)}/layers/comp_\\+_(top|bot)/components$`, 'i').test(norm(f)));
    steps.sort((a, b) => +has(b) - +has(a) || +/panel|array|pnl/i.test(a.step) - +/panel|array|pnl/i.test(b.step));
    out.push(steps[0]);
  }
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (f: InFile) => (f.path ?? f.name).replace(/\\/g, '/');
const dec = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

/** Units of one ODB++ file: its UNITS= / U line, else the job's. Returns mm per unit, and whether it is inch. */
function unitsOf(text: string, dflt: 'MM' | 'INCH'): { k: number; inch: boolean } {
  const m = text.match(/^\s*(?:UNITS\s*=\s*|U\s+)(MM|INCH)\b/im);
  const inch = (m ? m[1].toUpperCase() : dflt) === 'INCH';
  return { k: inch ? 25.4 : 1, inch };
}

/** Contours (OB ... OS / OC ... OE) of a surface: islands and holes as loops. */
function contours(lines: string[], k: number): { loop: Loop; hole: boolean }[] {
  const out: { loop: Loop; hole: boolean }[] = [];
  let cur: V2[] | null = null, hole = false;
  for (const raw of lines) {
    const t = raw.trim().split(/\s+/);
    if (t[0] === 'OB') { cur = [[+t[1] * k, +t[2] * k]]; hole = (t[3] ?? 'I').toUpperCase() === 'H'; }
    else if (t[0] === 'OS' && cur) cur.push([+t[1] * k, +t[2] * k]);
    else if (t[0] === 'OC' && cur) {
      const a = cur[cur.length - 1], e: V2 = [+t[1] * k, +t[2] * k], c: V2 = [+t[3] * k, +t[4] * k];
      const cw = (t[5] ?? 'Y').toUpperCase().startsWith('Y');
      let sw = Math.atan2(e[1] - c[1], e[0] - c[0]) - Math.atan2(a[1] - c[1], a[0] - c[0]);
      if (cw) { while (sw >= 0) sw -= 2 * Math.PI; } else { while (sw <= 0) sw += 2 * Math.PI; }
      if (Math.hypot(e[0] - a[0], e[1] - a[1]) < 1e-9) sw = cw ? -2 * Math.PI : 2 * Math.PI;
      cur.push(...arcCenter(c, a, (sw * 180) / Math.PI).slice(1));
    } else if (t[0] === 'OE' && cur) {
      if (cur.length > 1 && Math.hypot(cur[0][0] - cur[cur.length - 1][0], cur[0][1] - cur[cur.length - 1][1]) < 1e-6) cur.pop();
      if (cur.length >= 3) out.push({ loop: cur, hole });
      cur = null;
    }
  }
  return out;
}

/** Attribute values after the ';' of a record: index -> raw value. */
function recAttrs(line: string): Map<number, string> {
  const m = new Map<number, string>();
  const semi = line.indexOf(';');
  if (semi < 0) return m;
  for (const part of line.slice(semi + 1).split(/[;,]/)) { const q = part.match(/^\s*(\d+)(?:=(.*))?$/); if (q) m.set(+q[1], (q[2] ?? '').trim()); }
  return m;
}

export function importOdb(job: OdbJob, fileName = 'job.tgz'): Board {
  const find = (rel: string) => job.files.find((f) => norm(f).toLowerCase() === (job.root + rel).toLowerCase());
  const text = (rel: string) => { const f = find(rel); return f ? dec(f.bytes) : ''; };
  const info = text('misc/info');
  const dflt: 'MM' | 'INCH' = /^\s*UNITS\s*=\s*MM/im.test(info) ? 'MM' : 'INCH';
  const S = `steps/${job.step}/`;

  // outline
  const prof = text(`${S}profile`);
  if (!prof) throw new Error('The ODB++ job has no profile (board outline).');
  const pk = unitsOf(prof, dflt).k;
  const loops = contours(prof.split('\n'), pk).map((c) => c.loop);
  const ol = outlineFromLoops(loops);
  if (!ol) throw new Error('The ODB++ profile does not form a closed shape.');

  // layers from the matrix (name, type); without one, layer folders are guessed by name
  const matrix = text('matrix/matrix');
  const layers: { name: string; type: string }[] = [];
  for (const blk of matrix.matchAll(/LAYER\s*\{([^}]*)\}/gi)) {
    const g = (k: string) => blk[1].match(new RegExp(`^\\s*${k}\\s*=\\s*(\\S+)`, 'im'))?.[1] ?? '';
    layers.push({ name: g('NAME').toLowerCase(), type: g('TYPE').toUpperCase() });
  }
  const layerDirs = new Set<string>();
  for (const f of job.files) { const m = norm(f).slice(job.root.length).match(new RegExp(`^${esc(S)}layers/([^/]+)/`, 'i')); if (m) layerDirs.add(m[1]); }
  const drills = layers.length ? layers.filter((l) => l.type === 'DRILL').map((l) => l.name) : [...layerDirs].filter((n) => /drill|drl|^d\d|plated|npth|pth/i.test(n));
  const dirName = (n: string) => [...layerDirs].find((d) => d.toLowerCase() === n.toLowerCase()) ?? n;

  // holes
  const raw: RawHole[] = [];
  for (const L of drills) {
    const t = text(`${S}layers/${dirName(L)}/features`);
    if (!t) continue;
    const u = unitsOf(t, dflt);
    const syms = new Map<number, number>(); // symbol index -> diameter, mm
    const attrNames: string[] = [];
    const layerNp = /np|non[_-]?plat|unplat/i.test(L);
    for (const line of t.split('\n')) {
      const s = line.trim();
      let m;
      if ((m = s.match(/^\$(\d+)\s+r([\d.]+)(?:\s+([IM]))?/i))) {
        // round symbols: r<size> in mils (inch files) or microns (mm files); an I / M after the name overrides
        const inch = m[3] ? m[3].toUpperCase() === 'I' : u.inch;
        syms.set(+m[1], +m[2] * (inch ? 0.0254 : 0.001));
      } else if ((m = s.match(/^@(\d+)\s+(\S+)/))) attrNames[+m[1]] = m[2].toLowerCase();
      else if (s.startsWith('P ')) {
        const f = s.split(';')[0].trim().split(/\s+/);
        const sym = +f[3] === -1 ? +f[4] : +f[3];
        const d = syms.get(sym);
        if (!d) continue;
        // the .drill attribute says plated / non_plated / via (as an option index, or spelt out)
        let kind = layerNp ? 'non_plated' : 'plated';
        const di = attrNames.indexOf('.drill');
        const v = di >= 0 ? recAttrs(s).get(di) : undefined;
        if (v != null) kind = /^\d+$/.test(v) ? ['plated', 'non_plated', 'via'][+v] ?? kind : v.toLowerCase();
        raw.push({ x: +f[1] * u.k, y: +f[2] * u.k, d, plated: kind !== 'non_plated', via: kind === 'via' });
      }
    }
  }

  // packages from eda/data: name, bounding box, body outline, pins
  const eda = text(`${S}eda/data`);
  const ek = unitsOf(eda, dflt).k;
  const nets: string[] = [];
  const pkgs: { name: string; body: V2[]; bounds: V2[]; pins: { n: string; at: V2; tht: boolean }[] }[] = [];
  let cur: (typeof pkgs)[number] | null = null, inPin = false, ct: string[] | null = null;
  for (const line of eda.split('\n')) {
    const s = line.trim(), t = s.split(';')[0].trim().split(/\s+/);
    if (t[0] === 'NET') { nets.push(t[1] ?? ''); cur = null; continue; }
    if (t[0] === 'PKG') {
      cur = { name: t[1] ?? '', body: [], bounds: [[+t[3] * ek, +t[4] * ek], [+t[5] * ek, +t[6] * ek]], pins: [] };
      pkgs.push(cur); inPin = false; continue;
    }
    if (!cur) continue;
    if (t[0] === 'PIN') { inPin = true; cur.pins.push({ n: t[1] ?? String(cur.pins.length + 1), at: [+t[3] * ek, +t[4] * ek], tht: (t[2] ?? '').toUpperCase() === 'T' }); continue; }
    if (inPin) continue; // shapes after a PIN are that pin's pad; before the first PIN they are the body
    if (t[0] === 'CT') { ct = []; continue; }
    if (t[0] === 'CE' && ct) { for (const c of contours(ct, ek)) cur.body.push(...c.loop); ct = null; continue; }
    if (ct) { ct.push(s); continue; }
    if (t[0] === 'RC') { const x = +t[1] * ek, y = +t[2] * ek; cur.body.push([x, y], [x + +t[3] * ek, y + +t[4] * ek]); }
    else if (t[0] === 'CR') { const x = +t[1] * ek, y = +t[2] * ek, r = +t[3] * ek; cur.body.push([x - r, y - r], [x + r, y + r]); }
    else if (t[0] === 'SQ') { const x = +t[1] * ek, y = +t[2] * ek, r = +t[3] * ek; cur.body.push([x - r, y - r], [x + r, y + r]); }
  }

  // components on the top and bottom component layers
  const compLayers = (layers.length ? layers.filter((l) => l.type === 'COMPONENT').map((l) => l.name) : [...layerDirs].filter((n) => /^comp_\+_(top|bot)/i.test(n)));
  const placed: ReturnType<typeof toComp>[] = [];
  let noPkg = 0;
  for (const L of compLayers) {
    const t = text(`${S}layers/${dirName(L)}/components`);
    if (!t) continue;
    const u = unitsOf(t, dflt);
    const bottom = /bot/i.test(L);
    const attrNames: string[] = [];
    let pend: { p: Placed; pinsAt: V2[]; nets: string[] } | null = null;
    const flush = () => { if (pend) { pend.p.pinsAt = pend.pinsAt; pend.p.pins = pend.p.pins.map((q, i) => ({ ...q, net: pend!.nets[i] })); placed.push(toComp(pend.p)); } pend = null; };
    for (const line of t.split('\n')) {
      const s = line.trim();
      let m;
      if ((m = s.match(/^@(\d+)\s+(\S+)/))) { attrNames[+m[1]] = m[2].toLowerCase(); continue; }
      const f = s.split(';')[0].trim().split(/\s+/);
      if (f[0] === 'CMP') {
        flush();
        const pkg = pkgs[+f[1]];
        if (!pkg) noPkg++;
        const hi = attrNames.indexOf('.comp_height');
        const h = hi >= 0 ? +(recAttrs(s).get(hi) ?? 0) * u.k : 0;
        const part = f[7] && f[7] !== f[6] ? ` ${f[7]}` : '';
        pend = {
          p: {
            ref: f[6] ?? '?', pkg: `${pkg?.name ?? ''}${part}`.trim(), side: bottom ? 'bottom' : 'top',
            x: +f[2] * u.k, y: +f[3] * u.k,
            rot: -(+f[4] || 0), // ODB++ turns clockwise; BoardDock counter-clockwise
            mirror: (f[5] ?? 'N').toUpperCase() === 'M' || bottom,
            body: pkg?.body.length ? pkg.body : pkg?.bounds ?? [], pads: [], pins: (pkg?.pins ?? []).map((q) => ({ n: q.n, at: q.at })),
            h, tht: pkg?.pins.some((q) => q.tht) ?? false,
          },
          pinsAt: [], nets: [],
        };
      } else if (f[0] === 'PRP' && pend && /^value$/i.test(f[1] ?? '')) {
        const v = s.match(/'([^']*)'/);
        if (v) pend.p.value = v[1];
      } else if ((f[0] === 'TOP' || f[0] === 'BOT') && pend) {
        const i = +f[1];
        pend.pinsAt[i] = [+f[2] * u.k, +f[3] * u.k];
        pend.nets[i] = nets[+f[6]] ?? '';
      }
    }
    flush();
  }

  // board thickness, when the job gives it (.board_thickness in the step's or the job's attribute list)
  let thickness = 1.6;
  for (const rel of [`${S}attrlist`, 'misc/attrlist']) {
    const t = text(rel), m = t.match(/^\s*\.board_thickness\s*=\s*([\d.]+)/im);
    if (m) { thickness = +m[1] * unitsOf(t, dflt).k || thickness; break; }
  }

  const holes = sortHoles(raw, placed);
  const comps = placed.filter((c) => !isMountPkg(c.comp.pkg)).map((c) => c.comp);
  const notes: string[] = [];
  if (!eda) notes.push('The job has no eda/data file, so part sizes are guessed from their names.');
  else if (noPkg) notes.push(`${noPkg} part${noPkg > 1 ? 's' : ''} named a package missing from eda/data: sizes guessed.`);
  if (!drills.length) notes.push('The job has no drill layer: add mounting holes by hand.');
  if (!compLayers.length) notes.push('The job has no component layers (comp_+_top / comp_+_bot): add connectors by hand.');
  const jobName = info.match(/^\s*JOB_NAME\s*=\s*(.+)$/im)?.[1]?.trim() || job.root.replace(/\/$/, '').split('/').pop() || fileName.replace(/\.(tgz|tar\.gz|tar|zip)$/i, '');
  const board: Board = { name: jobName, outline: ol.outline, cutouts: ol.cutouts, thickness, holes, comps, source: `ODB++: ${fileName} (step ${job.step})`, notes };
  return finishBoard(board, { sizesKnown: true, heightsKnown: true });
}
