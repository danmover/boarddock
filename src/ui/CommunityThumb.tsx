// The picture on a community board's tile: the rendered 3D picture shipped in public/boards/ when there is one for the
// board as it is now (scripts/render-tiles.mjs makes them), else a plain top view drawn from the numbers in the list,
// so a board nobody has rendered yet still shows properly.
import { useEffect, useState } from 'react';
import { communityIndex, communityUrl, type CommunityEntry } from '../model/community';
import { bbox, compRect } from '../geom/poly';

/** The community boards, once the list has been fetched (empty until then, and when there are none). */
export function useCommunityBoards(): CommunityEntry[] {
  const [list, setList] = useState<CommunityEntry[]>([]);
  useEffect(() => {
    let on = true;
    communityIndex().then((l) => on && setList(l)).catch(() => {});
    return () => { on = false; };
  }, []);
  return list;
}

export function CommunityThumb({ e }: { e: CommunityEntry }) {
  const [bad, setBad] = useState(false);
  if (e.pic && !bad) return <img className="thumb pic" src={communityUrl(e.pic, e.rev)} alt="" draggable={false} decoding="async" loading="lazy" onError={() => setBad(true)} />;
  return <CommunitySketch e={e} />;
}

function CommunitySketch({ e }: { e: CommunityEntry }) {
  const { outline, holes, parts } = e.sketch;
  const bb = bbox(outline), pad = 3, w = bb.x1 - bb.x0 + 2 * pad, h = bb.y1 - bb.y0 + 2 * pad;
  const tx = (x: number) => x - bb.x0 + pad, ty = (y: number) => bb.y1 - y + pad;
  const path = (l: [number, number][]) => 'M' + l.map((q) => `${tx(q[0]).toFixed(1)},${ty(q[1]).toFixed(1)}`).join('L') + 'Z';
  return (
    <svg className="thumb" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMinYMid meet" aria-hidden>
      <path d={path(outline)} className="th-pcb" />
      {parts.map(([x, y, pw, pl, rot, conn], i) => <path key={i} d={path(compRect({ x, y, w: pw, l: pl, rot }))} className={conn ? 'th-conn' : 'th-part'} />)}
      {holes.map(([x, y, d], i) => <circle key={`h${i}`} cx={tx(x)} cy={ty(y)} r={Math.max(0.9, d / 2)} className="th-hole" />)}
    </svg>
  );
}
