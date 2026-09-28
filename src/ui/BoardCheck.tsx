// The Board step's check: what, as drawn, would spoil this board's holder (a hole off the board or under a part, a
// plug set back from the edge...), each with its fix, and all the safe fixes at once. Clicking one shows it.
import { useMemo, useState } from 'react';
import { activeModule, editMod, select, toast, useApp } from '../state';
import { boardIssues, fixAll } from '../model/boardcheck';

export function BoardCheck() {
  const p = useApp((s) => s.project)!;
  const m = activeModule(p), b = m.board;
  const issues = useMemo(() => boardIssues(b), [b]);
  const [open, setOpen] = useState(false);
  if (b.kind === 'box') return null;
  const real = issues.filter((x) => x.level !== 'info'), notes = issues.filter((x) => x.level === 'info');
  const fixable = real.filter((x) => x.fix);
  const show = open || real.length ? [...real, ...(open ? notes : [])] : [];
  const see = (x: (typeof issues)[number]) => { if (x.at?.hole) select([{ kind: 'hole', id: x.at.hole }]); else if (x.at?.comp) select([{ kind: 'comp', id: x.at.comp }]); };
  return (
    <div className={`bcheck ${real.some((x) => x.level === 'bad') ? 'bad' : real.length ? 'warn' : 'ok'}`}>
      <div className="bcheck-head">
        <span className="dot" />
        <b>{real.length ? `${real.length} thing${real.length > 1 ? 's' : ''} to look at` : 'The board checks out'}</b>
        {!real.length && notes.length > 0 && <button className="linkbtn" onClick={() => setOpen(!open)}>{open ? 'Hide notes' : `${notes.length} note${notes.length > 1 ? 's' : ''}`}</button>}
        {fixable.length > 1 && <button className="btn small" onClick={() => { let n = 0; editMod((q) => { n = fixAll(q.board); }); toast(`Fixed ${n} thing${n === 1 ? '' : 's'} on the ${b.name}. Undo puts them back.`); }}>Fix all</button>}
      </div>
      {show.length > 0 && (
        <ul>
          {show.map((x) => (
            <li key={x.id} className={x.level}>
              <button className="bcheck-text" onClick={() => see(x)} title={x.at ? 'Show it on the board' : undefined}>{x.text}</button>
              {x.fix && <button className="btn small" onClick={() => { editMod((q) => { x.fix!.apply(q.board); }); toast(`${x.fix!.label}: done. Undo puts it back.`); }}>{x.fix.label}</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
