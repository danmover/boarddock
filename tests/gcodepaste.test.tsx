// @vitest-environment happy-dom
// Start code pasted for a Bambu Lab A1 mini is checked before it is kept: code that can't be the A1 mini's start code
// stays out of the project and the page says why in plain words; code that only looks odd is kept once the user says so.
// (The code is written for this test; none of it is Bambu's.)
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GcodeSection } from '../src/ui/GcodeSection';
import { loadProject, store } from '../src/state';
import { newProject } from '../src/model/library';
import { TEMPLATES } from '../src/model/templates';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null, host: HTMLElement | null = null;
afterEach(async () => { await act(async () => { root?.unmount(); }); host?.remove(); root = null; host = null; });

const START = ['G90', 'M83', 'M140 S[bed_temperature_initial_layer_single]', 'M104 S140', 'G28', 'G1 X20 Y10 F6000', 'M190 S[bed_temperature_initial_layer_single]', 'M109 S[nozzle_temperature_initial_layer]', 'G92 E0', 'G1 X20 Y10 E0', 'G1 X120 Y10 E12 F1500'].join('\n');
const own = () => store.get().project!.printer.bambu;

beforeEach(() => {
  const p = newProject(TEMPLATES.find((t) => t.id === 'uno')!.make());
  p.printer = { name: 'Bambu Lab A1 mini', bed: [180, 180], spacing: 6, maxZ: 180 };
  loadProject(p);
});

async function open() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<GcodeSection plates={0} plateMeshes={() => []} plate3mf={() => new Uint8Array()} base="rack" brim={false} plateKey={0} />); });
  return host;
}
const button = (h: HTMLElement, text: string) => [...h.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text)) as HTMLButtonElement | undefined;
/** Type into a controlled textarea the way a user's paste arrives. */
async function type(el: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function pasteStart(h: HTMLElement, start: string) {
  if (!h.querySelector('.bambupaste')) await act(async () => { button(h, 'Paste it')!.click(); });
  await type(h.querySelector<HTMLTextAreaElement>('.bambupaste textarea')!, start);
  await act(async () => { button(h, 'Use it')!.click(); });
}

describe('pasting start code for the A1 mini', () => {
  it('keeps code that passes, and then offers to slice', async () => {
    const h = await open();
    expect(h.textContent).toMatch(/One step first: the Bambu Lab A1 mini's own start code/);
    await pasteStart(h, START);
    expect(own()).toMatchObject({ start: START, from: 'code you pasted', for: 'Bambu Lab A1 mini' });
    expect(h.querySelector('[role=alert]')).toBeNull();
    expect(h.textContent).toMatch(/Its own start code is in/);
    expect(h.textContent).not.toMatch(/One step first/);
  });

  it("does not keep, or use, code for a bigger printer's bed, and says so", async () => {
    const h = await open();
    await pasteStart(h, `${START}\nG1 X250 Y255 F6000`);
    expect(own()).toBeUndefined();
    const note = h.querySelector('[role=alert]')!;
    expect(note.textContent).toMatch(/This code can't be used/);
    expect(note.textContent).toMatch(/X 250 \(70 mm past the right edge\) and Y 255 \(75 mm past the back edge\)/);
    expect(note.textContent).toMatch(/farther than the Bambu Lab A1 mini reaches|farther than the A1 mini reaches/);
    // nothing to accept: only a way to leave it out; and what was pasted stays in the box to fix
    expect(button(h, 'Use it anyway')).toBeUndefined();
    expect(h.querySelector<HTMLTextAreaElement>('.bambupaste textarea')!.value).toContain('X250 Y255');
    expect(h.textContent).toMatch(/One step first/);
    await act(async () => { button(h, 'Leave it out')!.click(); });
    expect(h.querySelector('[role=alert]')).toBeNull();
  });

  it('does not keep end code pasted into the start box, or an empty one', async () => {
    const h = await open();
    await pasteStart(h, 'M104 S0\nM140 S0\nG1 Z5\nG1 X5 Y170');
    expect(own()).toBeUndefined();
    expect(h.querySelector('[role=alert]')!.textContent).toMatch(/end code, not start code/);
    await act(async () => { button(h, 'Leave it out')!.click(); });
    await pasteStart(h, '; only a comment\n');
    expect(own()).toBeUndefined();
    expect(h.querySelector('[role=alert]')!.textContent).toMatch(/nothing in it but comments/);
  });

  it('asks before keeping code that goes a little off the bed, then keeps what was accepted', async () => {
    const h = await open();
    await pasteStart(h, `${START}\nG1 X-38.2 Y100 F6000`);
    expect(own()).toBeUndefined();
    expect(h.querySelector('[role=alert]')!.textContent).toMatch(/Have a look before this code is used/);
    expect(h.querySelector('[role=alert]')!.textContent).toMatch(/X -38.2 \(38.2 mm past the left edge\)/);
    await act(async () => { button(h, 'Use it anyway')!.click(); });
    expect(own()).toMatchObject({ from: 'code you pasted', ok: ['start:past'] });
    expect(h.querySelector('[role=alert]')).toBeNull();
    expect(h.textContent).toMatch(/Its own start code is in/);
  });

  it("does not use code a project holds for another printer or that fails now, and says why", async () => {
    // a project from before the check, holding far-off code
    const p = structuredClone(store.get().project!);
    p.printer.bambu = { start: `${START}\nG1 X250 Y255 F6000`, from: 'code you pasted' };
    loadProject(p);
    const h = await open();
    expect(h.textContent).toMatch(/Start code kept, not used/);
    expect(h.querySelector('[role=alert]')!.textContent).toMatch(/farther than the .*A1 mini reaches/);
    expect(h.textContent).toMatch(/One step first/);
    await act(async () => { button(h, 'Forget it')!.click(); });
    expect(own()).toBeUndefined();
  });
});
