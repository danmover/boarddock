// One import path for the drop zone, the file picker and drag-and-drop anywhere in the window. Several files make
// several boards (a Gerber set or an IDF pair stays one board); they join the project unless "replace" is ticked.
import { importMany } from '../import';
import { lastReplace, loadProject, putBoards, reviseBoard, store, toast } from '../state';
import { bedNote, placementNote } from './panelOps';

let inFlight = false;

// where each file of a dropped folder sat inside it (an ODB++ job is a folder tree: steps/pcb/profile, ...)
const relPaths = new WeakMap<File, string>();
const readAll = (files: File[]) => Promise.all(files.map(async (f) => ({ name: f.name, path: relPaths.get(f) || f.webkitRelativePath || undefined, bytes: new Uint8Array(await f.arrayBuffer()) })));

/**
 * The files of a drop, with the files inside any dropped folder (and their paths in it). Browsers give a dropped
 * folder as one empty entry otherwise. Falls back to the plain file list where folder entries are not offered.
 */
export async function droppedFiles(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items ?? []).map((it) => (it.kind === 'file' ? it.webkitGetAsEntry?.() : null));
  if (!entries.some((e) => e?.isDirectory)) return Array.from(dt.files);
  const out: File[] = [];
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (e.isFile) {
      const f = await new Promise<File>((ok, no) => (e as FileSystemFileEntry).file(ok, no));
      relPaths.set(f, e.fullPath.replace(/^\//, ''));
      out.push(f);
    } else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      // readEntries hands them over in batches until it returns none
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((ok, no) => reader.readEntries(ok, no));
        if (!batch.length) break;
        for (const k of batch) await walk(k);
      }
    }
  };
  for (const e of entries) if (e) await walk(e);
  return out;
}

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
  const { boards, errors } = await importMany(await readAll(files));
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
  toast(`${what}${n > 1 ? ` (${n} boards in the project)` : ''}.${replace && had ? lastReplace : ''}${added ? placementNote(store.get().project!) : ''}${bedNote(store.get().project!, boards)}${had ? ' ⌘Z undoes it.' : ''}${errors.length ? ` Skipped: ${errors.join('; ')}` : ''}`, opts.stay && !replace ? { label: boards.length > 1 ? 'Check them' : 'Check its board', run: () => store.set({ step: 'board', view: 'assembly' }) } : undefined);
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
    const { boards, errors } = await importMany(await readAll(files));
    if (!boards.length) throw new Error(errors[0] ?? 'No board in those files.');
    const r = reviseBoard(moduleId, boards[0]);
    if (!r) throw new Error('That board is no longer in the project.');
    const what = r.changes.length ? r.changes.join('. ') : 'No mechanical changes: the holder comes out the same';
    const cables = r.kept || r.dropped ? ` Cables kept: ${r.kept}${r.dropped ? `; ${r.dropped} dropped (their plugs are gone)` : ''}.` : '';
    const more = boards.length > 1 ? ` The files held ${boards.length} boards; the first was used.` : '';
    toast(`New version of ${r.name}. ${what}.${cables}${more} ⌘Z undoes it.`, { label: 'Print its holder', run: () => store.set({ step: 'export', view: 'assembly', exportPick: [moduleId] }) });
  } finally {
    inFlight = false;
  }
}
