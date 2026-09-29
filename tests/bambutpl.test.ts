// Filling in Bambu Studio / OrcaSlicer G-code templates (the printer's own start code, from the user's own slicer).
import { describe, it, expect } from 'vitest';
import { evalExpr, fmt, fromProfileJson, isSlicerTemplate, renderTemplate } from '../src/slice/bambutpl';
import { MARK_END, MARK_START, withOwnCode } from '../src/slice/kiri';

const vars = {
  nozzle_temperature_initial_layer: [255], nozzle_temperature: [250], bed_temperature_initial_layer_single: 70,
  filament_type: ['PETG'], initial_extruder: 0, initial_no_support_extruder: 0, nozzle_diameter: 0.4,
  curr_bed_type: 'Textured PEI Plate', outer_wall_volumetric_speed: 12, first_layer_print_min: [40, 50], first_layer_print_size: [100, 80],
  max_layer_z: 32.4, spiral_mode: false, print_sequence: 'by layer', layer_num: 4, total_layer_count: 162,
};

describe('slicer templates', () => {
  it('arithmetic, comparisons, logic, strings and indexes', () => {
    expect(evalExpr('outer_wall_volumetric_speed/(0.3*0.5)/4 * 60', vars)).toBe(1200);
    expect(evalExpr('nozzle_temperature_initial_layer[initial_no_support_extruder]-20', vars)).toBe(235);
    expect(evalExpr('(filament_type[initial_no_support_extruder] == "PLA") && (nozzle_diameter != 0.2)', vars)).toBe(false);
    expect(evalExpr('!spiral_mode && print_sequence != "by object"', vars)).toBe(true);
    expect(evalExpr('(max_layer_z + 100.0) < 180', vars)).toBe(true);
    expect(evalExpr('min(3, max(1, 2)) + int(2.7) + round(2.5) + abs(-1)', vars)).toBe(8);
    expect(evalExpr('layer_num + 1', vars)).toBe(5);
    expect(fmt(1200.0000001)).toBe('1200');
    expect(fmt(541.66666)).toBe('541.667');
  });
  it('fills in values and keeps ordinary G-code', () => {
    const r = renderTemplate('M140 S[bed_temperature_initial_layer_single]\nM620 S[initial_no_support_extruder]A   ; switch material\nM109 S[nozzle_temperature_initial_layer]\nG29 A1 X{first_layer_print_min[0]} Y{first_layer_print_min[1]} I{first_layer_print_size[0]} J{first_layer_print_size[1]}', vars);
    expect(r.unknown).toEqual([]);
    expect(r.text.split('\n')).toEqual(['M140 S70', 'M620 S0A   ; switch material', 'M109 S255', 'G29 A1 X40 Y50 I100 J80']);
  });
  it('if / elsif / else / endif, lines of only tags go, nested blocks', () => {
    const t = ['G28', '{if curr_bed_type=="Textured PEI Plate"}', 'G29.1 Z{-0.02} ; textured', '{elsif curr_bed_type=="Cool Plate"}', 'G29.1 Z0', '{else}', 'G29.1 Z0.01', '{endif}',
      '{if !spiral_mode}', '{if (max_layer_z + 100.0) < 180}', 'G1 Z{max_layer_z + 100.0} F600', '{else}', 'G1 Z180', '{endif}', '{endif}', 'M400'].join('\n');
    const r = renderTemplate(t, vars);
    expect(r.text.split('\n')).toEqual(['G28', 'G29.1 Z-0.02 ; textured', 'G1 Z132.4 F600', 'M400']);
    const cool = renderTemplate(t, { ...vars, curr_bed_type: 'Cool Plate' });
    expect(cool.text).toContain('G29.1 Z0\n');
  });
  it('an inline condition keeps the rest of its line', () => {
    expect(renderTemplate('G1 X10 {if nozzle_diameter == 0.4}Y20{else}Y30{endif} F600', vars).text).toBe('G1 X10 Y20 F600');
  });
  it('names it does not know are reported, never guessed; in comments they are left alone', () => {
    const r = renderTemplate('M104 S{chamber_temperature[0]}\nG1 X[print_bed_max]\n; see [some_note] and {not_a_var}', vars);
    expect(r.unknown).toEqual(['chamber_temperature', 'print_bed_max']);
    expect(r.text.split('\n')[2]).toBe('; see [some_note] and {not_a_var}');
  });
  it('broken templates say what is wrong', () => {
    expect(() => renderTemplate('{if nozzle_diameter == 0.4}\nG1', vars)).toThrow(/without \{endif\}/);
    expect(() => renderTemplate('{endif}', vars)).toThrow(/without \{if\}/);
  });
  it('tells Bambu templates from Kiri code, and reads a machine profile', () => {
    expect(isSlicerTemplate('M140 S[bed_temperature_initial_layer_single]')).toBe(true);
    expect(isSlicerTemplate('{if curr_bed_type=="Cool Plate"}')).toBe(true);
    expect(isSlicerTemplate('M104 S{temp}\nM140 S{bed_temp}')).toBe(false);
    const p = fromProfileJson(JSON.stringify({ name: 'Bambu Lab A1 mini 0.4 nozzle', machine_start_gcode: 'G28\nM109 S[nozzle_temperature_initial_layer]', machine_end_gcode: 'M104 S0', layer_change_gcode: 'M73 L{layer_num+1}' }));
    expect(p.start).toContain('G28');
    expect(renderTemplate(p.layer!, vars).text).toBe('M73 L5');
  });
});

describe("a Bambu printer's own code in a slice", () => {
  // what Kiri:Moto writes: the markers where the start and end code go, a marker per layer, extrusion moves
  const kiri = [';; header', MARK_START, 'G90', 'M83', ';; --- layer 0 ---', 'G1 Z0.2', 'G1 X-2 Y30 F3000', 'G1 X150 Y30 E5', 'G1 X150 Y120 E3', ';; --- layer 1 ---', 'G1 Z0.4', 'G1 X20 Y30 E4', MARK_END, '; --- filament used: 100 mm ---', '; --- print time: 600s ---'].join('\n');
  const ps = { name: 'Bambu Lab A1 mini', bed: [180, 180] as [number, number], spacing: 6, maxZ: 180, plate: 'Cool Plate' };
  const own = { start: 'M140 S[bed_temperature_initial_layer_single]\nM109 S[nozzle_temperature_initial_layer]\n{if curr_bed_type=="Cool Plate"}; cool{endif}\nG29 A1 X{first_layer_print_min[0]} Y{first_layer_print_min[1]} I{first_layer_print_size[0]} J{first_layer_print_size[1]}', end: 'G1 Z{max_layer_z + 5}', layer: 'M73 L{layer_num+1}', from: 'test' };
  it('fills it in: temperatures, the plate, the first layer on the bed, the height, every layer', () => {
    const g = withOwnCode(kiri, own, ps, 'PETG');
    expect(g).not.toContain(MARK_START);
    expect(g).toContain('M140 S80');
    expect(g).toContain('M109 S255');
    expect(g).toContain('; cool');
    // the first layer's area, never past the bed (the move to x -2 is outside it)
    expect(g).toContain('G29 A1 X0 Y30 I150 J90');
    expect(g).toContain('G1 Z5.4');
    expect(g).toContain('M73 L1');
    expect(g).toContain('M73 L2');
    expect(g).toMatch(/; total layer number: 2/);
    expect(g.indexOf('M140 S80')).toBeLessThan(g.indexOf(';; --- layer 0'));
  });
  it('refuses code with names it cannot fill in', () => {
    expect(() => withOwnCode(kiri, { ...own, start: 'M191 S{chamber_temperature[0]}' }, ps, 'PETG')).toThrow(/chamber_temperature/);
  });
});

describe('temperatures a printer can do', () => {
  it("never puts a bed past the printer's limit into its G-code, and says so", async () => {
    const { filamentOn, printerByName } = await import('../src/model/printers');
    const { bambuVars } = await import('../src/slice/bambutpl');
    const { kiriProcess } = await import('../src/slice/profiles');
    const mini = printerByName('Bambu Lab A1 mini')!, ps = { name: mini.name, bed: mini.bed, spacing: 6, maxZ: mini.maxZ };
    const g = { x0: 10, y0: 10, x1: 100, y1: 100, z1: 20, layers: 100 };
    // ABS asks for 100 °C (105 on the first layer); the A1 mini's bed stops at 80 °C
    const abs = filamentOn(mini, 'ABS');
    expect([abs.bed, abs.bedFirst]).toEqual([80, 80]);
    expect(abs.capped[0]).toMatch(/ABS wants a 105 °C bed and the Bambu Lab A1 mini's heats to 80 °C at most/);
    const v = bambuVars(ps, 'ABS', g);
    expect([v.bed_temperature, v.bed_temperature_initial_layer, v.bed_temperature_initial_layer_single]).toEqual([[80], [80], 80]);
    expect(renderTemplate('M140 S[bed_temperature_initial_layer_single]', v).text).toBe('M140 S80');
    expect(kiriProcess(mini, 'ABS', true)).toMatchObject({ outputBedTemp: 80, firstLayerBedTemp: 80 });
    // PETG is within it; a printer whose limits aren't known keeps the filament's own figures
    expect(filamentOn(mini, 'PETG').capped).toEqual([]);
    expect(filamentOn(printerByName('Bambu Lab P1S'), 'PC')).toMatchObject({ bed: 100, bedFirst: 100 });
    expect(filamentOn(null, 'ABS')).toMatchObject({ bed: 100, bedFirst: 105, capped: [] });
  });
});
