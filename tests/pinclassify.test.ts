// Connectors known by their pins when their names say nothing BoardDock knows (an Allegro board read through KiCad
// keeps Allegro's footprint names: "CON10", "HDR1X6"...): no "Custom connector" for a plain header, and a J-Link or a
// USB-serial adapter can be connected to them.
import { describe, it, expect } from 'vitest';
import type { Comp, Pin } from '../src/model/types';
import { classify, pinGrid } from '../src/model/library';
import { isDebugPort, isUartPort } from '../src/model/links';

const grid = (rows: number, cols: number, pitch: number, nets: string[] = [], turn = 0): Pin[] => {
  const out: Pin[] = [];
  const c = Math.cos((turn * Math.PI) / 180), s = Math.sin((turn * Math.PI) / 180);
  for (let i = 0; i < cols; i++) for (let r = 0; r < rows; r++) {
    const k = i * rows + r, x = 20 + i * pitch, y = 10 + r * pitch;
    out.push({ n: String(k + 1), x: x * c - y * s, y: x * s + y * c, ...(nets[k] ? { net: nets[k] } : {}) });
  }
  return out;
};
const part = (ref: string, pkg: string, pins: Pin[]): Comp => ({ id: ref, ref, pkg, side: 'top', x: 25, y: 12, rot: 0, w: 6, l: 3, h: 0, kind: 'generic', tht: true, pins });

describe('connectors known by their pins', () => {
  it('finds the grid, turned or not, and leaves out what is not a header', () => {
    expect(pinGrid(grid(2, 5, 1.27))).toEqual({ rows: 2, cols: 5, pitch: 1.27 });
    expect(pinGrid(grid(1, 6, 2.54, [], 30))).toEqual({ rows: 1, cols: 6, pitch: 2.54 });
    expect(pinGrid(grid(3, 4, 2.54))).toBeNull(); // three rows: not a header
    expect(pinGrid([{ n: '1', x: 0, y: 0 }, { n: '2', x: 3.1, y: 0 }])).toBeNull(); // no header pitch
  });
  it('an Allegro-named 2 x 5 at 1.27 mm is the 10-pin debug connector a J-Link plugs into', () => {
    const c = classify(part('J5', 'CON10_SMT', grid(2, 5, 1.27)), true);
    expect(c.conn?.type).toBe('swd10');
    expect(isDebugPort(c)).toBe(true);
  });
  it('a 2 x 10 at 2.54 mm with JTAG nets is the 20-pin debug connector', () => {
    const nets = ['VREF', 'NC', 'TRST', 'GND', 'TDI', 'GND', 'TMS', 'GND', 'TCK', 'GND', 'RTCK', 'GND', 'TDO', 'GND', 'RESET', 'GND', 'NC', 'GND', 'NC', 'GND'];
    const c = classify(part('J2', 'HDR2X10', grid(2, 10, 2.54, nets)), true);
    expect(c.conn?.type).toBe('jtag20');
    expect(isDebugPort(c)).toBe(true);
  });
  it('a 1 x 6 with TX and RX nets is a UART header; a plain one a pin header, not a custom connector', () => {
    const u = classify(part('J3', 'HDR1X6', grid(1, 6, 2.54, ['GND', 'CTS', 'VCC', '/UART0_TXD', '/UART0_RXD', 'DTR'])), true);
    expect(u.conn?.type).toBe('header');
    expect(isUartPort(u)).toBe(true);
    const h = classify(part('P7', 'SIP3', grid(1, 3, 2.54, ['GND', 'SDA', 'SCL'])), true);
    expect(h.conn?.type).toBe('header');
    expect(isUartPort(h)).toBe(false);
    expect(isDebugPort(h)).toBe(false);
    const swd = classify(part('J9', 'HDR1X4', grid(1, 4, 2.54, ['VCC', 'SWDIO', 'SWCLK', 'GND'])), true);
    expect(isDebugPort(swd)).toBe(true);
  });
  it('a part whose pins are not a header keeps what its name says', () => {
    const usb = classify(part('J1', 'USB_MICRO_B', [{ n: '1', x: 0, y: 0 }, { n: '2', x: 0.65, y: 0 }, { n: '3', x: 1.3, y: 0 }]), true);
    expect(usb.conn?.type).toBe('usb_micro_b');
    const r = classify(part('R1', 'R0603', grid(1, 2, 2.54)), true);
    expect(r.conn).toBeUndefined();
  });
});
