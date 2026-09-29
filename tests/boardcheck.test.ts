// Checking a drawn board: what would spoil its holder, and the fixes.
import { describe, it, expect } from 'vitest';
import { TEMPLATES, edgeConn } from '../src/model/templates';
import { boardIssues, cornerHoles, fixAll, mouthGap } from '../src/model/boardcheck';
import type { Board } from '../src/model/types';
import { circlePts } from '../src/geom/shape';

const T = (id: string): Board => TEMPLATES.find((t) => t.id === id)!.make();

describe('board check', () => {
  it('every template board is clean (nothing bad or to warn about)', () => {
    for (const t of TEMPLATES) {
      const b = t.make();
      const bad = boardIssues(b).filter((x) => x.level !== 'info');
      expect(bad.map((x) => x.text), t.id).toEqual([]);
    }
  });
  it('finds a hole off the board, one under a part, one twice, and fixes them without moving real holes', () => {
    const b = T('rpi4');
    b.holes.push({ id: 'off', x: -5, y: 10, d: 2.75, plated: true, use: 'auto' });
    b.holes.push({ id: 'twin', x: 3.6, y: 3.5, d: 2.75, plated: true, use: 'auto' });
    b.holes.push({ id: 'under', x: 29, y: 32, d: 2.75, plated: true, use: 'auto' }); // under the SoC
    const ids = boardIssues(b).map((x) => x.id);
    expect(ids).toContain('hole-off:off');
    expect(ids.some((x) => x.startsWith('hole-twice:'))).toBe(true);
    expect(ids).toContain('hole-under:under');
    const n = fixAll(b);
    expect(n).toBeGreaterThanOrEqual(3);
    expect(boardIssues(b).filter((x) => x.level !== 'info')).toEqual([]);
    expect(b.holes.find((h) => h.id === 'under')!.use).toBe('none');
    expect(b.holes.find((h) => h.id === 'under')!.x).toBe(29); // not moved
  });
  it('a plug set back from the edge moves out to it; one facing in turns round', () => {
    const b = T('pico');
    const usb = b.comps.find((c) => c.ref === 'USB')!;
    usb.x += 4; // 4 mm in from the edge it faces (it faces -x)
    const i1 = boardIssues(b).find((x) => x.id === `plug-back:${usb.id}`)!;
    expect(i1).toBeDefined();
    i1.fix!.apply(b);
    expect(mouthGap(b, usb)!.gap).toBeLessThan(0.1);
    const b2 = T('rpi4');
    const eth = b2.comps.find((c) => c.ref === 'ETH')!;
    eth.conn!.angle = 180;
    const i2 = boardIssues(b2).find((x) => x.id === `plug-in:${eth.id}`)!;
    expect(i2).toBeDefined();
    i2.fix!.apply(b2);
    expect(eth.conn!.angle).toBe(0);
  });
  it('a board with no holes can have corner holes added, clear of parts and on the board', () => {
    const b = T('esp32');
    expect(boardIssues(b).find((x) => x.id === 'no-holes')).toBeDefined();
    const hs = cornerHoles(b);
    expect(hs.length).toBeGreaterThan(0);
    b.holes.push(...hs);
    expect(boardIssues(b).filter((x) => x.level !== 'info')).toEqual([]);
    void edgeConn;
  });
  it('a round board gets its corner holes on the board, round its rim, and a rectangle as before', () => {
    const round: Board = { name: 'Round', outline: circlePts([25, 25], 25), cutouts: [], thickness: 1.6, holes: [], comps: [], source: 'test', notes: [] };
    const hs = cornerHoles(round);
    expect(hs.length).toBe(4);
    // each 3.5 mm in from the rim (21.5 from the middle), at 45°
    for (const h of hs) {
      expect(Math.hypot(h.x - 25, h.y - 25)).toBeCloseTo(21.5, 0);
      expect(Math.abs(Math.abs(h.x - 25) - Math.abs(h.y - 25))).toBeLessThan(0.3);
    }
    // a rectangle's: 3.5 mm in from both edges at its corner (those clear of parts)
    const esp = T('esp32'), xs = esp.outline.map((q) => q[0]), ys = esp.outline.map((q) => q[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const eh = cornerHoles(esp);
    expect(eh.length).toBeGreaterThan(0);
    for (const h of eh) expect([Math.min(h.x - x0, x1 - h.x), Math.min(h.y - y0, y1 - h.y)].map((v) => Math.round(v * 10) / 10)).toEqual([3.5, 3.5]);
  });
});
