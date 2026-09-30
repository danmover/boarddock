// What's new in the 3D view: on a built rack, the pieces of the scene that are new since it was built (new boards'
// parts, new docks), found with the same list Export shows; the old ones are not.
import { describe, it, expect, beforeAll } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { delta, snapshot } from '../src/model/built';
import { isNewPiece, newSet, placeKey } from '../src/model/newparts';
import { generatePanel } from '../src/cad/panelgen';
import { initKernel } from '../src/cad/kernel';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();

describe("what's new in 3D", () => {
  beforeAll(async () => { await initKernel(); });

  it('has nothing to say about a rack that was never built', () => {
    const p = newProject(T('rpi4'));
    expect(newSet(p, generatePanel(p))).toBeNull();
  });

  it('marks a new board and its dock, not the boards and docks that were there', () => {
    const p = newProject(T('rpi4'));
    const old = p.modules[0];
    const r1 = generatePanel(p);
    p.built = snapshot(p, r1);
    expect(newSet(p, r1)!.any).toBe(false);
    p.modules.push(newModule(T('usb_charger')));
    const added = p.modules[1];
    const r2 = generatePanel(p);
    const ns = newSet(p, r2)!;
    expect(ns.any).toBe(true);
    expect([...ns.modules]).toEqual([added.id]);
    const pieces = r2.parts.flatMap((pt) => [pt.toAssembly, ...(pt.instances ?? [])].map((T, k) => ({ tag: k ? pt.tags?.[k - 1] ?? pt.tag : pt.tag, T })));
    const isNew = (x: (typeof pieces)[number]) => isNewPiece(ns, x.tag, x.T);
    const ofOld = pieces.filter((x) => x.tag?.module === old.id), ofNew = pieces.filter((x) => x.tag?.module === added.id);
    expect(ofOld.length).toBeGreaterThan(0);
    expect(ofNew.length).toBeGreaterThan(0);
    expect(ofOld.some(isNew)).toBe(false);
    expect(ofNew.every(isNew)).toBe(true);
    // the same count as What's new lists to print
    expect(pieces.filter(isNew).length).toBe(delta(p, r2)!.parts.reduce((n, x) => n + x.qty, 0));
  }, 120000);

  it('keys a placement by what it is and where it sits, to a twentieth of a millimetre', () => {
    const T1 = Array(16).fill(0); T1[12] = 10.01; T1[13] = -5; T1[14] = 3;
    const T2 = [...T1]; T2[12] = 10.02;
    const tag = { kind: 'shoe' as const, mount: 'd1' };
    expect(placeKey(tag, T1)).toBe(placeKey(tag, T2));
    expect(placeKey(tag, T1)).not.toBe(placeKey({ kind: 'shoe', mount: 'd2' }, T1));
    T2[12] = 10.2;
    expect(placeKey(tag, T1)).not.toBe(placeKey(tag, T2));
  });
});
