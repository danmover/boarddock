// What a selection means and what "Remove" does with it. Everything happens in one undoable edit, so a
// multi-selection picked in the 3D view (a cradle here, a cap there, a whole dock) goes in one ⌘Z.
import type { Feature, Project } from '../model/types';
import { ROLE_INFO } from '../model/holes';
import { cableNumbers, KIND_COLOR, KIND_NAME, refText } from '../model/links';
import { mountLabels } from '../model/built';
import { dropModule, edit, select, store, toast, type SelItem } from '../state';
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
      return { title: `Dock ${mountLabels(rep).get(it.id) ?? it.id.replace(/^d/, '')}`, sub: mt ? `rail ${mt.rail.replace(/^r/, '')} · ${on || 'empty'}` : 'rail shoe + socket', color: 'var(--accent)', removable: 'Remove dock' };
    }
    case 'rail': {
      const r = rep?.rails.find((x) => x.id === it.id);
      return { title: `Rail ${it.id.replace(/^r/, '')}`, sub: r ? `${r.dir === 'h' ? 'horizontal' : 'vertical'} · ${Math.round(r.length)} mm` : 'DIN rail', color: 'var(--muted)', removable: 'Remove rail' };
    }
    case 'link': {
      const l = (p.links ?? []).find((x) => x.id === it.id);
      const c = store.get().result?.report.cables?.find((x) => x.id === it.id);
      const nm = (r?: { module: string; ref: string }) => (r ? `${mod(r.module)?.board.name ?? '?'} ${refText(mod(r.module), r.ref)}` : '?');
      return { title: `${l ? KIND_NAME[l.kind ?? 'usb'] : ''} cable`, sub: `${nm(l?.a)} to ${nm(l?.b)}${c ? ` · ${Math.round(c.length / 10)} cm, buy ${c.buy} m` : ''}`, color: l ? KIND_COLOR[l.kind ?? 'usb'] : 'var(--muted)', removable: 'Remove cable' };
    }
    case 'railstand': {
      const all = rep?.stands ?? [], s = all.find((x) => `s${x.station}` === it.id);
      return { title: `Table stand ${it.id.slice(1)} of ${all.length}`, sub: s ? `${s.pieces} piece${s.pieces > 1 ? 's' : ''}${s.combs ? ` · ${s.combs} cable comb${s.combs > 1 ? 's' : ''}` : ''}` : 'sleeper under the rails', color: 'var(--muted)', removable: 'Remove table stands' };
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
      const all: Partial<Record<string, string>> = { finger: 'Remove all snap fingers', notch: 'Remove the finger notches', label: 'Remove the label', stand: 'Remove the stand', clip: 'Remove the DIN clip' };
      const removable = it.fkind === 'seat' || it.fkind === 'rim' ? null : it.fkind === 'dock' ? 'Take off the panel' : it.fkind === 'tower' ? 'Unstack' : it.fkind === 'plug' ? 'Ignore this connector' : it.fkind === 'pin' ? 'Remove this pin (hole left free)' : all[it.fkind ?? ''] ?? `Remove this ${name}`;
      return { title: `${refs ? refs + ' ' : ''}${name}`, sub: `${m?.board.name ?? ''}${p.modules.length > 1 ? ` · board ${idx(it.module) + 1}` : ''}`, color: it.fkind === 'cap' ? '#f2c94c' : it.fkind === 'plug' ? 'var(--copper)' : 'var(--accent)', removable };
    }
  }
}

/** Remove (or switch off) everything in the selection, as one undo step. Nothing removable: no undo step at all. */
export function removeItems(items: SelItem[]) {
  const cur = store.get().project;
  if (!cur) return;
  const p = structuredClone(cur);
  let n = 0, fixed = false;
  // the panel is written down (auto layout off) only when something on it actually goes
  const onPanel = () => { if (!fixed && p.layout === 'panel') materialise(p); fixed = true; };
  {
    for (const it of items) {
      const m = p.modules.find((x) => x.id === (it.kind === 'module' ? it.id : it.module));
      const comps = (refs?: string[]) => (m ? m.board.comps.filter((c) => refs?.includes(c.ref)) : []);
      if (it.kind === 'module' && m) {
        if (dropModule(p, m.id)) n++;
      } else if (it.kind === 'link') {
        p.links = (p.links ?? []).filter((l) => l.id !== it.id);
        n++;
      } else if (it.kind === 'mount') {
        if (!p.panel.mounts.some((x) => x.id === it.id)) continue;
        onPanel();
        p.panel.mounts = p.panel.mounts.filter((x) => x.id !== it.id);
        n++;
      } else if (it.kind === 'railstand') {
        if (p.panel.stands === false) continue;
        p.panel.stands = false;
        n++;
      } else if (it.kind === 'rail') {
        onPanel();
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
          case 'clip': if (p.layout === 'loose') p.mount.kind = 'none'; else { onPanel(); p.panel.mounts = p.panel.mounts.filter((x) => !x.slots.some((s) => s.module === m.id)); } break;
          case 'tower': m.on = null; for (const x of p.modules) if (x.on === m.id) x.on = null; break;
          case 'dock': onPanel(); for (const mt of p.panel.mounts) for (const sl of mt.slots) if (sl.module === m.id) sl.module = null; break;
          default: continue;
        }
        n++;
      }
    }
  }
  if (n) edit((q) => { Object.assign(q, p); });
  select([]);
  if (!n) return;
  // name what went: the boards, and the cables that went with them (by number, as on their tags)
  const gone = cur.modules.filter((m) => !p.modules.some((x) => x.id === m.id)).map((m) => m.board.name);
  const nos = cableNumbers(cur.links);
  const cables = (cur.links ?? []).filter((l) => !(p.links ?? []).some((x) => x.id === l.id)).map((l) => nos.get(l.id)).sort((a, b) => a! - b!);
  const other = n - gone.length - (items.filter((it) => it.kind === 'link').length);
  const what = [
    gone.length ? (gone.length > 3 ? `${gone.length} boards` : gone.join(', ')) : '',
    cables.length ? `cable${cables.length > 1 ? 's' : ''} ${cables.join(', ')}` : '',
    other > 0 ? `${other} other item${other > 1 ? 's' : ''}` : '',
  ].filter(Boolean);
  toast(`Removed ${what.length > 1 ? `${what.slice(0, -1).join(', ')} and ${what[what.length - 1]}` : what[0] ?? `${n} item${n > 1 ? 's' : ''}`}. ⌘Z brings ${n > 1 || what.length > 1 ? 'them' : 'it'} back.`);
}
