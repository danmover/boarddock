// The 3D view's toolbar group: Isolate and X-ray the selection, tint what's new, shade the mains zones. Esc leaves the
// first two (Viewer3D). The same switches are in the command palette.
import './extras.css';
import { useApp } from '../state';
import { setZones, toggleFocus, useView3d, view3d } from './view3d';

export function FocusTools() {
  const focus = useView3d((s) => s.focus), news = useView3d((s) => s.news), zones = useView3d((s) => s.zones);
  const built = useApp((s) => !!s.project?.built), hasZones = useApp((s) => !!s.result?.report.zones?.length);
  return (
    <div className="tgroup floating">
      <button className={focus?.mode === 'isolate' ? 'on' : ''} aria-pressed={focus?.mode === 'isolate'} onClick={() => toggleFocus('isolate')} title="Show only what is picked, hiding the rest (Esc leaves)">Isolate</button>
      <button className={focus?.mode === 'xray' ? 'on' : ''} aria-pressed={focus?.mode === 'xray'} onClick={() => toggleFocus('xray')} title="Keep what is picked solid and make everything else see-through (Esc leaves)">X-ray</button>
      {built && <button className={news ? 'on' : ''} aria-pressed={news} onClick={() => view3d.set({ news: !news })} title="Tint the parts, boards and cables that are new since the rack was built, and make the rest see-through">What's new</button>}
      {hasZones && <button className={zones ? 'on' : ''} aria-pressed={zones} onClick={() => setZones(!zones)} title="Shade where mains sits (outlets, mains leads, inlets, plug packs), with a 10 mm margin round each">Mains</button>}
    </div>
  );
}

/** The Rails toolbar's switch for the zones (nothing when the rack has no mains on it). */
export function ZonesToggle() {
  const zones = useView3d((s) => s.zones), n = useApp((s) => s.result?.report.zones?.length ?? 0);
  if (!n) return null;
  return <button className={`tbtn wide ${zones ? 'on' : ''}`} aria-pressed={zones} onClick={() => setZones(!zones)} title="Shade where mains sits (outlets, mains leads, inlets, plug packs), with a 10 mm margin round each">Mains zones</button>;
}

/** The Rails view's mains zones: each mains board's footprint with its margin, shaded orange (drawn under the docks). */
export function MainsZonesSvg({ px }: { px: number }) {
  const zones = useApp((s) => s.result?.report.zones), on = useView3d((s) => s.zones);
  if (!on || !zones?.length) return null;
  return (
    <g pointerEvents="none">
      <defs><pattern id="mainsHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#ff8a3d" strokeOpacity="0.55" strokeWidth={1.4} /></pattern></defs>
      {zones.map((z) => (
        <g key={z.module}>
          <rect x={z.rect[0]} y={-z.rect[3]} width={z.rect[2] - z.rect[0]} height={z.rect[3] - z.rect[1]} rx={3} fill="url(#mainsHatch)" stroke="#ff8a3d" strokeWidth={1.4 * px} strokeDasharray={`${5 * px} ${3 * px}`} />
          <text x={z.rect[0] + 4 * px} y={-z.rect[3] + 12 * px} fontSize={10.5 * px} fill="#ff8a3d" fontWeight={700}>mains: {z.what}</text>
        </g>
      ))}
    </g>
  );
}
