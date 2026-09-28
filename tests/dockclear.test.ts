// Nothing added to a holder after its cuts gets in the way of the dock: the release rod runs free in its tunnel (a
// zip-tie anchor or a stacking tower's arm used to fill it), a tie anchor for a plug from above stays off the dock and
// its socket, and a stacking tower's peg goes into its socket, not into the arm beside it.
import { describe, it, expect, beforeAll } from 'vitest';
import { initKernel } from '../src/cad/kernel';
import { generate } from '../src/cad/assembly';
import { RACKS } from './collide/racks';
import { measure } from './collide/measure';

beforeAll(async () => { await initKernel(); });
const run = (name: string) => { const p = RACKS.find((r) => r.name === name)!.make(); return measure(p, generate(p)); };

describe('dock clearances', () => {
  it('keeps the release rod free, and tie anchors off the dock socket', () => {
    // the Sensor board's rod ran through a tie anchor over 30 mm; the Dual-MCU board's tie anchor sat in its socket
    for (const name of ['example_jtag standing', 'example_dual_swd standing']) {
      const m = run(name);
      expect(m.worst.filter((w) => /Release rod|Dock socket/.test(`${w.a} ${w.b}`) && w.cat === 'holder-holder').map((w) => `${w.a} × ${w.b} ${w.vol.toFixed(1)}`), name).toEqual([]);
    }
  }, 120_000);

  it('keeps a probe holder\'s own rod and its stacking pegs clear', () => {
    const m = run('probes and adapters');
    // a J-Link's slot holder in a dock, with more on towers above it: its rod ran through the towers' arms (89 mm³)
    expect(m.worst.filter((w) => /Release rod/.test(`${w.a} ${w.b}`) && /J-Link/.test(`${w.a} ${w.b}`))).toEqual([]);
    // pegs in their sockets: only the three crush ribs press (well under 1 mm³ each; a peg in the arm was 24 mm³)
    for (const w of m.worst.filter((x) => x.cat === 'holder-holder' && /J-Link|USB-serial/.test(x.a) && /J-Link|USB-serial/.test(x.b))) expect(w.vol).toBeLessThan(1);
  }, 120_000);

  it('keeps a plug\'s collar out of the next plug\'s opening', () => {
    // a Pi 4's two USB pairs are 18 mm apart and their plugs 16 mm wide: each collar reached 0.4 mm into the other's
    const m = run('busy mixed rack');
    expect(m.worst.filter((w) => w.cat === 'holder-plug').map((w) => `${w.a} × ${w.b} ${w.vol.toFixed(2)}`)).toEqual([]);
  }, 120_000);
});
