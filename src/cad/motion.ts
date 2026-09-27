// The assembly animation's moves: how far a part still is from its seat through its step, by the way it goes in.
import type { Motion } from '../model/types';

const ease = (x: number) => 1 - Math.pow(1 - x, 3);
const inOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
/**
 * How far a part still is from its seat, as a fraction of its move (1 at the start, 0 seated), p going 0 to 1 through
 * its step: a slide eases in; a snap-fit arrives, is pushed a little past its seat and springs back (the click); a plug
 * goes in quickly, then the last few millimetres slowly; a press goes straight on, firmly.
 */
export function remaining(style: Motion['style'], p: number, dist: number): number {
  const q = Math.max(0, Math.min(1, p));
  if (style === 'snap') {
    const over = Math.min(1.4, dist * 0.04) / Math.max(dist, 1e-6);
    if (q < 0.68) return 1 - inOut(q / 0.68);
    if (q < 0.8) return -over * ((q - 0.68) / 0.12);
    return -over * (1 - ease((q - 0.8) / 0.2));
  }
  if (style === 'plug') {
    const last = Math.min(4, dist * 0.25) / Math.max(dist, 1e-6);
    return q < 0.55 ? 1 - (1 - last) * inOut(q / 0.55) : last * (1 - (q - 0.55) / 0.45);
  }
  if (style === 'press') return 1 - inOut(q);
  return 1 - ease(q);
}
