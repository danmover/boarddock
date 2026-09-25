// One import path for the drop zone, the file picker and drag-and-drop anywhere in the window.
import { importFiles } from '../import';
import { addBoard, loadProject, setBoard, store } from '../state';

export async function openFiles(fl: FileList | File[]): Promise<void> {
  const files = Array.from(fl);
  if (!files.length) return;
  const json = files.find((f) => /\.json$/i.test(f.name));
  if (json) return loadProject(JSON.parse(await json.text()));
  const board = await importFiles(await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
  const s = store.get();
  if (s.addMode && s.project) addBoard(board);
  else setBoard(board);
}
