// Check › Printability: every distinct part sliced into 0.2 mm layers in its print pose (a background worker, cached
// per part), and what a slicer will make of it: nothing in mid-air, how long the bridges and overhangs are, walls
// thinner than a line, and slots too narrow to stay open where something has to move.
import { useEffect, useMemo, useState } from 'react';
import type { PartOut } from '../model/types';
import { partSig } from '../model/built';
import { verdict, type LayerReport } from '../cad/printcheck';
import { checkLayers } from '../worker/client';
import { useApp } from '../state';
import { Chip, Section } from './controls';

const MOVING = /Rail shoe|Dock socket|DIN rail clip/; // print-in-place levers, latches and jaws

export function PrintCheckSection() {
  const res = useApp((s) => s.result);
  const parts = useMemo(() => {
    const seen = new Map<string, PartOut>();
    for (const x of res?.parts ?? []) { const k = partSig(x); if (!seen.has(k)) seen.set(k, x); }
    return [...seen.entries()];
  }, [res]);
  const [done, setDone] = useState<Record<string, LayerReport | null>>({});
  useEffect(() => {
    let live = true;
    (async () => {
      for (const [k, x] of parts) {
        if (!live) return;
        const r = await checkLayers(k, x.mesh).catch(() => null);
        if (live) setDone((d) => ({ ...d, [k]: r }));
      }
    })();
    return () => { live = false; };
  }, [parts]);
  const left = parts.filter(([k]) => !(k in done)).length;
  const bad = parts.filter(([k, x]) => done[k] && verdict(done[k]!, MOVING.test(x.name)).status === 'bad').length;
  return (
    <Section title="Printability" right={<span className="chip">{left ? `slicing ${parts.length - left}/${parts.length}` : bad ? `${bad} need support` : 'no supports'}</span>}>
      <p className="hint" style={{ marginTop: 0 }}>Each part is cut into 0.2 mm layers the way it lies on the bed, and every layer is checked against the one under it: nothing may start in mid-air (that would need support), bridges and overhangs are measured, and walls thinner than a line or slots too narrow to stay open are found.</p>
      {parts.map(([k, x]) => {
        const r = done[k];
        const v = r ? verdict(r, MOVING.test(x.name)) : null;
        return (
          <div key={k} className="checkrow">
            <div className="grow" title={v?.detail}>{x.name}{x.qty > 1 ? ` ×${x.qty}` : ''}<div className="hint">{k in done ? (v ? v.brief : 'could not be sliced') : 'slicing…'}</div></div>
            <Chip status={v?.status ?? 'info'}>{v ? v.value : k in done ? '?' : '…'}</Chip>
          </div>
        );
      })}
    </Section>
  );
}
