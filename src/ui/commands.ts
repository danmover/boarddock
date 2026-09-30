// The command palette's list (⌘K): the app's main actions and steps, each running the function the buttons already call.
// What can't be done now stays in the list, greyed, with the reason. `buildCommands` reads the state it is given; the
// few things that live inside App (going to a step, saving, the camera) come in through `CmdCtx`.
import type { Step, State } from '../state';
import { redo, select, store, undo } from '../state';
import { addLinks, rebalancePower, rewire } from './linkOps';
import { addDock, addRail, autoArrange, markBuilt, quickLayout, tidyUp, unmarkBuilt } from './panelOps';
import { describe, removeItems } from './pickOps';
import { leaveFocus, setZones, toggleFocus, view3d } from './view3d';

/** The 3D view's camera presets: which way the camera looks from (the toolbar's buttons and the palette). */
export const VIEW_DIRS = { iso: [0.6, -0.8, 0.62], top: [0, -0.02, 1], front: [0, -1, 0.22], side: [1, 0, 0.22], under: [-0.5, 0.6, -0.65] } as const satisfies Record<string, readonly [number, number, number]>;

export interface Command {
  id: string;
  title: string;
  group: string;
  hint?: string; // a line under the title
  keys?: string; // its keyboard shortcut, as shown
  words?: string; // more words that find it
  enabled: boolean;
  why?: string; // when it isn't: what to do first
  run: () => void;
}

/** What lives inside App. */
export interface CmdCtx {
  steps: { id: Step; label: string; title: string; text: string }[];
  goStep: (id: Step) => void;
  saveProject: () => void;
  newRack: () => void;
  look: (dir: [number, number, number]) => void;
  toggleTheme: () => void;
  showKeys: () => void;
}

export function buildCommands(s: State, c: CmdCtx): Command[] {
  const p = s.project, has = !!p, panel = p?.layout === 'panel';
  const f = view3d.get();
  const out: Command[] = [];
  const add = (group: string, title: string, run: () => void, o: { ok?: boolean; why?: string; hint?: string; keys?: string; words?: string; id?: string } = {}) =>
    out.push({ id: o.id ?? `${group}:${title}`, group, title, hint: o.hint, keys: o.keys, words: o.words, enabled: o.ok ?? true, why: o.ok === false ? o.why : undefined, run });
  const need = 'Add a board first';
  const in3d = () => { if (s.view !== 'assembly' && s.view !== 'print') store.set({ view: 'assembly' }); };
  const sel = s.sel, removable = sel.filter((it) => p && describe(p, it).removable);

  c.steps.forEach((st, i) => add('Steps', `Go to ${st.label}`, () => c.goStep(st.id), { id: `step:${st.id}`, hint: st.title, keys: String(i + 1), words: `step ${i + 1} ${st.text}`, ok: has || st.id === 'import', why: need }));

  const views: [State['view'], string, string, boolean][] = [['assembly', '3D view', 'model rack', true], ['panel', 'Rails view', 'docks layout top', panel], ['wiring', 'Wiring view', 'cables connections graph', true], ['print', 'Plates view', 'print bed plates', true], ['editor', 'Board editor', 'holes parts draw', true]];
  for (const [v, t, w, ok] of views) if (ok) add('Views', `Show the ${t}`, () => store.set({ view: v }), { id: `view:${v}`, words: w, ok: has, why: need });

  add('Rack', 'Add a board', () => store.set({ addSheet: true }), { keys: 'A', ok: has, why: need, words: 'import new hub charger accessory' });
  add('Rack', 'Auto-arrange the boards', autoArrange, { ok: panel, why: 'Needs the DIN-rail layout', hint: 'Lay everything out again on rails and docks', words: 'layout pack' });
  add('Rack', 'Tidy up the docks', tidyUp, { ok: !!panel && !p!.panel.auto, why: 'Only for a rack laid out by hand', hint: 'Take out empty docks, slide overlapping ones apart' });
  add('Rack', 'Lay the boards out in one row', () => quickLayout('row'), { ok: panel, why: 'Needs the DIN-rail layout', id: 'layout:row' });
  add('Rack', 'Lay the boards out in rows', () => quickLayout('rows'), { ok: panel, why: 'Needs the DIN-rail layout', id: 'layout:rows' });
  add('Rack', 'Lay the boards out in columns', () => quickLayout('cols'), { ok: panel, why: 'Needs the DIN-rail layout', id: 'layout:cols' });
  add('Rack', 'Add a horizontal rail', () => addRail('h'), { ok: panel, why: 'Needs the DIN-rail layout', words: 'din' });
  add('Rack', 'Add a vertical rail', () => addRail('v'), { ok: panel, why: 'Needs the DIN-rail layout', words: 'din' });
  add('Rack', 'Add a dock', () => addDock(sel.find((x) => x.kind === 'rail')?.id), { ok: panel, why: 'Needs the DIN-rail layout' });
  add('Rack', 'Mark the rack as built', markBuilt, { ok: has && !!s.result && !p!.built, why: p?.built ? 'It is marked as built already' : 'Wait for the build to finish', hint: 'Export then lists only what is new', words: 'printed done' });
  add('Rack', 'Forget that the rack is built', unmarkBuilt, { ok: !!p?.built, why: 'The rack is not marked as built' });

  add('Cables', 'Auto-connect the cables', () => addLinks(), { ok: has, why: need, hint: 'Connect every plug that has a partner', words: 'wire link usb power' });
  add('Cables', 'Rewire the auto-connected cables', rewire, { ok: has, why: need, hint: 'Choose them again for the rack as it is laid out now' });
  add('Cables', 'Move boards to stronger power ports', rebalancePower, { ok: has, why: need, words: 'charger supply' });

  add('3D view', 'Isolate the selection', () => { in3d(); toggleFocus('isolate'); }, { id: 'focus:isolate', ok: has && (sel.length > 0 || !!f.focus), why: 'Pick something in the 3D view first', hint: 'Show only what is picked (Esc leaves)', words: 'only hide' });
  add('3D view', 'X-ray the selection', () => { in3d(); toggleFocus('xray'); }, { id: 'focus:xray', ok: has && (sel.length > 0 || !!f.focus), why: 'Pick something in the 3D view first', hint: 'Everything else see-through (Esc leaves)', words: 'transparent ghost' });
  if (f.focus) add('3D view', 'Show everything again', leaveFocus, { id: 'focus:leave', keys: 'Esc' });
  add('3D view', f.news ? "Stop highlighting what's new" : "Highlight what's new", () => { in3d(); view3d.set({ news: !f.news }); }, { id: 'news', ok: !!p?.built, why: 'The rack is not marked as built yet', hint: 'Tint the parts, boards and cables added since it was built' });
  add('3D view', f.zones ? 'Hide the mains zones' : 'Show the mains zones', () => setZones(!f.zones), { id: 'zones', ok: !!s.result?.report.zones?.length, why: 'No mains on the rack', hint: 'Shade where outlets, mains leads and plug packs sit', words: 'low voltage safety' });
  for (const [k, t] of [['iso', 'Isometric view'], ['top', 'View from above'], ['front', 'View from the front'], ['side', 'View from the side'], ['under', 'View from below']] as const)
    add('3D view', t, () => { in3d(); c.look([...VIEW_DIRS[k]]); }, { id: `look:${k}`, ok: has, why: need, words: `camera ${k}` });
  add('3D view', 'Clear the selection', () => select([]), { ok: sel.length > 0, why: 'Nothing is picked', keys: 'Esc' });
  add('3D view', removable.length > 1 ? `Remove the ${removable.length} picked things` : 'Remove what is picked', () => removeItems(removable), { id: 'remove', ok: removable.length > 0, why: 'Nothing that can be removed is picked', keys: 'Del' });

  add('File', 'Undo', undo, { ok: s.past.length > 0, why: 'Nothing to undo', keys: '⌘Z' });
  add('File', 'Redo', redo, { ok: s.future.length > 0, why: 'Nothing to redo', keys: '⇧⌘Z' });
  add('File', 'Save the project file', c.saveProject, { ok: has, why: need, keys: '⌘S', words: 'download json' });
  add('File', 'Download the print files (.zip)', () => {
    if (s.step !== 'export') { c.goStep('export'); setTimeout(() => window.dispatchEvent(new Event('boarddock:download')), 150); } else window.dispatchEvent(new Event('boarddock:download'));
  }, { id: 'download', ok: has, why: need, words: 'export stl 3mf plates' });
  add('File', 'Start a new rack', c.newRack, { ok: has, why: need, words: 'close' });

  add('App', s.theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme', c.toggleTheme, { id: 'theme', words: 'dark light mode' });
  add('App', 'Keyboard shortcuts', c.showKeys, { keys: '?', words: 'help keys' });
  return out;
}

/** The letters of `t` in order in `s`, close together (within twice their number, so "wrng" finds "wiring" but "theme" doesn't find "hide the mains zones"). */
function subseq(s: string, t: string): boolean {
  for (let from = s.indexOf(t[0]); from >= 0; from = s.indexOf(t[0], from + 1)) {
    let i = 0, end = from;
    for (let k = from; k < s.length && i < t.length; k++) if (s[k] === t[i]) { i++; end = k; }
    if (i === t.length && end - from < 2 * t.length + 2) return true;
  }
  return false;
}

/** How well a command matches every word typed (0: not at all): titles beat other words, starts beat middles. */
function score(c: Command, words: string[]): number {
  const title = c.title.toLowerCase(), rest = `${c.group} ${c.hint ?? ''} ${c.words ?? ''}`.toLowerCase();
  let sum = 0;
  for (const w of words) {
    if (title.startsWith(w)) sum += 100;
    else if (title.includes(` ${w}`)) sum += 80;
    else if (title.includes(w)) sum += 60;
    else if (rest.includes(w)) sum += 30;
    else if (w.length > 2 && subseq(title, w)) sum += 15;
    else return 0;
  }
  return sum / words.length;
}

/** The commands that match what was typed, best first (what can be done now before what can't); all of them for nothing typed. */
export function searchCommands(list: Command[], query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.map((c, i) => ({ c, i, s: score(c, words) - (c.enabled ? 0 : 0.5) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.c);
}
