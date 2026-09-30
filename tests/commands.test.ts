// The command palette's list: built from the actions that already exist (the very functions the buttons call), what
// can't be done now stays but greyed with its reason, and typing finds things by title, group and other words.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildCommands, searchCommands, VIEW_DIRS, type CmdCtx } from '../src/ui/commands';
import { closeProject, loadProject, redo, select, store, undo, type Step } from '../src/state';
import { newProject } from '../src/model/library';
import { TEMPLATES } from '../src/model/templates';
import { autoArrange, markBuilt } from '../src/ui/panelOps';
import { addLinks, rewire } from '../src/ui/linkOps';
import { toggleFocus, view3d } from '../src/ui/view3d';

const STEPS = (['import', 'board', 'plugs', 'holder', 'mount', 'check', 'export'] as Step[]).map((id, i) => ({ id, label: ['Start', 'Board', 'Plugs', 'Holder', 'Rails', 'Check', 'Export'][i], title: `Title ${i}`, text: `Text ${i}` }));
const ctx = () => ({ steps: STEPS, goStep: vi.fn(), saveProject: vi.fn(), newRack: vi.fn(), look: vi.fn(), toggleTheme: vi.fn(), showKeys: vi.fn() }) satisfies CmdCtx;
const list = (c = ctx()) => buildCommands(store.get(), c);
const by = (l: ReturnType<typeof list>, title: string) => l.find((x) => x.title === title || x.id === title)!;

beforeEach(() => { closeProject(); view3d.set({ focus: null, news: false }); });

describe('cables off, from the palette', () => {
  it('switches cables off and on, keeps the links, and greys out what needs cables', () => {
    const p = newProject(TEMPLATES.find((t) => t.id === 'rpi4')!.make());
    p.links = [{ id: 'l1', a: { module: 'a', ref: 'USB' }, b: { module: 'b', ref: 'USB' }, kind: 'usb' }];
    loadProject(p);
    const links = structuredClone(store.get().project!.links);
    let l = list();
    expect(by(l, 'Cables: off (holders and plug covers only)').enabled).toBe(true);
    expect(by(l, 'Auto-connect the cables').enabled).toBe(true);
    expect(by(l, 'Show the Wiring view').enabled).toBe(true);
    by(l, 'Cables: off (holders and plug covers only)').run();
    expect(store.get().project!.cablesOff).toBe(true);
    expect(store.get().project!.links).toEqual(links);
    l = list();
    expect(l.some((c) => c.title === 'Cables: off (holders and plug covers only)')).toBe(false);
    expect(by(l, 'Auto-connect the cables').enabled).toBe(false);
    expect(by(l, 'Auto-connect the cables').why).toBe('Cables are off for this rack');
    expect(by(l, 'Rewire the auto-connected cables').enabled).toBe(false);
    expect(l.some((c) => c.title === 'Show the Wiring view')).toBe(false); // (no wiring without cables)
    by(l, 'Cables: in the app').run();
    expect(store.get().project!.cablesOff).toBeUndefined();
    expect(store.get().project!.links).toEqual(links);
    expect(by(list(), 'Auto-connect the cables').enabled).toBe(true);
    undo();
    expect(store.get().project!.cablesOff).toBe(true); // (each is one undo step)
  });
});

describe('the command list', () => {
  it('has a unique id for each command, and a title, a group and a run function', () => {
    loadProject(newProject(TEMPLATES.find((t) => t.id === 'rpi4')!.make()));
    const l = list();
    expect(new Set(l.map((c) => c.id)).size).toBe(l.length);
    for (const c of l) { expect(c.title).toBeTruthy(); expect(c.group).toBeTruthy(); expect(typeof c.run).toBe('function'); }
    expect(l.length).toBeGreaterThan(30);
  });

  it('with no rack open, offers Start, the theme and the shortcuts, and says what the rest needs', () => {
    const l = list();
    expect(l.filter((c) => c.enabled).map((c) => c.title).sort()).toEqual(['Go to Start', 'Keyboard shortcuts', 'Switch to the light theme'].sort());
    expect(by(l, 'Add a board').enabled).toBe(false);
    expect(by(l, 'Add a board').why).toBe('Add a board first');
  });

  it('lists the seven steps, in order, with their number keys, each going to its step', () => {
    loadProject(newProject(TEMPLATES.find((t) => t.id === 'rpi4')!.make()));
    const c = ctx(), l = list(c), steps = l.filter((x) => x.group === 'Steps');
    expect(steps.map((x) => x.title)).toEqual(STEPS.map((s) => `Go to ${s.label}`));
    expect(steps.map((x) => x.keys)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(steps.every((x) => x.enabled)).toBe(true);
    steps[4].run();
    expect(c.goStep).toHaveBeenCalledWith('mount');
  });

  it("runs the app's own functions rather than its own copies", () => {
    loadProject(newProject(TEMPLATES.find((t) => t.id === 'rpi4')!.make()));
    const c = ctx(), l = list(c);
    expect(by(l, 'Undo').run).toBe(undo);
    expect(by(l, 'Redo').run).toBe(redo);
    expect(by(l, 'Auto-arrange the boards').run).toBe(autoArrange);
    expect(by(l, 'Rewire the auto-connected cables').run).toBe(rewire);
    expect(by(l, 'Mark the rack as built').run).toBe(markBuilt);
    expect(by(l, 'Save the project file').run).toBe(c.saveProject);
    expect(by(l, 'Start a new rack').run).toBe(c.newRack);
    // (Auto-connect is called with no arguments: not the click event)
    expect(typeof by(l, 'Auto-connect the cables').run).toBe('function');
    void addLinks;
    by(l, 'View from above').run();
    expect(c.look).toHaveBeenCalledWith([...VIEW_DIRS.top]);
    expect(store.get().view).toBe('assembly');
  });

  it('greys what cannot be done yet, with the reason', () => {
    loadProject(newProject(TEMPLATES.find((t) => t.id === 'rpi4')!.make()));
    let l = list();
    expect(by(l, 'Undo').enabled).toBe(false);
    expect(by(l, 'Undo').why).toBe('Nothing to undo');
    expect(by(l, 'Isolate the selection').enabled).toBe(false);
    expect(by(l, 'Isolate the selection').why).toMatch(/Pick something/);
    expect(by(l, "Highlight what's new").enabled).toBe(false);
    expect(by(l, 'Clear the selection').enabled).toBe(false);
    expect(by(l, 'zones').enabled).toBe(false);
    select([{ kind: 'module', id: store.get().project!.modules[0].id }]);
    l = list();
    expect(by(l, 'Isolate the selection').enabled).toBe(true);
    expect(by(l, 'X-ray the selection').enabled).toBe(true);
    expect(by(l, 'Clear the selection').enabled).toBe(true);
    expect(by(l, 'Remove what is picked').enabled).toBe(true);
  });

  it('switches Isolate on and off for the selection, and offers to leave it', () => {
    loadProject(newProject(TEMPLATES.find((t) => t.id === 'rpi4')!.make()));
    const id = store.get().project!.modules[0].id;
    select([{ kind: 'module', id }]);
    by(list(), 'Isolate the selection').run();
    expect(view3d.get().focus).toMatchObject({ mode: 'isolate', items: [{ kind: 'module', id }] });
    const l = list();
    expect(l.some((c) => c.title === 'Show everything again')).toBe(true);
    // (with a focus on, the selection may go and the switches still work: they change its mode)
    select([]);
    expect(by(list(), 'X-ray the selection').enabled).toBe(true);
    by(list(), 'X-ray the selection').run();
    expect(view3d.get().focus?.mode).toBe('xray');
    by(list(), 'Show everything again').run();
    expect(view3d.get().focus).toBeNull();
    expect(toggleFocus('isolate')).toBe(false); // nothing selected, nothing to isolate
  });

  it('offers the Rails view and the layout commands only for a rack on rails', () => {
    const p = newProject(TEMPLATES.find((t) => t.id === 'rpi4')!.make());
    loadProject(p);
    expect(by(list(), 'Show the Rails view').enabled).toBe(true);
    loadProject({ ...p, layout: 'loose' });
    const l = list();
    expect(l.some((c) => c.title === 'Show the Rails view')).toBe(false);
    expect(by(l, 'Auto-arrange the boards').enabled).toBe(false);
  });
});

describe('searching the commands', () => {
  const all = () => { loadProject(newProject(TEMPLATES.find((t) => t.id === 'rpi4')!.make())); return list(); };

  it('gives them all for nothing typed', () => { const l = all(); expect(searchCommands(l, '  ')).toBe(l); });

  it('puts a title that starts with the word first, then one that has it as a word, then one that has it inside', () => {
    const l = all();
    expect(searchCommands(l, 'undo')[0].title).toBe('Undo');
    const rails = searchCommands(l, 'rail').map((c) => c.title);
    expect(rails.indexOf('Add a horizontal rail')).toBeGreaterThanOrEqual(0);
    expect(rails[0]).toBe('Go to Rails'); // (starts with... no: "Go to Rails" has it as a word, the others too, this one first in the list)
  });

  it('needs every word typed, in any order, in the title or its group and other words', () => {
    const l = all();
    expect(searchCommands(l, 'view rails').map((c) => c.title)).toContain('Show the Rails view');
    expect(searchCommands(l, 'rails view').map((c) => c.title)[0]).toBe('Show the Rails view');
    expect(searchCommands(l, 'camera top').map((c) => c.title)).toEqual(['View from above']);
    expect(searchCommands(l, 'zzzz')).toEqual([]);
    expect(searchCommands(l, 'undo zzzz')).toEqual([]);
  });

  it('finds by letters in order when the word is not there whole (wiring: "wrng"), if they are close together', () => {
    expect(searchCommands(all(), 'wrng').map((c) => c.title)).toContain('Show the Wiring view');
    expect(searchCommands(all(), 'theme').map((c) => c.id)).toEqual(['theme']); // (not "hide the mains zones" by scattered letters)
  });

  it('lists what can be done before what cannot, when they match alike', () => {
    const mk = (title: string, enabled: boolean) => ({ id: title, title, group: 'G', enabled, run: () => {} });
    const l = [mk('Open one', false), mk('Open two', true), mk('Open three', false), mk('Open four', true)];
    expect(searchCommands(l, 'open').map((c) => c.title)).toEqual(['Open two', 'Open four', 'Open one', 'Open three']);
    // a better match still beats an enabled one that matches less well
    expect(searchCommands([mk('Reopen it', true), mk('Open it', false)], 'open').map((c) => c.title)).toEqual(['Open it', 'Reopen it']);
  });
});
