// The 3D view's live touches, as if the rack were switched on: every LED glows in its colour and does what it does
// (a power light stays on, an activity light flickers, an Arduino's L blinks, a relay board clicks through its
// relays, an RGB pixel runs through the rainbow), boards with no power stay dark, and pulses run along the cables
// the way power or data goes. Kept apart from the view: it hangs its glows and pulses under the ghost meshes they
// belong to (so they move, explode and hide with them) and says when a frame needs drawing.
import * as THREE from 'three';
import type { Ghost, LightPattern } from '../model/types';
import { lightHue, lightLevel } from '../model/lights';

const FPS = 20; // blinking needs no more; the view only redraws when something changed

let glowTex: THREE.Texture | null = null;
function glow(): THREE.Texture {
  if (glowTex) return glowTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!, r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  r.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(cv);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

const noRay = () => {};

/** A small label in the scene (where an off-rack lead goes), always facing the camera and drawn over the boards (never behind one). */
function labelSprite(text: string): THREE.Sprite {
  const px = 28, pad = 10, cv = document.createElement('canvas'), g = cv.getContext('2d')!;
  g.font = `600 ${px}px system-ui, sans-serif`;
  const w = Math.ceil(g.measureText(text).width) + 2 * pad, h = px + 2 * pad;
  cv.width = w; cv.height = h;
  g.font = `600 ${px}px system-ui, sans-serif`;
  g.fillStyle = 'rgba(20,24,30,0.72)';
  g.beginPath(); g.roundRect(0, 0, w, h, h / 2); g.fill();
  g.fillStyle = '#e8edf4'; g.textBaseline = 'middle'; g.fillText(text, pad, h / 2 + 1);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  // the same size on screen however far away (readable zoomed out, not huge zoomed in)
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false, sizeAttenuation: false }));
  const H = 0.021;
  sp.scale.set((H * w) / h, H, 1);
  sp.raycast = noRay;
  sp.renderOrder = 11;
  return sp;
}
const seedOf = (s: string) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973; return h / 97; };

interface LightObj { sprite: THREE.Sprite; dot: THREE.Mesh; base: THREE.Color; pattern: LightPattern; seed: number; i: number; size: number; level: number; dark: boolean }
interface FlowObj { beads: THREE.Mesh[]; pts: number[][]; cum: number[]; len: number; speed: number; on: boolean }

export interface LiveFx { tick(now: number): boolean; setLive(on: boolean): void; hide(v: boolean): void; declutter(camera: THREE.PerspectiveCamera, zoom?: number): void; dispose(): void }

/**
 * Which of these labels (centre, half width and height on screen, distance from the eye) to show so none lies on
 * another: the nearest first keep their place; one that would overlap a label already kept is left out.
 */
export function keepApart(ls: { x: number; y: number; hw: number; hh: number; d: number }[]): boolean[] {
  const kept: number[][] = [], out = ls.map(() => false);
  for (const i of ls.map((_, k) => k).sort((a, b) => ls[a].d - ls[b].d)) {
    const l = ls[i], r = [l.x - l.hw, l.y - l.hh, l.x + l.hw, l.y + l.hh];
    if (kept.some((k) => r[0] < k[2] && k[0] < r[2] && r[1] < k[3] && k[1] < r[3])) continue;
    kept.push(r);
    out[i] = true;
  }
  return out;
}

/** How much of their strength the where-it-goes labels keep when the view is `zoom` times the rack's radius away: all up to 5 (the whole rack in view is about 3.5), none from 8. */
export const labelFade = (zoom: number) => Math.max(0, Math.min(1, (8 - zoom) / 3));

/** Hang the live touches on the meshes of the ghosts that have them. `live` false: lights on steady, no pulses. */
export function liveFx(items: { gh: Ghost; mesh: THREE.Object3D }[], live: boolean): LiveFx {
  const lights: LightObj[] = [], flows: FlowObj[] = [], extras: THREE.Object3D[] = [], tags: { at: THREE.Vector3; texts: string[]; mesh: THREE.Object3D; mod: string }[] = [];
  const made: { dispose(): void }[] = [], labels: THREE.Sprite[] = [];
  const dotGeo = new THREE.SphereGeometry(1, 12, 8), beadGeo = new THREE.SphereGeometry(1, 10, 6);
  made.push(dotGeo, beadGeo);
  for (const { gh, mesh } of items) {
    const fx = gh.fx;
    if (!fx) continue;
    const seed = seedOf(`${gh.tag?.module ?? ''}${gh.name}`);
    for (const L of fx.lights ?? []) {
      const base = new THREE.Color(L.colour);
      const sm = new THREE.SpriteMaterial({ map: glow(), color: base.clone(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9, toneMapped: false });
      const sprite = new THREE.Sprite(sm);
      const n = L.n ?? [0, 0, 1];
      sprite.position.set(L.p[0] + n[0] * 0.25, L.p[1] + n[1] * 0.25, L.p[2] + n[2] * 0.25);
      const size = Math.max(2.6, L.r * 6);
      sprite.scale.setScalar(size);
      sprite.raycast = noRay;
      sprite.renderOrder = 10;
      const dm = new THREE.MeshBasicMaterial({ color: base.clone(), toneMapped: false, transparent: true, opacity: 0.95 });
      const dot = new THREE.Mesh(dotGeo, dm);
      dot.position.set(L.p[0], L.p[1], L.p[2]);
      dot.scale.setScalar(Math.max(0.35, L.r * 0.7));
      dot.raycast = noRay;
      mesh.add(sprite, dot);
      made.push(sm, dm);
      lights.push({ sprite, dot, base, pattern: L.pattern, seed: seed + L.i * 0.17, i: L.i, size, level: -1, dark: !!fx.dark });
    }
    if (fx.fade && (mesh as THREE.Mesh).isMesh) {
      // a lead off the rack: it fades out along its stub, then dots on the way it goes, and where to
      const F = fx.fade, m0 = (mesh as THREE.Mesh).material as THREE.MeshStandardMaterial;
      const fm = new THREE.MeshStandardMaterial({ color: m0.color?.clone() ?? new THREE.Color(0x2b2e33), roughness: 0.62, metalness: 0, transparent: true, side: THREE.DoubleSide });
      const uP = { value: new THREE.Vector3(F.p[0], F.p[1], F.p[2]) }, uD = { value: new THREE.Vector3(F.d[0], F.d[1], F.d[2]).normalize() }, uL = { value: F.len };
      fm.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, { uP, uD, uL });
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform vec3 uP; uniform vec3 uD; varying float vAlong;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlong = dot(position - uP, uD);');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uL; varying float vAlong;').replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= 1.0 - smoothstep(0.3 * uL, uL, vAlong);');
      };
      fm.customProgramCacheKey = () => 'lead-fade';
      (mesh as THREE.Mesh).material = fm;
      made.push(fm);
      const dm = new THREE.MeshBasicMaterial({ color: new THREE.Color(F.colour), transparent: true, opacity: 0.9, toneMapped: false });
      made.push(dm);
      const n = Math.max(3, Math.round(F.dash / 4));
      for (let k = 0; k < n; k++) {
        const t = F.len * 0.8 + (k + 0.5) * (F.dash / n), dot = new THREE.Mesh(dotGeo, dm);
        dot.position.set(F.p[0] + F.d[0] * t, F.p[1] + F.d[1] * t, F.p[2] + F.d[2] * t);
        dot.scale.setScalar(0.75 * (1 - (0.5 * k) / n));
        dot.raycast = noRay;
        mesh.add(dot);
        extras.push(dot);
      }
      if (F.label) {
        // leads out of plugs close together share one label ("to a screen ×2 · to speakers")
        const t = F.len * 0.8 + F.dash + 7, at = new THREE.Vector3(F.p[0] + F.d[0] * t, F.p[1] + F.d[1] * t, F.p[2] + F.d[2] * t);
        // (and the same words from one holder are one label, "→ hub ×4", wherever along it the leads are)
        const mod = gh.tag?.module ?? '', text: string = F.label;
        const near = tags.find((g) => g.mod === mod && g.texts.includes(text)) ?? tags.find((g) => g.at.distanceTo(at) < 45);
        if (near) near.texts.push(F.label);
        else tags.push({ at, texts: [F.label], mesh, mod });
      }
    }
    if (fx.flow && fx.flow.pts.length > 1) {
      const pts = fx.flow.pts, cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
      const len = cum[cum.length - 1];
      if (len < 20) continue;
      const bm = new THREE.MeshBasicMaterial({ color: new THREE.Color(fx.flow.colour), toneMapped: false, transparent: true, opacity: 0.9 });
      made.push(bm);
      const n = Math.max(1, Math.min(6, Math.round(len / (fx.flow.slow ? 140 : 90))));
      const beads: THREE.Mesh[] = [];
      for (let k = 0; k < n; k++) {
        const b = new THREE.Mesh(beadGeo, bm);
        b.scale.set(fx.flow.r * 1.1, fx.flow.r * 1.1, fx.flow.r * 1.1);
        b.raycast = noRay;
        b.visible = false;
        mesh.add(b);
        beads.push(b);
      }
      flows.push({ beads, pts, cum, len, speed: fx.flow.slow ? 45 : 110, on: fx.flow.on });
    }
  }
  for (const g of tags) {
    const n = new Map<string, number>();
    for (const t of g.texts) n.set(t, (n.get(t) ?? 0) + 1);
    const tag = labelSprite([...n].map(([t, k]) => (k > 1 ? `${t} ×${k}` : t)).join(' · '));
    made.push(tag.material, (tag.material as THREE.SpriteMaterial).map!);
    tag.position.copy(g.at);
    g.mesh.add(tag);
    extras.push(tag);
    labels.push(tag);
  }
  let on = live, last = -1;
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tmp = new THREE.Color();
  const place = (f: FlowObj, s: number, b: THREE.Mesh) => {
    let i = 1;
    while (i < f.cum.length - 1 && f.cum[i] < s) i++;
    const a = f.pts[i - 1], c = f.pts[i], seg = f.cum[i] - f.cum[i - 1] || 1, k = (s - f.cum[i - 1]) / seg;
    b.position.set(a[0] + (c[0] - a[0]) * k, a[1] + (c[1] - a[1]) * k, a[2] + (c[2] - a[2]) * k);
  };
  const tick = (now: number): boolean => {
    if (!lights.length && !flows.length) return false;
    const moving = on && !reduce;
    if (moving && last >= 0 && now - last < 1000 / FPS) return false;
    if (!moving && last >= 0) return false; // drawn steady once
    const first = last < 0;
    last = now;
    const t = now / 1000;
    let changed = first || (moving && flows.some((f) => f.on));
    for (const L of lights) {
      const lv = L.dark ? 0 : moving ? lightLevel(L.pattern, t, L.seed, L.i) : 1;
      if (L.pattern === 'rainbow' && lv > 0) { tmp.setHSL(moving ? lightHue(t, L.seed) : 0.6, 0.9, 0.6); (L.sprite.material as THREE.SpriteMaterial).color.copy(tmp); (L.dot.material as THREE.MeshBasicMaterial).color.copy(tmp); }
      if (lv === L.level && L.pattern !== 'rainbow') continue;
      L.level = lv;
      changed = true;
      L.sprite.visible = lv > 0.02;
      (L.sprite.material as THREE.SpriteMaterial).opacity = 0.9 * lv;
      L.sprite.scale.setScalar(L.size * (0.75 + 0.25 * lv));
      if (L.pattern !== 'rainbow') (L.dot.material as THREE.MeshBasicMaterial).color.copy(L.base).multiplyScalar(0.25 + 0.75 * lv);
      L.dot.visible = lv > 0.02;
    }
    for (const f of flows) {
      const go = moving && f.on;
      f.beads.forEach((b, k) => {
        b.visible = go;
        if (!go) return;
        const s = ((t * f.speed + (k * f.len) / f.beads.length) % f.len + f.len) % f.len;
        place(f, s, b);
      });
    }
    return changed;
  };
  return {
    tick,
    setLive(v) { on = v; last = -1; },
    // kept out of the ambient-occlusion pass's own renders (a glow would darken the board round it)
    hide(v) {
      for (const o of [...lights.flatMap((L) => [L.sprite, L.dot]), ...flows.flatMap((f) => f.beads), ...extras]) {
        if (v) { o.userData.was = o.visible; o.visible = false; } else o.visible = !!o.userData.was;
      }
    },
    // where-it-goes labels are the same size on screen at any distance, so on a big rack seen whole they pile up: the
    // nearest keep their place and any that would lie on one of them wait until the view comes closer
    declutter(camera, zoom = 0) {
      // zoomed right out (the view further than 5 times the rack's radius from what it looks at) they fade away
      const fade = labelFade(zoom);
      if (labels.length < 2) { for (const s of labels) { (s.material as THREE.SpriteMaterial).opacity = fade; s.visible = fade > 0.02; } return; }
      const P = camera.projectionMatrix.elements, v = new THREE.Vector3();
      const shown = (s: THREE.Object3D) => { for (let o: THREE.Object3D | null = s.parent; o; o = o.parent) if (!o.visible) return false; return true; };
      const list = labels.filter(shown).map((s) => {
        s.getWorldPosition(v);
        const d = v.distanceTo(camera.position), q = v.project(camera);
        // (a label keeps its size on screen: its half width and height in the view's -1 to 1 units)
        return { s, x: q.x, y: q.y, hw: (s.scale.x * P[0]) / 2 + 0.01, hh: (s.scale.y * P[5]) / 2 + 0.01, d };
      });
      const keep = keepApart(list);
      list.forEach((l, i) => { (l.s.material as THREE.SpriteMaterial).opacity = fade; l.s.visible = keep[i] && fade > 0.02; });
    },
    dispose() {
      for (const L of lights) { L.sprite.removeFromParent(); L.dot.removeFromParent(); }
      for (const f of flows) for (const b of f.beads) b.removeFromParent();
      for (const o of extras) o.removeFromParent();
      for (const m of made) m.dispose();
    },
  };
}
