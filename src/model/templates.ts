// Ready-made boards for people without design files. Dimensions follow the makers' published mechanical
// drawings as far as we know them; each template says so and everything stays editable.
import type { Board, Comp, Hole, Side } from './types';
import { connById, connSetup } from './library';
import { roundedRectLoop, uid } from '../geom/poly';

const holes = (d: number, pts: [number, number][]): Hole[] =>
  pts.map(([x, y]) => ({ id: uid('h'), x, y, d, plated: true, use: 'auto' as const }));

function comp(ref: string, pkg: string, x: number, y: number, w: number, l: number, h: number, extra: Partial<Comp> = {}): Comp {
  return { id: uid('c'), ref, pkg, side: 'top' as Side, x, y, rot: 0, w, l, h, kind: 'generic', tht: false, ...extra };
}

/** An edge connector whose mouth faces `angle` (deg). `edge` = coordinate of the board edge it sits on. */
function edgeConn(ref: string, type: string, angle: number, along: number, edge: number, overhang: number, extra: Partial<Comp> = {}): Comp {
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

/** A port on the side of a box accessory: the plug axis sits at mid-height of the box. */
function boxPort(ref: string, type: string, angle: number, along: number, edge: number, height: number): Comp {
  const c = edgeConn(ref, type, angle, along, edge, 0);
  const t = connById(type);
  c.h = 0.2;
  c.conn!.zc = -height / 2;
  c.w = angle === 0 || angle === 180 ? 2 : t.body.w;
  c.l = angle === 0 || angle === 180 ? t.body.w : 2;
  c.tht = false;
  return c;
}

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
    id: 'pico', name: 'Raspberry Pi Pico / Pico W (51 × 21)',
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
  {
    id: 'usb_hub', name: 'USB hub, 4 ports (box 100 × 30 × 22)', accessory: true,
    make: () => {
      const b = rectBoard('USB hub', 100, 30, 3, 'accessory');
      b.kind = 'box'; b.thickness = 22; b.color = '#2b2f36';
      for (let i = 0; i < 4; i++) b.comps.push(boxPort(`P${i + 1}`, 'usb_a', -90, 20 + i * 20, 0, 22));
      b.comps.push(boxPort('UP', 'usb_micro_b', 180, 15, 0, 22));
      b.notes = ['A generic box: set its size and port positions to match yours (the ports are the connectors).'];
      return b;
    },
  },
  {
    id: 'usb_charger', name: 'USB charger, 4 ports (box 90 × 60 × 28)', accessory: true,
    make: () => {
      const b = rectBoard('USB charger', 90, 60, 4, 'accessory');
      b.kind = 'box'; b.thickness = 28; b.color = '#e9e7e2';
      for (let i = 0; i < 4; i++) b.comps.push(boxPort(`OUT${i + 1}`, 'usb_a', 90, 18 + i * 18, 60, 28));
      b.comps.push(boxPort('AC', 'barrel', -90, 45, 0, 28));
      b.notes = ['A generic box: set its size and port positions to match yours (the ports are the connectors).'];
      return b;
    },
  },
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
