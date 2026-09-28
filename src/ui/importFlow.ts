// One import path for the drop zone, the file picker and drag-and-drop anywhere in the window. Several files make
// several boards (a Gerber set or an IDF pair stays one board); they join the project unless "replace" is ticked.
import { importMany } from '../import';
import { amend, lastReplace, loadProject, putBoards, reviseBoard, store, toast } from '../state';
import { afterBuild, bedNote, placementNote, settleOverlaps } from './panelOps';

/** A warning that two things on the rack overlap or a cable runs into something. */
const isClash = (w: string) => / overlap on the panel\.| runs into /.test(w);

let inFlight = false;

/** A BoardDock project file: *.boarddock.json, or any JSON with boards in it. */
async function asProject(f: File): Promise<unknown | null> {
  if (!/\.json$/i.test(f.name)) return null;
  let raw: any;
  try {
    raw = JSON.parse(await f.text());
  } catch {
    if (/\.boarddock\.json$/i.test(f.name)) throw new Error(`${f.name}: this project file is damaged (it is not valid JSON).`);
    return null;
  }
  return Array.isArray(raw?.modules) || raw?.board ? raw : /\.boarddock\.json$/i.test(f.name) ? raw : null;
}

export async function openFiles(fl: FileList | File[], opts: { stay?: boolean } = {}): Promise<void> {
  const files = Array.from(fl);
  if (!files.length || inFlight) return;
  inFlight = true;
  try {
    await openNow(files, opts);
  } finally {
    inFlight = false;
  }
}

async function openNow(files: File[], opts: { stay?: boolean }): Promise<void> {
  for (const f of files) {
    const raw = await asProject(f);
    if (raw == null) continue;
    const had = store.get().project;
    try {
      loadProject(raw);
    } catch (e: any) {
      throw new Error(`${f.name}: ${e?.message ?? e}`);
    }
    const rest = files.length - 1;
    toast(`Opened ${f.name.replace(/\.boarddock\.json$|\.json$/i, '')}.${rest ? ` The other ${rest} file${rest > 1 ? 's were' : ' was'} not imported: drop ${rest > 1 ? 'them' : 'it'} again to add ${rest > 1 ? 'them' : 'it'} to this rack.` : ''}${had ? ' ⌘Z goes back to the rack you had open.' : ''}`);
    return;
  }
  const { boards, errors } = await importMany(await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
  if (!boards.length) throw new Error(errors[0] ?? 'Nothing to import.');
  const s = store.get();
  const had = s.project?.modules.length ?? 0;
  const replace = s.replaceMode || !s.project;
  putBoards(boards, replace, { stay: opts.stay && !replace });
  const n = store.get().project?.modules.length ?? 0;
  const names = boards.map((b) => b.name);
  const what = replace && had
    ? `Replaced ${s.project ? s.project.modules[s.project.active].board.name : 'the board'} with ${names[0]}${names.length > 1 ? ` and added ${names.slice(1).join(', ')}` : ''}`
    : `${had ? 'Added' : 'Imported'} ${boards.length > 1 ? `${boards.length} boards: ${names.join(', ')}` : names[0]}`;
  const added = had && (!replace || boards.length > 1);
  const p1 = store.get().project!;
  toast(`${what}${n > 1 ? ` (${n} boards in the project)` : ''}.${replace && had ? lastReplace : ''}${added ? placementNote(p1, p1.modules.slice(had).map((m) => m.id)) : ''}${bedNote(store.get().project!, boards)}${had ? ' ⌘Z undoes it.' : ''}${errors.length ? ` Skipped: ${errors.join('; ')}` : ''}`, opts.stay && !replace ? { label: boards.length > 1 ? 'Check them' : 'Check its board', run: () => store.set({ step: 'board', view: 'assembly' }) } : undefined);
  if (added && p1.layout === 'panel' && !p1.panel.auto) settleOverlaps();
}

/**
 * A new version of one board on the rack: its files replace the board, which keeps its place, cables and holder
 * settings. The toast says what changed and offers to go straight to printing its new holder.
 */
export async function openRevision(fl: FileList | File[], moduleId: string): Promise<void> {
  const files = Array.from(fl);
  if (!files.length || inFlight) return;
  inFlight = true;
  try {
    const { boards, errors } = await importMany(await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
    if (!boards.length) throw new Error(errors[0] ?? 'No board in those files.');
    // what Check says now, to tell afterwards what the new version broke
    const res0 = store.get().result;
    const bad0 = new Set([...(res0?.report.checks ?? []).filter((c) => c.status === 'bad').map((c) => `${c.group}|${c.name}`), ...(res0?.report.warnings ?? []).filter(isClash)]);
    const r = reviseBoard(moduleId, boards[0]);
    if (!r) throw new Error('That board is no longer in the project.');
    const what = r.changes.length ? r.changes.join('. ') : 'No mechanical changes: the holder comes out the same';
    const cables = r.kept || r.dropped ? ` Cables kept: ${r.kept}${r.dropped ? `; ${r.dropped} dropped (their plugs are gone)` : ''}.` : '';
    const more = boards.length > 1 ? ` The files held ${boards.length} boards; the first was used.` : '';
    const act = { label: 'Print its holder', run: () => store.set({ step: 'export', view: 'assembly', exportPick: [moduleId] }) };
    toast(`New version of ${r.name}. ${what}.${cables}${more} ⌘Z undoes it.`, act);
    // once it is built: anything Check now fails (an overlap from a bigger holder, say) that it did not before
    afterBuild((res) => {
      const now = [...res.report.checks.filter((c) => c.status === 'bad' && !bad0.has(`${c.group}|${c.name}`)).map((c) => `${c.group.replace(/ · .*$/, '')}: ${c.name}${c.value ? ` (${c.value})` : ''}`), ...res.report.warnings.filter((w) => isClash(w) && !bad0.has(w)).map((w) => w.replace(/ Move one along.*$/, ''))];
      if (!now.length) return;
      amend((q) => { const m = q.modules.find((x) => x.id === moduleId); if (m?.revision) m.revision.changes = [...m.revision.changes, ...now.map((x) => `Now in Check: ${x}`)]; });
      toast(`New version of ${r.name}. ${what}.${cables} It also brings ${now.length > 1 ? `${now.length} new problems` : 'a new problem'} in Check: ${now.join('; ')}. Move or turn its dock in the Rails step, or ⌘Z to go back to the old version.`, act);
    });
  } finally {
    inFlight = false;
  }
}
