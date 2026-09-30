// @vitest-environment happy-dom
// The 3D view's "Only what's new": on a built rack with a board added, the steps are only those in which something new
// moves or appears, and everything that was there is already in place (no moves, shown from the first step).
import { describe, it, expect } from 'vitest';
import { initKernel } from '../src/cad/kernel';
import { generate } from '../src/cad/assembly';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { autoLinks, numberLinks } from '../src/model/links';
import { delta, snapshot } from '../src/model/built';
import { seatBoard } from '../src/cad/dockplan';
import { prepare, type OnlyNew } from '../src/ui/Viewer3D';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();

describe("steps for only what's new", () => {
  it('play just the new board and its cable, on a rack that is already together', async () => {
    await initKernel();
    const p = newProject(T('rpi4'));
    p.modules.push(newModule(T('pico')));
    p.links = numberLinks(autoLinks(p));
    const r0 = generate(p), pr = r0.report.panel!;
    p.panel.rails = pr.rails.map((x) => ({ id: x.id, x: x.x, y: x.y, dir: x.dir, length: x.length }));
    p.panel.mounts = pr.mounts.map((m) => ({ id: m.id, rail: m.rail, at: m.at, kind: m.kind, turn: m.turn, lever: m.leverSide > 0 ? 'pos' as const : 'neg' as const, slots: m.slots.map((s, k) => ({ module: s.module, edge: s.module ? pr.modules.find((x) => x.id === s.module && x.mount === m.id && x.slot === k)?.edge ?? s.edge : s.edge })) }));
    p.panel.auto = false;
    p.built = snapshot(p, r0);
    p.modules.push(newModule(T('uno')));
    seatBoard(p, p.modules[2].id); // (as adding it to a built rack does)
    p.links = numberLinks(autoLinks(p));
    const r = generate(p), d = delta(p, r)!;
    const uno = p.modules[2].id, old = new Set(p.modules.slice(0, 2).map((m) => m.id));
    const only: OnlyNew = { parts: d.parts, cables: new Set(d.cables.map((c) => c.id)), boards: new Set([uno]) };
    const args = [{}, r, 'assembly', [256, 256], 6, 'dark', null, false] as const;
    const all = prepare(args[0], args[1], args[2], args[3] as [number, number], args[4], args[5], args[6], args[7], null);
    const part = prepare(args[0], args[1], args[2], args[3] as [number, number], args[4], args[5], args[6], args[7], only);
    expect(part.ranks).toBeGreaterThan(0);
    expect(part.ranks).toBeLessThan(all.ranks);
    expect(part.phases.length).toBe(part.ranks);
    const of = (o: (typeof part.objs)[number]) => o.tag?.module;
    // what was there: no moves, shown from the first step
    const before = part.objs.filter((o) => of(o) && old.has(of(o)!) && !o.anim?.grow);
    expect(before.length).toBeGreaterThan(0);
    for (const o of before) { expect(o.moves).toEqual([]); expect(o.show).toBe(-1); }
    // the new board's holder moves in some step
    const fresh = part.objs.filter((o) => of(o) === uno && o.tag?.kind === 'holder');
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.some((o) => o.moves.length > 0 || o.show >= 0)).toBe(true);
    for (const o of part.objs) for (const m of o.moves) expect(m.rank).toBeLessThan(part.ranks);
  }, 240_000);
});
