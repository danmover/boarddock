// "Copy to…": holder options, plug options and marked ports from one board onto others, matched by port name and type.
import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { copySettings, copyTargets, copyText } from '../src/model/copyto';

const T = (id: string, name?: string) => { const b = TEMPLATES.find((t) => t.id === id)!.make(); if (name) b.name = name; return b; };
const rack = () => {
  const p = newProject(T('rpi4'));
  p.modules.push(newModule(T('rpi4', 'Raspberry Pi 4B #2')), newModule(T('rpi4', 'Raspberry Pi 4B #3')), newModule(T('uno')), newModule(T('rpi5')));
  p.modules[0].board.name = 'Raspberry Pi 4B';
  return p;
};
const port = (p: ReturnType<typeof rack>, i: number, ref: string) => p.modules[i].board.comps.find((c) => c.ref === ref)!.conn!;

describe('copy to', () => {
  it('offers boards of the same kind first', () => {
    const p = rack();
    const t = copyTargets(p, p.modules[0].id);
    expect(t.same.map((m) => m.board.name)).toEqual(['Raspberry Pi 4B #2', 'Raspberry Pi 4B #3']);
    expect(t.others.map((m) => m.board.name)).toEqual(['Arduino Uno R3', 'Raspberry Pi 5']);
    expect(copyTargets(p, 'nope')).toEqual({ same: [], others: [] });
  });

  it('copies holder options, keeps the label and the clearances under the board', () => {
    const p = rack();
    const H = p.modules[0].holder;
    Object.assign(H, { style: 'tray', wall: 2.4, material: 'ASA', hold: 'clips', grip: 'gentle', color: '#ff0000', feat: { cradles: false, caps: false, ties: true, guards: true }, leadLen: 4 });
    const r = copySettings(p, p.modules[0].id, [p.modules[1].id, p.modules[2].id], { holder: true, plugs: false, marks: false });
    expect(r).toEqual({ boards: 2, ports: 0, missed: 0 });
    for (const i of [1, 2]) {
      const h = p.modules[i].holder;
      expect([h.style, h.wall, h.material, h.hold, h.grip, h.color]).toEqual(['tray', 2.4, 'ASA', 'clips', 'gentle', '#ff0000']);
      expect(h.feat).toEqual(H.feat);
      expect(h.feat).not.toBe(H.feat); // a copy, not the same object
      expect(h.label).toBe(p.modules[i].board.name.slice(0, 24));
      expect(h.leadLen).not.toBe(4);
    }
    expect(p.modules[3].holder.style).not.toBe('tray'); // not picked
  });

  it('a colour or grip the source has not set is unset on the copy too', () => {
    const p = rack();
    p.modules[1].holder.color = '#00ff00'; p.modules[1].holder.grip = 'gentle';
    copySettings(p, p.modules[0].id, [p.modules[1].id], { holder: true, plugs: false, marks: false });
    expect(p.modules[1].holder.color).toBeUndefined();
    expect(p.modules[1].holder.grip).toBeUndefined();
  });

  it('copies each connector\'s cradle, cap, guard and tie, and the marks, by name and type', () => {
    const p = rack();
    const eth = port(p, 0, 'ETH'), usb = port(p, 0, 'USB2');
    Object.assign(eth, { cradle: true, cap: true, guard: false, tie: true, use: 'yes' });
    Object.assign(usb, { cradle: false, cap: false, guard: true, tie: false, use: 'no' });
    const r = copySettings(p, p.modules[0].id, [p.modules[1].id], { holder: false, plugs: true, marks: true });
    expect(r.boards).toBe(1);
    expect(r.missed).toBe(0);
    expect(r.ports).toBeGreaterThan(5);
    expect(port(p, 1, 'ETH')).toMatchObject({ cradle: true, cap: true, guard: false, tie: true, use: 'yes' });
    expect(port(p, 1, 'USB2')).toMatchObject({ cradle: false, cap: false, guard: true, tie: false, use: 'no' });
    expect(p.modules[1].holder.wall).toBe(p.modules[2].holder.wall); // holder not asked for
  });

  it('marks only, or plug options only, leave the other alone; an unset mark is unset on the copy', () => {
    const p = rack();
    Object.assign(port(p, 0, 'ETH'), { cradle: true, guard: false, use: 'no' });
    Object.assign(port(p, 1, 'ETH'), { cradle: false, guard: true, use: 'yes' });
    copySettings(p, p.modules[0].id, [p.modules[1].id], { holder: false, plugs: false, marks: true });
    expect(port(p, 1, 'ETH')).toMatchObject({ cradle: false, guard: true, use: 'no' });
    delete port(p, 0, 'ETH').use;
    copySettings(p, p.modules[0].id, [p.modules[1].id], { holder: false, plugs: true, marks: false });
    expect(port(p, 1, 'ETH')).toMatchObject({ cradle: true, guard: false, use: 'no' }); // plug options went, the mark stayed
    copySettings(p, p.modules[0].id, [p.modules[1].id], { holder: false, plugs: false, marks: true });
    expect(port(p, 1, 'ETH').use).toBeUndefined();
  });

  it('onto a board of another kind, only the ports both have (same name and type) are copied, and the rest are counted', () => {
    const p = rack();
    Object.assign(port(p, 0, 'ETH'), { tie: false });
    const uno = p.modules[3];
    const r = copySettings(p, p.modules[0].id, [uno.id, p.modules[4].id], { holder: false, plugs: true, marks: false });
    expect(r.boards).toBe(2);
    expect(r.missed).toBeGreaterThan(0);
    // the Pi 5 has the same port names and types: its ETH took the setting; the Uno has none of them
    expect(port(p, 4, 'ETH').tie).toBe(false);
    expect(uno.board.comps.every((c) => !c.conn || c.conn.tie === TEMPLATES.find((t) => t.id === 'uno')!.make().comps.find((x) => x.ref === c.ref)!.conn!.tie)).toBe(true);
  });

  it('never copies onto itself or onto boards not picked, and says what it did', () => {
    const p = rack();
    Object.assign(p.modules[0].holder, { wall: 3 });
    const r = copySettings(p, p.modules[0].id, [p.modules[0].id, p.modules[2].id], { holder: true, plugs: false, marks: false });
    expect(r.boards).toBe(1);
    expect(p.modules[1].holder.wall).not.toBe(3);
    expect(copyText('Pi 4B', r, { holder: true, plugs: true, marks: true })).toMatch(/^Copied holder options, cradles, caps, guards and tie anchors and marked ports from Pi 4B to 1 board\./);
    expect(copyText('Pi 4B', { boards: 2, ports: 3, missed: 2 }, { holder: false, plugs: true, marks: false })).toMatch(/to 2 boards \(2 ports had no match/);
  });
});
