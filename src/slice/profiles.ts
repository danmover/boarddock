// What BoardDock hands Kiri:Moto for a slice: the machine (bed, start/end G-code) and the process (the settings from
// printers.ts turned into Kiri's names). Pure data, no engine: src/slice/kiri.ts runs it.
//
// Start/end G-code comes from Kiri:Moto's own printer profiles where it has one for the printer (public/kiri/
// profiles.json, see vendor/kiri/build.mjs), otherwise from a plain template for the firmware that heats, homes and
// primes. Neither has been run on a real printer by BoardDock, which the UI says.
import type { Material, PrinterSettings, V2 } from '../model/types';
import { FILAMENTS, type Printer } from '../model/printers';

export type Fit = 'exact' | 'close' | 'generic' | 'none';
export interface MachinePlan {
  fit: Fit;
  kiri?: string; // Kiri:Moto profile id in profiles.json
  firmware: 'bambu' | 'marlin' | 'klipper';
  label: string; // where the start/end code comes from, for the UI
  note?: string;
}

const PROFILED: Record<string, { kiri: string; fit: Fit; note?: string }> = {
  'Bambu Lab P1S': { kiri: 'Bambu.P1S', fit: 'exact' },
  'Bambu Lab A1': { kiri: 'Bambu.A1', fit: 'exact' },
  'Bambu Lab X1 Carbon': { kiri: 'Bambu.P1S', fit: 'close', note: 'Kiri:Moto has no X1 Carbon profile, so this uses its P1S start code (same motion system). Watch the start of the first print.' },
  'Prusa MK3S+': { kiri: 'Prusa.i3.MK3S+', fit: 'exact' },
  'Prusa MINI+': { kiri: 'Prusa.mini', fit: 'exact' },
  'Creality K1C': { kiri: 'Creality.K1', fit: 'close', note: "Uses Kiri:Moto's K1 profile: same bed and the same START_PRINT macro." },
};
const UNSUPPORTED: Record<string, string> = {
  'Bambu Lab A1 mini': "It needs the A1 mini's own start code, which comes with Bambu Studio and OrcaSlicer: load it below (the desktop app reads it from your slicer), and BoardDock fills it in for every print.",
  'Prusa XL': 'The XL is a tool changer: its start code has to pick up a tool, which plain start code cannot do safely. Slice it in PrusaSlicer.',
};

/** Where this printer's start/end G-code comes from, or why BoardDock will not slice for it. `own`: the printer's
 * own code from the user's Bambu Studio or OrcaSlicer (where it came from), which beats every other source. */
export function machinePlan(pr: Printer | null, name: string, own?: string): MachinePlan {
  const firmware = pr?.firmware ?? 'marlin';
  if (own && firmware === 'bambu') return { fit: 'exact', firmware, label: `The ${name}'s own start code`, note: `From ${own}, filled in for each print (temperatures, plate, the area to level, the height). Bambu's own code, so it knows this printer; BoardDock hasn't run it on one.` };
  if (UNSUPPORTED[name]) return { fit: 'none', firmware, label: 'Not available', note: UNSUPPORTED[name] };
  const hit = PROFILED[name];
  if (hit) return { fit: hit.fit, kiri: hit.kiri, firmware, label: `Kiri:Moto's ${hit.kiri.replace(/\./g, ' ').replace('i3 ', '')} profile`, note: hit.note };
  if (firmware === 'bambu') return { fit: 'none', firmware, label: 'Not available', note: "Bambu printers need Bambu's own start code: load it below from Bambu Studio or OrcaSlicer." };
  return {
    fit: 'generic',
    firmware,
    label: `Plain ${firmware === 'klipper' ? 'Klipper' : 'Marlin'} start code`,
    note: `Heats, homes and draws a purge line; ${firmware === 'klipper' ? 'if your printer has a PRINT_START macro, put it in instead' : 'it loads a saved bed mesh if there is one (M420 S1) but does not probe'}. Check it against your slicer's start code before the first print.`,
  };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Plain start code: heat, home, prime along the left edge. Kiri fills in {temp} and {bed_temp}. */
export function genericStart(firmware: 'marlin' | 'klipper', bed: V2): string[] {
  const y1 = r1(Math.min(bed[1] - 20, 120));
  return [
    '; BoardDock plain start code: check it against your own slicer start code',
    'G90 ; absolute XYZ',
    'M83 ; relative extrusion',
    'M140 S{bed_temp} ; bed on',
    'M104 S150 ; warm the nozzle without oozing',
    'G28 ; home',
    ...(firmware === 'marlin' ? ['M420 S1 ; use the saved bed mesh, if any'] : []),
    'M190 S{bed_temp} ; wait for the bed',
    'M104 S{temp}',
    'M109 S{temp} ; wait for the nozzle',
    'G92 E0',
    'G1 Z2 F3000',
    'G1 X3 Y20 F6000',
    'G1 Z0.3 F600',
    `G1 Y${y1} E${r1(((y1 - 20) * 0.45 * 0.3) / 2.405 * 1.1)} F1200 ; purge line`,
    'G1 X3.6 F600',
    `G1 Y20 E${r1(((y1 - 20) * 0.45 * 0.3) / 2.405)} F1200`,
    'G92 E0',
    'G1 Z1 F600',
  ];
}

export function genericEnd(bed: V2): string[] {
  return [
    'G91',
    'G1 E-1 F1800 ; retract',
    'G1 Z10 F600 ; lift',
    'G90',
    `G1 X5 Y${r1(bed[1] - 5)} F3000 ; present the plate`,
    'M104 S0',
    'M140 S0',
    'M106 S0',
    'M84',
  ];
}

/** Kiri:Moto process settings for BoardDock parts: printers.ts' settings in Kiri's names. */
export function kiriProcess(pr: Printer | null, mat: Material, brim: boolean): Record<string, number | string | boolean> {
  const f = FILAMENTS[mat];
  const fast = pr?.kind === 'corexy', bowden = pr?.extruder === 'bowden';
  return {
    processName: 'BoardDock',
    // design: 0.2 mm steps, two 0.45 mm lines per hinge leaf, no supports
    sliceHeight: 0.2,
    firstSliceHeight: 0.2,
    sliceLineWidth: 0.45,
    sliceSupportType: 'disabled',
    // conventions (see printers.ts)
    sliceShells: 3,
    sliceShellOrder: 'in-out',
    // thin-wall detection off: Kiri's "basic" mode merges walls closer than a line width (and checks every pair of
    // points, which is slow); the springs must stay two full lines
    sliceDetectThin: 'off',
    sliceTopLayers: 5,
    sliceBottomLayers: 4,
    sliceFillSparse: 0.15,
    // grid, not gyroid: Kiri slices a plate about 4 times faster (7 s against 27 s for a 7-board rack's first plate)
    // for the same print time and filament to a gram or two; the springs and clips are all walls anyway
    sliceFillType: 'grid',
    sliceLayerStart: 'origin', // seams line up toward one corner instead of wandering
    outputBrimCount: brim ? 7 : 1, // brim: seven 0.45 mm loops (~3 mm) touching the part; else one skirt loop
    outputBrimOffset: brim ? 0 : 3,
    // filament (OrcaSlicer generic profile)
    outputTemp: f.nozzle,
    firstLayerNozzleTemp: f.nozzleFirst,
    outputBedTemp: f.bed,
    firstLayerBedTemp: f.bedFirst,
    outputFanSpeed: Math.round((255 * f.fan[0]) / 100), // the fan for normal layers; Kiri slows short layers down instead
    firstLayerFanSpeed: 0,
    outputFanLayer: 1,
    outputMaxFlowrate: f.flow,
    // machine
    outputRetractDist: pr?.retraction ?? (bowden ? 3.2 : 0.8),
    outputFeedrate: bowden ? 60 : fast ? 200 : 120, // capped by the filament's volumetric limit anyway
    outputFinishrate: bowden ? 35 : fast ? 80 : 50, // outer walls
    outputSeekrate: bowden ? 120 : fast ? 300 : 180,
    firstLayerRate: 25,
    firstLayerFillRate: 30,
  };
}

/** The machine for Kiri: a stock profile (bed from the project) or the plain templates, plus any start/end code the
 * user typed in. `@MATERIAL@` in a Bambu profile becomes the filament type. */
export function kiriDevice(plan: MachinePlan, profile: Record<string, any> | null, ps: PrinterSettings, mat: Material): Record<string, unknown> {
  const bed = ps.bed;
  // every machine field set every time: Kiri keeps its device settings between slices, so a Bambu profile's
  // extras or layer code must never leak into the next printer's G-code
  const blank = { extruders: [{ extFilament: 1.75, extNozzle: 0.4, extOffsetX: 0, extOffsetY: 0 }], gcodeFan: ['M106 S{fan_speed}'], gcodeLayer: [] as string[], gcodeTrack: [], gcodeFeature: [], gcodeFExt: 'gcode', extrudeAbs: false, fwRetract: false, extras: {} };
  const base = { ...blank, ...(profile ? structuredClone(profile) : {}) };
  // Kiri writes its own ";; --- layer" marker only when a profile has no layer code; BoardDock reads layers by it
  if (base.gcodeLayer.length) base.gcodeLayer = [';; --- layer {layer} ---', ...base.gcodeLayer];
  const pre: string[] = ps.gcodeStart?.trim() ? ps.gcodeStart.split('\n') : profile ? profile.gcodePre : genericStart(plan.firmware === 'klipper' ? 'klipper' : 'marlin', bed);
  const post: string[] = ps.gcodeEnd?.trim() ? ps.gcodeEnd.split('\n') : profile ? profile.gcodePost : genericEnd(bed);
  return {
    ...base,
    mode: 'FDM',
    bedWidth: bed[0],
    bedDepth: bed[1],
    maxHeight: ps.maxZ ?? 250,
    originCenter: false,
    gcodePre: pre.map((l) => l.replace(/@MATERIAL@/g, mat)),
    gcodePost: post.map((l) => l.replace(/@MATERIAL@/g, mat)),
  };
}

/** Start and end code as the editor shows it before the user changes anything. */
export function defaultCode(plan: MachinePlan, profile: Record<string, any> | null, ps: PrinterSettings): { start: string; end: string } {
  return {
    start: (profile ? profile.gcodePre : genericStart(plan.firmware === 'klipper' ? 'klipper' : 'marlin', ps.bed)).join('\n'),
    end: (profile ? profile.gcodePost : genericEnd(ps.bed)).join('\n'),
  };
}
