// Panel step sidebar: automatic arrangement, the board list (drag onto the panel), and inspectors for the
// selected docks and rails. Works on several docks at once.
import type { Access, EdgeName, Project, Turn } from '../model/types';
import { edit, isSel, select, useApp } from '../state';
import { Check, Chip, Num, Pick, Section, Seg } from './controls';
import { accessCounts, MODULE_DRAG, PALETTE } from './PanelEditor';
import { addDock, autoArrange, duplicateModule, placeMount, removeMounts, removeRails, seat, setKind, setLever, setRail, setSlot, swapSlots, turnMounts, unseat } from './panelOps';
import { turnLabel } from '../cad/dockplan';

const DIR_TEXT: Record<string, string> = { front: 'faces you', up: 'points up', down: 'points down', left: 'points left', right: 'points right', wall: 'into the wall' };
const EDGE_OPTS: ['auto' | EdgeName, string][] = [['auto', 'Auto (best plug access)'], ['bottom', 'Bottom edge'], ['top', 'Top edge'], ['left', 'Left edge'], ['right', 'Right edge']];

function AccessList({ list }: { list: Access[] }) {
  if (!list.length) return <p className="hint">No plugs defined on this board.</p>;
  return (
    <div className="access">
      {list.map((a, i) => (
        <div key={i} className={`acc ${a.ok}`}>
          <b className="mono">{a.ref}</b>
          <span>{a.type.replace(/_/g, ' ')}</span>
          <span className="grow">{DIR_TEXT[a.dir]}{a.ok === 'side' ? ', towards the next dock' : ''}</span>
          <i>{a.ok === 'good' ? '✓' : a.ok === 'side' ? '⚠' : '✕'}</i>
        </div>
      ))}
    </div>
  );
}

export function AccessChips({ list }: { list: Access[] }) {
  const c = accessCounts(list);
  if (!list.length) return null;
  return (
    <span className="accchips">
      {c.front > 0 && <Chip status="ok">◉ {c.front}</Chip>}
      {c.good - c.front > 0 && <Chip status="ok">✓ {c.good - c.front}</Chip>}
      {c.side > 0 && <Chip status="warn">⚠ {c.side}</Chip>}
      {c.blocked > 0 && <Chip status="bad">✕ {c.blocked}</Chip>}
    </span>
  );
}

export function PanelSide() {
  const p = useApp((s) => s.project)!;
  const rep = useApp((s) => s.result?.report.panel ?? null);
  const sel = useApp((s) => s.sel);
  const P = p.panel;
  const setAuto = (fn: (q: Project['panel']) => void) => edit((q) => { fn(q.panel); q.panel.auto = true; });
  const mountsSel = sel.filter((s) => s.kind === 'mount').map((s) => s.id);
  const railsSel = sel.filter((s) => s.kind === 'rail').map((s) => s.id);
  const railOf = (id: string) => rep?.rails.find((r) => r.id === id);
  const one = mountsSel.length === 1 ? rep?.mounts.find((m) => m.id === mountsSel[0]) : null;
  const railOne = railsSel.length === 1 ? rep?.rails.find((r) => r.id === railsSel[0]) : null;
  const docks = rep?.mounts.filter((m) => m.kind === 'dock').length ?? 0;
  const flats = (rep?.mounts.length ?? 0) - docks;

  return (
    <>
      <Section title="Arrangement" right={<Chip status={P.auto ? 'ok' : 'info'}>{P.auto ? 'auto' : 'manual'}</Chip>}>
        <div className="btns">
          <button className={`btn ${P.auto ? '' : 'primary'}`} onClick={autoArrange}>⚡ Auto-arrange</button>
          <span className="hint" style={{ margin: 0 }}>{P.auto ? 'Every board is placed and turned for plug access. Drag anything on the panel to take over.' : 'Your layout. Auto-arrange starts over (⌘Z undoes).'}</span>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <Pick label="Rails run" value={P.rowDir} options={[['h', 'Horizontally ⟷'], ['v', 'Vertically ↕']]} onChange={(v) => setAuto((q) => { q.rowDir = v; })} />
          <Num label="Longest rail" value={P.maxRail} min={60} max={2000} step={5} onChange={(v) => setAuto((q) => { q.maxRail = v; })} />
          <Num label="Gap between docks" value={P.gap} min={0} max={40} step={0.5} onChange={(v) => setAuto((q) => { q.gap = v; })} />
          <Num label="Space between rails" value={P.rowGap} min={0} max={200} step={1} onChange={(v) => setAuto((q) => { q.rowGap = v; })} />
        </div>
        <div style={{ marginTop: 8 }}><Check label="Two boards back to back per dock when their plugs allow it" value={P.pairs} onChange={(v) => setAuto((q) => { q.pairs = v; })} /></div>
        <div className="row" style={{ marginTop: 8 }}>
          <Num label="Tongue fit (looser +)" value={P.fit ?? 0} min={0} max={0.4} step={0.05} hint="print the test-fit kit first" onChange={(v) => edit((q) => { q.panel.fit = v; })} />
        </div>
      </Section>

      <Section title={`Boards · ${p.modules.length}`}>
        <div className="list">
          {p.modules.map((m, i) => {
            const at = rep?.modules.find((q) => q.id === m.id);
            const mt = at ? rep!.mounts.find((x) => x.id === at.mount) : null;
            const where = !at || !mt ? 'not on the panel' : `rail ${mt.rail.replace(/^r/, '')} · ${mt.kind === 'flat' ? 'flat clip' : at.slot ? 'dock, back' : 'dock, front'} · ${at.edge} edge in`;
            const on = mt ? isSel(sel, mt.id) : false;
            return (
              <div key={m.id} className={`item brow ${on ? 'sel' : ''}`} draggable onDragStart={(e) => { e.dataTransfer.setData(MODULE_DRAG, m.id); e.dataTransfer.effectAllowed = 'move'; }}
                onClick={(e) => { if (mt) select([{ kind: 'mount', id: mt.id }], e.shiftKey || e.metaKey ? 'toggle' : 'set'); if (p.active !== i) edit((q) => { q.active = i; }); }}
                title="Drag onto a rail or a dock in the panel view">
                <span className="dot" style={{ background: PALETTE[i % PALETTE.length] }} />
                <span className="grow"><b>{m.board.name}</b><small>{where}</small></span>
                {at ? <AccessChips list={at.access} /> : <button className="btn small" onClick={(e) => { e.stopPropagation(); seat(m.id); }}>Place</button>}
                <button className="btn small ghost icon" title="Duplicate board (another holder like this one)" onClick={(e) => { e.stopPropagation(); duplicateModule(i); }}>⧉</button>
              </div>
            );
          })}
        </div>
        <p className="hint">◉ faces you · ✓ points along the panel · ⚠ points at the next dock on the rail · ✕ into the wall. Drag a board onto a rail for a new dock, or onto a dock to share it back to back.</p>
      </Section>

      {mountsSel.length > 0 && (
        <Section title={one ? `${one.kind === 'dock' ? 'Dock' : 'Flat clip'} · rail ${one.rail.replace(/^r/, '')}` : `${mountsSel.length} docks`} right={<button className="btn small danger" onClick={() => removeMounts(mountsSel)}>Remove</button>}>
          <Seg value={one?.kind ?? (rep?.mounts.filter((m) => mountsSel.includes(m.id)).every((m) => m.kind === 'flat') ? 'flat' : 'dock')} options={[['dock', 'Dock: stands out, top release'], ['flat', 'Flat on the panel']]} onChange={(v) => setKind(mountsSel, v)} />
          <div className="turns">
            {([0, 90, 180, 270] as Turn[]).map((t) => {
              const railDir = one ? railOf(one.rail)?.dir ?? 'h' : 'h';
              const cur = one ? one.turn === t : false;
              return (
                <button key={t} className={`turn ${cur ? 'on' : ''}`} onClick={() => turnMounts(mountsSel, one ? t - one.turn : 0)} disabled={!one} title={one ? '' : 'use Turn ⟳ for several docks'}>
                  <svg viewBox="-12 -12 24 24"><rect x="-6" y="-7" width="12" height="14" rx="2" transform={`rotate(${-t - (railDir === 'v' ? 90 : 0)})`} /><line x1="0" y1="0" x2="0" y2="-7" transform={`rotate(${-t - (railDir === 'v' ? 90 : 0)})`} /></svg>
                  <span>{t}°</span>
                  <small>{turnLabel(t, railDir, one?.kind ?? 'dock')}</small>
                </button>
              );
            })}
          </div>
          {!one && <div className="btns" style={{ marginTop: 8 }}><button className="btn small" onClick={() => turnMounts(mountsSel, -90)}>⟲ Turn all</button><button className="btn small" onClick={() => turnMounts(mountsSel, 90)}>Turn all ⟳</button><button className="btn small" onClick={() => swapSlots(mountsSel)}>Swap front / back</button></div>}
          {one && (
            <>
              {one.kind === 'dock' && (() => {
                const v = railOf(one.rail)?.dir === 'v';
                const side = (sgn: number) => (v ? (sgn > 0 ? 'left' : 'right') : sgn > 0 ? 'upper' : 'lower');
                return (
                  <div className="row" style={{ marginTop: 10, gridTemplateColumns: '1fr' }}>
                    <Pick label="Rail release lever" value={one.lever ?? 'auto'} options={[['auto', `Auto: ${side(one.leverSide)} side (more room)`], ['pos', `${side(1)} side`], ['neg', `${side(-1)} side`]]} onChange={(val) => setLever([one.id], val)} />
                  </div>
                );
              })()}
              <div className="row" style={{ marginTop: 10 }}>
                <Pick label="Rail" value={one.rail} options={(rep?.rails ?? []).map((r) => [r.id, `Rail ${r.id.replace(/^r/, '')} (${r.dir === 'h' ? '⟷' : '↕'})`] as [string, string])} onChange={(v) => placeMount(one.id, v, one.at)} />
                <Num label="Position on the rail" value={Math.round(one.at * 10) / 10} min={0} step={1} onChange={(v) => placeMount(one.id, one.rail, v)} />
              </div>
              {(one.kind === 'dock' ? [0, 1] : [0]).map((slot) => {
                const s = one.slots[slot] ?? { module: null, edge: 'auto' };
                const acc = rep?.modules.find((q) => q.mount === one.id && q.slot === slot);
                return (
                  <div key={slot} className="slot">
                    <div className="slothead">{one.kind === 'flat' ? 'Board' : slot === 0 ? 'Front slot' : 'Back slot (turned 180°)'}</div>
                    <div className="row">
                      <Pick label="Board" value={s.module ?? ''} options={[['', '— empty —'], ...p.modules.map((m) => [m.id, m.board.name] as [string, string])]} onChange={(v) => setSlot(one.id, slot, (x) => { x.module = v || null; x.edge = 'auto'; })} />
                      {one.kind === 'dock' && <Pick label="Edge in the dock" value={s.edge} options={EDGE_OPTS} onChange={(v) => setSlot(one.id, slot, (x) => { x.edge = v; })} />}
                    </div>
                    {acc && <p className="hint" style={{ marginTop: 6 }}>{s.edge === 'auto' ? `auto: ${acc.edge} edge in the dock` : ''}</p>}
                    {acc && <AccessList list={acc.access} />}
                    {s.module && <div className="btns" style={{ marginTop: 6 }}><button className="btn small ghost" onClick={() => unseat(s.module!)}>Take off the panel</button></div>}
                  </div>
                );
              })}
              {one.kind === 'dock' && <div className="btns" style={{ marginTop: 10 }}><button className="btn small" onClick={() => swapSlots([one.id])}>Swap front / back (F)</button><button className="btn small ghost" onClick={() => turnMounts([one.id], 90)}>Turn 90° (R)</button></div>}
            </>
          )}
        </Section>
      )}

      {railOne && (
        <Section title={`Rail ${railOne.id.replace(/^r/, '')}`} right={<button className="btn small danger" onClick={() => removeRails([railOne.id])}>Remove</button>}>
          <Seg value={railOne.dir} options={[['h', 'Horizontal ⟷'], ['v', 'Vertical ↕']]} onChange={(v) => setRail(railOne.id, (r) => { r.dir = v; })} />
          <div className="row" style={{ marginTop: 8 }}>
            <Num label="Start X" value={Math.round(railOne.x)} step={1} onChange={(v) => setRail(railOne.id, (r) => { r.x = v; })} />
            <Num label="Start Y" value={Math.round(railOne.y)} step={1} onChange={(v) => setRail(railOne.id, (r) => { r.y = v; })} />
            <Num label="Length" value={Math.round(railOne.length)} min={30} step={5} hint={P.rails.find((r) => r.id === railOne.id)?.length == null ? 'cut to fit' : ''} onChange={(v) => setRail(railOne.id, (r) => { r.length = v; })} />
          </div>
          <div className="btns" style={{ marginTop: 8 }}>
            <button className="btn small" onClick={() => setRail(railOne.id, (r) => { r.length = null; })}>Cut to fit</button>
            <button className="btn small" onClick={() => addDock(railOne.id)}>+ Dock on this rail</button>
          </div>
        </Section>
      )}

      {flats > 0 && (
        <Section title="Flat clips">
          <div className="row">
            <Num label="Clip width" value={p.mount.clipWidth} min={10} max={30} step={1} onChange={(v) => edit((q) => { q.mount.clipWidth = v; })} />
            <Pick label="Pull tab points" value={p.mount.tabSide} options={[['down', 'Down'], ['up', 'Up']]} onChange={(v) => edit((q) => { q.mount.tabSide = v; })} />
          </div>
          <p className="hint">A flat board lies against the panel on a pull-tab clip: pull the tab towards you to release it.</p>
        </Section>
      )}

      <Section title="Rails & parts">
        {rep?.rails.length ? rep.rails.map((r) => (
          <div key={r.id} className={`item ${isSel(sel, r.id) ? 'sel' : ''}`} onClick={() => select([{ kind: 'rail', id: r.id }])}>
            <span className="mono">{r.dir === 'h' ? '⟷' : '↕'}</span>
            <span className="grow">Rail {r.id.replace(/^r/, '')}</span>
            <small className="mono">{Math.round(r.length)} mm</small>
          </div>
        )) : <p className="hint" style={{ marginTop: 0 }}>No rails yet.</p>}
        <p className="hint">{docks} dock{docks === 1 ? '' : 's'} (rail shoe + socket each){flats ? `, ${flats} flat clip${flats === 1 ? '' : 's'}` : ''}; every board also gets a release rod. TS35 × 7.5 top-hat rail, cut with a hacksaw. {rep ? `Deepest point ${Math.round(rep.depth)} mm from the wall.` : ''}</p>
      </Section>
    </>
  );
}
