// The picture of a contributed connector (parts/, see src/model/contributed.ts) while no rendered one is shipped: a plain
// drawing made from its look, seen from the front for a plug on an edge and from above for one that plugs in from above.
import { ICON_COLOR, iconShapes, type TypeDef } from '../model/contributed';

export function PartIcon({ def }: { def: TypeDef }) {
  const { w, h, shapes } = iconShapes(def), pad = Math.max(w, h) * 0.08, sw = Math.max(w, h) * 0.012;
  return (
    <svg className="pic sketch icon" viewBox={`${-pad} ${-pad} ${w + 2 * pad} ${h + 2 * pad}`} aria-hidden data-type={def.id}>
      <rect x={0} y={0} width={w} height={h} rx={Math.min(w, h) * 0.06} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={sw} />
      {shapes.map((s, i) => s.round
        ? <ellipse key={i} cx={s.x + s.w / 2} cy={s.y + s.h / 2} rx={s.w / 2} ry={s.h / 2} fill={ICON_COLOR[s.mat]} stroke="#0006" strokeWidth={sw} />
        : <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} fill={ICON_COLOR[s.mat]} stroke="#0006" strokeWidth={sw} />)}
    </svg>
  );
}
