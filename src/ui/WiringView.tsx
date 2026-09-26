// Wiring view: every board as a card with its plugs, cables drawn between them. Click a plug, then another, to
// connect them; click a cable to select it (Del removes). Cards are laid out by rail, boxes (hubs, chargers) last.
import { useEffect, useMemo, useState } from 'react';
import type { Link, Module, PlugRef } from '../model/types';
import { compatible, KIND_COLOR, KIND_NAME, linkKind, numberLinks, plugsOf, sameRef, type PlugInfo } from '../model/links';
import { edit, isSel, select, store, toast, useApp } from '../state';
import { Icon, I } from './icons';
import { addLinks, removeLinks } from './linkOps';

const W = 220, HEAD = 34, ROW = 24, GAPX = 70, GAPY = 46;
// USB cables are drawn near-black in 3D; on this graph they take the text colour so they show in both themes
const wire = (k: keyof typeof KIND_COLOR) => (k === 'usb' ? 'var(--muted)' : KIND_COLOR[k]);

const ROLE_TEXT: Record<string, string> = { host: 'USB host', device: 'USB device', 'power-in': 'power in', 'power-in-dc': 'DC in', 'power-out': 'power out', 'hub-up': 'to host', 'hub-down': 'hub port', net: 'Ethernet', video: 'video', audio: 'audio', wire: 'wires', other: '' };

export function WiringView() {
  const p = useApp((s) => s.project)!;
  const rep = useApp((s) => s.result?.report ?? null);
  const sel = useApp((s) => s.sel);
  const [pending, setPending] = useState<PlugInfo | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const plugs = useMemo(() => plugsOf(p), [p]);
  const links = p.links ?? [];

  // rows: one per rail (panel order), then boxes, then boards not on the panel
  const layout = useMemo(() => {
    const rows: Module[][] = [];
    const placed = new Set<string>();
    const panel = rep?.panel;
    if (panel) for (const r of panel.rails) {
      const ids = panel.mounts.filter((m) => m.rail === r.id).sort((a, b) => a.at - b.at).flatMap((m) => m.slots.map((s) => s.module)).filter(Boolean) as string[];
      const row: Module[] = [];
      for (const id of ids) {
        const m = p.modules.find((x) => x.id === id);
        if (!m || placed.has(id)) continue;
        row.push(m); placed.add(id);
        for (const r2 of p.modules.filter((x) => x.on === id)) { row.push(r2); placed.add(r2.id); }
      }
      if (row.length) rows.push(row);
    }
    const rest = p.modules.filter((m) => !placed.has(m.id));
    const boards = rest.filter((m) => m.board.kind !== 'box'), boxes = rest.filter((m) => m.board.kind === 'box');
    for (let i = 0; i < boards.length; i += 4) rows.push(boards.slice(i, i + 4));
    if (boxes.length) rows.push(boxes);
    const pos = new Map<string, { x: number; y: number; h: number }>();
    let y = 20;
    for (const row of rows) {
      let hmax = 0;
      row.forEach((m, i) => {
        const n = plugs.filter((q) => q.module === m).length;
        const h = HEAD + Math.max(1, n) * ROW + 10;
        pos.set(m.id, { x: 20 + i * (W + GAPX), y, h });
        hmax = Math.max(hmax, h);
      });
      y += hmax + GAPY;
    }
    const width = Math.max(...rows.map((r) => r.length), 1) * (W + GAPX) + 20;
    return { pos, width, height: y };
  }, [p.modules, rep, plugs]);

  const portAt = (q: PlugInfo, side: 1 | -1) => {
    const c = layout.pos.get(q.module.id)!;
    const i = plugs.filter((x) => x.module === q.module).indexOf(q);
    return { x: c.x + (side > 0 ? W : 0), y: c.y + HEAD + i * ROW + ROW / 2 };
  };
  const info = (r: PlugRef) => plugs.find((q) => sameRef(q.ref, r));
  const linkPath = (l: Link) => {
    const A = info(l.a), B = info(l.b);
    if (!A || !B) return null;
    const ca = layout.pos.get(A.module.id)!, cb = layout.pos.get(B.module.id)!;
    const sa: 1 | -1 = cb.x > ca.x + 1 ? 1 : cb.x < ca.x - 1 ? -1 : 1;
    const sb: 1 | -1 = ca.x > cb.x + 1 ? 1 : ca.x < cb.x - 1 ? -1 : 1;
    const a = portAt(A, sa), b = portAt(B, sb);
    const k = Math.max(40, Math.abs(b.x - a.x) * 0.4);
    return { d: `M${a.x},${a.y} C${a.x + sa * k},${a.y} ${b.x + sb * k},${b.y} ${b.x},${b.y}`, mid: { x: (a.x + b.x) / 2 + (sa === sb ? sa * k * 0.75 : 0), y: (a.y + b.y) / 2 } };
  };

  const clickPlug = (q: PlugInfo) => {
    const existing = links.find((l) => sameRef(l.a, q.ref) || sameRef(l.b, q.ref));
    if (!pending) { if (existing) select([{ kind: 'link', id: existing.id }]); setPending(q); return; }
    if (pending === q) { setPending(null); return; }
    if (pending.module === q.module) { toast('Pick a plug on another board.'); return; }
    if (!compatible(pending.role, q.role)) { toast(`${pending.label} (${ROLE_TEXT[pending.role] || pending.role}) does not plug into ${q.label} (${ROLE_TEXT[q.role] || q.role}).`); setPending(null); return; }
    edit((pp) => {
      pp.links = (pp.links ?? []).filter((l) => !sameRef(l.a, pending.ref) && !sameRef(l.b, pending.ref) && !sameRef(l.a, q.ref) && !sameRef(l.b, q.ref));
      pp.links = numberLinks([...pp.links, { id: `l${Math.random().toString(36).slice(2, 8)}`, a: pending.ref, b: q.ref, kind: linkKind(pending.role, q.role) }]);
    });
    setPending(null);
  };
  const cableOf = (id: string) => rep?.cables?.find((c) => c.id === id);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'Escape') { setPending(null); select([]); }
      const ids = store.get().sel.filter((x) => x.kind === 'link').map((x) => x.id);
      if ((e.key === 'Delete' || e.key === 'Backspace') && ids.length) { e.preventDefault(); removeLinks(ids); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  return (
    <div className="editor wiring" style={{ position: 'absolute', inset: 0, overflow: 'auto' }} onClick={(e) => { if (e.target === e.currentTarget) { setPending(null); select([]); } }}>
      <svg width={Math.max(layout.width, 600)} height={Math.max(layout.height, 400)} style={{ display: 'block', margin: '60px 0 0 10px' }} onClick={(e) => { if ((e.target as Element).tagName === 'svg') { setPending(null); select([]); } }}>
        {links.map((l) => {
          const lp = linkPath(l);
          if (!lp) return null;
          const on = isSel(sel, l.id) || hover === l.id;
          const c = cableOf(l.id);
          return (
            <g key={l.id} style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); select([{ kind: 'link', id: l.id }], e.shiftKey ? 'toggle' : 'set'); }} onMouseEnter={() => setHover(l.id)} onMouseLeave={() => setHover(null)}>
              <path d={lp.d} fill="none" stroke="transparent" strokeWidth={12} />
              <path d={lp.d} fill="none" stroke={wire(l.kind ?? 'usb')} strokeWidth={on ? 4 : 2.6} strokeLinecap="round" opacity={on ? 1 : 0.85} />
              {c && <g transform={`translate(${lp.mid.x},${lp.mid.y})`}><title>{`Cable ${c.no}: ${c.label ?? ''}`}</title><rect x={-38} y={-11} width={76} height={22} rx={11} fill="var(--surface)" stroke={wire(l.kind ?? 'usb')} /><circle cx={-26} cy={0} r={8.5} fill={wire(l.kind ?? 'usb')} /><text x={-26} y={3.8} textAnchor="middle" fontSize={10.5} fontWeight={700} className="mono" fill="#fff">{c.no}</text><text x={8} textAnchor="middle" y={4} fontSize={11} className="mono" fill="var(--fg)">{c.buy} m</text></g>}
            </g>
          );
        })}
        {p.modules.map((m) => {
          const c = layout.pos.get(m.id);
          if (!c) return null;
          const qs = plugs.filter((q) => q.module === m);
          const box = m.board.kind === 'box';
          return (
            <g key={m.id} transform={`translate(${c.x},${c.y})`}>
              <rect width={W} height={c.h} rx={12} fill="var(--surface-2)" stroke={box ? 'var(--line-2)' : 'var(--accent-line)'} />
              <rect width={W} height={HEAD - 4} rx={12} fill={box ? 'var(--surface-3)' : 'var(--accent-soft)'} />
              <text x={14} y={20} fontSize={13} fontWeight={650} fill="var(--fg)">{m.board.name.slice(0, 24)}</text>
              {m.on && <text x={W - 12} y={20} fontSize={10.5} textAnchor="end" fill="var(--subtle)">stacked</text>}
              {qs.map((q, i) => {
                const y = HEAD + i * ROW;
                const l = links.find((x) => sameRef(x.a, q.ref) || sameRef(x.b, q.ref));
                const isP = pending === q;
                const ok = pending && pending !== q && pending.module !== q.module && compatible(pending.role, q.role);
                return (
                  <g key={q.ref.ref} style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); clickPlug(q); }}>
                    <rect x={6} y={y} width={W - 12} height={ROW - 3} rx={6} fill={isP ? 'var(--accent-soft)' : ok ? 'color-mix(in srgb, var(--good) 14%, transparent)' : 'transparent'} stroke={isP ? 'var(--accent)' : 'transparent'} />
                    <text x={16} y={y + 15} fontSize={11.5} fill="var(--fg)" className="mono">{q.label}</text>
                    <text x={W - 16} y={y + 15} fontSize={10.5} textAnchor="end" fill={l ? wire(l.kind ?? 'usb') : 'var(--subtle)'}>{l ? '● ' : ''}{ROLE_TEXT[q.role]}</text>
                    {[0, W].map((x) => <circle key={x} cx={x} cy={y + ROW / 2 - 1} r={l || isP ? 4.5 : 3.5} fill={l ? wire(l.kind ?? 'usb') : 'var(--surface)'} stroke={l ? 'none' : 'var(--line-2)'} strokeWidth={1.5} />)}
                  </g>
                );
              })}
              {!qs.length && <text x={14} y={HEAD + 15} fontSize={11.5} fill="var(--subtle)">no plugs</text>}
            </g>
          );
        })}
      </svg>
      <div className="toolbar floating">
        <button className="tbtn" onClick={() => addLinks()}><Icon d={I.wand} /> Auto-connect</button>
        <span className="tsep" />
        <button className="tbtn" disabled={!links.length} onClick={() => { edit((pp) => { pp.links = []; }); select([]); }}>Clear all</button>
      </div>
      <div className="hud floating mono">
        <span>{pending ? `${pending.module.board.name} ${pending.label}: now click the plug it goes to (green ones fit) · Esc cancels` : 'click a plug, then the plug it goes to · click a cable to select it, Del removes · Auto-connect fills in the rest'}</span>
        <span className="xy">{links.length} cable{links.length === 1 ? '' : 's'}{rep?.cables?.length ? ` · ${(rep.cables.reduce((a, c) => a + c.length, 0) / 1000).toFixed(1)} m` : ''}</span>
      </div>
      <div className="legend2 floating" style={{ bottom: 52 }}>
        {(Object.keys(KIND_COLOR) as (keyof typeof KIND_COLOR)[]).map((k) => <span key={k}><i style={{ background: wire(k) }} />{KIND_NAME[k]}</span>)}
      </div>
    </div>
  );
}
