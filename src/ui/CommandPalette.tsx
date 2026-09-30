// The command palette: ⌘K / Ctrl+K (or the search button in the top bar, for touch) opens a box to type in; arrows pick,
// Enter runs, Esc closes. The list is commands.ts's.
import './extras.css';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { store } from '../state';
import { buildCommands, searchCommands, type CmdCtx, type Command } from './commands';
import { Icon, I } from './icons';

const OPEN = 'boarddock:palette';
/** The top bar's button (a phone has no ⌘K). */
export function PaletteButton() {
  return <button className="iconbtn" onClick={() => window.dispatchEvent(new Event(OPEN))} title="Commands (⌘K)" aria-label="Commands"><Icon d={I.search} /></button>;
}

export function CommandPalette({ ctx }: { ctx: CmdCtx }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const opener = useRef<HTMLElement | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const openRef = useRef(false);
  openRef.current = open;
  const show = () => { opener.current = document.activeElement as HTMLElement | null; setQ(''); setAt(0); setOpen(true); };
  const close = () => { setOpen(false); const o = opener.current; opener.current = null; if (o?.isConnected) o.focus?.(); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); if (openRef.current) close(); else show(); }
    };
    const ev = () => show();
    window.addEventListener('keydown', k);
    window.addEventListener(OPEN, ev);
    return () => { window.removeEventListener('keydown', k); window.removeEventListener(OPEN, ev); };
  }, []);

  // the list is made when the box opens (the state at that moment), and searched as you type
  const list = useMemo(() => (open ? buildCommands(store.get(), ctxRef.current) : []), [open]);
  const shown = useMemo(() => searchCommands(list, q), [list, q]);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => { setAt(0); }, [q]);
  useEffect(() => { if (open) document.getElementById(`cmd-${at}`)?.scrollIntoView({ block: 'nearest' }); }, [at, open, shown]);
  if (!open) return null;

  const run = (c: Command | undefined) => {
    if (!c || !c.enabled) return;
    close();
    setTimeout(() => c.run(), 0); // (after the box has gone and focus is back where it was)
  };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setAt((a) => (shown.length ? (a + 1) % shown.length : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((a) => (shown.length ? (a - 1 + shown.length) % shown.length : 0)); }
    else if (e.key === 'Home' && !q) { e.preventDefault(); setAt(0); }
    else if (e.key === 'End' && !q) { e.preventDefault(); setAt(Math.max(0, shown.length - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(shown[at]); }
  };
  return (
    <div className="cmdveil" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="cmd floating" role="dialog" aria-modal="true" aria-label="Commands" onKeyDown={key}>
        <div className="cmd-in">
          <Icon d={I.search} />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type what to do: undo, rails view, add a board…" role="combobox" aria-expanded="true" aria-controls="cmd-list" aria-activedescendant={shown.length ? `cmd-${at}` : undefined} aria-autocomplete="list" autoComplete="off" spellCheck={false} />
          <button className="btn small ghost icon" onClick={close} aria-label="Close" title="Close (Esc)"><Icon d={I.x} /></button>
        </div>
        <div className="cmd-list" id="cmd-list" role="listbox">
          {shown.length === 0 && <div className="cmd-empty">Nothing matches “{q}”.</div>}
          {shown.map((c, i) => (
            <Fragment key={c.id}>
              {!q && (i === 0 || shown[i - 1].group !== c.group) && <div className="cmd-group">{c.group}</div>}
              <button id={`cmd-${i}`} role="option" aria-selected={i === at} aria-disabled={!c.enabled} tabIndex={-1} className={`cmd-item${i === at ? ' on' : ''}`} disabled={!c.enabled} title={c.enabled ? c.hint : c.why}
                onMouseMove={() => at !== i && setAt(i)} onClick={() => run(c)}>
                <span className="grow">{c.title}<small>{c.enabled ? c.hint ?? (q ? c.group : '') : c.why}</small></span>
                {c.keys && <kbd>{c.keys}</kbd>}
              </button>
            </Fragment>
          ))}
        </div>
        <div className="cmd-foot"><span>↑ ↓ pick</span><span>Enter runs</span><span>Esc closes</span></div>
      </div>
    </div>
  );
}
