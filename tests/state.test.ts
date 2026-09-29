import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { autoLinks } from '../src/model/links';
import { dropModule, edit, loadProject, putBoards, setActive, store, undo } from '../src/state';
import { connectIfNone } from '../src/ui/linkOps';

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

  it('starting a rack from several boards opens on the first; adding to a rack opens on the first added', () => {
    store.set({ project: null, past: [], future: [], sel: [] });
    putBoards([T('rpi4'), T('uno'), T('pico'), T('uno')], false);
    let p = store.get().project!;
    expect(p.modules.map((m) => m.board.name)).toEqual(['Raspberry Pi 4B', 'Arduino Uno R3', 'Raspberry Pi Pico', 'Arduino Uno R3 #2']);
    expect(p.active).toBe(0);
    expect(store.get().past.length).toBe(0);
    // more onto that rack: the first of the new ones is the board being edited
    putBoards([T('nano'), T('pico')], false, { stay: true });
    p = store.get().project!;
    expect(p.modules.length).toBe(6);
    expect(p.active).toBe(4);
    // replacing the board being edited with several: the first takes its place and stays the one being edited
    setActive(1);
    putBoards([T('nano'), T('rpi4')], true);
    p = store.get().project!;
    expect(p.active).toBe(1);
    expect(p.modules[1].board.name).toMatch(/^Arduino Nano/);
    expect(p.modules.length).toBe(7);
  });

  it('opening a project file can be undone', () => {
    loadProject(newProject(T('rpi4')));
    edit((p) => { p.modules[0].board.name = 'Mine'; });
    loadProject(newProject(T('uno')));
    expect(store.get().project!.modules[0].board.name).not.toBe('Mine');
    undo();
    expect(store.get().project!.modules[0].board.name).toBe('Mine');
  });

  it('Next from the Plugs step connects a rack with no cables, and leaves one you started connecting alone', () => {
    store.set({ project: null, past: [], future: [], sel: [] });
    putBoards([T('rpi4'), T('uno'), T('usb_hub')], false);
    expect(store.get().project!.links ?? []).toEqual([]);
    expect(connectIfNone()).toBe(true);
    const n = store.get().project!.links!.length;
    expect(n).toBeGreaterThan(0);
    // ⌘Z takes them all back in one go
    undo();
    expect(store.get().project!.links ?? []).toEqual([]);
    // one cable of your own: nothing more is added
    edit((p) => { const [a] = autoLinks(p); p.links = [a]; });
    expect(connectIfNone()).toBe(false);
    expect(store.get().project!.links!.length).toBe(1);
  });
});
