// The layout lock and change receipts: what is locked, what an automatic change may not touch, Auto-arrange around
// locked docks and rails, the receipts each automatic change writes, and that undo takes a change and its receipt together.
import { describe, it, expect, beforeEach } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { addReceipts, describeMoves, enforceLocks, hasLocks, isDockLocked, isRailLocked, lockedDocks, lockedModules, lockedRails, placesOf, pruneLocks, RECEIPTS_KEEP, setLock } from '../src/model/locks';
import { arrangeAround } from '../src/cad/arrangelock';
import { appendDock, seatBoard } from '../src/cad/dockplan';
import { autoArrange, quickLayout } from '../src/ui/panelOps';
import { addLinks } from '../src/ui/linkOps';
import { closeProject, loadProject, store, undo } from '../src/state';
import type { Project, RailMount } from '../src/model/types';

const T = (id: string, name?: string) => { const b = TEMPLATES.find((t) => t.id === id)!.make(); if (name) b.name = name; return b; };
const dock = (id: string, rail: string, at: number, ...mods: (string | null)[]): RailMount => ({ id, rail, at, kind: 'dock', turn: 90, slots: [0, 1].map((k) => ({ module: mods[k] ?? null, edge: 'auto' as const })) });

/** A layout by hand: Pi A and Pi B back to back in dock d1 on rail 1, Pi C alone in d2 on rail 1, an Uno in d3 on rail 2. */
function rack(): { p: Project; ids: Record<string, string> } {
  const p = newProject(T('rpi4', 'Raspberry Pi 4B'));
  p.modules.push(newModule(T('rpi4', 'Raspberry Pi 4B #2')), newModule(T('rpi4', 'Raspberry Pi 4B #3')), newModule(T('uno')));
  const [a, b, c, u] = p.modules.map((m) => m.id);
  p.panel.auto = false;
  p.panel.rails = [{ id: 'r1', x: 0, y: 0, dir: 'h', length: null }, { id: 'r2', x: 0, y: -90, dir: 'h', length: null }];
  p.panel.mounts = [dock('d1', 'r1', 60, a, b), dock('d2', 'r1', 200, c), dock('d3', 'r2', 60, u)];
  return { p, ids: { a, b, c, u } };
}
const seats = (p: Project) => p.panel.mounts.flatMap((m) => m.slots.map((s) => s.module)).filter(Boolean) as string[];

describe('locks', () => {
  it('lock the whole layout, a dock or a rail; a rail takes its docks with it', () => {
    const { p } = rack();
    expect(hasLocks(p)).toBe(false);
    setLock(p, 'dock', 'd2', true);
    expect([...lockedDocks(p)]).toEqual(['d2']);
    setLock(p, 'rail', 'r1', true);
    expect([...lockedRails(p)]).toEqual(['r1']);
    expect([...lockedDocks(p)].sort()).toEqual(['d1', 'd2']);
    expect(isRailLocked(p, 'r2')).toBe(false);
    expect(isDockLocked(p, 'd3')).toBe(false);
    setLock(p, 'all', null, true);
    expect([...lockedDocks(p)].sort()).toEqual(['d1', 'd2', 'd3']);
    expect([...lockedRails(p)].sort()).toEqual(['r1', 'r2']);
    setLock(p, 'all', null, false);
    setLock(p, 'rail', 'r1', false);
    setLock(p, 'dock', 'd2', false);
    expect(p.locks).toBeUndefined();
    setLock(p, 'dock', null, true); // no id: nothing
    expect(p.locks).toBeUndefined();
  });

  it('the boards in locked docks, with what is stacked on them', () => {
    const { p, ids } = rack();
    p.modules[3].on = ids.a; // the Uno on Pi A
    setLock(p, 'dock', 'd1', true);
    expect([...lockedModules(p)].sort()).toEqual([ids.a, ids.b, ids.u].sort());
  });

  it('locks on docks and rails that are gone are dropped', () => {
    const { p } = rack();
    setLock(p, 'dock', 'd1', true); setLock(p, 'rail', 'r2', true);
    p.panel.mounts = p.panel.mounts.filter((m) => m.id !== 'd1');
    pruneLocks(p);
    expect(p.locks).toEqual({ rails: ['r2'] });
    p.panel.rails = p.panel.rails.filter((r) => r.id !== 'r2');
    pruneLocks(p);
    expect(p.locks).toBeUndefined();
  });
});

describe('enforcing locks after an automatic change', () => {
  it('puts back a locked dock that was moved, emptied or removed, and a locked rail that was moved', () => {
    const { p, ids } = rack();
    setLock(p, 'dock', 'd1', true); setLock(p, 'rail', 'r2', true);
    const before = structuredClone(p), after = structuredClone(p);
    after.panel.mounts[0].at = 300; // d1 slid along
    after.panel.mounts[0].slots[1].module = null; // Pi B taken out of it
    after.panel.mounts.push(dock('d9', 'r1', 0, ids.b)); // and given a dock of its own
    after.panel.rails[1].y = 0; // r2 moved
    after.panel.mounts.splice(2, 1); // d3 gone with... (it is on locked r2)
    const held = enforceLocks(before, after, (k, id) => `${k} ${id}`);
    expect(held.sort()).toEqual(['dock d1', 'dock d3', 'rail r2']);
    expect(after.panel.mounts.find((m) => m.id === 'd1')).toEqual(before.panel.mounts[0]);
    expect(after.panel.mounts.find((m) => m.id === 'd3')).toEqual(before.panel.mounts[2]);
    expect(after.panel.rails[1]).toEqual(before.panel.rails[1]);
    // Pi B is back in d1 and in no other dock
    expect(seats(after).filter((m) => m === ids.b)).toHaveLength(1);
    expect(after.panel.mounts.find((m) => m.id === 'd9')!.slots[0].module).toBeNull();
  });

  it('leaves alone what is not locked, and does nothing without locks', () => {
    const { p } = rack();
    setLock(p, 'dock', 'd1', true);
    const after = structuredClone(p);
    after.panel.mounts[1].at = 350;
    expect(enforceLocks(p, after)).toEqual([]);
    expect(after.panel.mounts[1].at).toBe(350);
    const plain = rack().p, moved = structuredClone(plain);
    moved.panel.mounts[0].at = 1;
    expect(enforceLocks(plain, moved)).toEqual([]);
    expect(moved.panel.mounts[0].at).toBe(1);
  });

  it('a change that made the layout automatic is undone: an automatic layout could not leave anything where it is', () => {
    const { p } = rack();
    setLock(p, 'dock', 'd2', true);
    const after = structuredClone(p);
    after.panel.auto = true; after.panel.mounts = []; after.panel.rails = [];
    expect(enforceLocks(p, after)).toEqual(['the whole layout']);
    expect(after.panel.auto).toBe(false);
    expect(after.panel.mounts).toEqual(p.panel.mounts);
    expect(after.panel.rails).toEqual(p.panel.rails);
  });

  it('a board that is gone leaves its slot in a locked dock empty', () => {
    const { p, ids } = rack();
    setLock(p, 'dock', 'd1', true);
    const before = structuredClone(p), after = structuredClone(p);
    after.modules = after.modules.filter((m) => m.id !== ids.a);
    enforceLocks(before, after);
    expect(after.panel.mounts[0].slots.map((s) => s.module)).toEqual([null, ids.b]);
  });
});

describe('Auto-arrange around locks', () => {
  it('a locked dock stays exactly as it is, nothing goes in its free slot, and the other boards are seated again', () => {
    const { p, ids } = rack();
    p.panel.mounts[0].slots[1].module = null; // d1: Pi A alone, its back slot free
    setLock(p, 'dock', 'd1', true);
    const d1 = structuredClone(p.panel.mounts[0]);
    const seated = arrangeAround(p);
    expect(seated.sort()).toEqual([ids.b, ids.c, ids.u].sort());
    expect(p.panel.mounts.find((m) => m.id === 'd1')).toEqual(d1);
    expect(p.panel.mounts[0].slots[1].module).toBeNull();
    // every board is in exactly one dock
    expect(seats(p).sort()).toEqual([ids.a, ids.b, ids.c, ids.u].sort());
    // the old docks that were not locked are gone
    expect(p.panel.mounts.some((m) => m.id === 'd2' || m.id === 'd3')).toBe(false);
  });

  it('nothing is put on a locked rail: new docks go on the other rails', () => {
    const { p } = rack();
    setLock(p, 'rail', 'r1', true);
    const r1 = p.panel.mounts.filter((m) => m.rail === 'r1').map((m) => structuredClone(m));
    arrangeAround(p);
    expect(p.panel.mounts.filter((m) => m.rail === 'r1')).toEqual(r1);
    expect(p.panel.mounts.filter((m) => m.rail !== 'r1').flatMap((m) => m.slots.map((s) => s.module)).filter(Boolean)).toHaveLength(1); // the Uno, re-seated on r2
  });

  it('with every rail locked, a board that is on no dock gets a rail of its own, clear of the others; every dock on a locked rail is locked', () => {
    const { p, ids } = rack();
    setLock(p, 'rail', 'r1', true); setLock(p, 'rail', 'r2', true);
    p.modules.push(newModule(T('rpi4', 'Raspberry Pi 4B #4')));
    const extra = p.modules[4].id, before = structuredClone(p.panel);
    expect(arrangeAround(p)).toEqual([extra]); // (the boards in docks on locked rails are held by those docks)
    expect(p.panel.rails.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
    expect(p.panel.rails[2].y).toBeLessThan(Math.min(before.rails[0].y, before.rails[1].y));
    expect(p.panel.mounts.filter((m) => m.rail !== 'r3')).toEqual(before.mounts);
    expect(p.panel.mounts.filter((m) => m.rail === 'r3').flatMap((m) => m.slots.map((s) => s.module)).filter(Boolean)).toEqual([extra]);
    expect(seats(p).sort()).toEqual([ids.a, ids.b, ids.c, ids.u, extra].sort());
  });

  it('appendDock and seatBoard keep off locked rails and docks', () => {
    const { p, ids } = rack();
    p.panel.mounts[1].slots[1].module = null; // d2 has a free back slot
    setLock(p, 'dock', 'd2', true);
    p.panel.mounts[0].slots[1].module = null; // d1 too, not locked
    p.modules.push(newModule(T('rpi4', 'Raspberry Pi 4B #4')));
    const n = p.modules[4].id;
    seatBoard(p, n);
    expect(p.panel.mounts.find((m) => m.id === 'd2')!.slots[1].module).toBeNull(); // not into the locked dock
    setLock(p, 'rail', 'r1', true); setLock(p, 'rail', 'r2', true);
    const rails = p.panel.rails.length;
    p.panel.mounts.forEach((m) => m.slots.forEach((s) => { if (s.module === n) s.module = null; }));
    appendDock(p, n);
    expect(p.panel.rails.length).toBe(rails + 1);
    expect(p.panel.mounts[p.panel.mounts.length - 1].rail).toBe('r3');
    expect(ids.a).toBeTruthy();
  });
});

describe('receipts', () => {
  it('say which boards moved to which rail, one line each up to three, then one for all', () => {
    const name = (id: string) => `Pi ${id}`;
    const b = new Map([['1', { rail: 1 }], ['2', { rail: 1 }], ['3', { rail: 2 }]]), a = new Map([['1', { rail: 1 }], ['2', { rail: 2 }], ['3', { rail: 2 }], ['4', { rail: 2 }]]);
    expect(describeMoves('Auto-arrange', b, a, name)).toEqual(['Auto-arrange moved Pi 2 from rail 1 to rail 2', 'Auto-arrange put Pi 4 on rail 2']);
    const many = new Map([...'123456'].map((i) => [i, { rail: 1 }] as const)), gone = new Map([...'123456'].map((i) => [i, { rail: 2 }] as const));
    expect(describeMoves('Auto-arrange', many, gone, name)).toEqual(['Auto-arrange moved 6 boards to other rails (Pi 1 from rail 1 to rail 2, Pi 2 from rail 1 to rail 2, Pi 3 from rail 1 to rail 2, and 3 more)']);
    expect(describeMoves('Auto-arrange', b, b, name)).toEqual([]);
    expect(describeMoves('Tidy up', new Map([['1', { rail: 1 }], ['2', { rail: 2 }]]), new Map([['1', { rail: 1 }], ['2', { rail: 1 }]]), name)).toEqual(['Tidy up moved Pi 2 from rail 2 to rail 1', 'Tidy up used 1 rail where there were 2']);
  });

  it('places boards by rail from the rails and docks, or from the build of an automatic layout', () => {
    const { p, ids } = rack();
    expect([...placesOf(p)].map(([id, x]) => [id, x.rail]).sort()).toEqual([[ids.a, 1], [ids.b, 1], [ids.c, 1], [ids.u, 2]].sort());
    p.panel.auto = true;
    const rep = { rails: [{ id: 'x' }, { id: 'y' }], mounts: [{ id: 'm1', rail: 'y' }], modules: [{ id: ids.a, mount: 'm1' }] } as never;
    expect([...placesOf(p, rep)]).toEqual([[ids.a, { rail: 2 }]]);
  });

  it('are kept newest last and the oldest dropped', () => {
    const { p } = rack();
    for (let i = 0; i < RECEIPTS_KEEP + 5; i++) addReceipts(p, 'Auto-connect', [`Auto-connect added ${i} cables`], '2026-09-30T10:00:00Z');
    expect(p.receipts).toHaveLength(RECEIPTS_KEEP);
    expect(p.receipts![RECEIPTS_KEEP - 1].text).toBe(`Auto-connect added ${RECEIPTS_KEEP + 4} cables`);
    expect(p.receipts![0].text).toBe('Auto-connect added 5 cables');
    addReceipts(p, 'x', ['', '']);
    expect(p.receipts).toHaveLength(RECEIPTS_KEEP);
  });
});

describe('automatic changes on the rack: locks kept, receipts written, one undo step', () => {
  beforeEach(() => closeProject());

  it('Auto-arrange around a locked dock writes a receipt for each board it moved to another rail, and undo takes it back with the change', () => {
    const { p, ids } = rack();
    // d2 (Pi C) is on rail 1; rail 2 is the last rail that is not locked, so Pi C goes there when everything not locked is seated again
    setLock(p, 'dock', 'd1', true);
    p.panel.mounts = [p.panel.mounts[0], dock('d2', 'r1', 200, ids.c), dock('d3', 'r1', 300, ids.u)];
    loadProject(p);
    const past = store.get().past.length;
    autoArrange();
    const q = store.get().project!;
    expect(q.panel.mounts.find((m) => m.id === 'd1')).toEqual(p.panel.mounts[0]);
    expect(q.locks).toEqual({ docks: ['d1'] });
    const texts = (q.receipts ?? []).map((r) => r.text);
    expect(texts).toContain('Auto-arrange moved Raspberry Pi 4B #3 from rail 1 to rail 2');
    expect(texts.every((t) => t.startsWith('Auto-arrange '))).toBe(true);
    expect(store.get().past.length).toBe(past + 1);
    undo();
    expect(store.get().project!.receipts).toBeUndefined();
    expect(store.get().project!.panel.mounts.map((m) => m.id)).toEqual(['d1', 'd2', 'd3']);
  });

  it('with the whole layout locked, Auto-arrange and the quick layouts change nothing', () => {
    const { p } = rack();
    setLock(p, 'all', null, true);
    loadProject(p);
    const before = store.get().project;
    autoArrange();
    quickLayout('rows');
    expect(store.get().project).toBe(before);
    expect(store.get().past.length).toBe(0);
  });

  it('Auto-connect writes a receipt with what it added, in the same undo step', () => {
    const p = newProject(T('rpi4'));
    p.modules.push(newModule(T('uno')), newModule(T('usb_charger6')));
    loadProject(p);
    addLinks();
    const q = store.get().project!;
    expect(q.links!.length).toBeGreaterThan(0);
    expect(q.receipts).toHaveLength(1);
    expect(q.receipts![0]).toMatchObject({ what: 'Auto-connect' });
    expect(q.receipts![0].text).toMatch(new RegExp(`^Auto-connect added ${q.links!.length} cables? \\(`));
    undo();
    expect(store.get().project!.receipts).toBeUndefined();
    expect(store.get().project!.links ?? []).toHaveLength(0);
  });
});
