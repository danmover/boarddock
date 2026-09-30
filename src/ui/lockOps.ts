// Lock or unlock the whole layout, a dock or a rail. A layout that lays itself out (automatic) is written down as rails
// and docks first, since an automatic layout is worked out afresh after every change and could not leave anything where it is.
import { setLock } from '../model/locks';
import { edit, store, toast } from '../state';
import { materialise } from './panelOps';

export function toggleLock(kind: 'all' | 'dock' | 'rail', id: string | null, on: boolean, label = '') {
  const p = store.get().project;
  if (!p) return;
  if (on && p.panel.auto && !store.get().result?.report.panel) { toast('The rack is still building: lock it in a moment.'); return; }
  const wasAuto = p.panel.auto;
  edit((q) => { if (on) materialise(q); setLock(q, kind, id, on); });
  const what = kind === 'all' ? 'The whole layout' : label || (kind === 'dock' ? 'The dock' : 'The rail');
  toast(on
    ? `${what} is locked: Auto-arrange, Tidy up, docks sliding to make room and Auto-connect leave it where it is.${wasAuto ? ' The layout stopped laying itself out, so it stays as it is now.' : ''} You can still move it by hand. ⌘Z undoes it.`
    : `${what} is unlocked. ⌘Z undoes it.`);
}
