// Checking a Bambu printer's own start, end and layer-change code before it is trusted (src/slice/startcheck.ts). The
// code here is written for these tests; none of it is Bambu's.
import { describe, it, expect } from 'vitest';
import { checkOwnCode, checkPlainCode, ownUsable, usableCode, usablePlain, whyNot, type Finding } from '../src/slice/startcheck';
import { readFileSync } from 'node:fs';
import { defaultCode, machinePlan } from '../src/slice/profiles';
import { PRINTERS_DB, printerByName } from '../src/model/printers';
import type { PrinterSettings } from '../src/model/types';

const settings = (name: string): PrinterSettings => { const pr = printerByName(name)!; return { name, bed: pr.bed, spacing: 6, maxZ: pr.maxZ }; };
const MINI = settings('Bambu Lab A1 mini');
const START = [
  '; start code for the tests: heat, home, prime along the front',
  'G90', 'M83',
  'M140 S[bed_temperature_initial_layer_single]', 'M104 S140', 'G28', 'G1 Z5 F1200', 'G1 X20 Y10 F6000',
  'M190 S[bed_temperature_initial_layer_single]', 'M109 S[nozzle_temperature_initial_layer]',
  'G92 E0', 'G1 Z0.3 F600', 'G1 X20 Y10 E0', 'G1 X120 Y10 E12 F1500', 'G1 X120 Y12 E0.3', 'G1 X20 Y12 E12', 'G92 E0', 'G1 Z2 F1200',
].join('\n');
const END = 'M104 S0\nM140 S0\nG91\nG1 Z5\nG90\nG1 X5 Y170\nM84';
const LAYER = ';layer {layer_num+1}\nG1 Z{layer_z + 0.1} F1200\nG1 Z{layer_z} F1200';
const good = { start: START, end: END, layer: LAYER, from: 'code you pasted', for: MINI.name };
const ids = (f: Finding[]) => f.map((x) => x.id);
const check = (own: Partial<typeof good>, ps = MINI, mat: 'PETG' | 'PLA' | 'ABS' = 'PETG', extra: string[] = []) => checkOwnCode({ ...good, ...own }, ps, mat, extra);

describe('start code from outside, before it is trusted', () => {
  it('lets through code that heats, homes and primes inside the A1 mini', () => {
    expect(check({})).toEqual([]);
    // the start code can be all there is
    expect(check({ end: undefined, layer: undefined })).toEqual([]);
    // and the same code is fine for every filament (its temperatures come from the filament)
    expect(check({}, MINI, 'PLA')).toEqual([]);
  });

  it('stops an empty start code, or one of only comments', () => {
    expect(ids(check({ start: '' }))).toEqual(['start:empty']);
    const f = check({ start: '; nothing here\n\n;; M104 S200' });
    expect(f.map((x) => [x.id, x.stop])).toEqual([['start:empty', true]]);
    expect(f[0].text).toMatch(/nothing in it but comments/);
  });

  it("stops code BoardDock can't fill in, or that has a mistake, and says which", () => {
    expect(check({ start: `${START}\nM191 S{chamber_temperature[0]}` }).find((x) => x.stop)!.text).toMatch(/uses chamber_temperature/);
    expect(check({ start: '{if spiral_mode}\nG28' }).find((x) => x.stop)!.text).toMatch(/has a mistake in it: .*endif/);
  });

  it('stops end code (or the body of a print) pasted where the start code goes', () => {
    const asStart = check({ start: END });
    expect(asStart.find((x) => x.id === 'start:end')).toMatchObject({ stop: true });
    expect(asStart.find((x) => x.id === 'start:end')!.text).toMatch(/end code, not start code/);
    // a slicer's layers and printing moves
    const body = ['; FEATURE: Outer wall', ...Array.from({ length: 80 }, (_, i) => `G1 X${20 + i} Y30 E0.4`)].join('\n');
    const f = check({ start: `${START}\n${body}` });
    expect(f.find((x) => x.id === 'start:body')).toMatchObject({ stop: true });
    expect(f.find((x) => x.id === 'start:body')!.text).toMatch(/part of a sliced file/);
    // just many printing moves, no notes
    expect(check({ start: `${START}\n${body.split('\n').slice(1).join('\n')}` }).find((x) => x.id === 'start:body')!.text).toMatch(/83 printing moves/);
    // a whole file
    expect(ids(check({ start: `${START}\n${'G1 X10 Y10\n'.repeat(2000)}` }))).toContain('start:body');
  });

  it('stops start code that never heats, and asks about one that never homes', () => {
    expect(ids(check({ start: 'G28\nG1 X10 Y10' }))).toEqual(['start:bed', 'start:nozzle']);
    expect(check({ start: 'M140 S60\nM104 S200\nG1 X10 Y10' }).find((x) => x.id === 'start:home')).toMatchObject({ stop: false });
    expect(check({ start: 'M140 S60\nM104 S200\nG1 X10 Y10' }).some((x) => x.stop)).toBe(false);
  });

  it('checks the temperatures against the printer and the filament', () => {
    // more than the A1 mini's nozzle (300) or bed (80) can do, however the code says it
    expect(check({ start: `${START}\nM104 S320` }).find((x) => x.id === 'start:hot')!.text).toMatch(/nozzle to 320 °C, past the A1 mini's 300 °C/);
    expect(check({ start: START.replace('M104 S140', 'M104 S140\nM140 S100') }).find((x) => x.id === 'start:hotbed')!.text).toMatch(/bed to 100 °C, past the A1 mini's 80 °C/);
    // the filament's own bed temperature isn't the code's fault (ABS asks for 100 on a bed that stops at 80)
    expect(check({}, MINI, 'ABS')).toEqual([]);
    // the last nozzle temperature has to suit the filament, or it is worth a look
    const cool = check({ start: START.replace('M109 S[nozzle_temperature_initial_layer]', 'M109 S200') });
    expect(cool.find((x) => x.id === 'start:range')).toMatchObject({ stop: false });
    expect(cool.find((x) => x.id === 'start:range')!.text).toMatch(/200 °C, but PETG prints at 220 to 260/);
    expect(check({ start: START.replace('M109 S[nozzle_temperature_initial_layer]', 'M109 S200') }, MINI, 'PLA')).toEqual([]);
    // the X1 Carbon's bed goes further than the mini's
    expect(check({ start: START.replace('M104 S140', 'M104 S140\nM140 S110'), for: 'Bambu Lab X1 Carbon' }, settings('Bambu Lab X1 Carbon'))).toEqual([]);
  });

  it("stops moves a long way off the A1 mini's bed (a bigger printer's), asks about a little way off, and lets through what stays on", () => {
    // 256 mm printer's purge spots
    const big = check({ start: `${START}\nG1 X250 Y255 F6000\nG1 Z10` });
    expect(big.find((x) => x.id === 'start:reach')).toMatchObject({ stop: true });
    expect(big.find((x) => x.id === 'start:reach')!.text).toMatch(/X 250 \(70 mm past the right edge\) and Y 255 \(75 mm past the back edge\).*bigger printer/);
    // a wipe spot off the left edge and past the back
    const off = check({ start: `${START}\nG1 X-38.2 Y183 F6000` });
    expect(off.find((x) => x.id === 'start:past')).toMatchObject({ stop: false });
    expect(off.find((x) => x.id === 'start:past')!.text).toMatch(/X -38.2 \(38.2 mm past the left edge\), Y 183 \(3 mm past the back edge\)/);
    // right up to the edge and a hair over is on the bed
    expect(check({ start: `${START}\nG1 X180.5 Y0 F6000\nG1 X0 Y180` })).toEqual([]);
    // relative moves count from where the nozzle is
    expect(ids(check({ start: `${START}\nG91\nG1 X200\nG90` }))).toContain('start:reach');
    // moves too high or into the bed, in any of the three
    expect(check({ start: `${START}\nG1 Z200` }).find((x) => x.id === 'start:height')!.text).toMatch(/Z 200, above the A1 mini's 180 mm/);
    expect(check({ end: 'M104 S0\nG1 Z-20' }).find((x) => x.id === 'end:low')!.text).toMatch(/into the bed/);
    expect(ids(check({ layer: 'G1 X400' }))).toContain('layer:reach');
    // Bambu's own probing goes a little below the bed
    expect(check({ start: `${START}\nG1 Z-1.5` })).toEqual([]);
  });

  it('knows the same code fits the X1 Carbon and P1S, whose bed it was written for', () => {
    const x1 = settings('Bambu Lab X1 Carbon');
    expect(check({ start: `${START}\nG1 X250 Y255 F6000\nG1 Z10`, for: x1.name }, x1).some((f) => f.stop)).toBe(false);
  });

  it('stops code for a runs-every-layer box that homes, heats or is long', () => {
    expect(check({ layer: 'G28\nG1 Z1' }).find((x) => x.id === 'layer:long')).toMatchObject({ stop: true });
    expect(check({ layer: 'M190 S60' }).find((x) => x.id === 'layer:long')).toMatchObject({ stop: true });
    expect(check({ layer: Array.from({ length: 60 }, () => 'G1 Z1').join('\n') }).find((x) => x.id === 'layer:long')!.text).toMatch(/60 lines long/);
    // end code that heats and waits is a start code
    expect(check({ end: 'M190 S60\nM104 S0' }).find((x) => x.id === 'end:heats')).toMatchObject({ stop: false });
  });

  it("stops code that came from another printer's profile, and asks about a comment that names one", () => {
    // where it came from says so
    const f = check({ from: 'Bambu Lab P1S 0.4 nozzle template machine_start_gcode.json' });
    expect(f.find((x) => x.id === 'from')).toMatchObject({ stop: true });
    expect(f.find((x) => x.id === 'from')!.text).toBe("It came from the P1S profile, not the A1 mini's.");
    expect(ids(check({}, MINI, 'PETG', ['Bambu Lab X1 Carbon 0.4 nozzle']))).toEqual(['from']);
    expect(check({ from: 'Bambu Lab A1 mini 0.4 nozzle template machine_start_gcode.json' })).toEqual([]);
    // its own comments only hint
    const c = check({ start: `;===== machine: X1C =====\n${START}` });
    expect(c.find((x) => x.id === 'start:model')).toMatchObject({ stop: false });
    expect(c.some((x) => x.stop)).toBe(false);
    // naming the A1 mini as well is fine, and G-code's own "A1" (G29 A1) is no name
    expect(check({ start: `;===== machine: A1 mini, also the A1 =====\n${START}` })).toEqual([]);
    expect(check({ start: `${START}\nG29 A1 X20 Y10 I50 J50` })).toEqual([]);
    // "A1" alone is the A1, not the A1 mini
    expect(ids(check({ start: `; from the A1's profile\n${START}` }))).toEqual(['start:model']);
  });

  it("stops code loaded for another printer once the printer changes", () => {
    const p1s = settings('Bambu Lab P1S');
    const f = checkOwnCode(good, p1s, 'PETG');
    expect(f.find((x) => x.id === 'printer')).toMatchObject({ stop: true });
    expect(f.find((x) => x.id === 'printer')!.text).toBe("This code was loaded for the A1 mini, and the printer is now the P1S: it is not this printer's.");
    // (a project from before this check has no printer noted: whose it is isn't known, so it is asked about, not stopped)
    const old = checkOwnCode({ ...good, for: undefined }, p1s, 'PETG');
    expect(old).toEqual([{ id: 'printer:unknown', stop: false, text: expect.stringMatching(/doesn't say which printer it was loaded for/) }]);
    expect(ownUsable({ ok: ['printer:unknown'] }, old)).toBe(true);
  });

  it('is used only when nothing stops it and everything to look at has been accepted', () => {
    const own = { ...good, start: `${START}\nG1 X-38.2 Y183 F6000` };
    const f = checkOwnCode(own, MINI, 'PETG');
    expect(ids(f)).toEqual(['start:past']);
    expect(ownUsable(own, f)).toBe(false);
    expect(whyNot(own, f)).toMatch(/moves the nozzle off the bed/);
    expect(ownUsable({ ...own, ok: ['start:past'] }, f)).toBe(true);
    expect(whyNot({ ...own, ok: ['start:past'] }, f)).toBe('');
    // accepting doesn't reach what stops it
    const bad = checkOwnCode({ ...own, start: `${START}\nG1 X250 Y255` }, MINI, 'PETG');
    expect(ownUsable({ ...own, ok: bad.map((x) => x.id) }, bad)).toBe(false);
    expect(ownUsable(good, [])).toBe(true);
  });

  it("gives the A1 mini a start code only from code that passed, in the project's own settings", () => {
    const plan = (ps: PrinterSettings) => machinePlan(printerByName(ps.name), ps.name, usableCode(ps, 'PETG').own?.from);
    expect(plan(MINI).fit).toBe('none'); // nothing loaded
    expect(plan({ ...MINI, bambu: good })).toMatchObject({ fit: 'exact' });
    // loaded, but it is another printer's, or has a far move: not used, and it says why
    const wrong = { ...MINI, bambu: { ...good, start: `${START}\nG1 X250 Y255` } };
    expect(plan(wrong).fit).toBe('none');
    expect(usableCode(wrong, 'PETG').why).toMatch(/farther than the A1 mini reaches/);
    // one that needs a look is used once it has been accepted
    const off = { ...good, start: `${START}\nG1 X-38.2 Y100` };
    expect(plan({ ...MINI, bambu: off }).fit).toBe('none');
    expect(plan({ ...MINI, bambu: { ...off, ok: ['start:past'] } }).fit).toBe('exact');
    // the same code left in the project when the printer becomes a P1S goes back to Kiri:Moto's own P1S profile
    const p1s = { ...settings('Bambu Lab P1S'), bambu: good };
    expect(usableCode(p1s, 'PETG').why).toMatch(/not this printer's/);
    expect(plan(p1s)).toMatchObject({ fit: 'exact', kiri: 'Bambu.P1S' });
  });

  it('checks the code as it will be printed: conditions taken, names filled in', () => {
    // the far move is only in a branch the A1 mini never takes
    const start = `${START}\n{if nozzle_diameter[0] > 0.6}\nG1 X250 Y255\n{endif}`;
    expect(check({ start })).toEqual([]);
    expect(ids(check({ start: `${START}\n{if nozzle_diameter[0] < 0.6}\nG1 X250 Y255\n{endif}` }))).toContain('start:reach');
  });
});

// Start and end code typed into the Export step's own box (Kiri:Moto's {temp} and {bed_temp} kind), for printers whose
// code BoardDock doesn't ship, or over the profile's own
describe('start and end code typed in for a printer, before it is used', () => {
  const MK3 = settings('Prusa MK3S+'), K1 = settings('Creality K1C'), ENDER = settings('Creality Ender-3 V3 SE');
  const PLAIN = ['; my start code', 'G90', 'M83', 'M140 S{bed_temp}', 'M104 S150', 'G28', 'M190 S{bed_temp}', 'M104 S{temp}', 'M109 S{temp}', 'G92 E0', 'G1 Z2 F3000', 'G1 X3 Y20 F6000', 'G1 Z0.3', 'G1 Y120 E12 F1200', 'G92 E0'].join('\n');
  const PEND = 'G91\nG1 E-1 F1800\nG1 Z10\nG90\nG1 X5 Y200\nM104 S0\nM140 S0\nM84';
  const sorted = (f: Finding[]) => ids(f).sort();
  const plain = (start?: string, end?: string, ps: PrinterSettings = MK3, mat: 'PETG' | 'PLA' | 'ABS' = 'PETG') => checkPlainCode(ps, mat, { start, end });

  it('lets through start and end code that heats, homes and stays on the bed, and does not look at empty boxes', () => {
    expect(plain(PLAIN, PEND)).toEqual([]);
    expect(plain(PLAIN, PEND, ENDER, 'PLA')).toEqual([]);
    expect(plain(undefined, undefined)).toEqual([]);
    expect(plain('', '  ')).toEqual([]);
    // a prime line a few mm in front of the bed (Prusa's), and Kiri's own {layer}-style names
    expect(plain(`${PLAIN}\nG1 X0 Y-3 F1000\nG1 Z{z_max}`)).toEqual([]);
  });

  it('stops moves to a bigger printer\'s bed, and asks about ones a little off the bed', () => {
    const far = plain(`${PLAIN}\nG1 X340 Y300 F6000`, undefined, MK3); // the MK3S+ bed is 250 x 210
    expect(far.find((f) => f.id === 'start:reach')).toMatchObject({ stop: true });
    expect(far.find((f) => f.id === 'start:reach')!.text).toMatch(/X 340 \(90 mm past the right edge\) and Y 300 \(90 mm past the back edge\).*250 × 210/);
    const near = plain(`${PLAIN}\nG1 X-12 Y100 F6000`);
    expect(ids(near)).toEqual(['start:past']);
    expect(near[0].stop).toBe(false);
    // the end code is read the same way, and the height too
    expect(plain(undefined, `${PEND}\nG1 X400`).map((f) => f.id)).toContain('end:reach');
    expect(ids(plain(`${PLAIN}\nG1 Z400`))).toEqual(['start:height']);
    // the code was for a 350 mm bed and the project's bed is now smaller (bed edited: the name becomes Custom)
    expect(plain(`${PLAIN}\nG1 X300 Y30`, undefined, { name: 'Custom', bed: [220, 220], spacing: 7 }).some((f) => f.id === 'start:reach' && f.stop)).toBe(true);
  });

  it('reads heater targets against the printer and the filament', () => {
    expect(sorted(plain(PLAIN.replace('M104 S{temp}\nM109 S{temp}', 'M104 S320\nM109 S320')))).toEqual(['start:hot', 'start:range']);
    expect(plain(PLAIN.replace('M104 S{temp}\nM109 S{temp}', 'M104 S320\nM109 S320')).find((f) => f.id === 'start:hot')!.stop).toBe(true);
    expect(sorted(plain(PLAIN.replace(/M140 S\{bed_temp\}/, 'M140 S150').replace(/M190 S\{bed_temp\}/, 'M190 S150')))).toEqual(['start:bedrange', 'start:hotbed']);
    // 200 C is fine for PLA and PETG's range starts at 220; a 110 C bed is far from PLA's
    expect(plain(PLAIN.replace(/S\{temp\}/g, 'S200'), undefined, MK3, 'PETG').map((f) => f.id)).toEqual(['start:range']);
    expect(plain(PLAIN.replace(/S\{temp\}/g, 'S200'), undefined, MK3, 'PLA')).toEqual([]);
    expect(ids(plain(PLAIN.replace(/S\{bed_temp\}/g, 'S110'), undefined, MK3, 'PLA'))).toEqual(['start:bedrange']);
    // Marlin's M109 R and Klipper's SET_HEATER_TEMPERATURE count too
    expect(sorted(plain(PLAIN.replace('M109 S{temp}', 'M109 R{temp}').replace('M104 S{temp}', 'SET_HEATER_TEMPERATURE HEATER=extruder TARGET=330')))).toEqual(['start:hot']); // (M109 R220 is the last target: in range)
    // the printer's limit is what its maker gives, or a common one (300 C nozzle, 120 C bed) when it isn't known
    expect(sorted(plain(PLAIN.replace('M109 S{temp}', 'M109 S310'), undefined, { name: 'Custom', bed: [200, 200], spacing: 7 }))).toEqual(['start:hot', 'start:range']);
  });

  it('stops code that is not start code, or has names the slicer cannot fill in', () => {
    expect(ids(plain(undefined, PLAIN))).toEqual(['end:heats']);
    expect(sorted(plain(PEND))).toEqual(['start:end', 'start:home']);
    expect(ids(plain('; nothing\n'))).toEqual(['start:empty']);
    expect(sorted(plain('G28\nG1 X10 Y10'))).toEqual(['start:bed', 'start:nozzle']);
    // an OrcaSlicer or PrusaSlicer start code uses [names] and {if}: none of it is filled in here
    const orca = plain('M140 S[first_layer_bed_temperature]\nM104 S[first_layer_temperature]\nG28\n{if is_extruder_used[0]}M109 S0{endif}');
    expect(orca).toHaveLength(1);
    expect(orca[0]).toMatchObject({ id: 'start:names', stop: true });
    expect(orca[0].text).toMatch(/\[first_layer_bed_temperature\].*\{if is_extruder_used\[0\]\}/);
    // a macro takes the temperatures itself: no "never heats", and no homing needed
    expect(plain('START_PRINT BED_TEMP={bed_temp} EXTRUDER_TEMP={temp}', undefined, K1)).toEqual([]);
    // ...but a Klipper macro on a Marlin printer, and Bambu's own commands anywhere else, are wrong
    expect(ids(plain('START_PRINT BED_TEMP={bed_temp} EXTRUDER_TEMP={temp}', undefined, MK3))).toEqual(['start:klipper']);
    expect(plain(`${PLAIN}\nM620 S0A\nM1002 gcode_claim_action : 2`).find((f) => f.id === 'start:bambu')).toMatchObject({ stop: true });
  });

  it("asks about code that names another printer in its comments and never this one", () => {
    expect(ids(plain(`; Prusa MK4 start code\n${PLAIN}`, undefined, MK3))).toEqual(['start:model']);
    expect(ids(plain(`; from an Ender-3 profile\n${PLAIN}`, undefined, MK3))).toEqual(['start:model']);
    expect(ids(plain(`; for the Bambu Lab A1\n${PLAIN}`, undefined, MK3))).toEqual(['start:model']);
    expect(plain(`; Prusa MK3S+ and Prusa MK4\n${PLAIN}`, undefined, MK3)).toEqual([]);
    expect(plain(`; Ender-3 V3 SE start\n${PLAIN}`, undefined, ENDER)).toEqual([]);
  });

  it('is used once it passes, or the notes are accepted, and never when something stops it', () => {
    const ps = (over: Partial<PrinterSettings>): PrinterSettings => ({ ...MK3, ...over });
    expect(usablePlain(ps({}), 'PETG')).toEqual({ found: [] }); // nothing typed in: the profile's code
    expect(usablePlain(ps({ gcodeStart: PLAIN, gcodeEnd: PEND }), 'PETG')).toEqual({ found: [] });
    const off = ps({ gcodeStart: `${PLAIN}\nG1 X-12 Y100` });
    expect(usablePlain(off, 'PETG').why).toMatch(/moves the nozzle off the bed/);
    expect(usablePlain({ ...off, gcodeOk: ['start:past'] }, 'PETG').why).toBeUndefined();
    const bad = ps({ gcodeStart: `${PLAIN}\nG1 X400 Y400`, gcodeOk: ['start:reach', 'start:past'] });
    expect(usablePlain(bad, 'PETG').why).toMatch(/bigger printer's code/);
  });

  it("finds nothing to say about the code each printer's own profile starts from, so changing one line of it raises no alarm", () => {
    const profiles = JSON.parse(readFileSync('public/kiri/profiles.json', 'utf8'));
    const seen: string[] = [];
    for (const pr of PRINTERS_DB) {
      const ps = settings(pr.name), plan = machinePlan(pr, pr.name);
      if (plan.fit === 'none') continue;
      const d = defaultCode(plan, plan.kiri ? profiles[plan.kiri] : null, ps);
      for (const mat of ['PLA', 'PETG'] as const) {
        const f = checkPlainCode(ps, mat, d);
        if (f.length) seen.push(`${pr.name} ${mat}: ${ids(f)}`);
      }
    }
    expect(seen).toEqual([]);
  });
});
