// The 3D view's extra looks, kept out of Viewer3D.tsx: Isolate and X-ray (show the picked things on their own, or the
// rest see-through), the tint on what is new since the rack was built, and the shaded mains zones.
import * as THREE from 'three';
import type { MainsZone, PickTag } from '../model/types';
import { isNewPiece, type NewSet } from '../model/newparts';
import type { SelItem } from '../state';
import type { View3d } from './view3d';

interface Piece { mesh: THREE.Mesh; tag?: PickTag; base: THREE.Matrix4 }

/** Whether a piece of the scene is part of a picked thing (a board: all of its parts, plugs and caps; not its cables). */
export function keeps(t: PickTag | undefined, it: SelItem): boolean {
  if (!t) return false;
  switch (it.kind) {
    case 'module': return t.module === it.id && t.kind !== 'cable' && t.kind !== 'cabletag';
    case 'feature': return t.module === it.module && t.kind !== 'cable' && t.kind !== 'cabletag';
    case 'mount': return t.mount === it.id;
    case 'rail': return t.rail === it.id;
    case 'link': return (t.kind === 'cable' || t.kind === 'cabletag') && (t.refs ?? []).includes(it.id);
    case 'railstand': return t.kind === 'railstand' && (t.refs ?? []).includes(it.id);
    default: return false;
  }
}

// see-through and tinted copies of a material, made once per material and freed with it
const variants = new Map<THREE.Material, { xray?: THREE.Material; tint?: THREE.Material }>();
const TINT = new THREE.Color('#ffb020');
function variant(base: THREE.Material, kind: 'xray' | 'tint'): THREE.Material {
  const v = variants.get(base) ?? variants.set(base, {}).get(base)!;
  if (!v[kind]) {
    const m = base.clone() as THREE.MeshStandardMaterial;
    if (kind === 'xray') { m.transparent = true; m.opacity = Math.min(base.opacity, 0.12); m.depthWrite = false; if ('emissiveIntensity' in m) m.emissiveIntensity = 0; }
    else if ('emissive' in m) { m.emissive = TINT.clone(); m.emissiveIntensity = 0.5; }
    v[kind] = m;
  }
  return v[kind]!;
}
/** Hand back the copies made from a material that is being freed. */
export function dropVariants(base: THREE.Material, out: { dispose(): void }[]) {
  const v = variants.get(base);
  if (!v) return;
  for (const m of [v.xray, v.tint]) if (m) out.push(m);
  variants.delete(base);
}

export interface ViewFx { focus: View3d['focus']; news: NewSet | null }

/**
 * Put the focus and the new-parts look on the scene's pieces. Isolate hides what isn't picked; X-ray (and What's new)
 * make it see-through, with no outline lines and no shadow, and What's new tints the new pieces. False when nothing in
 * the scene is what was asked for (the caller leaves the mode).
 */
export function applyView(c: any, fx: ViewFx): boolean {
  const objs = c.objs as Piece[];
  let keep: Set<Piece> | null = null;
  if (fx.focus) keep = new Set(objs.filter((o) => fx.focus!.items.some((it) => keeps(o.tag, it))));
  else if (fx.news) keep = new Set(objs.filter((o) => isNewPiece(fx.news!, o.tag, o.base.elements)));
  let ok = true;
  if (keep && !keep.size) { keep = null; ok = false; } // nothing matches: show it all rather than an empty view
  const mode = keep ? fx.focus?.mode ?? 'xray' : null;
  const xrayed: THREE.Mesh[] = [];
  for (const o of objs) {
    const m = o.mesh, u = m.userData;
    const plain = (u.plainMat ??= m.material) as THREE.Material;
    const inKeep = !keep || keep.has(o);
    const hide = mode === 'isolate' && !inKeep, fade = mode === 'xray' && !inKeep;
    const tint = !!fx.news && isNewPiece(fx.news, o.tag, o.base.elements);
    u.focusHidden = hide;
    u.xray = fade;
    if (fade) xrayed.push(m);
    const want = fade ? variant(plain, 'xray') : tint ? variant(plain, 'tint') : plain;
    if (m.material !== want) m.material = want;
    if (u.cast0 === undefined) u.cast0 = m.castShadow;
    m.castShadow = fade ? false : u.cast0;
    for (const ch of m.children) ch.visible = !fade; // (the outline edges)
    m.visible = !hide && !u.animHidden && !u.layerHidden;
  }
  // see-through pieces stay out of the ambient-occlusion pass, or they would darken what is picked like solid ones
  // the mains zones sit out Isolate, X-ray and What's new: shaded boxes would drown what those are showing
  c.zonesOff = !!(fx.focus || fx.news);
  if (c.zones) c.zones.visible = zoneVisible(c);
  c.aoHide = xrayed.length ? (on: boolean) => { for (const m of xrayed) m.visible = on ? false : !m.userData.animHidden && !m.userData.layerHidden && !m.userData.focusHidden; } : null;
  return ok;
}

// ---------------------------------------------------------------- mains zones

const ZONE_COL = 0xff8a3d;
/** Whether the zones show now: switched on, not in a focus mode, and the rack assembled (not moving). */
export const zoneVisible = (c: any) => !!c.showZones && !c.zonesOff && !Number.isFinite(c.anim?.t ?? Infinity) && !((c.anim?.explode ?? 0) > 0);
/** Shaded boxes where mains sits (each mains board's footprint with its margin), in the assembly frame. */
export function applyZones(c: any, zones: MainsZone[]) {
  const g = c.zones as THREE.Group;
  for (const o of [...g.children]) { g.remove(o); (o as THREE.Mesh).geometry?.dispose?.(); (o as THREE.Mesh).material && ((o as THREE.Mesh).material as THREE.Material).dispose(); }
  for (const z of zones) {
    const [x0, y0, x1, y1] = z.rect, z0 = z.z[0], z1 = z.z[1];
    const geo = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: ZONE_COL, transparent: true, opacity: 0.14, depthWrite: false }));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: ZONE_COL, transparent: true, opacity: 0.9 }));
    for (const m of [fill, edges]) { m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); m.renderOrder = 8; g.add(m); }
  }
  g.updateMatrixWorld(true);
  c.invalidate?.();
}
