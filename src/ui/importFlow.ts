// One import path for the drop zone, the file picker and drag-and-drop anywhere in the window. Several files make
// several boards (a Gerber set or an IDF pair stays one board); they join the project unless "replace" is ticked.
import { importMany } from '../import';
import { loadProject, putBoards, store, toast } from '../state';

export async function openFiles(fl: FileList | File[]): Promise<void> {
  const files = Array.from(fl);
  if (!files.length) return;
  const json = files.find((f) => /\.json$/i.test(f.name));
  if (json) return loadProject(JSON.parse(await json.text()));
  const { boards, errors } = await importMany(await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
  if (!boards.length) throw new Error(errors[0] ?? 'Nothing to import.');
  const s = store.get();
  const had = s.project?.modules.length ?? 0;
  const replace = s.replaceMode || !s.project;
  putBoards(boards, replace);
  const n = store.get().project?.modules.length ?? 0;
  const names = boards.map((b) => b.name).join(', ');
  const what = replace && had ? `Replaced the board with ${names}` : `${had ? 'Added' : 'Imported'} ${boards.length > 1 ? `${boards.length} boards: ${names}` : names}`;
  toast(`${what}${n > 1 ? ` (${n} boards in the project)` : ''}.${had ? ' ⌘Z undoes it.' : ''}${errors.length ? ` Skipped: ${errors.join('; ')}` : ''}`);
}
