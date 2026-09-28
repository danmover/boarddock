// The lights: which LEDs a board shows, how each behaves, and that boards without power stay dark in the rack.
import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { boardLights, ledLook, lightLevel, LED_COLOUR, poweredBoards } from '../src/model/lights';
import { newModule, newProject } from '../src/model/library';
import { compRect, inside } from '../src/geom/poly';
import type { Board, Comp, LightPattern } from '../src/model/types';

const T = (id: string): Board => TEMPLATES.find((t) => t.id === id)!.make();
const led = (ref: string, value: string, pkg = 'LED_0805'): Comp => ({ id: ref, ref, value, pkg, side: 'top', x: 20, y: 20, rot: 0, w: 2, l: 1.25, h: 0.8, kind: 'led', tht: false });

describe('what an LED looks like lit', () => {
  it('reads its colour and job from its name', () => {
    expect(ledLook(led('D1', 'PWR'))).toEqual({ colour: LED_COLOUR.red, pattern: 'on' });
    expect(ledLook(led('D2', 'ACT'))).toEqual({ colour: LED_COLOUR.green, pattern: 'activity' });
    expect(ledLook(led('L', ''))).toMatchObject({ pattern: 'blink' });
    expect(ledLook(led('D3', 'TX'))).toEqual({ colour: LED_COLOUR.yellow, pattern: 'activity' });
    expect(ledLook(led('D4', 'WS2812B', 'LED_WS2812B_PLCC4'))).toMatchObject({ pattern: 'rainbow' });
    expect(ledLook(led('D5', '', 'LED_0603_Blue'))).toEqual({ colour: LED_COLOUR.blue, pattern: 'on' });
  });
  it('blinks, beats and flickers the same way every time, between 0 and 1', () => {
    const pats: LightPattern[] = ['on', 'blink', 'heartbeat', 'activity', 'breathe', 'chase', 'rainbow'];
    for (const p of pats) for (let t = 0; t < 10; t += 0.137) {
      const v = lightLevel(p, t, 3, 1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(lightLevel(p, t, 3, 1)).toBe(v);
    }
    expect([0.2, 1.2, 2.2, 3.2].map((t) => lightLevel('blink', t))).toEqual([1, 0, 1, 0]); // a second on, a second off
    const beats = Array.from({ length: 125 }, (_, k) => lightLevel('heartbeat', k / 100));
    expect(beats.filter((v, k) => v && !beats[k - 1]).length).toBe(2); // two beats a cycle
    const flick = Array.from({ length: 400 }, (_, k) => lightLevel('activity', k * 0.05, 2));
    expect(flick.some((v) => v === 1) && flick.some((v) => v === 0)).toBe(true);
  });
});

describe('the lights a board shows', () => {
  it("template boards get their real board's LEDs, on the board and off its parts", () => {
    for (const [id, n] of [['rpi4', 2], ['rpi5', 1], ['rpi_zero', 1], ['pico', 1], ['uno', 4], ['mega', 4], ['nano', 4], ['esp32', 1]] as const) {
      const b = T(id), L = boardLights(b);
      expect(L.length, id).toBe(n);
      for (const q of L) {
        expect(inside([q.p[0], q.p[1]], b.outline), id).toBe(true);
        expect(b.comps.some((c) => c.side === 'top' && inside([q.p[0], q.p[1]], compRect(c, 0.3))), `${id} ${q.name}`).toBe(false);
      }
    }
    expect(boardLights(T('rpi4')).map((q) => q.name)).toEqual(['PWR', 'ACT']);
  });
  it("a board's own LED parts are its lights (and a template's are then not added)", () => {
    const b = T('rpi4');
    b.comps.push(led('D9', 'STATUS'));
    expect(boardLights(b).map((q) => q.name)).toEqual(['STATUS']);
  });
  it('a relay board lights a lamp per relay, one after another', () => {
    const L = boardLights(T('relay4'));
    expect(L.length).toBeGreaterThanOrEqual(1);
    expect(L.every((q) => q.pattern === 'chase')).toBe(true);
  });
});

describe('which boards have power', () => {
  it('a board with nothing plugged in is dark; a power cable lights it; a box on mains lights itself', () => {
    const p = newProject(T('rpi4'));
    const pi = p.modules[0].id;
    const ch = newModule(T('usb_charger'));
    p.modules.push(ch);
    expect(poweredBoards(p).has(pi)).toBe(false);
    expect(poweredBoards(p).has(ch.id)).toBe(true);
    const out = ch.board.comps.find((c) => c.conn?.type === 'usb_a')!;
    p.links = [{ id: 'l1', a: { module: ch.id, ref: out.ref }, b: { module: pi, ref: 'J_PWR' }, kind: 'power' }];
    expect(poweredBoards(p).has(pi)).toBe(true);
  });
});

describe('in the rack', () => {
  it('the lights ride on the board, dark without power; a jack lights only with a cable in; cables carry pulses', async () => {
    const { initKernel } = await import('../src/cad/kernel');
    const { generate } = await import('../src/cad/assembly');
    await initKernel();
    const p = newProject(T('rpi4'));
    const pi = p.modules[0].id;
    const uno = newModule(T('uno')), ch = newModule(T('usb_charger'));
    p.modules.push(uno, ch);
    const out = ch.board.comps.find((c) => c.conn?.type === 'usb_a')!;
    p.links = [{ id: 'l1', a: { module: ch.id, ref: out.ref }, b: { module: pi, ref: 'J_PWR' }, kind: 'power' }];
    const r = generate(p);
    const lit = (mod: string) => r.ghosts.filter((g) => g.fx?.lights && g.tag?.module === mod);
    expect(lit(pi).length).toBeGreaterThan(0);
    expect(lit(pi).every((g) => !g.fx!.dark)).toBe(true);
    expect(lit(uno.id).every((g) => g.fx!.dark)).toBe(true);
    // the Pi's Ethernet jack has nothing in it: no link or activity light
    expect(lit(pi).flatMap((g) => g.fx!.lights!).some((l) => l.ref === 'ETH')).toBe(false);
    // on the board's top, where the template puts them
    const pwr = lit(pi).flatMap((g) => g.fx!.lights!).find((l) => l.name === 'PWR')!;
    expect(Number.isFinite(pwr.p[0] + pwr.p[1] + pwr.p[2])).toBe(true);
    const flows = r.ghosts.filter((g) => g.fx?.flow);
    if (r.report.cables?.length) expect(flows.length).toBeGreaterThan(0);
  }, 600000);
});
