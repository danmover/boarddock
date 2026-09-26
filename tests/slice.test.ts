import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { printerByName, PRINTERS_DB } from '../src/model/printers';
import { defaultCode, genericStart, kiriDevice, kiriProcess, machinePlan } from '../src/slice/profiles';
import { bambu3mf, gcodeLayers, gcodeStats, md5 } from '../src/slice/kiri';

const ps = (name: string) => { const pr = printerByName(name)!; return { name, bed: pr.bed, spacing: 6, maxZ: pr.maxZ }; };

describe('slicing with Kiri:Moto', () => {
  it('knows where every printer gets its start code, and refuses the ones it cannot do safely', () => {
    for (const pr of PRINTERS_DB) {
      const plan = machinePlan(pr, pr.name);
      expect(plan.label.length).toBeGreaterThan(3);
      if (pr.firmware === 'bambu') expect(plan.fit === 'none' || plan.kiri?.startsWith('Bambu.')).toBe(true);
    }
    expect(machinePlan(printerByName('Bambu Lab P1S'), 'Bambu Lab P1S')).toMatchObject({ fit: 'exact', kiri: 'Bambu.P1S' });
    expect(machinePlan(printerByName('Bambu Lab A1 mini'), 'Bambu Lab A1 mini').fit).toBe('none');
    expect(machinePlan(printerByName('Prusa XL'), 'Prusa XL').fit).toBe('none');
    expect(machinePlan(printerByName('Voron 2.4 350'), 'Voron 2.4 350')).toMatchObject({ fit: 'generic', firmware: 'klipper' });
    expect(machinePlan(null, 'Custom').fit).toBe('generic');
  });

  it("uses the filament's temperatures and BoardDock's design settings", () => {
    const pr = printerByName('Prusa MK4S / MK4');
    const p = kiriProcess(pr, 'PETG', true);
    expect(p).toMatchObject({ sliceHeight: 0.2, sliceLineWidth: 0.45, sliceDetectThin: 'off', sliceSupportType: 'disabled', outputTemp: 255, outputBedTemp: 80, outputBrimOffset: 0 });
    expect(kiriProcess(pr, 'PLA', false)).toMatchObject({ outputTemp: 220, outputFanSpeed: 255, outputBrimCount: 1 });
    const start = genericStart('marlin', [250, 210]).join('\n');
    expect(start).toMatch(/M190 S\{bed_temp\}/);
    expect(start).toMatch(/M109 S\{temp\}/);
    expect(start).toMatch(/G28/);
    expect(genericStart('klipper', [350, 350]).join('\n')).not.toMatch(/M420/);
  });

  it('puts in the filament type for Bambu profiles, and typed-in start code wins', () => {
    const plan = machinePlan(printerByName('Bambu Lab A1'), 'Bambu Lab A1');
    const profile = { gcodePre: ['M1002 set_filament_type:@MATERIAL@', 'M190 S{bed_temp}'], gcodePost: ['M400'], gcodeLayer: ['; CHANGE_LAYER'], extras: { bbl: {} } };
    const d = kiriDevice(plan, profile, ps('Bambu Lab A1'), 'PETG') as any;
    expect(d.gcodePre[0]).toBe('M1002 set_filament_type:PETG');
    expect(d.bedWidth).toBe(256);
    expect(d.gcodeLayer[0]).toMatch(/;; --- layer \{layer\}/); // BoardDock can still find the layers
    const own = kiriDevice(plan, profile, { ...ps('Bambu Lab A1'), gcodeStart: 'G28\nM109 S{temp}' }, 'PLA') as any;
    expect(own.gcodePre).toEqual(['G28', 'M109 S{temp}']);
    // a generic machine never inherits a Bambu profile's extras (Kiri keeps its device defaults between slices)
    const g = kiriDevice(machinePlan(null, 'Custom'), null, { name: 'Custom', bed: [200, 200], spacing: 6 }, 'PLA') as any;
    expect(g.extras).toEqual({});
    expect(g.gcodeLayer).toEqual([]);
    expect(defaultCode(machinePlan(null, 'Custom'), null, { name: 'Custom', bed: [200, 200], spacing: 6 }).start).toMatch(/purge/);
  });

  it('reads time, filament and layers back out of the G-code', () => {
    const g = [';; --- layer 0 (0.200 @ 0.2) ---', 'G1 X10 Y10 F3000', 'G1 X20 Y10 E1.2', 'G1 X20 Y20 E1.2', ';; --- layer 1 (0.200 @ 0.4) ---', 'G1 Z0.4', 'G1 X10 Y20 E1.0', 'G1 X10 Y10', '; --- filament used: 1000.00 mm ---', '; --- print time: 3600s ---'].join('\n');
    const st = gcodeStats(g, 1.27);
    expect(st).toMatchObject({ filament: 1000, seconds: 3600, layers: 2 });
    expect(st.grams).toBeCloseTo(1000 * Math.PI * 0.875 ** 2 * 1.27 / 1000, 3);
    const L = gcodeLayers(g);
    expect(L.length).toBe(2);
    expect(Array.from(L[0].segs)).toEqual([10, 10, 20, 10, 20, 10, 20, 20]);
    expect(L[1].z).toBe(0.4);
    expect(L[1].segs.length).toBe(4); // the travel back isn't drawn
  });

  it('packs a .gcode.3mf the way Bambu printers read it', () => {
    expect(md5(new TextEncoder().encode(''))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5(new TextEncoder().encode('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5(new TextEncoder().encode('x'.repeat(1000)))).toBe('398533d48111e9f664b1f64cb10c4b63');
    const g = '; total layer number: 2\nG28\nM104 S255 ; 255°C\n';
    const z = unzipSync(bambu3mf(g, { seconds: 90, grams: 3.2 }, new Uint8Array([1]), new Uint8Array([2])));
    expect(strFromU8(z['Metadata/plate_1.gcode'])).toBe(g);
    expect(strFromU8(z['Metadata/plate_1.gcode.md5'])).toBe(md5(z['Metadata/plate_1.gcode']));
    expect(strFromU8(z['Metadata/slice_info.config'])).toMatch(/key="prediction" value="90"/);
    expect(Object.keys(z)).toEqual(expect.arrayContaining(['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model', 'Metadata/model_settings.config', 'Metadata/plate_1.png']));
  });
});
