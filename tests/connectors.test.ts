// Connectors known by name or part number: the ones a board's footprints or values usually carry, so few come in as
// "Custom connector"; each sized for its pins where the name says how many, and plain parts left alone.
import { describe, it, expect, beforeAll } from 'vitest';
import { initKernel } from '../src/cad/kernel';
import { classify, CONNECTORS, guessPackage, nameCircuits, newModule, newProject } from '../src/model/library';
import { compatible, isDebugPort, isUartPort, KIND_COLOR, numberLinks, offRackTo, plugRole } from '../src/model/links';
import { uartPins } from '../src/model/probes';
import { generate } from '../src/cad/assembly';
import { PALETTE } from '../src/model/palette';
import { pictureOf, plugDetail } from '../src/cad/boardviz';
import { edgeConnector } from '../src/model/palette';
import type { Board, Comp, Link, Module } from '../src/model/types';

const type = (pkg: string, ref = 'J1', value = '') => guessPackage(pkg, ref, value).conn?.id;

describe('connectors by name and part number', () => {
  beforeAll(async () => { await initKernel(); });
  it('the ones from the Allegro board', () => {
    expect(type('A829-1A1T-91B')).toBe('rj45'); // Bel MagJack
    expect(type('PJ-102AH')).toBe('barrel'); // CUI DC jack
    expect(type('3020-10-0200-00')).toBe('idc_ra'); // CNC Tech box header, right-angle
    expect(guessPackage('3020-10-0200-00', 'J1').w).toBeCloseTo(20.3, 1);
    expect(type('3020-16-0100-00')).toBe('idc');
    expect(type('502352-0200')).toBe('wtb_side'); // Molex DuraClik, 2 mm right-angle
    expect(guessPackage('502352-0200', 'J1').w).toBeCloseTo(6, 1);
    const s = guessPackage('PPTC122LFBN-RC', 'J1'); // Sullins socket, 12 a row, two rows
    expect([s.conn?.id, s.kind, s.w, s.l]).toEqual(['header', 'header', 12 * 2.54, 2 * 2.54]);
    expect(guessPackage('PBC03SAAN', 'J1').w).toBeCloseTo(3 * 2.54, 3);
    expect(guessPackage('PEC02SAAN', 'J1').w).toBeCloseTo(2 * 2.54, 3);
    expect(guessPackage('X', 'J1', '61300611121').w).toBeCloseTo(6 * 2.54, 3); // Würth, by its value
  });

  it('micro-USB, USB-C and the rest by their makers\' part numbers', () => {
    for (const p of ['10118194-0001LF', 'ZX62-B-5PA', '105017-0001', '47346-0001', 'USB_MICRO_B', 'MICRO-AB']) expect(type(p), p).toBe('usb_micro_b');
    for (const p of ['USB4105-GF-A', '12401598E4#2A', 'TYPE-C-31-M-12']) expect(type(p), p).toBe('usb_c');
    for (const p of ['UX60-MB-5ST', '67503-1020']) expect(type(p), p).toBe('usb_mini_b');
    expect(type('292303-1')).toBe('usb_a');
    expect(type('61400416021')).toBe('usb_b');
    expect(type('HR911105A')).toBe('rj45');
    expect(type('RJ11_6P6C')).toBe('rj11');
    expect(type('47151-1051')).toBe('hdmi_a');
    expect(type('DisplayPort_Molex_47272')).toBe('dp');
    expect(type('PJ-320A')).toBe('audio35');
    expect(type('SJ1-3523N')).toBe('audio35');
    expect(type('RCJ-014')).toBe('rca');
    expect(type('DM3AT-SF-PEJM5')).toBe('microsd');
    expect(type('SD_Kyocera_145638009211859+')).toBe('sd');
    expect(type('BNC_Amphenol_031-5431')).toBe('bnc');
    expect(type('U.FL_Hirose_U.FL-R-SMT-1_Vertical')).toBe('ufl');
    expect(type('132134')).toBe('sma');
    expect(type('XT60PW-M')).toBe('xt60');
    expect(type('XT30UPB-F')).toBe('xt30');
    expect(type('1935161')).toBe('terminal');
  });

  it('the wire-to-board families, upright and side entry, sized for their pins', () => {
    const g = guessPackage('JST_GH_BM04B-GHS-TBT_1x04-1MP_P1.25mm_Vertical', 'J1');
    expect([g.conn?.id, g.w]).toEqual(['jst_gh', 6.75]);
    expect(type('JST_ZH_B4B-ZR_1x04_P1.50mm_Vertical')).toBe('jst_zh');
    expect(type('Molex_PicoBlade_53047-0610_1x06_P1.25mm_Vertical')).toBe('picoblade');
    expect(type('Molex_KK-254_AE-6410-04A_1x04_P2.54mm_Vertical')).toBe('kk254');
    expect(type('22-27-2031')).toBe('kk254');
    const mf = guessPackage('Molex_Micro-Fit_3.0_43045-2400_2x12_P3.00mm_Vertical', 'J1');
    expect([mf.conn?.id, mf.w]).toEqual(['microfit', 11 * 3 + 6.6]);
    expect(type('Molex_Mini-Fit_Jr_5566-24A_2x12_P4.20mm_Vertical')).toBe('minifit');
    expect(type('JST_PH_S2B-PH-K_1x02_P2.00mm_Horizontal')).toBe('wtb_side');
    expect(type('S4B-XH-A')).toBe('wtb_side');
    expect(type('JST_PH_B2B-PH-K_1x02_P2.00mm_Vertical')).toBe('jst_ph');
    expect(type('Molex_Micro-Fit_3.0_43045-0400_2x02_P3.00mm_Horizontal')).toBe('wtb_side');
    const idc = guessPackage('IDC-Header_2x08_P2.54mm_Vertical', 'J1');
    expect([idc.conn?.id, idc.w]).toEqual(['idc', 8 * 2.54 + 7.6]);
    expect(idc.conn?.plug.w).toBeCloseTo(18.3 + idc.w - 20.3, 2);
    expect(type('IDC-Header_2x05_P2.54mm_Horizontal')).toBe('idc_ra');
    const fpc = guessPackage('Hirose_FH12-24S-0.5SH_1x24-1MP_P0.50mm_Horizontal', 'J1');
    expect([fpc.conn?.id, fpc.w]).toEqual(['fpc', 23 * 0.5 + 5]);
    expect(nameCircuits('53047-0410')).toBe(4);
    expect(nameCircuits('C_Rect_L7.0mm_W2.5mm')).toBe(0);
  });

  it('plain parts stay plain', () => {
    for (const p of ['R_0603_1608Metric', 'C_Rect_L7.0mm_W2.1mm_P5.00mm', 'SOIC-8_3.9x4.9mm_P1.27mm', 'LED_0603', 'Crystal_HC49-4H_Vertical', 'TO-220-3_Vertical', 'CP_Elec_6.3x7.7', 'QFN-32-1EP_5x5mm_P0.5mm', 'SOT-23-5', 'L_1210'])
      expect(guessPackage(p, 'R1').conn, p).toBeUndefined();
  });

  it('every type has its own model, receptacle and plug', () => {
    const b: Board = { name: 'T', outline: [[0, 0], [120, 0], [120, 80], [0, 80]], thickness: 1.6, holes: [], cutouts: [], comps: [] } as unknown as Board;
    for (const t of CONNECTORS.filter((t) => t.entry === 'edge')) b.comps.push({ ...edgeConnector(b, t.id, [60, 0]), ref: `E_${t.id}` });
    for (const it of PALETTE.filter((x) => !x.edge && x.group === 'Headers and wires')) { const c = it.make(b, [60, 40]).comp; if (c) b.comps.push({ ...c, ref: `U_${it.id}` }); }
    const ghosts = pictureOf(b);
    const mats = new Set(ghosts.map((g) => g.mat));
    for (const m of ['yellow', 'white', 'gold', 'metal', 'black']) expect(mats.has(m as never), m).toBe(true);
    for (const g of ghosts) expect(g.mesh.pos.length, g.name).toBeGreaterThan(0);
    for (const t of CONNECTORS) {
      const plug = plugDetail([0, 0], [1, 0], 5, t.plug, { kind: 'plug', module: 'm', refs: ['J1'] }, { seq: 30, dir: [1, 0, 0] }, t.id);
      expect(plug.length, t.id).toBeGreaterThan(0);
      for (const g of plug) expect(Number.isFinite(g.mesh.pos[0]), t.id).toBe(true);
    }
  });
});

describe('wiring the new connectors', () => {
  beforeAll(async () => { await initKernel(); });

  it('each plugs into what it should, and its lead off the rack says where it goes', () => {
    const b = (comps: [string, string][]): Module => newModule({ name: 'B', outline: [[0, 0], [60, 0], [60, 40], [0, 40]], thickness: 1.6, holes: [], cutouts: [], source: 't', notes: [],
      comps: comps.map(([ref, pkg]) => classify({ id: ref, ref, pkg, side: 'top', x: 30, y: 20, rot: 0, w: 1, l: 1, h: 1, kind: 'generic', tht: false } as Comp, false)) } as unknown as Board);
    const A = b([['J1', 'DisplayPort'], ['J2', 'RCJ-014'], ['J3', 'IDC-Header_2x05_P2.54mm_Vertical'], ['J4', 'BNC_Amphenol_031-5431'], ['J5', 'XT60PW-M'], ['J6', 'JST_GH_BM04B-GHS-TBT_1x04_P1.25mm_Vertical']]);
    const B = b([['J1', 'HDMI_A'], ['J2', 'PJ-320A'], ['J3', 'IDC-Header_2x08_P2.54mm_Vertical'], ['J4', 'PinHeader_1x04_P2.54mm_Vertical']]);
    const role = (m: Module, ref: string) => plugRole(m, m.board.comps.find((c) => c.ref === ref)!);
    expect(['J1', 'J2', 'J3', 'J4', 'J5', 'J6'].map((r) => role(A, r))).toEqual(['video', 'audio', 'wire', 'other', 'other', 'other']);
    expect(compatible(role(A, 'J1'), role(B, 'J1'))).toBe(true); // DisplayPort to HDMI (a DP to HDMI cable)
    expect(compatible(role(A, 'J2'), role(B, 'J2'))).toBe(true); // RCA to 3.5 mm
    expect(compatible(role(A, 'J3'), role(B, 'J3'))).toBe(true); // a ribbon between box headers
    expect(compatible(role(A, 'J3'), role(B, 'J4'))).toBe(true); // or jumper wires onto pins
    expect(compatible(role(A, 'J4'), role(B, 'J1'))).toBe(false);
    const to = (ref: string) => offRackTo(A, A.board.comps.find((c) => c.ref === ref)!);
    expect([to('J4'), to('J5'), to('J1')]).toEqual(['to a scope or instrument', 'to its battery', 'to a screen']);
    // a JTAG box header named for it is a debug port a J-Link cables to
    expect(isDebugPort(classify({ id: 'x', ref: 'J9', pkg: 'IDC-Header_2x07_P2.54mm_Vertical', value: 'JTAG', side: 'top', x: 0, y: 0, rot: 0, w: 1, l: 1, h: 1, kind: 'generic', tht: false } as Comp, false))).toBe(true);
  });

  it('a cable between two box headers is drawn as a flat ribbon, its ends in their plugs', () => {
    const b = (name: string, pkg: string): Board => ({ name, outline: [[0, 0], [60, 0], [60, 40], [0, 40]], thickness: 1.6, holes: [{ id: 'h1', x: 4, y: 4, d: 3.2, plated: true, use: 'auto', role: 'mount' }, { id: 'h2', x: 56, y: 36, d: 3.2, plated: true, use: 'auto', role: 'mount' }], cutouts: [], source: 't', notes: [],
      comps: [classify({ id: 'c', ref: 'J1', pkg, side: 'top', x: 30, y: 20, rot: 0, w: 1, l: 1, h: 1, kind: 'generic', tht: true } as Comp, false)] } as unknown as Board);
    const p = newProject(b('Left', 'IDC-Header_2x05_P2.54mm_Vertical'));
    p.modules.push(newModule(b('Right', 'IDC-Header_2x05_P2.54mm_Vertical')));
    generate(p);
    p.links = numberLinks([{ id: 'L1', a: { module: p.modules[0].id, ref: 'J1' }, b: { module: p.modules[1].id, ref: 'J1' }, kind: 'wire' } as Link]);
    const r = generate(p);
    const cable = r.ghosts.find((g) => g.name === 'cable L1');
    expect(cable, 'the ribbon').toBeTruthy();
    expect(cable!.color).toBe(KIND_COLOR.debug); // the grey ribbon, not a round wire
    expect(r.ghosts.some((g) => g.name === 'cable L1 stripe'), 'its red pin 1 edge').toBe(true);
  });
});

describe('serial headers by their pins', () => {
  const pin = (n: number, net: string) => ({ n: String(n), x: n * 2.54, y: 0, net });
  it('GND, FDX, TX: a UART header a USB-serial adapter wires to, RX the one left (to check)', () => {
    const c = classify({ id: 'x', ref: 'J7', pkg: 'HDR1X3', side: 'top', x: 0, y: 0, rot: 0, w: 1, l: 1, h: 1, kind: 'generic', tht: true, pins: [pin(1, 'GND'), pin(2, 'FDX'), pin(3, 'TX')] } as Comp, false);
    expect(isUartPort(c)).toBe(true);
    const u = uartPins(c)!;
    expect([u.gnd.n, u.rx.n, u.tx.n, u.from]).toEqual(['1', '2', '3', 'guess']);
    // with a power pin as well, RX is still the one signal left
    const d = { ...c, pins: [pin(1, 'GND'), pin(2, '3V3'), pin(3, 'FDX'), pin(4, 'TX')] } as Comp;
    expect(uartPins(d)!.rx.n).toBe('3');
  });
  it('a JST whose nets are TX and RX is a UART port too', () => {
    const c = classify({ id: 'x', ref: 'J8', pkg: 'JST_GH_BM04B-GHS-TBT_1x04_P1.25mm_Vertical', side: 'top', x: 0, y: 0, rot: 0, w: 1, l: 1, h: 1, kind: 'generic', tht: false, pins: [pin(1, 'VCC'), pin(2, 'UART1_TX'), pin(3, 'UART1_RX'), pin(4, 'GND')] } as Comp, false);
    expect(c.conn?.type).toBe('jst_gh');
    expect(isUartPort(c)).toBe(true);
  });
});
