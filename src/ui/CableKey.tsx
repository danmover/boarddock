// The key to the cable colours: a short line in each kind's colour and pattern (cablekinds.ts), for the kinds on this
// rack. Under the 3D view's tabs (folded on a phone); the Wiring view's legend uses the same swatches.
import './extras.css';
import { useMemo } from 'react';
import { KIND_COLOR, KIND_DASH, KIND_NAME, KIND_ORDER, type CableKind } from '../model/cablekinds';
import { useApp } from '../state';
import { useView3d } from './view3d';

/** A line sample in a kind's colour and pattern, with a faint halo so a dark or pale one shows on either theme. */
export function KindSwatch({ kind, color = KIND_COLOR[kind] }: { kind: CableKind; color?: string }) {
  return (
    <svg className="kswatch" width="22" height="8" viewBox="0 0 22 8" aria-hidden="true" style={{ verticalAlign: '-1px', marginRight: 5 }}>
      <line x1="1.5" y1="4" x2="20.5" y2="4" stroke="var(--fg)" strokeOpacity="0.3" strokeWidth="5.5" strokeLinecap="round" />
      <line x1="1.5" y1="4" x2="20.5" y2="4" stroke={color} strokeWidth="3" strokeLinecap="round" strokeDasharray={KIND_DASH[kind]} />
    </svg>
  );
}

export function CableKey() {
  const cables = useApp((s) => s.result?.report.cables), zones = useApp((s) => s.result?.report.zones?.length ?? 0), showZones = useView3d((s) => s.zones);
  const kinds = useMemo(() => { const on = new Set((cables ?? []).map((c) => c.kind)); return KIND_ORDER.filter((k) => on.has(k)); }, [cables]);
  if (!kinds.length && !(zones && showZones)) return null;
  const wide = typeof matchMedia === 'undefined' || matchMedia('(min-width: 861px)').matches;
  return (
    <details className="cablekey floating" open={wide}>
      <summary title="What each cable colour means">{kinds.length ? 'Cable colours' : 'Mains zone'}</summary>
      <div className="ck-list">
        {kinds.map((k) => <span key={k}><KindSwatch kind={k} />{KIND_NAME[k]}</span>)}
        {zones > 0 && showZones && <span className="mainskey" title="A mains board's footprint with a 10 mm margin"><em />mains zone</span>}
      </div>
    </details>
  );
}
