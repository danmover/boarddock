// Connectors known by name or part number: the ones a board's footprints or values usually carry, so few come in as
// "Custom connector"; each sized for its pins where the name says how many, and plain parts left alone.
import { describe, it, expect, beforeAll } from 'vitest';
import { initKernel } from '../src/cad/kernel';
import { classify, CONN_REF, CONNECTORS, guessPackage, nameCircuits, newModule, newProject } from '../src/model/library';
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

describe('connectors as Allegro libraries name them', () => {
  beforeAll(async () => { await initKernel(); });
  const plain = (pkg: string, ref: string, value = '') => expect(guessPackage(pkg, ref, value).conn, `${pkg} on ${ref}`).toBeUndefined();

  it('IPC-7251 header names (Allegro libraries, Ultra Librarian, SamacSys), sized for their pins', () => {
    const one = guessPackage('HDRV10W64P254_1X10_2540X254X850B', 'J1');
    expect([one.conn?.id, one.kind]).toEqual(['header', 'header']);
    expect([one.w, one.l]).toEqual([expect.closeTo(25.4, 3), expect.closeTo(2.54, 3)]);
    const two = guessPackage('HDRV20W64P254_2X10_2540X508X850B', 'J1');
    expect([two.w, two.l]).toEqual([expect.closeTo(25.4, 3), expect.closeTo(5.08, 3)]);
    expect(guessPackage('HDRRA10W64P254_1X10_2540X254X850B', 'J1').h).toBeCloseTo(2.5 + 2.54, 3); // right-angle: low
    expect(type('HDRV10W64P127_2X5_1270X254X600B')).toBe('swd10'); // 2 x 5 at 1.27 mm: the Cortex debug connector
    expect(guessPackage('SIP4', 'J1').w).toBeCloseTo(4 * 2.54, 3);
  });

  it('the maker in front of a part number, or its dashes taken out, is the same part', () => {
    const same = (a: string, b: string, id: string) => { expect(type(a), a).toBe(id); expect(type(b), b).toBe(id); };
    same('SAMTEC_SHF-110-01-L-D-TH', 'SHF11001LDTH', 'cortex20');
    same('SAMTEC_TSW-110-07-L-S', 'TSW11007LS', 'header');
    expect(guessPackage('TSW11007LS', 'J3').w).toBeCloseTo(25.4, 3);
    expect(guessPackage('SAMTEC_TSW-110-07-L-D', 'J3').l).toBeCloseTo(5.08, 3);
    same('TE_5745781-4', '57457814', 'dsub');
    same('BEL_A829-1A1T-91B', 'A8291A1T91B', 'rj45');
    same('CNC_3020-10-0200-00', '302010020000', 'idc_ra');
    same('CNC_3020-10-0100-00', '302010010000', 'idc');
    expect(guessPackage('302010020000', 'J1').w).toBeCloseTo(5 * 2.54 + 7.6, 2); // sized for its 10 pins
    same('MULTICOMP_MC000046', 'MC000046', 'terminal'); // Multicomp's 2-way 5 mm screw terminal block
    expect(type('WURTH_61300611121')).toBe('header');
    expect(guessPackage('HARWIN_M20-9990345', 'J1').w).toBeCloseTo(3 * 2.54, 3);
    expect(guessPackage('SULLINS_PBC03SAAN', 'J1').w).toBeCloseTo(3 * 2.54, 3);
  });

  it('more of the makers\' families: terminal blocks, USB-C, RJ45, D-sub, DC jacks, wire-to-board', () => {
    const all = (id: string, names: string[]) => { for (const n of names) expect(type(n), n).toBe(id); };
    all('terminal', ['MC000046', 'MC000047', 'MC000048', 'MC001346', 'TB_2P_5MM', 'TBLOCK-I2', 'BLZP5.08HC/02', 'SL3.5/2/90', 'PTSM 0,5/ 4-2,5-H', 'AK300/2', 'CTB9350/2', 'DG350-3.5-02P', 'DB127-5.0-2P', '1715721', 'OSTTC022162']);
    all('usb_c', ['12401610E4#2A', '12401548E4#2A', 'USB4110-GF-A', 'GSB1C41110SSHR']);
    all('usb_a', ['USB3_A']);
    all('usb_a_dual', ['USB3.0_A_DUAL']);
    all('usb_b', ['USB_3.0_B']);
    all('hdmi_a', ['HDMI_TYPE_A', 'HDMI-19']); // not USB-A's "type A"
    all('rj45', ['HFJ11-2450E-L12RL', 'TRJG0926HENL', 'SS-6488-NF']);
    all('dsub', ['DB15', 'VGA_DB15HD', 'SUBD9', 'SUB-D_9', 'L717SDE09P', '172-E09-2', 'DE-9']);
    all('barrel', ['KLDHCX-0202-A', 'PWR_JACK', 'DCPWR', 'EJ508A', 'PJ1-063', 'DC POWER 2.1MM', 'DC-005']);
    all('fpc', ['FH28-30S-0.5SH', 'XF2M-2415-1A']);
    all('sma', ['73251-1150', 'SMA_EDGE']);
    all('rf_mini', ['MMCX_VERT', 'SMB_RA', 'MCX']);
    all('jst_xh', ['B2B-EH-A']);
    all('jst_ph', ['DF11-8DP-2DS', 'DF3-2P-2DS']);
    all('picoblade', ['DF13-4P-1.25DSA', 'Molex_Pico-EZmate_78171']);
    all('microfit', ['Molex_Nano-Fit']);
    all('minifit', ['Molex_Mega-Fit_170', 'Molex_Ultra-Fit_172']);
    all('kk254', ['B2P-VH', 'TE_640456-2', 'MOLEX_26-48-1045']);
    all('idc', ['3M_N2510-6002-RB', '61201021621']);
    // a 3.96 mm family is as wide as its pitch says, not the 2.54 mm one's
    expect(guessPackage('B4P-VH', 'J1').w).toBeCloseTo(3 * 3.96 + 2.54, 2);
    expect(nameCircuits('B2P-VH')).toBe(2);
  });

  it('chips, diodes and other parts named like connectors stay plain', () => {
    for (const [pkg, ref] of [['SMA', 'D1'], ['DO-214AC_SMA', 'D2'], ['SMA_Diode', 'D3'], ['SMB', 'D4'], ['SMBJ5.0A', 'D5'], ['TRS3232', 'U1'], ['HDMI_ESD_TPD12S016', 'U2'], ['USB4640', 'U3'], ['USB3300', 'U4'], ['TB6612FNG', 'U5'],
      ['SPH0645LM4H', 'MK1'], ['MCXN947', 'U6'], ['MCXA153', 'U6'], ['SIM800L', 'U6'], ['PEX8747', 'U6'], ['PCIE_SWITCH', 'U6'], ['M2', 'H1'], ['DIMM_TEMP_SENSOR_TS3', 'U6'], ['ETHERNET_PHY', 'U7'], ['MAX3232_RS232', 'U8'], ['AUDIO_CODEC', 'U9'], ['DisplayPort_ESD', 'U10'], ['SIM7100', 'U11'], ['SFPD', 'U12']]) plain(pkg, ref);
  });

  it('a bare word names a connector only on a connector\'s reference', () => {
    expect(type('HDMI', 'J1')).toBe('hdmi_a');
    expect(type('HDMI', 'U1')).toBeUndefined();
    expect(type('SMA', 'J2')).toBe('sma');
    expect(type('SMA', 'D1')).toBeUndefined();
    expect(type('X', 'HDMI1', 'HDMI')).toBe('hdmi_a'); // HDMI1 is a connector's reference
    expect(type('X', 'ANT1', 'SMA')).toBe('sma');
    for (const r of ['J1', 'P3', 'CN2', 'JP1', 'TB1', 'JK2', 'RJ1', 'PL1', 'SKT1', 'ANT1', 'HDMI1', 'SD1', 'SIM1', 'PWR1', 'CONN1', 'X2', 'USB1']) expect(CONN_REF.test(r), r).toBe(true);
    for (const r of ['R1', 'C7', 'U3', 'D1', 'Q2', 'L1', 'Y1', 'SW1', 'TP1', 'K1', 'DC1']) expect(CONN_REF.test(r), r).toBe(false);
  });

  it('SATA, SFP, mini-DIN and a C14 inlet are known, and wired as what they are', () => {
    for (const [pkg, id] of [['SATA_7P', 'sata'], ['SATA_Molex_67800', 'sata'], ['SFP_CAGE', 'sfp'], ['SFP+', 'sfp'], ['MINIDIN_6', 'minidin'], ['PS2', 'minidin'], ['IEC_C14', 'iec_c14'], ['IEC_60320_C14', 'iec_c14'], ['C14_INLET', 'iec_c14']]) expect(type(pkg), pkg).toBe(id);
    expect(type('IEC_60320_C7')).toBe('iec_c7'); // the figure-8 one is still the C7
    const m = newModule({ name: 'B', outline: [[0, 0], [60, 0], [60, 40], [0, 40]], thickness: 1.6, holes: [], cutouts: [], source: 't', notes: [],
      comps: [['J1', 'SATA_7P'], ['J2', 'SFP_CAGE'], ['J3', 'MINIDIN_6'], ['J4', 'IEC_C14'], ['J5', 'RJ45_8P8C']].map(([ref, pkg]) => classify({ id: ref, ref, pkg, side: 'top', x: 30, y: 20, rot: 0, w: 1, l: 1, h: 1, kind: 'generic', tht: false } as Comp, false)) } as unknown as Board);
    const comp = (ref: string) => m.board.comps.find((c) => c.ref === ref)!;
    const role = (ref: string) => plugRole(m, comp(ref));
    expect(role('J4')).toBe('mains-in'); // a mains inlet takes the wall's lead, not a supply's
    expect(role('J2')).toBe('net');
    expect(compatible(role('J2'), role('J5'))).toBe(true); // an SFP link to an RJ45 (a media converter)
    expect([offRackTo(m, comp('J1')), offRackTo(m, comp('J2')), offRackTo(m, comp('J4'))]).toEqual(['to a drive', 'to the network', 'to the wall']);
  });
});

describe('the connector families left over: mezzanines, card sockets, round connectors', () => {
  beforeAll(async () => { await initKernel(); });
  const board = (): Board => ({ name: 'T', outline: [[0, 0], [160, 0], [160, 90], [0, 90]], thickness: 1.6, holes: [], cutouts: [], comps: [], source: 't', notes: [] } as unknown as Board);
  const part = (pkg: string, ref = 'J1') => classify({ id: ref, ref, pkg, side: 'top', x: 30, y: 45, rot: 0, w: 1, l: 1, h: 1, kind: 'generic', tht: false } as Comp, false);

  it('board-to-board connectors are a type of their own, no cable goes to them', () => {
    for (const n of ['SAMTEC_QSH-060-01-L-D-A', 'QSH060', 'QTE-040-03-F-D-A', 'SEAM-50-02.0-S-08-2-A-K-TR', 'Hirose_DF40C-60DP-0.4V', 'DF12(3.0)-40DP-0.5V', 'Molex_SlimStack_54722', 'MEZZANINE_CONN']) expect(type(n), n).toBe('b2b');
    expect(type('JST_B2B-XH-A')).toBe('jst_xh'); // "B2B" in a JST name is its two pins, not a board-to-board
    const m = newModule({ ...board(), comps: [part('SAMTEC_QSH-060-01-L-D-A')] } as unknown as Board);
    expect(offRackTo(m, m.board.comps[0])).toMatch(/no cable/);
  });

  it('card sockets by name, slots sized for their lanes', () => {
    for (const [n, id] of [['SIM_CARD', 'sim'], ['NANO_SIM', 'sim'], ['M.2_KEY_M', 'm2'], ['M2_KEY_E', 'm2'], ['NGFF', 'm2'], ['MINI_PCIE', 'm2'], ['PCIE_X1', 'pcie'], ['PCI_EXPRESS_X16', 'pcie'], ['SODIMM_DDR4', 'dimm'], ['DDR4_DIMM', 'dimm'], ['POGO_PIN', 'pogo']]) expect(type(n), n).toBe(id);
    const w = (n: string) => guessPackage(n, 'J1').w;
    expect([w('PCIE_X1'), w('PCIE_X4'), w('PCIE_X8'), w('PCI_EXPRESS_X16')]).toEqual([25, 39, 56, 89]);
    expect([w('SODIMM_DDR4'), w('DDR4_DIMM'), w('MINI_PCIE')]).toEqual([70, 137, 30]);
    expect(type('SIM800L', 'U1')).toBeUndefined(); // a modem chip, not a slot
  });

  it('XLR, banana, M12 and TOSLINK, with the roles they have', () => {
    for (const [n, id] of [['XLR', 'xlr'], ['NEUTRIK_NC3FAH', 'xlr'], ['BANANA_JACK', 'banana'], ['BINDING_POST', 'banana'], ['M12_4P', 'm12'], ['M8_3P', 'm12'], ['TOSLINK', 'toslink'], ['TORX147L', 'toslink']]) expect(type(n), n).toBe(id);
    const m = newModule({ ...board(), comps: [part('TOSLINK', 'J1'), part('RCJ-014', 'J2'), part('BANANA_JACK', 'J3'), part('M12_4P', 'J4'), part('XLR', 'J5')] } as unknown as Board);
    const comp = (r: string) => m.board.comps.find((c) => c.ref === r)!;
    expect(compatible(plugRole(m, comp('J1')), plugRole(m, comp('J2')))).toBe(true); // an optical lead to an audio one: a converter
    expect(plugRole(m, comp('J5'))).toBe('audio');
    expect([offRackTo(m, comp('J3')), offRackTo(m, comp('J4'))]).toEqual(['to an instrument or supply', 'to a sensor or machine']);
  });

  it('every one of them is drawn, and a 3.96 mm header has its pins at 3.96 mm', () => {
    const b = board();
    b.comps = ['SAMTEC_QSH-060-01-L-D-A', 'M.2_KEY_M', 'PCIE_X1', 'DDR4_DIMM', 'POGO_PIN', 'XLR', 'M12_4P', 'SIM_CARD', 'MMCX_VERT', 'SATA_7P'].map((n, i) => ({ ...part(n, `J${i + 1}`), x: 20 + i * 12, y: 45 }));
    const ghosts = pictureOf(b);
    expect(ghosts.length).toBeGreaterThan(0);
    for (const g of ghosts) for (const v of g.mesh.pos) expect(Number.isFinite(v)).toBe(true);
    const kk = (pkg: string) => {
      const c = { ...part(pkg), x: 80, y: 45 }, bb = board();
      bb.comps = [c];
      const xs: number[] = [];
      for (const g of pictureOf(bb)) if (g.mat === 'gold') for (let i = 0; i < g.mesh.pos.length; i += 3) xs.push(g.mesh.pos[i]);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(kk('B4P-VH')).toBeGreaterThan(3 * 3.96); // four pins, 3.96 apart
    expect(kk('Molex_KK-254_AE-6410-04A_1x04_P2.54mm_Vertical')).toBeLessThan(3 * 2.54 + 1);
  });
});
