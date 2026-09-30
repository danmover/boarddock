// Checklist ticks live in the project but are not rack changes: no undo step, and undo / redo keep them.
import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { newProject } from '../src/model/library';
import { edit, loadProject, redo, setTicks, store, undo } from '../src/state';

describe('checklist ticks in the store', () => {
  it('are saved in the project without an undo step, and survive undo and redo', () => {
    loadProject(newProject(TEMPLATES.find((t) => t.id === 'rpi4')!.make()));
    edit((q) => { q.name = 'Rack'; });
    const past = store.get().past.length;
    setTicks(['buy|Rails|1|a rail']);
    expect(store.get().project!.ticks).toEqual(['buy|Rails|1|a rail']);
    expect(store.get().past.length).toBe(past);
    const same = store.get().project;
    setTicks(['buy|Rails|1|a rail']); // the same again: nothing happens
    expect(store.get().project).toBe(same);
    edit((q) => { q.name = 'Rack 2'; });
    undo();
    expect(store.get().project!.name).toBe('Rack');
    expect(store.get().project!.ticks).toEqual(['buy|Rails|1|a rail']);
    redo();
    expect(store.get().project!.name).toBe('Rack 2');
    expect(store.get().project!.ticks).toEqual(['buy|Rails|1|a rail']);
    setTicks([]);
    expect(store.get().project!.ticks).toBeUndefined();
    undo();
    expect(store.get().project!.ticks).toBeUndefined();
  });
});
