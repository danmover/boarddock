// One import path for the drop zone, the file picker and drag-and-drop anywhere in the window. Several files make
// several boards (a Gerber set or an IDF pair stays one board); they join the project unless "replace" is ticked.
import { importMany } from '../import';
import { loadProject, putBoards, store, toast } from '../state';
import { placementNote } from './panelOps';

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
    ? `Replaced the board with ${names[0]}${names.length > 1 ? ` and added ${names.slice(1).join(', ')}` : ''}`
    : `${had ? 'Added' : 'Imported'} ${boards.length > 1 ? `${boards.length} boards: ${names.join(', ')}` : names[0]}`;
  const added = had && (!replace || boards.length > 1);
  toast(`${what}${n > 1 ? ` (${n} boards in the project)` : ''}.${added ? placementNote(store.get().project!) : ''}${had ? ' ⌘Z undoes it.' : ''}${errors.length ? ` Skipped: ${errors.join('; ')}` : ''}`, opts.stay && !replace ? { label: boards.length > 1 ? 'Check them' : 'Check its board', run: () => store.set({ step: 'board', view: 'assembly' }) } : undefined);
}
