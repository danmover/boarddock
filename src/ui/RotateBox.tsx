// A rotation box: type an angle, or turn with ⟲ ⟳ by the snap chosen (15°, 45°, 90°, or free). With `value` (the angle
// it has now) a typed angle is where it should point; with null (a group, or parts that differ) it is how far to turn.
// The snap is kept for next time. The box only says how far to turn: the caller turns.
import './extras.css';
import { useEffect, useState } from 'react';
import { parseDeg, shortTurn, snapDeg, SNAPS, stepTo } from '../geom/angle';
import { Seg } from './controls';

const KEY = 'boarddock.rotsnap';
const fmt = (v: number) => String(Math.round(v * 100) / 100);

function useSnap(steps: readonly number[]) {
  const [snap, set] = useState<number>(() => {
    try { const raw = localStorage.getItem(KEY), v = Number(raw); if (raw != null && (steps.includes(v) || (v === 0 && steps.length > 1))) return v; } catch { /* private window */ }
    return steps.includes(15) ? 15 : steps[0];
  });
  return [snap, (v: number) => { set(v); try { localStorage.setItem(KEY, String(v)); } catch { /* private window */ } }] as const;
}

export function RotateBox({ value, onTurn, label = 'Rotation', steps = SNAPS, compact }: { value: number | null; onTurn: (by: number) => void; label?: string; steps?: readonly number[]; compact?: boolean }) {
  const free = !(steps.length === 1);
  const [snap, setSnap] = useSnap(steps);
  const [txt, setTxt] = useState(value == null ? '' : fmt(value));
  useEffect(() => setTxt(value == null ? '' : fmt(value)), [value]);
  const step = snap || 1;
  const turn = (by: number) => { if (Math.abs(by) > 1e-9) onTurn(by); };
  const commit = (s: string) => {
    const v = parseDeg(s);
    if (v == null) { setTxt(value == null ? '' : fmt(value)); return; }
    const t = snap ? snapDeg(v, snap) : v;
    if (value == null) { turn(t); setTxt(''); } else { turn(shortTurn(value, t)); setTxt(fmt(t)); }
  };
  const go = (dir: 1 | -1) => turn(value == null ? dir * step : stepTo(value, dir, step) - value);
  const input = (
    <input type="text" inputMode="decimal" value={txt} placeholder={value == null ? 'turn by' : ''} aria-label={`${label}, degrees${value == null ? ': how far to turn' : ''}`}
      title={value == null ? 'Type how far to turn, in degrees, then Enter' : 'Type the angle, then Enter'}
      onChange={(e) => setTxt(e.target.value)} onBlur={(e) => { if (e.target.value !== (value == null ? '' : fmt(value))) commit(e.target.value); }}
      onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }} />
  );
  const opts: [number, string][] = [...(free ? [[0, 'Free'] as [number, string]] : []), ...steps.map((s): [number, string] => [s, `${s}°`])];
  return (
    <div className={`rotbox${compact ? ' compact' : ''}`} role="group" aria-label={label}>
      {compact ? input : <label className="field"><span>{label}<em>°</em></span>{input}</label>}
      <div className="rotturn">
        <button className="btn small ghost" onClick={() => go(-1)} title={`Turn back ${free && !snap ? '1°' : `${step}°`}`} aria-label="Turn back">⟲</button>
        <button className="btn small ghost" onClick={() => go(1)} title={`Turn on ${free && !snap ? '1°' : `${step}°`}`} aria-label="Turn on">⟳</button>
      </div>
      {compact
        ? <select value={snap} onChange={(e) => setSnap(+e.target.value)} aria-label="Snap the turn to" title="Snap: turns and typed angles go to a multiple of this">{opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        : opts.length > 1 && <Seg value={snap} options={opts} onChange={setSnap} />}
    </div>
  );
}
