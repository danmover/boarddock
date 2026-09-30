// Printers and filaments. Printer geometry comes from the machine profiles in OrcaSlicer's open profile library
// (resources/profiles/<vendor>/machine/*.json) and the makers' own specs; filament temperatures, fans and flow from
// OrcaSlicer's generic filament base profiles. Everything else BoardDock recommends is either set by the design of
// the parts (a hinge leaf of two 0.45 mm lines, no supports) or a common slicing convention, and says which.
import type { Material } from './types';

export interface Printer {
  name: string;
  bed: [number, number];
  maxZ: number;
  kind: 'corexy' | 'bedslinger';
  extruder: 'direct' | 'bowden';
  firmware: 'bambu' | 'marlin' | 'klipper';
  orca: string; // machine preset name in OrcaSlicer (and Bambu Studio for Bambu Lab printers)
  slicers: string[]; // slicers that ship a profile for it, the maker's own first
  maxNozzle?: number; // °C, the maker's spec (used to check start code someone pastes in)
  maxBed?: number; // °C, the maker's spec (the most any mains voltage gives)
  retraction?: number; // mm, from the vendor profile
  accel?: number; // mm/s², max while extruding, from the vendor profile
  source: string;
  aliases?: string[]; // older names in saved projects
}

const ORCA = 'https://github.com/OrcaSlicer/OrcaSlicer/tree/main/resources/profiles';

export const PRINTERS_DB: Printer[] = [
  { name: 'Bambu Lab X1 Carbon', bed: [256, 256], maxZ: 256, kind: 'corexy', extruder: 'direct', firmware: 'bambu', maxNozzle: 300, maxBed: 120, orca: 'Bambu Lab X1 Carbon 0.4 nozzle', slicers: ['Bambu Studio', 'OrcaSlicer'], retraction: 0.8, accel: 20000, source: `${ORCA}/BBL/machine`, aliases: ['Bambu Lab X1 / P1 / A1'] },
  { name: 'Bambu Lab P1S', bed: [256, 256], maxZ: 256, kind: 'corexy', extruder: 'direct', firmware: 'bambu', maxNozzle: 300, maxBed: 100, orca: 'Bambu Lab P1S 0.4 nozzle', slicers: ['Bambu Studio', 'OrcaSlicer'], retraction: 0.8, accel: 20000, source: `${ORCA}/BBL/machine` },
  { name: 'Bambu Lab A1', bed: [256, 256], maxZ: 256, kind: 'bedslinger', extruder: 'direct', firmware: 'bambu', maxNozzle: 300, maxBed: 100, orca: 'Bambu Lab A1 0.4 nozzle', slicers: ['Bambu Studio', 'OrcaSlicer'], accel: 12000, source: `${ORCA}/BBL/machine` },
  { name: 'Bambu Lab A1 mini', bed: [180, 180], maxZ: 180, kind: 'bedslinger', extruder: 'direct', firmware: 'bambu', maxNozzle: 300, maxBed: 80, orca: 'Bambu Lab A1 mini 0.4 nozzle', slicers: ['Bambu Studio', 'OrcaSlicer'], source: `${ORCA}/BBL/machine` },
  { name: 'Prusa CORE One', bed: [250, 220], maxZ: 270, kind: 'corexy', extruder: 'direct', firmware: 'marlin', orca: 'Prusa CORE One 0.4 nozzle', slicers: ['PrusaSlicer', 'OrcaSlicer'], source: `${ORCA}/Prusa/machine` },
  { name: 'Prusa MK4S / MK4', bed: [250, 210], maxZ: 220, kind: 'bedslinger', extruder: 'direct', firmware: 'marlin', orca: 'Prusa MK4S 0.4 nozzle', slicers: ['PrusaSlicer', 'OrcaSlicer'], source: `${ORCA}/Prusa/machine`, aliases: ['Prusa MK4 / MK3S'] },
  { name: 'Prusa MK3S+', bed: [250, 210], maxZ: 210, kind: 'bedslinger', extruder: 'direct', firmware: 'marlin', orca: 'Prusa MK3S 0.4 nozzle', slicers: ['PrusaSlicer', 'OrcaSlicer'], retraction: 0.8, source: `${ORCA}/Prusa/machine` },
  { name: 'Prusa MINI+', bed: [180, 180], maxZ: 180, kind: 'bedslinger', extruder: 'bowden', firmware: 'marlin', orca: 'Prusa MINI 0.4 nozzle', slicers: ['PrusaSlicer', 'OrcaSlicer'], retraction: 3.2, accel: 1250, source: `${ORCA}/Prusa/machine`, aliases: ['Prusa MINI'] },
  { name: 'Prusa XL', bed: [360, 360], maxZ: 360, kind: 'corexy', extruder: 'direct', firmware: 'marlin', orca: 'Prusa XL 0.4 nozzle', slicers: ['PrusaSlicer', 'OrcaSlicer'], source: `${ORCA}/Prusa/machine` },
  { name: 'Creality K1C', bed: [220, 220], maxZ: 250, kind: 'corexy', extruder: 'direct', firmware: 'klipper', orca: 'Creality K1C 0.4 nozzle', slicers: ['Creality Print', 'OrcaSlicer'], retraction: 0.8, accel: 20000, source: `${ORCA}/Creality/machine`, aliases: ['Creality Ender-3 / K1'] },
  { name: 'Creality Ender-3 V3 SE', bed: [220, 220], maxZ: 250, kind: 'bedslinger', extruder: 'direct', firmware: 'marlin', orca: 'Creality Ender-3 V3 SE 0.4 nozzle', slicers: ['Creality Print', 'OrcaSlicer'], retraction: 1.2, accel: 2500, source: `${ORCA}/Creality/machine` },
  { name: 'Creality Ender-3 S1', bed: [220, 220], maxZ: 270, kind: 'bedslinger', extruder: 'direct', firmware: 'marlin', orca: 'Creality Ender-3 S1 0.4 nozzle', slicers: ['Creality Print', 'OrcaSlicer'], retraction: 1, source: `${ORCA}/Creality/machine` },
  { name: 'Voron 2.4 350', bed: [350, 350], maxZ: 325, kind: 'corexy', extruder: 'direct', firmware: 'klipper', orca: 'Voron 2.4 350 0.4 nozzle', slicers: ['OrcaSlicer', 'PrusaSlicer'], retraction: 0.8, source: `${ORCA}/Voron/machine`, aliases: ['Voron 2.4 350'] },
  { name: 'Voron Trident 350', bed: [350, 350], maxZ: 250, kind: 'corexy', extruder: 'direct', firmware: 'klipper', orca: 'Voron Trident 350 0.4 nozzle', slicers: ['OrcaSlicer', 'PrusaSlicer'], retraction: 0.8, source: `${ORCA}/Voron/machine` },
  { name: 'Elegoo Neptune 4 Pro', bed: [230, 230], maxZ: 265, kind: 'bedslinger', extruder: 'direct', firmware: 'klipper', orca: 'Elegoo Neptune 4 Pro 0.4 nozzle', slicers: ['OrcaSlicer'], source: `${ORCA}/Elegoo/machine` },
  { name: 'Anycubic Kobra 3', bed: [255, 255], maxZ: 260, kind: 'bedslinger', extruder: 'direct', firmware: 'klipper', orca: 'Anycubic Kobra 3 0.4 nozzle', slicers: ['Anycubic Slicer Next', 'OrcaSlicer'], retraction: 1, accel: 20000, source: `${ORCA}/Anycubic/machine` },
  { name: 'Sovol SV06', bed: [220, 220], maxZ: 250, kind: 'bedslinger', extruder: 'direct', firmware: 'marlin', orca: 'Sovol SV06 0.4 nozzle', slicers: ['OrcaSlicer', 'PrusaSlicer'], retraction: 0.5, accel: 1000, source: `${ORCA}/Sovol/machine` },
  { name: 'Qidi Q1 Pro', bed: [245, 245], maxZ: 240, kind: 'corexy', extruder: 'direct', firmware: 'klipper', orca: 'Qidi Q1 Pro 0.4 nozzle', slicers: ['QIDI Studio', 'OrcaSlicer'], retraction: 0.8, source: `${ORCA}/Qidi/machine` },
];

export const printerByName = (name: string) => PRINTERS_DB.find((p) => p.name === name || p.aliases?.includes(name)) ?? null;

export interface FilamentSettings { nozzle: number; nozzleFirst: number; range: [number, number]; bed: number; bedFirst: number; fan: [number, number]; flow: number; note?: string }

const FIL = `${ORCA}/OrcaFilamentLibrary/filament/base`;
/** OrcaSlicer's generic filament base profiles (fdm_filament_*.json, over fdm_filament_common.json). */
export const FILAMENTS: Record<Material, FilamentSettings & { source: string }> = {
  PETG: { nozzle: 255, nozzleFirst: 255, range: [220, 260], bed: 80, bedFirst: 80, fan: [20, 100], flow: 10, source: `${FIL}/fdm_filament_pet.json` },
  PLA: { nozzle: 220, nozzleFirst: 220, range: [190, 240], bed: 55, bedFirst: 55, fan: [100, 100], flow: 12, source: `${FIL}/fdm_filament_pla.json` },
  ABS: { nozzle: 260, nozzleFirst: 260, range: [240, 280], bed: 100, bedFirst: 105, fan: [10, 80], flow: 12, note: 'needs an enclosure', source: `${FIL}/fdm_filament_abs.json` },
  ASA: { nozzle: 260, nozzleFirst: 260, range: [240, 280], bed: 100, bedFirst: 105, fan: [10, 80], flow: 12, note: 'needs an enclosure', source: `${FIL}/fdm_filament_asa.json` },
  PA: { nozzle: 280, nozzleFirst: 280, range: [260, 300], bed: 100, bedFirst: 100, fan: [0, 60], flow: 8, note: 'dry it first; the profile asks for a hardened nozzle', source: `${FIL}/fdm_filament_pa.json` },
  PC: { nozzle: 280, nozzleFirst: 270, range: [260, 290], bed: 110, bedFirst: 110, fan: [10, 60], flow: 12, note: 'needs an enclosure', source: `${FIL}/fdm_filament_pc.json` },
};

/**
 * A filament's temperatures on this printer: never past what the printer heats to (ABS asks for a 100 °C bed, the A1
 * mini's stops at 80 °C). `capped`: what was held back, in words, for the user; empty when nothing was (or the
 * printer's limits aren't known).
 */
export function filamentOn(pr: Printer | null | undefined, mat: Material): FilamentSettings & { capped: string[] } {
  const f = FILAMENTS[mat], capped: string[] = [];
  const bedMax = pr?.maxBed ?? Infinity, nozMax = pr?.maxNozzle ?? Infinity;
  if (Math.max(f.bed, f.bedFirst) > bedMax) capped.push(`${mat} wants a ${Math.max(f.bed, f.bedFirst)} °C bed and the ${pr!.name}'s heats to ${bedMax} °C at most, so the bed is set to ${bedMax} °C. ${mat} may lift or warp at that: PETG or PLA suit this printer better.`);
  if (Math.max(f.nozzle, f.nozzleFirst) > nozMax) capped.push(`${mat} wants a ${Math.max(f.nozzle, f.nozzleFirst)} °C nozzle and the ${pr!.name}'s heats to ${nozMax} °C at most, so the nozzle is set to ${nozMax} °C.`);
  return {
    ...f, capped,
    nozzle: Math.min(f.nozzle, nozMax), nozzleFirst: Math.min(f.nozzleFirst, nozMax), range: [Math.min(f.range[0], nozMax), Math.min(f.range[1], nozMax)],
    bed: Math.min(f.bed, bedMax), bedFirst: Math.min(f.bedFirst, bedMax),
  };
}

export type Basis = 'design' | 'vendor' | 'convention';
export interface SettingRow { name: string; value: string; basis: Basis; why: string; orca: string; prusa: string }

/** What to set in the slicer for BoardDock parts on this printer with this filament. */
export function printSettings(pr: Printer | null, mat: Material, tallParts: string[]): SettingRow[] {
  const f = filamentOn(pr, mat);
  const rows: SettingRow[] = [
    { name: 'Layer height', value: '0.2 mm', basis: 'design', why: 'chamfers, snap lips and clearances are sized in 0.2 mm steps', orca: 'Quality › Layer height', prusa: 'Print › Layers and perimeters › Layer height' },
    { name: 'Wall line width', value: '0.45 mm (outer and inner)', basis: 'design', why: 'the rail shoe hinge is exactly two 0.45 mm lines', orca: 'Quality › Line width › Outer / Inner wall', prusa: 'Print › Advanced › Extrusion width › External perimeters / Perimeters' },
    { name: 'Walls', value: '3', basis: 'convention', why: 'stiff holders; thin features get as many as fit', orca: 'Strength › Wall loops', prusa: 'Print › Layers and perimeters › Perimeters' },
    { name: 'Detect thin walls', value: 'off', basis: 'convention', why: 'keeps each spring at two full lines instead of one odd-width line', orca: 'Quality › Detect thin wall', prusa: 'Print › Layers and perimeters › Detect thin walls' },
    { name: 'Top / bottom layers', value: '5 / 4', basis: 'convention', why: 'what the estimate assumes', orca: 'Strength › Top / Bottom shell layers', prusa: 'Print › Layers and perimeters › Solid layers' },
    { name: 'Infill', value: '15 %, grid', basis: 'convention', why: 'what the estimate and the in-app G-code use (gyroid is fine too, just slower to slice); the springs are all walls anyway', orca: 'Strength › Sparse infill density / pattern', prusa: 'Print › Infill › Fill density / pattern' },
    { name: 'Supports', value: 'off', basis: 'design', why: 'every part is oriented to print without them', orca: 'Support › Enable support', prusa: 'Print › Support material › Generate support material' },
    { name: 'Seam', value: 'aligned', basis: 'convention', why: 'keeps the seam off the springs', orca: 'Quality › Seam position', prusa: 'Print › Layers and perimeters › Seam position' },
    { name: 'Elephant foot compensation', value: '0.1 mm', basis: 'convention', why: 'the first layer of snap parts stays true to size', orca: 'Quality › Elephant foot compensation', prusa: 'Print › Advanced › Elephant foot compensation' },
    // (the in-app slice does the same: a brim of seven loops on every part if any is tall, else one skirt loop round the plate)
    { name: 'Brim', value: tallParts.length ? `3 mm, on every part (needed for ${tallParts.join(', ')})` : 'none', basis: 'convention', why: tallParts.length ? 'they stand more than 3 times taller than their footprint is wide' : 'no part is tall and narrow', orca: 'Others › Brim type / width', prusa: 'Print › Skirt and brim › Brim width' },
    { name: 'Skirt', value: tallParts.length ? 'none (the brim goes round the parts)' : '1 loop, 3 mm from the parts', basis: 'convention', why: 'it primes the nozzle before the parts start; a plate with less than 4 mm to the bed edge gets none', orca: 'Others › Skirt loops / distance', prusa: 'Print › Skirt and brim › Loops / Distance from object' },
    { name: 'Nozzle', value: `${f.nozzle} °C (first layer ${f.nozzleFirst}); ${f.range[0]}–${f.range[1]} °C is fine`, basis: 'vendor', why: `OrcaSlicer generic ${mat}${f.note ? `; ${f.note}` : ''}`, orca: 'Filament › Nozzle temperature', prusa: 'Filament › Temperature › Extruder' },
    { name: 'Bed', value: `${f.bed} °C (first layer ${f.bedFirst})`, basis: 'vendor', why: `OrcaSlicer generic ${mat}, smooth or textured PEI${f.capped.length ? `; ${f.capped.join(' ')}` : ''}`, orca: 'Filament › Bed temperature', prusa: 'Filament › Temperature › Bed' },
    { name: 'Part fan', value: f.fan[0] === f.fan[1] ? `${f.fan[0]} %` : `${f.fan[0]}–${f.fan[1]} %`, basis: 'vendor', why: `OrcaSlicer generic ${mat}`, orca: 'Filament › Cooling › Fan speed', prusa: 'Filament › Cooling › Fan settings' },
    { name: 'Max volumetric speed', value: `${f.flow} mm³/s`, basis: 'vendor', why: `OrcaSlicer generic ${mat}; your printer preset's speeds stay as they are`, orca: 'Filament › Max volumetric speed', prusa: 'Filament › Advanced › Max volumetric speed' },
  ];
  if (pr?.retraction != null) rows.push({ name: 'Retraction', value: `${pr.retraction} mm (${pr.extruder === 'bowden' ? 'bowden' : 'direct drive'})`, basis: 'vendor', why: `from the ${pr.name} machine profile; leave it as the preset has it`, orca: 'Printer › Extruder › Retraction length', prusa: 'Printer › Extruder › Retraction length' });
  return rows;
}
