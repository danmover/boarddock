import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { autoLinks } from '../src/model/links';
import { dropModule, edit, loadProject, putBoards, setActive, store, undo } from '../src/state';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();

describe('project edits', () => {
  it('removing a board takes its cables and dock slot with it and keeps the right board active', () => {
    const p = newProject(T('rpi4'));
    p.modules.push(newModule(T('uno')), newModule(T('pico')));
    p.links = autoLinks(p);
    p.active = 2; // editing the Pico
    const uno = p.modules[1].id, pico = p.modules[2].id;
    expect(p.links.some((l) => l.a.module === uno || l.b.module === uno)).toBe(true);
    expect(dropModule(p, uno)).toBe(true);
    expect(p.modules[p.active].id).toBe(pico);
    expect(p.links.some((l) => l.a.module === uno || l.b.module === uno)).toBe(false);
    expect(p.panel.mounts.some((mt) => mt.slots.some((s) => s.module === uno))).toBe(false);
    expect(dropModule(p, p.modules[0].id) && dropModule(p, p.modules[0].id)).toBe(false); // never the last board
  });

  it('replacing a board keeps its cables, and switching boards is not an undo step', () => {
    const p = newProject(T('rpi4'));
    p.modules.push(newModule(T('uno')));
    p.links = autoLinks(p);
    loadProject(p);
    const n = store.get().project!.links!.length;
    expect(n).toBeGreaterThan(0);
    const past = store.get().past.length;
    setActive(1);
    expect(store.get().project!.active).toBe(1);
    expect(store.get().past.length).toBe(past);
    const id = store.get().project!.modules[1].id;
    putBoards([T('uno')], true); // re-import the Uno over itself
    const q = store.get().project!;
    expect(q.modules[1].id).toBe(id);
    expect(q.links!.length).toBe(n);
  });

  it('opening a project file can be undone', () => {
    loadProject(newProject(T('rpi4')));
    edit((p) => { p.modules[0].board.name = 'Mine'; });
    loadProject(newProject(T('uno')));
    expect(store.get().project!.modules[0].board.name).not.toBe('Mine');
    undo();
    expect(store.get().project!.modules[0].board.name).toBe('Mine');
  });
});
