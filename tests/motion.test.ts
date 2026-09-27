// The assembly animation's moves.
import { it, expect } from 'vitest';
import { remaining } from '../src/cad/motion';

it('starts a move whole, ends it seated; a snap-fit goes past its seat and springs back; a plug takes its last mm slowly', () => {
  for (const st of ['slide', 'snap', 'plug', 'press'] as const) { expect(remaining(st, 0, 30)).toBeCloseTo(1); expect(remaining(st, 1, 30)).toBeCloseTo(0); }
  const snap = [...Array(101)].map((_, i) => remaining('snap', i / 100, 30));
  expect(Math.min(...snap)).toBeLessThan(-0.02); // pushed past the seat: the click
  expect(snap[100]).toBeCloseTo(0);
  // the plug covers its last 4 mm in the last 45% of the step
  expect(remaining('plug', 0.55, 30) * 30).toBeCloseTo(4, 1);
});
