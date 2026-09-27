// Ready-made boards for people without design files. Dimensions follow the makers' published mechanical
// drawings as far as we know them; each template says so and everything stays editable.
import type { Board, Comp, Hole, Side } from './types';
import { connById, connSetup } from './library';
import { roundedRectLoop, uid } from '../geom/poly';
import { makeBox } from './boxes';
import { headerPins } from './probes';

/** A header with its pins' nets, pin 1 first. */
const named = (c: Comp, nets: string[]): Comp => ({ ...c, pins: headerPins(c).map((q, i) => ({ ...q, net: nets[i] })) });

const holes = (d: number, pts: [number, number][]): Hole[] =>
  pts.map(([x, y]) => ({ id: uid('h'), x, y, d, plated: true, use: 'auto' as const }));

function comp(ref: string, pkg: string, x: number, y: number, w: number, l: number, h: number, extra: Partial<Comp> = {}): Comp {
  return { id: uid('c'), ref, pkg, side: 'top' as Side, x, y, rot: 0, w, l, h, kind: 'generic', tht: false, ...extra };
}

/** An edge connector whose mouth faces `angle` (deg). `edge` = coordinate of the board edge it sits on. */
export function edgeConn(ref: string, type: string, angle: number, along: number, edge: number, overhang: number, extra: Partial<Comp> = {}): Comp {
  const t = connById(type);
  const horizontal = angle === 0 || angle === 180;
  const depth = t.body.l, width = t.body.w;
  const out = angle === 0 || angle === 90 ? 1 : -1;
  const c = edge + out * (overhang - depth / 2);
  const x = horizontal ? c : along, y = horizontal ? along : c;
  return {
    id: uid('c'), ref, pkg: t.name, side: 'top', x, y, rot: 0,
    w: horizontal ? depth : width, l: horizontal ? width : depth, h: t.body.h,
    kind: 'connector', tht: !['usb_micro_b', 'usb_c', 'hdmi_micro', 'hdmi_mini', 'microsd', 'qwiic'].includes(type), conn: connSetup(t, angle), ...extra,
  };
}

function rectBoard(name: string, w: number, h: number, r: number, source: string): Board {
  const outline = roundedRectLoop(w, h, r, 6).map(([x, y]) => [x + w / 2, y + h / 2] as [number, number]);
  return { name, outline, cutouts: [], thickness: 1.6, holes: [], comps: [], source, notes: [] };
}

export interface Template { id: string; name: string; make: () => Board; accessory?: boolean }

export const TEMPLATES: Template[] = [
  {
    id: 'rpi4', name: 'Raspberry Pi 4 / 3B+ (85 × 56)',
    make: () => {
      const b = rectBoard('Raspberry Pi 4B', 85, 56, 3, 'template');
      b.holes = holes(2.75, [[3.5, 3.5], [61.5, 3.5], [3.5, 52.5], [61.5, 52.5]]);
      b.comps = [
        edgeConn('J_PWR', 'usb_c', -90, 11.2, 0, 1.0),
        edgeConn('HDMI0', 'hdmi_micro', -90, 26.0, 0, 0.8),
        edgeConn('HDMI1', 'hdmi_micro', -90, 39.5, 0, 0.8),
        edgeConn('AUDIO', 'audio35', -90, 53.5, 0, 1.5, { h: 6 }),
        edgeConn('USB2', 'usb_a_dual', 0, 9.0, 85, 2.8, { h: 16 }),
        edgeConn('USB3', 'usb_a_dual', 0, 27.0, 85, 2.8, { h: 16 }),
        edgeConn('ETH', 'rj45', 0, 45.75, 85, 2.8, { h: 13.5 }),
        comp('GPIO', 'PinHeader_2x20_P2.54mm_Vertical', 32.5, 52.5, 50.8, 5.08, 8.5, { kind: 'header', tht: true, conn: connSetup(connById('header'), 90) }),
        comp('SoC', 'BCM2711 + heatsink area', 29, 32, 15, 15, 2.5, { kind: 'hot' }),
        { ...edgeConn('SD', 'microsd', 180, 28, 0, 2.5), side: 'bottom', tht: false },
      ];
      b.notes = ['Positions from the Raspberry Pi 4 mechanical drawing. Check yours: board revisions move parts slightly.'];
      return b;
    },
  },
  {
    id: 'rpi5', name: 'Raspberry Pi 5 (85 × 56)',
    make: () => {
      const b = rectBoard('Raspberry Pi 5', 85, 56, 3, 'template');
      b.holes = holes(2.75, [[3.5, 3.5], [61.5, 3.5], [3.5, 52.5], [61.5, 52.5]]);
      b.comps = [
        edgeConn('J_PWR', 'usb_c', -90, 11.2, 0, 1.0),
        edgeConn('HDMI0', 'hdmi_micro', -90, 25.8, 0, 0.8),
        edgeConn('HDMI1', 'hdmi_micro', -90, 39.2, 0, 0.8),
        // the Pi 5 moved Ethernet back to the corner by the power side; USB 3 in the middle, USB 2 by the header
        edgeConn('ETH', 'rj45', 0, 10.2, 85, 2.8, { h: 13.5 }),
        edgeConn('USB3', 'usb_a_dual', 0, 29.1, 85, 2.8, { h: 16 }),
        edgeConn('USB2', 'usb_a_dual', 0, 47.0, 85, 2.8, { h: 16 }),
        comp('GPIO', 'PinHeader_2x20_P2.54mm_Vertical', 32.5, 52.5, 50.8, 5.08, 8.5, { kind: 'header', tht: true, conn: connSetup(connById('header'), 90) }),
        comp('SoC', 'BCM2712 (Active Cooler area)', 29, 30, 15, 15, 2.5, { kind: 'hot' }),
        comp('PCIE', 'PCIe FPC (16 pin)', 3, 28, 4, 17, 1.5, { kind: 'connector' }),
        { ...edgeConn('SD', 'microsd', 180, 28, 0, 2.5), side: 'bottom', tht: false },
      ];
      b.notes = ['Positions follow the Raspberry Pi 5 mechanical drawing as far as we know them, and this template has not been checked against a real board yet: measure yours. With the Active Cooler fitted, leave the holder wall low on the fan side.'];
      return b;
    },
  },
  {
    id: 'rpi_zero', name: 'Raspberry Pi Zero / Zero 2 W (65 × 30)',
    make: () => {
      const b = rectBoard('Raspberry Pi Zero 2 W', 65, 30, 3, 'template');
      b.holes = holes(2.75, [[3.5, 3.5], [61.5, 3.5], [3.5, 26.5], [61.5, 26.5]]);
      b.comps = [
        edgeConn('HDMI', 'hdmi_mini', -90, 12.4, 0, 0.5),
        edgeConn('USB', 'usb_micro_b', -90, 41.4, 0, 0.8),
        edgeConn('PWR', 'usb_micro_b', -90, 54.0, 0, 0.8),
        edgeConn('SD', 'microsd', 180, 16.9, 0, 1.5),
        comp('CAM', 'CSI camera FPC (22 pin)', 63, 15, 4, 17, 1.2, { kind: 'connector' }),
        comp('GPIO', 'PinHeader_2x20_P2.54mm_Vertical', 32.5, 26.5, 50.8, 5.08, 8.5, { kind: 'header', tht: true, conn: connSetup(connById('header'), 90) }),
      ];
      b.notes = ['Positions from the Raspberry Pi Zero mechanical drawing. GPIO header only if you fitted one.'];
      return b;
    },
  },
  {
    id: 'pico', name: 'Raspberry Pi Pico / Pico W / Pico 2 (51 × 21)',
    make: () => {
      const b = rectBoard('Raspberry Pi Pico', 51, 21, 0.5, 'template');
      b.holes = holes(2.1, [[2, 4.8], [2, 16.2], [49, 4.8], [49, 16.2]]);
      b.comps = [edgeConn('USB', 'usb_micro_b', 180, 10.5, 0, 1.3), comp('BOOTSEL', 'SW_Push', 12.5, 13.5, 4, 3, 2.5, { kind: 'switch' })];
      b.thickness = 1.0;
      b.notes = ['Pico is 1.0 mm thick. If you soldered header pins, set their length as the lead length under Holder.'];
      return b;
    },
  },
  {
    id: 'uno', name: 'Arduino Uno R3 (68.6 × 53.3)',
    make: () => {
      const b = rectBoard('Arduino Uno R3', 68.58, 53.34, 0, 'template');
      b.outline = [[0, 0], [66.04, 0], [66.04, 1.27], [68.58, 3.81], [68.58, 38.1], [66.04, 40.64], [66.04, 51.82], [64.52, 53.34], [0, 53.34]];
      b.holes = holes(3.2, [[13.97, 2.54], [15.24, 50.8], [66.04, 7.62], [66.04, 35.56]]);
      b.comps = [
        edgeConn('USB', 'usb_b', 180, 38.1, 0, 6.35),
        edgeConn('DC', 'barrel', 180, 7.62, 0, 1.9),
        comp('J_DIG', 'PinSocket_1x18 (digital)', 44, 50.8, 44, 2.54, 8.5, { kind: 'header', tht: true, conn: connSetup(connById('header'), 90) }),
        comp('J_ANA', 'PinSocket_1x14 (power/analog)', 48, 2.54, 34, 2.54, 8.5, { kind: 'header', tht: true, conn: connSetup(connById('header'), -90) }),
        comp('ICSP', 'PinHeader_2x03', 64.5, 27.9, 5.08, 7.62, 8.5, { kind: 'header', tht: true }),
        comp('U1', 'DIP-28 ATmega328P', 45, 17, 36, 9, 6, { tht: true }),
      ];
      b.notes = ['Outline and holes from the Arduino Uno R3 reference design. The ATmega socket and header pins stick out about 2 mm underneath.'];
      return b;
    },
  },
  {
    id: 'mega', name: 'Arduino Mega 2560 (101.6 × 53.3)',
    make: () => {
      const b = rectBoard('Arduino Mega 2560', 101.6, 53.34, 0, 'template');
      b.holes = holes(3.2, [[13.97, 2.54], [15.24, 50.8], [66.04, 7.62], [66.04, 35.56], [90.17, 50.8], [96.52, 2.54]]);
      b.comps = [
        edgeConn('USB', 'usb_b', 180, 38.1, 0, 6.35),
        edgeConn('DC', 'barrel', 180, 7.62, 0, 1.9),
        comp('J_DIG', 'PinSocket_1x16 (digital)', 44, 50.8, 41, 2.54, 8.5, { kind: 'header', tht: true, conn: connSetup(connById('header'), 90) }),
        comp('J_ANA', 'PinSocket_1x24 (power/analog)', 58, 2.54, 61, 2.54, 8.5, { kind: 'header', tht: true, conn: connSetup(connById('header'), -90) }),
        comp('J_IO', 'PinSocket_2x18 (digital 22-53)', 96.5, 27, 5.08, 45.7, 8.5, { kind: 'header', tht: true, conn: connSetup(connById('header'), 0) }),
        comp('U1', 'ATmega2560 (TQFP-100)', 60, 27, 16, 16, 1.5),
      ];
      b.notes = ['Outline and holes from the Arduino Mega 2560 R3 reference design; header positions are approximate. Header pins stick out about 2 mm underneath.'];
      return b;
    },
  },
  {
    id: 'esp32', name: 'ESP32 DevKitC (55 × 28)',
    make: () => {
      const b = rectBoard('ESP32 DevKitC', 54.4, 27.9, 0.5, 'template');
      b.comps = [
        edgeConn('USB', 'usb_micro_b', 180, 13.95, 0, 1.2),
        comp('EN', 'SW_Push (EN)', 5, 4, 4, 3, 2, { kind: 'switch' }),
        comp('BOOT', 'SW_Push (BOOT)', 5, 23.9, 4, 3, 2, { kind: 'switch' }),
        comp('U1', 'ESP32-WROOM-32 module', 36, 13.95, 25.5, 18, 3.1, { kind: 'antenna' }),
      ];
      b.notes = ['Held by its edges (it has no mounting holes). Its two rows of header pins point down: set their length as the lead length under Holder. Sizes vary a little between makers: measure yours.'];
      return b;
    },
  },
  {
    id: 'nano', name: 'Arduino Nano (18 × 43.2)',
    make: () => {
      const b = rectBoard('Arduino Nano', 17.78, 43.18, 0.5, 'template');
      b.comps = [edgeConn('USB', 'usb_mini_b', 90, 8.89, 43.18, 1.5)];
      b.notes = ['Held by its edges (no mounting holes used). If you soldered pin headers, raise the standoff to clear them.'];
      return b;
    },
  },
  {
    id: 'proto_5x7', name: 'Perfboard 50 × 70 (measure holes)',
    make: () => {
      const b = rectBoard('Perfboard 50x70', 70, 50, 0.5, 'template');
      b.holes = holes(2.0, [[2, 2], [68, 2], [2, 48], [68, 48]]);
      b.notes = ['Cheap perfboards vary: measure the hole positions and diameter.'];
      return b;
    },
  },
  // two made-up boards to try debug probes and serial cables on: one debug header per MCU, and a UART header whose
  // pins are named (as a KiCad file names them by their nets)
  {
    id: 'example_dual_swd', name: 'Example: dual-MCU board, two 10-pin SWD headers and a UART (80 × 60)',
    make: () => {
      const b = rectBoard('Dual-MCU controller', 80, 60, 1.5, 'example');
      b.holes = holes(3.2, [[3.5, 3.5], [76.5, 3.5], [3.5, 56.5], [76.5, 56.5]]);
      b.comps.push(edgeConn('J1', 'usb_c', -90, 40, 0, 0.6));
      b.comps.push(comp('U1', 'LQFP-64_10x10mm_P0.5mm', 22, 28, 12, 12, 1.6));
      b.comps.push(comp('U2', 'LQFP-48_7x7mm_P0.5mm', 58, 28, 9, 9, 1.6));
      const swd = connById('swd10');
      for (const [ref, x] of [['J_SWD1', 22], ['J_SWD2', 58]] as const) b.comps.push(comp(ref, 'PinHeader_2x05_P1.27mm_Vertical_SMD', x, 47, swd.body.w, swd.body.l, swd.body.h, { kind: 'connector', conn: connSetup(swd, 0) }));
      b.comps.push(named(comp('J_UART', 'PinHeader_1x06_P2.54mm_Vertical', 64, 10, 15.24, 2.54, 8.5, { kind: 'header', tht: true, value: 'FTDI', conn: connSetup(connById('header'), 0) }), ['GND', 'CTS', '+3V3', 'RXI', 'TXO', 'DTR']));
      b.notes = ['An example board to try J-Links and a serial cable on: two MCUs, each with its own 10-pin SWD header, and a 6-pin FTDI UART header. Board › Debug & UART headers.'];
      return b;
    },
  },
  {
    id: 'example_jtag', name: 'Example: sensor board, a 20-pin JTAG header and a UART (70 × 45)',
    make: () => {
      const b = rectBoard('Sensor board', 70, 45, 1.5, 'example');
      b.holes = holes(3.2, [[3.5, 3.5], [66.5, 3.5], [3.5, 41.5], [66.5, 41.5]]);
      b.comps.push(edgeConn('J1', 'usb_micro_b', 180, 22, 0, 0.6));
      b.comps.push(comp('U1', 'QFN-48_7x7mm_P0.5mm', 48, 15, 7, 7, 0.9));
      const jtag = connById('jtag20');
      b.comps.push(comp('J_JTAG', 'IDC-Header_2x10_P2.54mm_Vertical', 35, 33, jtag.body.w, jtag.body.l, jtag.body.h, { kind: 'connector', tht: true, conn: connSetup(jtag, 0) }));
      b.comps.push(named(comp('J_UART', 'PinHeader_1x04_P2.54mm_Vertical', 58, 40, 10.16, 2.54, 8.5, { kind: 'header', tht: true, value: 'UART', conn: connSetup(connById('header'), 0) }), ['+3V3', 'UART_TX', 'UART_RX', 'GND']));
      b.notes = ['An example board to try a J-Link and a serial cable on: one 20-pin JTAG box header and a 4-pin UART header. Board › Debug & UART headers.'];
      return b;
    },
  },
  { id: 'usb_hub', name: 'USB hub, 4 ports (box 100 × 30 × 22)', accessory: true, make: () => makeBox('hub4') },
  { id: 'usb_hub7', name: 'Powered USB hub, 7 ports on top (160 × 48)', accessory: true, make: () => makeBox('hub7') },
  { id: 'usb_hubc', name: 'USB-C hub with Ethernet (110 × 32)', accessory: true, make: () => makeBox('hubc') },
  { id: 'usb_charger', name: 'USB charger, 4 ports (box 90 × 60 × 28)', accessory: true, make: () => makeBox('charger4') },
  { id: 'usb_charger6', name: 'USB charger, 4 A + 2 C (110 × 70)', accessory: true, make: () => makeBox('charger6') },
  { id: 'jlink', name: 'J-Link debug probe (50 × 50 × 3, 10-pin ribbon)', accessory: true, make: () => makeBox('jlink') },
  { id: 'ftdi', name: 'USB-serial adapter, FT232RL (36 × 18, mini-USB, 6 pins)', accessory: true, make: () => makeBox('ftdi') },
  {
    id: 'power_dist', name: 'DC power distribution board (60 × 40)', accessory: true,
    make: () => {
      const b = rectBoard('Power distribution', 60, 40, 1, 'accessory');
      b.holes = holes(3.2, [[3.5, 3.5], [56.5, 3.5], [3.5, 36.5], [56.5, 36.5]]);
      b.comps.push(edgeConn('IN', 'terminal', 180, 20, 0, 0));
      for (let i = 0; i < 4; i++) b.comps.push(edgeConn(`OUT${i + 1}`, 'terminal', -90, 12 + i * 12, 0, 0));
      b.comps.push(comp('F1', 'fuse holder', 30, 24, 14, 6, 9));
      return b;
    },
  },
  {
    id: 'relay4', name: 'Relay board, 4 channels (75 × 55)', accessory: true,
    make: () => {
      const b = rectBoard('Relay board', 75, 55, 1, 'accessory');
      b.holes = holes(3.1, [[3.2, 3.2], [71.8, 3.2], [3.2, 51.8], [71.8, 51.8]]);
      for (let i = 0; i < 4; i++) {
        b.comps.push(comp(`K${i + 1}`, 'relay', 16 + i * 15, 30, 15.5, 19, 15.5, { kind: 'module' }));
        b.comps.push(edgeConn(`X${i + 1}`, 'terminal', 90, 16 + i * 15, 55, 0));
      }
      b.comps.push(comp('J1', 'PinHeader_1x06', 37, 6, 15.2, 2.54, 8.5, { kind: 'header', conn: connSetup(connById('header'), 0) }));
      return b;
    },
  },
  {
    id: 'blank', name: 'Blank rectangle 60 × 40, 4 × M3',
    make: () => {
      const b = rectBoard('My board', 60, 40, 2, 'manual');
      b.holes = holes(3.2, [[3.5, 3.5], [56.5, 3.5], [3.5, 36.5], [56.5, 36.5]]);
      return b;
    },
  },
];
