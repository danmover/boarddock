// The rotation box's arithmetic: typed angles, the 15°, 45° and 90° snaps, the short way round, the turn buttons.
import { describe, it, expect } from 'vitest';
import { normDeg, parseDeg, shortTurn, snapDeg, SNAPS, stepTo } from '../src/geom/angle';

describe('angles', () => {
  it('offers 15, 45 and 90 degree snaps', () => expect([...SNAPS]).toEqual([15, 45, 90]));

  it('wraps an angle into 0 to 360, with no -0', () => {
    expect([normDeg(-90), normDeg(450), normDeg(360), normDeg(0), normDeg(-360), normDeg(12.5)]).toEqual([270, 90, 0, 0, 0, 12.5]);
    expect(Object.is(normDeg(-360), -0)).toBe(false);
  });

  it('snaps to the nearest multiple of the step, or is free (to 0.01°)', () => {
    expect([snapDeg(37, 15), snapDeg(38, 15), snapDeg(22, 45), snapDeg(23, 45), snapDeg(-40, 90), snapDeg(-46, 90)]).toEqual([30, 45, 0, 45, -0, -90].map((v) => v + 0));
    expect(snapDeg(12.3456, 0)).toBe(12.35);
    expect(Object.is(snapDeg(-2, 15), -0)).toBe(false);
  });

  it('turns the short way round', () => {
    expect([shortTurn(350, 10), shortTurn(10, 350), shortTurn(0, 180), shortTurn(180, 0), shortTurn(90, 90), shortTurn(0, 270)]).toEqual([20, -20, 180, 180, 0, -90]);
  });

  it('steps to the next multiple in a direction, also from between two', () => {
    expect([stepTo(0, 1, 15), stepTo(0, -1, 15), stepTo(37, 1, 15), stepTo(37, -1, 15), stepTo(45, 1, 45), stepTo(45, -1, 45), stepTo(200, 1, 90), stepTo(270.00000000001, 1, 90), stepTo(269, 1, 90)]).toEqual([15, -15, 45, 30, 90, 0, 270, 360, 270]);
  });

  it('reads what was typed: a number with an optional degree sign or word, a comma for the point', () => {
    expect([parseDeg('45'), parseDeg(' -30 '), parseDeg('12.5°'), parseDeg('90 deg'), parseDeg('7,5'), parseDeg('+15'), parseDeg('.5')]).toEqual([45, -30, 12.5, 90, 7.5, 15, 0.5]);
    expect([parseDeg(''), parseDeg('abc'), parseDeg('45x'), parseDeg('1e3'), parseDeg('--5')]).toEqual([null, null, null, null, null]);
  });
});
