// @vitest-environment happy-dom
// The rotation box: typed angles and the turn buttons go to the snap chosen (15°, 45°, 90° or free); with no angle
// to show (a group) it takes how far to turn; turning parts moves their plug direction with them.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RotateBox } from '../src/ui/RotateBox';
import { turnParts } from '../src/ui/rotateOps';
import { activeModule, loadProject, store } from '../src/state';
import { newProject } from '../src/model/library';
import { TEMPLATES } from '../src/model/templates';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null, host: HTMLElement | null = null;
beforeEach(() => { try { localStorage.removeItem('boarddock.rotsnap'); } catch { /* none */ } });
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); root = null; host = null; });

async function mount(props: Partial<Parameters<typeof RotateBox>[0]> & { value: number | null }) {
  const onTurn = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<RotateBox onTurn={onTurn} {...props} />); });
  const q = (s: string) => host!.querySelector<HTMLElement>(s)!;
  const type = async (text: string) => {
    const el = q('input') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  };
  const click = async (el: Element) => { await act(async () => { (el as HTMLElement).click(); }); };
  const snap = async (label: string) => click([...host!.querySelectorAll('.seg button')].find((b) => b.textContent === label)!);
  return { onTurn, q, type, click, snap };
}

describe('the rotation box', () => {
  it('offers Free, 15°, 45° and 90°, on 15° to begin with', async () => {
    const m = await mount({ value: 0 });
    expect([...host!.querySelectorAll('.seg button')].map((b) => b.textContent)).toEqual(['Free', '15°', '45°', '90°']);
    expect(host!.querySelector('.seg button.on')!.textContent).toBe('15°');
    expect(m.q('input').getAttribute('value') ?? (m.q('input') as HTMLInputElement).value).toBe('0');
  });

  it('turns a typed angle to the nearest snap, by the short way round', async () => {
    const m = await mount({ value: 350 });
    await m.type('100'); // 100 snaps to 105; from 350 that is 115 on
    expect(m.onTurn).toHaveBeenLastCalledWith(115);
    await m.snap('45°');
    await m.type('100'); // 90: from 350 that is 100 on
    expect(m.onTurn).toHaveBeenLastCalledWith(100);
    await m.snap('Free');
    await m.type('12.5°');
    expect(m.onTurn).toHaveBeenLastCalledWith(22.5);
  });

  it('steps with the buttons to the next multiple of the snap, also from between two', async () => {
    const m = await mount({ value: 37 });
    await m.click(m.q('[aria-label="Turn on"]'));
    expect(m.onTurn).toHaveBeenLastCalledWith(8); // 45
    await m.click(m.q('[aria-label="Turn back"]'));
    expect(m.onTurn).toHaveBeenLastCalledWith(-7); // 30
    await m.snap('90°');
    await m.click(m.q('[aria-label="Turn on"]'));
    expect(m.onTurn).toHaveBeenLastCalledWith(53); // 90
  });

  it('ignores what is not an angle, and says nothing when the angle is already there', async () => {
    const m = await mount({ value: 90 });
    await m.type('abc');
    await m.type('90');
    await m.type('450');
    expect(m.onTurn).not.toHaveBeenCalled();
  });

  it('takes how far to turn when there is no angle to show (a group)', async () => {
    const m = await mount({ value: null });
    await m.type('20'); // snaps to 15
    expect(m.onTurn).toHaveBeenLastCalledWith(15);
    await m.click(m.q('[aria-label="Turn back"]'));
    expect(m.onTurn).toHaveBeenLastCalledWith(-15);
    await m.snap('45°');
    await m.click(m.q('[aria-label="Turn on"]'));
    expect(m.onTurn).toHaveBeenLastCalledWith(45);
    expect((m.q('input') as HTMLInputElement).value).toBe('');
  });

  it('remembers the snap for next time, and a dock (turns of 90° only) offers just that', async () => {
    const m = await mount({ value: 0 });
    await m.snap('45°');
    await act(async () => { root!.unmount(); });
    host!.remove();
    const again = await mount({ value: 0 });
    expect(host!.querySelector('.seg button.on')!.textContent).toBe('45°');
    await act(async () => { root!.unmount(); });
    host!.remove();
    const dock = await mount({ value: 90, steps: [90], compact: true });
    expect([...host!.querySelectorAll('select option')].map((o) => o.textContent)).toEqual(['90°']);
    await dock.type('200');
    expect(dock.onTurn).toHaveBeenLastCalledWith(90); // 200 snaps to 180: 90 on from 90
    void again;
  });
});

describe('turning parts', () => {
  it("turns a part and the way its plug points together, about the part's own place", () => {
    loadProject(newProject(TEMPLATES.find((t) => t.id === 'rpi4')!.make()));
    const m = activeModule(store.get().project!);
    const c = m.board.comps.find((x) => x.conn?.entry === 'edge')!;
    const { x, y, rot } = c, angle = c.conn!.angle;
    turnParts([c.id], 45);
    const after = store.get().project!.modules[0].board.comps.find((q) => q.id === c.id)!;
    expect(after.rot).toBe(((rot + 45) % 360 + 360) % 360);
    expect(after.conn!.angle).toBe(((angle + 45) % 360 + 360) % 360);
    expect([after.x, after.y]).toEqual([x, y]);
    // and the rest are left alone
    const other = m.board.comps.find((q) => q.id !== c.id)!;
    expect(store.get().project!.modules[0].board.comps.find((q) => q.id === other.id)!.rot).toBe(other.rot);
  });
});
