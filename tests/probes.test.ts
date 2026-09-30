// Debug probes (J-Link): debug headers found on import or marked by hand, a J-Link for each: ordinary small boards
// standing on their long edges in columns by their board, ribbons that come with the probe.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { TEMPLATES } from '../src/model/templates';
import { debugType, newModule, newProject } from '../src/model/library';
import { autoLinks, isDebugPort, numberLinks, plugRole } from '../src/model/links';
import { addAdapters, addProbes, addUartLinks, adapterFor, columnHeight, columnLimit, debugHeaders, fillWires, headerPins, isAdapter, isProbe, isSmall, isUartPort, markDebug, probesOf, stackCompanions, uartHeaders, uartPins, uartWiring } from '../src/model/probes';
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

describe('UART pins', () => {
  it('come from the nets in a KiCad file, else a guess from the header size, else what you set', () => {
    const b = example('dual-mcu-swd.kicad_pcb'), c = uartHeaders(b)[0];
    expect(c.pins!.map((q) => q.net)).toEqual(['GND', 'CTS', '+3V3', '/RXI', '/TXO', '/DTR']);
    const u = uartPins(c)!;
    expect([u.from, u.gnd.n, u.rx.n, u.tx.n]).toEqual(['nets', '1', '4', '5']);
    const s = uartPins(uartHeaders(example('sensor-jtag.kicad_pcb'))[0])!;
    expect([s.from, s.gnd.n, s.rx.n, s.tx.n]).toEqual(['nets', '4', '3', '2']);
    // no nets: an FTDI six is guessed, and says so
    const bare = { ...c, pins: undefined };
    expect(headerPins(bare).length).toBe(6);
    expect([uartPins(bare)!.from, uartPins(bare)!.rx.n]).toEqual(['guess', '4']);
    expect(uartWiring(bare)).toMatch(/a guess/);
    expect(uartPins({ ...bare, uart: { gnd: '6', rx: '2', tx: '3' } })!.gnd.n).toBe('6');
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

  it('is an ordinary small board: the 20-pin 1.27 mm Cortex connector on its face by one long edge, its USB-B on one end', () => {
    const j = T('jlink'), dbg = j.comps.find(isDebugPort)!, usb = j.comps.find((c) => c.conn?.type === 'usb_b')!;
    expect([j.kind, j.box, j.role, isSmall(j)]).toEqual([undefined, undefined, 'probe', true]);
    // the same connector as the boards it debugs (Samtec SHF-110 and the like): one straight ribbon, no adapter
    expect([dbg.conn!.type, dbg.conn!.entry, dbg.y < 12, dbg.h]).toEqual(['cortex20', 'top', true, 5.6]);
    // its USB-B flush with its end, as a board's connectors are
    expect(usb.conn!.entry).toBe('edge');
    expect(usb.x + usb.w / 2).toBeCloseTo(65 + 6.3, 6);
  });

  it('adds one per free header, cabled to it, stacked, the board still the one being edited', () => {
    const p = rack();
    p.active = 1;
    const added = addProbes(p, p.modules[0].id);
    expect(added.length).toBe(2);
    expect(added.every(isProbe)).toBe(true);
    expect(p.modules[3].board.name).toBe('Sensor board');
    expect(p.active).toBe(3);
    // two J-Links are taller than the dock's tongue takes (a 20 N push on top, PETG): each stands in a column of its own
    expect(columnHeight(added)).toBeGreaterThan(columnLimit(added[0].holder));
    expect(added.map((x) => x.on ?? null)).toEqual([null, null]);
    expect(probesOf(p, p.modules[0]).map((m) => m.id)).toEqual(added.map((m) => m.id));
    expect(p.links!.every((l) => l.kind === 'debug')).toBe(true);
    // nothing left to add
    expect(addProbes(p, p.modules[0].id)).toEqual([]);
    // an adapter on top of a J-Link fits: it goes on the first column
    const [ad] = addAdapters(p, p.modules[0].id);
    expect([ad.on, ad.onMode]).toEqual([added[0].id, 'column']);
    expect(columnHeight([added[0], ad])).toBeLessThanOrEqual(columnLimit(ad.holder));
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
      const usb = pr.board.comps.find((c) => c.conn?.type === 'usb_b')!;
      expect(plugRole(pr, usb)).toBe('device');
      expect(p.links.some((l) => l.kind === 'usb' && (l.a.module === pr.id || l.b.module === pr.id))).toBe(true);
    }
    // two J-Links on one board are too tall for one column: nothing to stack
    expect(stackCompanions(p)).toBe(false);
  });

  it('seats each board with its first column in the back slot of its dock, the next in a dock beside it', () => {
    const p = rack();
    addProbes(p, p.modules[0].id);
    addProbes(p, p.modules.find((m) => m.board.name === 'Sensor board')!.id);
    const docks = autoAssign(p).filter((m) => m.kind === 'dock');
    const name = (id: string | null) => p.modules.find((m) => m.id === id)?.board.name ?? '';
    // (the dual-MCU board's second J-Link goes before it: its header is on that side)
    expect(docks.map((d) => d.slots.map((s) => name(s.module).replace(/\s*\(.*\)$/, '')))).toEqual([['J-Link', ''], ['Dual-MCU controller', 'J-Link'], ['Sensor board', 'J-Link']]);
    expect(docks.every((d) => d.turn % 180 === 0)).toBe(true);
  });

  it('needs an adapter only where the pin counts differ', () => {
    const p = rack();
    // (the J-Link with the 10-pin Cortex-M connector is what a 10-pin header is offered: no adapter)
    const [own] = addProbes(p, p.modules[0].id, ['J_SWD2']);
    expect(own.board.comps.find(isDebugPort)!.conn!.type).toBe('swd10');
    expect(adapterFor(own.board.comps.find(isDebugPort)!, debugHeaders(p.modules[0].board)[0])).toBeNull();
    const [pr] = addProbes(p, p.modules[0].id, ['J_SWD1'], 'jlink');
    const port = pr.board.comps.find(isDebugPort)!, head = debugHeaders(p.modules[0].board)[0];
    // the J-Link's 20-pin 1.27 mm connector: a 10-pin header takes an adapter, a 20-pin 1.27 mm one a straight ribbon
    expect(port.conn!.type).toBe('cortex20');
    expect(adapterFor(port, head)).toMatch(/20-to-10-pin 1.27 mm adapter/);
    expect(adapterFor(port, debugHeaders(T('example_jtag'))[0])).toMatch(/1.27 mm to 2.54 mm 20-pin adapter/);
    const cortex = { ...head, conn: { ...head.conn!, type: 'cortex20' } };
    expect(adapterFor(port, cortex)).toBeNull();
  });
});

describe('probe rack', () => {
  beforeAll(async () => { await initKernel(); });

  it('stands the probes in columns by their boards, with ribbons that reach and nothing to buy for them', () => {
    const p = newProject(T('example_dual_swd'));
    p.modules.push(newModule(T('example_jtag')), newModule(T('usb_hub7')));
    addProbes(p, p.modules[0].id);
    addProbes(p, p.modules.find((m) => m.board.name === 'Sensor board')!.id);
    p.links = numberLinks([...(p.links ?? []), ...autoLinks(p)]);
    for (const m of p.modules.filter((x) => x.board.kind !== 'box')) addUartLinks(p, m.id);
    const r = generatePanel(p);
    const w = r.report.warnings.join('\n');
    expect(w.split('\n').filter((x) => /Nothing clips|runs into/.test(x))).toEqual([]);
    // J-Links are boards in holders of their own now: clipped in, no slots, no towers
    expect(r.report.checks.filter((c) => c.name === 'Slot' || c.name === 'Stacking towers')).toEqual([]);
    expect(r.report.checks.filter((c) => c.name === 'Spring clips (2)' && /^J-Link/.test(c.group)).length).toBe(3);
    const ribbons = r.report.cables!.filter((c) => c.kind === 'debug');
    expect(ribbons.length).toBe(3);
    for (const c of ribbons) { expect(c.buy).toBe(0); expect(c.ribbon).toBe(200); expect(c.clash).toBeUndefined(); }
    // short from behind their boards; the dual-MCU board's second J-Link, in the dock beside it, needs a longer ribbon
    // than the usual 200 mm, and says so
    expect(ribbons.filter((c) => c.length < 190).length).toBe(2); // (the JTAG box header's ribbon is 25 mm wide: a little longer)
    expect(Math.max(...ribbons.map((c) => c.length))).toBeLessThan(260);
    expect(w.split('\n').filter((x) => /ribbon is 200 mm but has to run/.test(x)).map((x) => /J_SWD2/.test(x))).toEqual([true]);
    expect(r.report.cables!.every((c) => !c.clash)).toBe(true);
    // the serial cables are ordinary cables to buy
    const serial = r.report.cables!.filter((c) => c.kind === 'uart');
    expect(serial.length).toBe(2);
    for (const c of serial) { expect(c.buy).toBeGreaterThan(0); expect(c.ribbon).toBeUndefined(); expect(c.wires).toMatch(/black \(GND\) on pin/); }
    // drawn as a lead that splits into three loose jumper wires, one on each pin
    expect(r.ghosts.filter((g) => / wire \d$/.test(g.name)).length).toBe(6);
    // the ribbons are drawn flat, with a red pin-1 edge
    expect(r.ghosts.filter((g) => /^cable .* stripe$/.test(g.name)).length).toBe(3);
    // no strap for a probe
    expect(r.report.checks.some((c) => c.name === 'Strap loops' && /J-Link/.test(c.group))).toBe(false);
    expect((r.steps ?? []).some((s) => /Snap the J-Link .* into its holder/.test(s.text))).toBe(true);
  }, 120_000);
});

describe('USB-serial adapters', () => {
  beforeAll(async () => { await initKernel(); });
  const rack = () => {
    const p = newProject(T('example_dual_swd'));
    p.modules.push(newModule(T('example_jtag')), newModule(T('usb_hub7')));
    for (const m of p.modules.filter((x) => x.board.kind !== 'box')) { addProbes(p, m.id); addAdapters(p, m.id); }
    p.links = numberLinks([...(p.links ?? []), ...autoLinks(p)]).map((l) => fillWires(p, l));
    return p;
  };

  it('go on a J-Link\'s column, jumper wires crossed over from their pins to its UART header', () => {
    const p = rack(), board = p.modules[0];
    const ad = p.modules.filter(isAdapter);
    expect(ad.length).toBe(2);
    expect(probesOf(p, board).map((m) => m.board.name.replace(/ \(.*$/, ''))).toEqual(['J-Link', 'J-Link', 'USB-serial adapter']);
    // on the first J-Link's column (the two J-Links are each a column: too tall together)
    expect([ad[0].on, ad[0].onMode]).toEqual([probesOf(p, board)[0].id, 'column']);
    const l = p.links!.find((x) => x.kind === 'jumper' && x.b.module === board.id)!;
    // its GND (pin 6), TXD (3), RXD (2) to the board's GND (1), RXI (4), TXO (5)
    expect(l.wires!.map((w) => [w.a, w.b])).toEqual([['6', '1'], ['3', '4'], ['2', '5']]);
    // and its USB to the hub
    expect(p.links!.some((x) => x.kind === 'usb' && x.a.module === ad[0].id)).toBe(true);
    // a second press adds nothing
    expect(addAdapters(p, board.id)).toEqual([]);
  });

  it('stand on a J-Link in its column, the wires going round the dock to the pins, bought by the wire', () => {
    const p = rack(), r = generatePanel(p);
    expect(r.report.warnings.filter((x) => /runs into|don't fit|towers are close|Nothing clips/.test(x))).toEqual([]);
    expect(r.report.checks.filter((c) => c.name === 'Box ports')).toEqual([]);
    const jumpers = r.report.cables!.filter((c) => c.kind === 'jumper');
    expect(jumpers.length).toBe(2);
    for (const c of jumpers) { expect(c.clash).toBeUndefined(); expect([0.1, 0.15, 0.2, 0.3]).toContain(c.buy); expect(c.wires).toMatch(/black wire from pin 6 \(GND\)/); }
    // three wires each, with a housing on every pin at both ends
    expect(r.ghosts.filter((g) => / wire \d$/.test(g.name)).length).toBe(6);
    expect((r.steps ?? []).some((s) => /Push the jumper wires on/.test(s.text))).toBe(true);
    // each adapter on its J-Link: a column of two, one rod down through both, the adapter in a slot (its ends are
    // its plugs: no room for spring clips), the holder on the landing below on pegs
    const cols = r.report.checks.filter((c) => c.name === 'Column');
    expect(cols.map((c) => c.value).sort()).toEqual(['1 of 2', '1 of 2', '2 of 2', '2 of 2']);
    expect(r.report.checks.filter((c) => c.name === 'Slot').map((c) => c.group.replace(/ \(.*$/, ''))).toEqual(['USB-serial adapter', 'USB-serial adapter']);
    expect(r.parts.filter((x) => x.tag?.kind === 'rod').length).toBe(5); // one per dock slot: the two boards, two columns of two, a J-Link alone
    expect(r.report.checks.filter((c) => /^Tongue root/.test(c.name) && c.status === 'bad')).toEqual([]);
    expect((r.steps ?? []).filter((s) => /Stand the USB-serial adapter .* holder on its long edge on the J-Link/.test(s.text)).length).toBe(2);
    expect((r.steps ?? []).filter((s) => /Push the release rod down through the column/.test(s.text)).length).toBe(2);
  }, 120_000);
});

