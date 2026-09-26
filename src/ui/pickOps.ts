// What a selection means and what "Remove" does with it. Everything happens in one undoable edit, so a
// multi-selection picked in the 3D view (a cradle here, a cap there, a whole dock) goes in one ⌘Z.
import type { Feature, Project } from '../model/types';
import { ROLE_INFO } from '../model/holes';
import { edit, select, store, toast, type SelItem } from '../state';
import { materialise } from './panelOps';

export const FEATURE_NAME: Record<NonNullable<SelItem['fkind']>, string> = {
  cradle: 'plug cradle', cap: 'plug cap', guard: 'receptacle guard', tie: 'cable-tie anchor', finger: 'snap finger', label: 'label',
  pin: 'pin', seat: 'edge seat', dock: 'dock tongue', tower: 'stack tower', stand: 'stand socket', notch: 'finger notch', rim: 'rim',
  plug: 'plug', clip: 'DIN clip',
};

export const featureId = (fkind: string, module: string, refs: string[] = []) => `${fkind}:${module}:${refs.join(',')}`;

export function featureItem(f: Pick<Feature, 'module' | 'refs'> & { kind: NonNullable<SelItem['fkind']> }): SelItem {
  return { kind: 'feature', id: featureId(f.kind, f.module, f.refs), module: f.module, fkind: f.kind, refs: f.refs };
}

/** Human description: a title, a context line and a colour. */
export function describe(p: Project, it: SelItem): { title: string; sub: string; color: string; removable: string | null } {
  const mod = (id?: string) => p.modules.find((m) => m.id === id);
  const idx = (id?: string) => p.modules.findIndex((m) => m.id === id);
  const rep = store.get().result?.report.panel;
  switch (it.kind) {
    case 'module': {
      const m = mod(it.id);
      return { title: m?.board.name ?? 'Board', sub: m?.on ? `stacked on ${mod(m.on)?.board.name ?? '?'}` : 'board and its holder', color: 'var(--good)', removable: 'Remove board' };
    }
    case 'mount': {
      const mt = rep?.mounts.find((x) => x.id === it.id);
      const on = mt?.slots.map((s) => mod(s.module ?? undefined)?.board.name).filter(Boolean).join(' + ');
      return { title: `Dock ${it.id.replace(/^d/, '')}`, sub: mt ? `rail ${mt.rail.replace(/^r/, '')} · ${on || 'empty'}` : 'rail shoe + socket', color: 'var(--accent)', removable: 'Remove dock' };
    }
    case 'rail': {
      const r = rep?.rails.find((x) => x.id === it.id);
      return { title: `Rail ${it.id.replace(/^r/, '')}`, sub: r ? `${r.dir === 'h' ? 'horizontal' : 'vertical'} · ${Math.round(r.length)} mm` : 'DIN rail', color: 'var(--muted)', removable: 'Remove rail' };
    }
    case 'hole': {
      const h = p.modules[p.active].board.holes.find((x) => x.id === it.id);
      return { title: `Hole Ø${h?.d.toFixed(2) ?? ''}`, sub: ROLE_INFO[h?.role ?? 'mount'].name, color: ROLE_INFO[h?.role ?? 'mount'].color, removable: 'Delete' };
    }
    case 'comp': {
      const c = p.modules[p.active].board.comps.find((x) => x.id === it.id);
      return { title: c?.ref ?? 'Part', sub: c?.pkg ?? '', color: 'var(--info)', removable: 'Delete' };
    }
    case 'feature': {
      const m = mod(it.module);
      const name = FEATURE_NAME[it.fkind ?? 'rim'];
      const refs = it.fkind === 'pin' ? (it.refs ?? []).map((id) => `hole ${(m?.board.holes.findIndex((h) => h.id === id) ?? -1) + 1}`).join(', ') : (it.refs ?? []).join(' + ');
      const removable = it.fkind === 'seat' || it.fkind === 'rim' ? null : it.fkind === 'dock' ? 'Take off the panel' : it.fkind === 'tower' ? 'Unstack' : it.fkind === 'plug' ? 'Ignore this connector' : `Remove ${name}`;
      return { title: `${refs ? refs + ' ' : ''}${name}`, sub: `${m?.board.name ?? ''}${p.modules.length > 1 ? ` · board ${idx(it.module) + 1}` : ''}`, color: it.fkind === 'cap' ? '#ffc043' : it.fkind === 'plug' ? 'var(--copper)' : 'var(--accent)', removable };
    }
  }
}

/** Remove (or switch off) everything in the selection, as one undo step. */
export function removeItems(items: SelItem[]) {
  const panelish = items.some((i) => i.kind === 'mount' || i.kind === 'rail' || (i.kind === 'feature' && i.fkind === 'dock'));
  let n = 0;
  edit((p) => {
    if (panelish && p.layout === 'panel') materialise(p);
    for (const it of items) {
      const m = p.modules.find((x) => x.id === (it.kind === 'module' ? it.id : it.module));
      const comps = (refs?: string[]) => (m ? m.board.comps.filter((c) => refs?.includes(c.ref)) : []);
      if (it.kind === 'module' && m) {
        if (p.modules.length <= 1) continue;
        p.modules = p.modules.filter((x) => x !== m);
        for (const x of p.modules) if (x.on === m.id) x.on = m.on ?? null;
        for (const mt of p.panel.mounts) for (const sl of mt.slots) if (sl.module === m.id) sl.module = null;
        p.active = Math.min(p.active, p.modules.length - 1);
        n++;
      } else if (it.kind === 'mount') {
        p.panel.mounts = p.panel.mounts.filter((x) => x.id !== it.id);
        n++;
      } else if (it.kind === 'rail') {
        p.panel.rails = p.panel.rails.filter((r) => r.id !== it.id);
        p.panel.mounts = p.panel.mounts.filter((x) => x.rail !== it.id);
        n++;
      } else if (it.kind === 'feature' && m) {
        const H = m.holder;
        switch (it.fkind) {
          case 'cradle': for (const c of comps(it.refs)) if (c.conn) { c.conn.cradle = false; c.conn.cap = false; } break;
          case 'cap': for (const c of comps(it.refs)) if (c.conn) c.conn.cap = false; break;
          case 'guard': for (const c of comps(it.refs)) if (c.conn) c.conn.guard = false; break;
          case 'tie': for (const c of comps(it.refs)) if (c.conn) c.conn.tie = false; break;
          case 'plug': for (const c of comps(it.refs)) c.hidden = true; break;
          case 'pin': for (const h of m.board.holes) if (it.refs?.includes(h.id)) { h.role = 'free'; h.why = 'switched off in the 3D view'; } break;
          case 'finger': H.tabs = 'off'; break;
          case 'label': H.label = ''; break;
          case 'notch': H.notches = false; break;
          case 'stand': p.stand.enabled = false; break;
          case 'clip': if (p.layout === 'loose') p.mount.kind = 'none'; else p.panel.mounts = p.panel.mounts.filter((x) => !x.slots.some((s) => s.module === m.id)); break;
          case 'tower': m.on = null; for (const x of p.modules) if (x.on === m.id) x.on = null; break;
          case 'dock': for (const mt of p.panel.mounts) for (const sl of mt.slots) if (sl.module === m.id) sl.module = null; break;
          default: continue;
        }
        n++;
      }
    }
  });
  select([]);
  if (n) toast(`Removed ${n} item${n > 1 ? 's' : ''}. ⌘Z brings ${n > 1 ? 'them' : 'it'} back.`);
}
