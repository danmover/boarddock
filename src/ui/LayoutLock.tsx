// Rails step: lock the whole layout, a dock or a rail so Auto-arrange and other automatic changes leave it alone, and the
// list of what the automatic changes did (receipts). The receipts are part of the project, so ⌘Z takes back a change and
// its line together.
import { useApp } from '../state';
import { mountLabels } from '../model/built';
import { Check, Chip, Section } from './controls';
import { clearReceipts } from './autoEdit';
import { toggleLock } from './lockOps';

const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };

export function LayoutLock() {
  const p = useApp((s) => s.project);
  const rep = useApp((s) => s.result?.report.panel ?? null);
  const sel = useApp((s) => s.sel);
  if (!p || p.layout !== 'panel') return null;
  const lab = mountLabels(rep), rails = p.panel.rails;
  const railNo = (id: string) => rails.findIndex((r) => r.id === id) + 1;
  const dockName = (id: string) => `dock ${lab.get(id) ?? id.replace(/^d/, '')}`, railName = (id: string) => `rail ${railNo(id) || id.replace(/^r/, '')}`;
  const mount = sel.find((s) => s.kind === 'mount'), rail = sel.find((s) => s.kind === 'rail');
  const own = [...(p.locks?.docks ?? []).map((id) => ({ kind: 'dock' as const, id })), ...(p.locks?.rails ?? []).map((id) => ({ kind: 'rail' as const, id }))];
  const receipts = [...(p.receipts ?? [])].reverse();
  const n = p.locks?.all ? 'all' : own.length;
  return (
    <Section title="Lock and changes" right={n ? <Chip status="info">{n === 'all' ? 'all locked' : `${n} locked`}</Chip> : undefined}>
      <Check label="Lock the whole layout" value={!!p.locks?.all} onChange={(v) => toggleLock('all', null, v)} hint="Every dock and rail stays exactly where it is, whatever changes automatically" />
      <div className="btns" style={{ marginTop: 6 }}>
        {mount && <button className="btn small" disabled={!!p.locks?.all} onClick={() => toggleLock('dock', mount.id, !(p.locks?.docks ?? []).includes(mount.id), dockName(mount.id).replace(/^./, (c) => c.toUpperCase()))}>{(p.locks?.docks ?? []).includes(mount.id) ? 'Unlock' : 'Lock'} {dockName(mount.id)}</button>}
        {rail && <button className="btn small" disabled={!!p.locks?.all} onClick={() => toggleLock('rail', rail.id, !(p.locks?.rails ?? []).includes(rail.id), railName(rail.id).replace(/^./, (c) => c.toUpperCase()))}>{(p.locks?.rails ?? []).includes(rail.id) ? 'Unlock' : 'Lock'} {railName(rail.id)}</button>}
      </div>
      {own.length > 0 && !p.locks?.all && (
        <ul className="fmt" style={{ marginTop: 6 }}>
          {own.map((x) => <li key={`${x.kind}${x.id}`}>{x.kind === 'dock' ? dockName(x.id) : railName(x.id)} <button className="btn small ghost" onClick={() => toggleLock(x.kind, x.id, false, x.kind === 'dock' ? dockName(x.id) : railName(x.id))}>Unlock</button></li>)}
        </ul>
      )}
      <p className="hint">{!mount && !rail && !n ? 'Pick a dock or a rail (here or in the Rails view) to lock just that one. ' : ''}Locked docks and rails stay where they are when Auto-arrange, Tidy up, docks sliding to make room or Auto-connect change the rack: new boards go elsewhere. Moving one by hand still works.</p>
      {receipts.length > 0 && (
        <details className="receipts" open={receipts.length <= 4}>
          <summary>Changes made for you · {receipts.length}</summary>
          <ul className="fmt">{receipts.slice(0, 40).map((r, i) => <li key={`${r.at}${i}`}>{r.text}. <small>{when(r.at)}</small></li>)}</ul>
          <p className="hint" style={{ margin: '4px 0 0' }}>⌘Z takes back the last change and its line. <button className="btn small ghost" onClick={clearReceipts}>Clear the list</button></p>
        </details>
      )}
    </Section>
  );
}
