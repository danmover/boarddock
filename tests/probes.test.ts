// Debug probes (J-Link): debug headers found on import or marked by hand, a J-Link for each, stacked in the back
// slot of the board's dock (they slide down into slots), ribbons round the dock that come with the probe.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { TEMPLATES } from '../src/model/templates';
import { debugType, newModule, newProject } from '../src/model/library';
import { autoLinks, isDebugPort, numberLinks, plugRole } from '../src/model/links';
import { addProbes, addUartLinks, adapterFor, debugHeaders, isProbe, isUartPort, markDebug, probesOf, stackProbes, uartHeaders } from '../src/model/probes';
import { powerBudget } from '../src/model/power';
import { importKicad } from '../src/import/kicad';
import { autoAssign } from '../src/cad/dockplan';
import { generatePanel } from '../src/cad/panelgen';
import { initKernel } from '../src/cad/kernel';
import type { Comp, Project } from '../src/model/types';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
const example = (f: string) => importKicad(readFileSync(new URL(`../examples/${f}`, import.meta.url), 'utf8'), f);

describe('debug headers', () => {
  it('knows them by shape or by name', () => {
    expect(debugType('Connector_PinHeader_1.27mm:PinHeader_2x05_P1.27mm_Vertical_SMD')).toBe('swd10');
    expect(debugType('Connector_Samtec:Samtec_FTSH-105-01-F-DV-K')).toBe('swd10');
    expect(debugType('Connector_IDC:IDC-Header_2x10_P2.54mm_Vertical', 'J2', 'JTAG')).toBe('jtag20');
    expect(debugType('Connector:Tag-Connect_TC2050-IDC-NL_2x05_P1.27mm_Vertical')).toBe('tagconnect');
    // a 20-pin header that says nothing about debugging is just a header; so is a 1 x 4 SWD header (jumper wires)
    expect(debugType('Connector_IDC:IDC-Header_2x10_P2.54mm_Vertical', 'J5', 'GPIO')).toBeNull();
    expect(debugType('Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical', 'J_SWD', 'SWD')).toBeNull();
  });

  it('finds both headers of the dual-MCU example on import, and the JTAG one on the sensor board', () => {
    const b = example('dual-mcu-swd.kicad_pcb');
    expect(debugHeaders(b).map((c) => [c.ref, c.conn!.type, c.conn!.entry])).toEqual([['J_SWD1', 'swd10', 'top'], ['J_SWD2', 'swd10', 'top']]);
    const s = example('sensor-jtag.kicad_pcb');
    expect(debugHeaders(s).map((c) => [c.ref, c.conn!.type])).toEqual([['J2', 'jtag20']]);
    // and their UART headers, by name
    expect(uartHeaders(b).map((c) => c.ref)).toEqual(['J_UART']);
    expect(uartHeaders(s).map((c) => c.ref)).toEqual(['J3']);
  });

  it('marks a part as a debug header by hand, and back', () => {
    const c: Comp = { id: 'c1', ref: 'J9', pkg: 'something', side: 'top', x: 10, y: 10, rot: 90, w: 4, l: 14, h: 5, kind: 'generic', tht: true };
    markDebug(c, 'swd10');
    expect(isDebugPort(c)).toBe(true);
    expect([c.conn!.type, c.w, c.l]).toEqual(['swd10', 5.8, 12.7]); // along its long side, as it was
    markDebug(c, null);
    expect(isDebugPort(c)).toBe(false);
    // a 1 x 4 SWD header stays pins for jumper wires, and still takes a probe
    const pins: Comp = { ...c, id: 'c2', ref: 'J_SWD', conn: undefined, role: undefined };
    markDebug(pins, 'pins');
    expect([pins.conn!.type, isDebugPort(pins)]).toEqual(['header', true]);
    // and a UART header, which is not a debug port
    markDebug(pins, 'uart');
    expect([pins.conn!.type, isUartPort(pins), isDebugPort(pins)]).toEqual(['header', true, false]);
  });
});

describe('USB-serial cables', () => {
  it('go from each free UART header to the nearest free hub port, once', () => {
    const p = newProject(T('example_dual_swd'));
    p.modules.push(newModule(T('usb_hub7')));
    const before = powerBudget(p).map((x) => x.load);
    expect(addUartLinks(p, p.modules[0].id)).toEqual({ added: 1, left: 0 });
    const l = p.links!.find((x) => x.kind === 'uart')!;
    expect(l.a).toEqual({ module: p.modules[0].id, ref: 'J_UART' });
    expect(p.modules.find((m) => m.id === l.b.module)!.board.name).toBe('Powered USB hub');
    expect(addUartLinks(p, p.modules[0].id)).toEqual({ added: 0, left: 0 });
    // a serial cable does not power the board
    expect(powerBudget(p).map((x) => x.load)).toEqual(before);
  });

  it("use a computer's USB port when there is no hub, and say when there is none", () => {
    const p = newProject(T('example_jtag'));
    expect(addUartLinks(p, p.modules[0].id)).toEqual({ added: 0, left: 1 });
    p.modules.push(newModule(T('rpi4')));
    expect(addUartLinks(p, p.modules[0].id)).toEqual({ added: 1, left: 0 });
    expect(p.modules.find((m) => m.id === p.links![0].b.module)!.board.name).toMatch(/Raspberry Pi/);
  });
});

describe('J-Links for a board', () => {
  const rack = (): Project => {
    const p = newProject(T('example_dual_swd'));
    p.modules.push(newModule(T('example_jtag')), newModule(T('usb_hub7')));
    return p;
  };

  it('adds one per free header, cabled to it, stacked, the board still the one being edited', () => {
    const p = rack();
    p.active = 1;
    const added = addProbes(p, p.modules[0].id);
    expect(added.length).toBe(2);
    expect(added.every(isProbe)).toBe(true);
    expect(p.modules[3].board.name).toBe('Sensor board');
    expect(p.active).toBe(3);
    expect(added[1].on).toBe(added[0].id);
    expect(added[1].onMode).toBe('towers');
    expect(probesOf(p, p.modules[0]).map((m) => m.id)).toEqual(added.map((m) => m.id));
    expect(p.links!.every((l) => l.kind === 'debug')).toBe(true);
    // nothing left to add
    expect(addProbes(p, p.modules[0].id)).toEqual([]);
  });

  it('Auto-connect pairs a loose J-Link with a free header and its USB with a hub, never probe to probe', () => {
    const p = rack();
    p.modules.push(newModule(T('jlink')), newModule(T('jlink')));
    p.links = numberLinks(autoLinks(p));
    const dbg = p.links.filter((l) => l.kind === 'debug');
    expect(dbg.length).toBe(2);
    for (const l of dbg) {
      const ends = [l.a, l.b].map((r) => p.modules.find((m) => m.id === r.module)!);
      expect(ends.filter(isProbe).length).toBe(1);
    }
    const probes = p.modules.filter(isProbe);
    for (const pr of probes) {
      const usb = pr.board.comps.find((c) => c.conn?.type === 'usb_micro_b')!;
      expect(plugRole(pr, usb)).toBe('device');
      expect(p.links.some((l) => l.kind === 'usb' && (l.a.module === pr.id || l.b.module === pr.id))).toBe(true);
    }
    // the two probes on the dual-MCU board end up in one stack
    expect(stackProbes(p)).toBe(p.links.filter((l) => l.kind === 'debug' && [l.a.module, l.b.module].includes(p.modules[0].id)).length > 1);
  });

  it('seats each board with its probe stack in the back slot of its dock', () => {
    const p = rack();
    addProbes(p, p.modules[0].id);
    addProbes(p, p.modules.find((m) => m.board.name === 'Sensor board')!.id);
    const docks = autoAssign(p).filter((m) => m.kind === 'dock');
    const name = (id: string | null) => p.modules.find((m) => m.id === id)?.board.name ?? '';
    expect(docks.map((d) => d.slots.map((s) => name(s.module).replace(/\s*\(.*\)$/, '')))).toEqual([['Dual-MCU controller', 'J-Link'], ['Sensor board', 'J-Link']]);
  });

  it('needs an adapter only where the pin counts differ', () => {
    const p = rack();
    const [pr] = addProbes(p, p.modules[0].id);
    const port = pr.board.comps.find(isDebugPort)!, head = debugHeaders(p.modules[0].board)[0];
    expect(adapterFor(port, head)).toBeNull(); // a 10-pin J-Link on a 10-pin header
    expect(adapterFor(port, debugHeaders(T('example_jtag'))[0])).toMatch(/10-to-20-pin adapter/);
  });
});

describe('probe rack', () => {
  beforeAll(async () => { await initKernel(); });

  it('slots the probes in behind their boards, with ribbons that reach and nothing to buy for them', () => {
    const p = newProject(T('example_dual_swd'));
    p.modules.push(newModule(T('example_jtag')), newModule(T('usb_hub7')));
    addProbes(p, p.modules[0].id);
    addProbes(p, p.modules.find((m) => m.board.name === 'Sensor board')!.id);
    p.links = numberLinks([...(p.links ?? []), ...autoLinks(p)]);
    for (const m of p.modules.filter((x) => x.board.kind !== 'box')) addUartLinks(p, m.id);
    const r = generatePanel(p);
    const w = r.report.warnings.join('\n');
    expect(w.split('\n').filter((x) => /Nothing clips|runs into|ribbon is/.test(x))).toEqual([]);
    // a slot for each probe, the second one for the dual-MCU board on the towers of the first
    expect(r.report.checks.filter((c) => c.name === 'Slot').length).toBe(3);
    expect(r.report.checks.filter((c) => c.name === 'Stacking towers').length).toBe(2);
    const ribbons = r.report.cables!.filter((c) => c.kind === 'debug');
    expect(ribbons.length).toBe(3);
    for (const c of ribbons) { expect(c.buy).toBe(0); expect(c.ribbon).toBe(200); expect(c.length).toBeLessThan(200); expect(c.clash).toBeUndefined(); }
    expect(r.report.checks.find((c) => c.name === 'Debug ribbons')?.status).toBe('ok');
    // the serial cables are ordinary cables to buy
    const serial = r.report.cables!.filter((c) => c.kind === 'uart');
    expect(serial.length).toBe(2);
    for (const c of serial) { expect(c.buy).toBeGreaterThan(0); expect(c.ribbon).toBeUndefined(); }
    // the ribbons are drawn flat, with a red pin-1 edge
    expect(r.ghosts.filter((g) => /^cable .* stripe$/.test(g.name)).length).toBe(3);
    // no strap for a probe
    expect(r.report.checks.some((c) => c.name === 'Strap loops' && /J-Link/.test(c.group))).toBe(false);
    expect((r.steps ?? []).some((s) => /slide the J-Link .* down into it/.test(s.text))).toBe(true);
  }, 120_000);
});
