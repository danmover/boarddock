// Slicing in the browser with Kiri:Moto (MIT, https://github.com/GridSpace/grid-apps), built into public/kiri by
// vendor/kiri/build.mjs. The engine loads on first use and slices in its own worker plus a pool of helpers, so the
// app stays responsive. Out comes plain G-code, or a .gcode.3mf for Bambu Lab printers.
import { zipSync, strToU8 } from 'fflate';
import type { Material, MeshData, PrinterSettings } from '../model/types';
import { printerByName } from '../model/printers';
import { writeStl } from '../cad/export';
import { kiriDevice, kiriProcess, machinePlan, roundRoom, type MachinePlan } from './profiles';
import { bambuVars, renderTemplate, type TplValue } from './bambutpl';
import { usableCode, usablePlain } from './startcheck';

const kiriBase = () => new URL('kiri/', document.baseURI).href;

let profilesP: Promise<Record<string, any>> | null = null;
/** Kiri:Moto's printer profiles that BoardDock uses (public/kiri/profiles.json). */
export function kiriProfiles(): Promise<Record<string, any>> {
  return (profilesP ??= fetch(kiriBase() + 'profiles.json')
    .then((r) => {
      if (!r.ok) throw new Error(`printer profiles missing (${r.status})`);
      return r.json();
    })
    .catch((e) => {
      profilesP = null;
      throw e;
    }));
}

export interface SliceJob { meshes: MeshData[]; printer: PrinterSettings; material: Material; brim: boolean; density: number; base: string }
export interface Sliced { gcode: string; seconds: number; filament: number; grams: number; layers: number; plan: MachinePlan; file: string; bytes: Uint8Array; round: 'brim' | 'skirt' | 'none' }

let busy = false;
export const slicing = () => busy;

/** Slice one plate. `onProgress(fraction, what)` follows the engine's own progress. */
export async function slicePlate(job: SliceJob, onProgress: (f: number, what: string) => void): Promise<Sliced> {
  if (busy) throw new Error('Another plate is still slicing');
  busy = true;
  try {
    const pr = printerByName(job.printer.name);
    // the printer's own code only once it has passed the check (a project can hold code from before, or from another printer)
    const { own, why } = usableCode(job.printer, job.material);
    const plan = machinePlan(pr, job.printer.name, own?.from);
    if (plan.fit === 'none') throw new Error(why ? `The start code loaded for this printer isn't used, so there is none to slice with. ${why}` : plan.note ?? 'No start code for this printer');
    // start and end code typed in over the profile's own: only once it has passed the check too
    const typed: { why?: string } = own ? {} : usablePlain(job.printer, job.material);
    if (typed.why) throw new Error(`The start or end code typed in isn't used, so there is none to slice with. ${typed.why}`);
    onProgress(0, 'Loading the slicer');
    const [kiri, profiles] = await Promise.all([import(/* @vite-ignore */ kiriBase() + 'kiri-engine.js'), kiriProfiles()]);
    const profile = own ? null : plan.kiri ? (profiles[plan.kiri] ?? null) : null;
    if (!own && plan.kiri && !profile) throw new Error(`Kiri:Moto profile ${plan.kiri} is missing`);
    const eng = kiri.newEngine({ workURL: kiriBase() + 'kiri-worker.js', poolURL: kiriBase() + 'kiri-pool.js' });
    eng.setController({ threaded: true }); // spread slicing over the helper workers (off in the bare engine)
    eng.setListener((m: any) => {
      if (typeof m.slice?.update === 'number') onProgress(0.05 + 0.5 * m.slice.update, 'Slicing layers');
      else if (typeof m.prepare?.update === 'number') onProgress(0.55 + 0.35 * m.prepare.update, 'Planning the moves');
      else if (m.export) onProgress(0.93, 'Writing G-code');
    });
    await eng.parse(writeStl(job.meshes).buffer);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = 0;
    for (const m of job.meshes) for (let i = 0; i < m.pos.length; i += 3) { x0 = Math.min(x0, m.pos[i]); x1 = Math.max(x1, m.pos[i]); y0 = Math.min(y0, m.pos[i + 1]); y1 = Math.max(y1, m.pos[i + 1]); z1 = Math.max(z1, m.pos[i + 2]); }
    eng.settings.bounds = { min: { x: -(x1 - x0) / 2, y: -(y1 - y0) / 2, z: 0 }, max: { x: (x1 - x0) / 2, y: (y1 - y0) / 2, z: z1 } };
    // the printer's own code goes in after slicing, when the first layer and the height are known: markers for now
    // (Bambu's part fan is P1; Bambu output marks its objects)
    const device = own ? { ...kiriDevice(plan, null, { ...job.printer, gcodeStart: MARK_START, gcodeEnd: MARK_END }, job.material), gcodeLayer: [], gcodeFan: ['M106 P1 S{fan_speed}'], extras: { bbl: {} } } : kiriDevice(plan, profile, job.printer, job.material);
    // the skirt or brim only where the bed has room for it round the plate (Kiri:Moto puts the plate in the middle of the
    // bed, so the room is the same on both sides)
    const room = Math.min(job.printer.bed[0] - (x1 - x0), job.printer.bed[1] - (y1 - y0)) / 2;
    const proc = kiriProcess(pr, job.material, job.brim);
    const round = room < roundRoom(job.brim) ? 'none' : job.brim ? 'brim' : 'skirt';
    if (round === 'none') Object.assign(proc, { outputBrimCount: 0, outputBrimOffset: 0 });
    eng.setMode('FDM').setDevice(device).setProcess(proc);
    await eng.slice();
    await eng.prepare();
    let gcode: string = await eng.export();
    if (own) gcode = withOwnCode(gcode, own, job.printer, job.material);
    const st = gcodeStats(gcode, job.density);
    if (!st.layers || /^G[01] [^;\n]*(NaN|Infinity|undefined)/m.test(gcode)) throw new Error('The slicer returned broken G-code');
    const bambu = plan.firmware === 'bambu';
    const name = `${job.base}.gcode${bambu ? '.3mf' : ''}`;
    const bytes = bambu ? bambu3mf(gcode, st, ...(await plateImages(job.meshes, [512, 128]))) : strToU8(gcode);
    onProgress(1, 'Done');
    return { gcode, ...st, plan, file: name, bytes, round };
  } finally {
    busy = false;
  }
}

export const MARK_START = ';; BoardDock: start code', MARK_END = ';; BoardDock: end code';

/** Kiri:Moto's G-code with the printer's own start, end and layer-change code filled in and put where the markers
 * are, and the progress (M73) at every layer, as Bambu's printers show it. Refuses code it can't fill in. */
export function withOwnCode(gcode: string, own: NonNullable<PrinterSettings['bambu']>, ps: PrinterSettings, mat: Material): string {
  const layers = gcodeLayers(gcode);
  if (!layers.length) throw new Error('The slicer returned no layers');
  const first = layers[0].segs;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < first.length; i += 2) { x0 = Math.min(x0, first[i]); x1 = Math.max(x1, first[i]); y0 = Math.min(y0, first[i + 1]); y1 = Math.max(y1, first[i + 1]); }
  // (the printer levels this area: never past the bed)
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(ps.bed[0], x1); y1 = Math.min(ps.bed[1], y1);
  const z1 = layers[layers.length - 1].z, n = (gcode.match(/^;; --- layer \d+/gm) ?? []).length;
  const seconds = Number(/; --- print time: (\d+)s/.exec(gcode)?.[1] ?? 0);
  const vars = bambuVars(ps, mat, { x0, y0, x1, y1, z1, layers: n });
  const fill = (t: string | undefined, extra: Record<string, TplValue> = {}) => {
    if (!t) return '';
    const r = renderTemplate(t, { ...vars, ...extra });
    if (r.unknown.length) throw new Error(`The printer's own code uses ${r.unknown.join(', ')}, which BoardDock can't fill in yet. Slice this plate in Bambu Studio or OrcaSlicer, or remove those lines from the code you loaded.`);
    return r.text;
  };
  const start = fill(own.start), end = fill(own.end);
  const out: string[] = [];
  for (const line of gcode.split('\n')) {
    if (line.trim() === MARK_START) {
      // the header Bambu's printers read (layers, time), then the printer's own start code
      out.push('; HEADER_BLOCK_START', '; BoardDock (Kiri:Moto engine)', `; model printing time: ${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ${seconds % 60}s`, `; total layer number: ${n}`, `; max_z_height: ${Math.round(z1 * 100) / 100}`, '; HEADER_BLOCK_END');
      out.push('; ---- start code: the printer\'s own, from ' + own.from, start, '; ---- end of the start code');
      continue;
    }
    if (line.trim() === MARK_END) { out.push('; ---- end code: the printer\'s own', end); continue; }
    out.push(line);
    const m = /^;; --- layer (\d+)/.exec(line);
    if (m) {
      const k = Number(m[1]);
      out.push(`M73 P${Math.floor((100 * k) / Math.max(1, n))} R${Math.max(0, Math.round((seconds * (1 - k / Math.max(1, n))) / 60))}`);
      if (own.layer) out.push(fill(own.layer, { layer_num: k, layer_z: layers[Math.min(k, layers.length - 1)]?.z ?? 0 }));
    }
  }
  return out.join('\n');
}

/** Time, filament and layers from the summary Kiri:Moto writes at the end, and the layer markers. */
export function gcodeStats(gcode: string, density: number) {
  const filament = Number(/; --- filament used: ([\d.]+) mm/.exec(gcode)?.[1] ?? 0);
  const seconds = Number(/; --- print time: (\d+)s/.exec(gcode)?.[1] ?? 0);
  const layers = (gcode.match(/^;; --- layer \d+/gm) ?? []).length;
  const grams = (filament * Math.PI * 0.875 ** 2 * density) / 1000; // 1.75 mm filament
  return { filament, seconds, layers, grams };
}

/** Extruding moves per layer, for the preview: [x0, y0, x1, y1, ...] in bed millimetres. */
export function gcodeLayers(gcode: string): { z: number; segs: Float32Array }[] {
  const out: { z: number; segs: Float32Array }[] = [];
  let cur: number[] | null = null, z = 0, x = 0, y = 0, e = 0, absXY = true, absE = false;
  const flush = () => { if (cur) out.push({ z, segs: new Float32Array(cur) }); };
  for (const line of gcode.split('\n')) {
    if (line.startsWith(';; --- layer ')) { flush(); cur = []; continue; }
    const c = line.indexOf(';'), cmd = (c < 0 ? line : line.slice(0, c)).trim();
    if (!cmd) continue;
    const w = cmd.split(/\s+/), g = w[0];
    if (g === 'G90') absXY = true;
    else if (g === 'G91') absXY = false;
    else if (g === 'M82') absE = true;
    else if (g === 'M83') absE = false;
    else if (g === 'G92') { for (const t of w.slice(1)) if (t[0] === 'E') e = Number(t.slice(1)); }
    else if (g === 'G0' || g === 'G1') {
      let nx = x, ny = y, de = 0;
      for (const t of w.slice(1)) {
        const v = Number(t.slice(1));
        if (t[0] === 'X') nx = absXY ? v : x + v;
        else if (t[0] === 'Y') ny = absXY ? v : y + v;
        else if (t[0] === 'Z') z = absXY ? v : z + v;
        else if (t[0] === 'E') { de = absE ? v - e : v; e = absE ? v : e + v; }
      }
      if (cur && de > 0 && (nx !== x || ny !== y)) cur.push(x, y, nx, ny);
      x = nx; y = ny;
    }
  }
  flush();
  return out.filter((l) => l.segs.length);
}

/** Top-down pictures of the plate for the Bambu printer screen: drawn once at the first size, scaled for the rest. */
async function plateImages(meshes: MeshData[], sizes: [number, number]): Promise<[Uint8Array, Uint8Array]> {
  const big = plateCanvas(meshes, sizes[0]);
  const small = document.createElement('canvas');
  small.width = small.height = sizes[1];
  const g = small.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(big, 0, 0, sizes[1], sizes[1]);
  const png = async (cv: HTMLCanvasElement) => new Uint8Array(await ((await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/png'))) ?? new Blob()).arrayBuffer());
  return [await png(big), await png(small)];
}

function plateCanvas(meshes: MeshData[], size: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = 0;
  for (const m of meshes) for (let i = 0; i < m.pos.length; i += 3) { x0 = Math.min(x0, m.pos[i]); x1 = Math.max(x1, m.pos[i]); y0 = Math.min(y0, m.pos[i + 1]); y1 = Math.max(y1, m.pos[i + 1]); z1 = Math.max(z1, m.pos[i + 2]); }
  const s = (0.9 * size) / Math.max(x1 - x0, y1 - y0, 1), ox = (size - (x1 - x0) * s) / 2, oy = (size - (y1 - y0) * s) / 2;
  const tris: { z: number; pts: number[]; shade: number }[] = [];
  for (const m of meshes) for (let t = 0; t < m.idx.length; t += 3) {
    const a = m.idx[t] * 3, b = m.idx[t + 1] * 3, c = m.idx[t + 2] * 3, P = m.pos;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vz = P[c + 2] - P[a + 2];
    const nz = ux * vy - uy * vx, nl = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, nz) || 1;
    if (nz <= 0) continue;
    tris.push({ z: Math.max(P[a + 2], P[b + 2], P[c + 2]), shade: nz / nl, pts: [P[a], P[a + 1], P[b], P[b + 1], P[c], P[c + 1]] });
  }
  tris.sort((p, q) => p.z - q.z);
  for (const t of tris) {
    const k = Math.round(90 + 120 * (t.z / (z1 || 1)) * 0.5 + 60 * t.shade);
    g.fillStyle = g.strokeStyle = `rgb(${k},${Math.round(k * 0.62)},${Math.round(k * 0.25)})`;
    g.beginPath();
    for (let i = 0; i < 6; i += 2) g[i ? 'lineTo' : 'moveTo'](ox + (t.pts[i] - x0) * s, size - oy - (t.pts[i + 1] - y0) * s);
    g.closePath(); g.fill(); g.stroke();
  }
  return cv;
}

/**
 * The .gcode.3mf Bambu Lab printers take: G-code plus the metadata the printer reads. Follows Kiri:Moto's own
 * writer (src/kiri/app/export.js, gen3mf; MIT).
 */
export function bambu3mf(gcode: string, info: { seconds: number; grams: number }, img: Uint8Array, small: Uint8Array): Uint8Array {
  const ymd = new Date().toISOString().slice(0, 10);
  const g = strToU8(gcode);
  const xml = (...l: string[]) => strToU8(['<?xml version="1.0" encoding="UTF-8"?>', ...l].join('\n'));
  return zipSync({
    '[Content_Types].xml': xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">', ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>', ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>', ' <Default Extension="gcode" ContentType="application/octet-stream"/>', ' <Default Extension="png" ContentType="image/png"/>', '</Types>'),
    '_rels/.rels': xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">', ' <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>', '</Relationships>'),
    '3D/3dmodel.model': xml('<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">', ' <metadata name="Application">BoardDock (Kiri:Moto engine)</metadata>', ` <metadata name="CreationDate">${ymd}</metadata>`, ` <metadata name="ModificationDate">${ymd}</metadata>`, ' <resources>', ' </resources>', ' <build/>', '</model>'),
    'Metadata/_rels/model_settings.config.rels': xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">', ' <Relationship Target="/Metadata/plate_1.gcode" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/gcode"/>', '</Relationships>'),
    'Metadata/model_settings.config': xml('<config>', '  <plate>', '    <metadata key="plater_id" value="1"/>', '    <metadata key="plater_name" value=""/>', '    <metadata key="locked" value="false"/>', '    <metadata key="gcode_file" value="Metadata/plate_1.gcode"/>', '    <metadata key="thumbnail_file" value="Metadata/plate_1.png"/>', '    <metadata key="thumbnail_no_light_file" value="Metadata/plate_no_light_1.png"/>', '    <metadata key="top_file" value="Metadata/top_1.png"/>', '    <metadata key="pick_file" value="Metadata/pick_1.png"/>', '  </plate>', '</config>'),
    'Metadata/slice_info.config': xml('<config>', '  <header>', '    <header_item key="X-BBL-Client-Type" value="slicer"/>', '    <header_item key="X-BBL-Client-Version" value="01.10.01.50"/>', '  </header>', '  <plate>', '    <metadata key="index" value="1"/>', '    <metadata key="nozzle_diameters" value="0.4"/>', '    <metadata key="timelapse_type" value="0"/>', `    <metadata key="prediction" value="${Math.round(info.seconds)}"/>`, `    <metadata key="weight" value="${info.grams.toFixed(2)}"/>`, '    <metadata key="outside" value="false"/>', '    <metadata key="support_used" value="false"/>', '    <metadata key="label_object_enabled" value="false"/>', '  </plate>', '</config>'),
    'Metadata/project_settings.config': strToU8('{}'),
    'Metadata/plate_1.gcode': g,
    'Metadata/plate_1.gcode.md5': strToU8(md5(g)),
    'Metadata/plate_1.png': img,
    'Metadata/plate_no_light_1.png': img,
    'Metadata/top_1.png': img,
    'Metadata/pick_1.png': img,
    'Metadata/plate_1_small.png': small,
  });
}

const MD5_K = Int32Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0);
const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
/** MD5 as lowercase hex (Bambu printers check the G-code against it). */
export function md5(data: Uint8Array): string {
  const n = data.length, blocks = ((n + 8) >> 6) + 1, buf = new Uint8Array(blocks * 64);
  buf.set(data);
  buf[n] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(blocks * 64 - 8, (n * 8) >>> 0, true);
  dv.setUint32(blocks * 64 - 4, Math.floor(n / 0x20000000), true);
  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
  const M = new Int32Array(16);
  for (let off = 0; off < buf.length; off += 64) {
    for (let j = 0; j < 16; j++) M[j] = dv.getInt32(off + j * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
      else { F = C ^ (B | ~D); g = (7 * i) & 15; }
      F = (F + A + MD5_K[i] + M[g]) | 0;
      A = D; D = C; C = B;
      const s = MD5_S[(i >> 4) * 4 + (i & 3)];
      B = (B + ((F << s) | (F >>> (32 - s)))) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((v, i) => out.setInt32(i * 4, v, true));
  return Array.from(new Uint8Array(out.buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}
