// Checking a drawn board: what would spoil its holder, and the fixes.
import { describe, it, expect } from 'vitest';
import { TEMPLATES, edgeConn } from '../src/model/templates';
import { boardIssues, cornerHoles, fixAll, mouthGap } from '../src/model/boardcheck';
import type { Board } from '../src/model/types';

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
});
