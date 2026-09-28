// 3D view: studio-lit assembly with ambient occlusion, a fading floor grid (or the wall), click / Shift-click
// picking of boards, docks, rails and single holder features, hover tips, an assembly animation that builds the
// panel step by step, and an exploded view. Renders on demand only (no work while nothing changes).
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { remaining } from '../cad/motion';
import type { Anim, Feature, Motion, GenResult, Ghost, MeshData, PickTag, V2 } from '../model/types';
import { packPlates, placedMesh, printability, type Plate } from '../cad/export';
import { store, type Layer, type SelItem } from '../state';
import { featureItem } from './pickOps';
import { KIND_COLOR } from '../model/links';
import { liveFx } from './liveFx';
import { growTo } from './cableGrow';
import { badgeText } from '../model/cablebadge';

interface Props {
  result: GenResult | null;
  mode: 'assembly' | 'print';
  bed: V2;
  spacing: number;
  theme: 'dark' | 'light';
  camera?: { dir: [number, number, number]; n: number };
  installed?: 'h' | 'v' | null; // show the assembly against the wall it hangs on
  overhangs?: boolean; // print view: paint faces that need support (red) and bridges (amber)
  layers: Record<Layer, boolean>;
  sel: SelItem[];
  onPick: (it: SelItem | null, additive: boolean) => void;
  label: (it: SelItem) => { title: string; sub: string };
}

const LAYER: Record<PickTag['kind'], Layer> = {
  holder: 'holders', rod: 'holders', clip: 'holders', link: 'holders', rivet: 'holders', stand: 'boards',
  shoe: 'docks', socket: 'docks', cap: 'caps', rail: 'rails', board: 'boards', parts: 'boards', plug: 'plugs', cable: 'cables', railstand: 'rails', cabletag: 'cables',
};

interface Obj { mesh: THREE.Mesh; tag?: PickTag; anim?: Anim; lag?: number; rank: number; base: THREE.Matrix4; ghost: boolean; moves: { rank: number; dir: number[]; dist?: number; style?: Motion['style']; rot?: Motion['rot'] }[]; show: number }

function rigidInverse(m: number[]): number[] {
  const r = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
  const t = [m[12], m[13], m[14]];
  r[12] = -(r[0] * t[0] + r[4] * t[1] + r[8] * t[2]);
  r[13] = -(r[1] * t[0] + r[5] * t[1] + r[9] * t[2]);
  r[14] = -(r[2] * t[0] + r[6] * t[1] + r[10] * t[2]);
  return r;
}

// geometry cache: holders that did not change between builds keep their GPU buffers and outline edges
const geoCache = new Map<string, { g: THREE.BufferGeometry; e: THREE.EdgesGeometry | null; used: number }>();
let buildNo = 0;
function meshKey(m: MeshData) {
  // every coordinate: an edit that moves one hole must not reuse the old shape
  const p = m.pos, n = p.length;
  let h = 2166136261;
  for (let i = 0; i < n; i++) { h ^= Math.round(p[i] * 1000); h = Math.imul(h, 16777619); }
  return `${n}:${m.idx.length}:${h >>> 0}`;
}
function geom(m: MeshData, edges: boolean, smooth = false) {
  const key = meshKey(m) + (smooth ? ':s' : '');
  let c = geoCache.get(key);
  if (!c) {
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
    g.setIndex(new THREE.BufferAttribute(m.idx, 1));
    // round things (cables, plug bodies) shade smooth across gentle bends and stay sharp at real edges
    if (smooth) g = toCreasedNormals(g, (40 * Math.PI) / 180);
    else g.computeVertexNormals(); // shading stays flat; the ambient-occlusion pass reads these
    g.computeBoundingBox();
    g.computeBoundingSphere();
    c = { g, e: null, used: buildNo };
    geoCache.set(key, c);
  }
  c.used = buildNo;
  if (edges && !c.e && m.idx.length < 90000) c.e = new THREE.EdgesGeometry(c.g, 28);
  return c;
}
/** Geometry no build has used for a while: handed back to be disposed once the new scene has been drawn. */
function sweepCache(): { dispose(): void }[] {
  const out: { dispose(): void }[] = [];
  for (const [k, c] of geoCache) if (buildNo - c.used > 2) { out.push(c.g); if (c.e) out.push(c.e); geoCache.delete(k); }
  return out;
}

// Materials, shared between meshes and kept from one build to the next. three.js keeps a compiled shader program
// only while a material that uses it is alive: making every material new and disposing the old ones first meant it
// compiled every shader again on each edit, which froze the window for seconds. A key holds everything that makes
// two materials differ, so equal ones are one material.
const matPool = new Map<string, { m: THREE.Material; used: number }>();
function pooled<T extends THREE.Material>(key: string, make: () => T): T {
  let e = matPool.get(key);
  if (!e) { e = { m: make(), used: buildNo }; matPool.set(key, e); }
  e.used = buildNo;
  return e.m as T;
}
// the highlighted copy of a material, shown on the mesh under the pointer (the shared one must not light up everywhere)
const hoverMats = new Map<THREE.Material, THREE.Material>();
function sweepMaterials(): THREE.Material[] {
  const out: THREE.Material[] = [];
  for (const [k, e] of matPool) if (buildNo - e.used > 2) {
    out.push(e.m);
    const h = hoverMats.get(e.m);
    if (h) { out.push(h); hoverMats.delete(e.m); }
    matPool.delete(k);
  }
  return out;
}

/** Fading grid on a plane (xy or xz). */
function gridMaterial(color: THREE.Color, axis: 0 | 1) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uColor: { value: color }, uMinor: { value: 10 }, uMajor: { value: 50 }, uRadius: { value: 400 }, uCenter: { value: new THREE.Vector3() }, uOpacity: { value: 1 }, uAxis: { value: axis } },
    vertexShader: 'varying vec3 vP; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform vec3 uColor; uniform float uMinor, uMajor, uRadius, uOpacity; uniform vec3 uCenter; uniform int uAxis; varying vec3 vP;
      float line(vec2 p, float s){ vec2 q = p / s; vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q); return 1.0 - min(min(g.x, g.y), 1.0); }
      void main(){ vec2 p = uAxis == 0 ? vP.xy : vP.xz; vec2 c = uAxis == 0 ? uCenter.xy : uCenter.xz;
        float fade = 1.0 - smoothstep(uRadius * 0.2, uRadius, length(p - c));
        float a = max(line(p, uMinor) * 0.16, line(p, uMajor) * 0.42) * fade * fade * uOpacity;
        if (a < 0.004) discard; gl_FragColor = vec4(uColor, a); }`,
  });
}

function backdrop(theme: 'dark' | 'light') {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 512;
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, 0, 512);
  if (theme === 'dark') { gr.addColorStop(0, '#4b545e'); gr.addColorStop(0.55, '#343b43'); gr.addColorStop(1, '#22282e'); }
  else { gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.6, '#eceff2'); gr.addColorStop(1, '#d6dce2'); }
  g.fillStyle = gr; g.fillRect(0, 0, 16, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const ease = (x: number) => 1 - Math.pow(1 - x, 3);


/**
 * A printed part's look: the fine lines of its layers (0.2 mm, across the way it printed: its own z), fading out when
 * they get too small to see so they never shimmer.
 */
function printed<T extends THREE.MeshStandardMaterial>(m: T): T {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vPrintZ;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvPrintZ = position.z;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vPrintZ;').replace('#include <color_fragment>', `#include <color_fragment>
      float lz = vPrintZ / 0.2, fw = fwidth(lz), f = fract(lz);
      float groove = 1.0 - smoothstep(0.0, 0.22 + fw, min(f, 1.0 - f));
      diffuseColor.rgb *= 1.0 - 0.13 * groove * (1.0 - smoothstep(0.25, 0.7, fw));`);
  };
  m.customProgramCacheKey = () => 'printed-layers';
  return m;
}

/** Physically based look per surface kind (boards, pads, connector shells, plastics). */
export function surface(mat: Ghost['mat'] | undefined, color: string, opacity: number, ghost: boolean, board: boolean, smooth = false): THREE.MeshStandardMaterial {
  const base = { color, flatShading: !smooth, transparent: opacity < 1, opacity, depthWrite: opacity >= 0.9, side: THREE.DoubleSide, emissive: new THREE.Color(0x4c8dff), emissiveIntensity: 0 };
  switch (mat) {
    case 'mask': return new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.42, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.3 });
    case 'trace': return new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.3, metalness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.2 });
    case 'tin': return new THREE.MeshStandardMaterial({ ...base, metalness: 0.95, roughness: 0.35 });
    case 'box': return new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.38, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.5 });
    case 'gold': return new THREE.MeshStandardMaterial({ ...base, metalness: 1, roughness: 0.3 });
    case 'metal': return new THREE.MeshStandardMaterial({ ...base, metalness: 0.9, roughness: 0.32 });
    case 'led': return new THREE.MeshStandardMaterial({ ...base, roughness: 0.12, metalness: 0 }); // a clear lens: the live view lights it
    // moulded plugs: satin plastic with a light gloss; cable jackets: matt
    case 'plug': return new THREE.MeshPhysicalMaterial({ ...base, roughness: 0.5, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.45 });
    case 'cable': return new THREE.MeshStandardMaterial({ ...base, roughness: 0.62, metalness: 0 });
    case 'red': return new THREE.MeshStandardMaterial({ ...base, roughness: 0.5, metalness: 0 });
    case 'chip': case 'black': return new THREE.MeshStandardMaterial({ ...base, roughness: 0.5, metalness: 0.05 });
    case 'silk': return new THREE.MeshStandardMaterial({ ...base, roughness: 0.75 });
    case undefined: return board || ghost ? new THREE.MeshStandardMaterial({ ...base, roughness: board ? 0.42 : 0.5, metalness: board ? 0.05 : 0 }) : printed(new THREE.MeshStandardMaterial({ ...base, roughness: 0.46, metalness: 0 }));
    default: return new THREE.MeshStandardMaterial({ ...base, roughness: 0.55 });
  }
}

/** The one 3D view's renderer, scene, lights and post chain (made the first time the view opens, then kept). */
let kept: any = null;
function makeContext() {
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 5000);
  camera.up.set(0, 0, 1);
  camera.position.set(140, -180, 150);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.14;
  controls.zoomToCursor = true;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  // light levels set with the ambient occlusion reading real normals (it used to read none and darken every part,
  // which the light made up for); the backdrop keeps its brightness
  const L = 0.4;
  scene.environmentIntensity = 1.05 * L;
  const hemi = new THREE.HemisphereLight(0xf4f7ff, 0x3a4048, 0.9 * L);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff6ec, 2.4 * L);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.6;
  key.shadow.radius = 5;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0xa9d4ff, 0.7 * L);
  rim.position.set(-300, 250, 160);
  scene.add(rim);
  const world = new THREE.Group();
  world.matrixAutoUpdate = false;
  scene.add(world);
  const floor = new THREE.Group();
  scene.add(floor);

  // HDR target with MSAA for the post chain
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, 4, 4);
  gtao.blendIntensity = 0.65;
  gtao.updateGtaoMaterial({ radius: 6, distanceExponent: 1.4, thickness: 2, scale: 1.1, samples: 12 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
  composer.addPass(gtao);
  const outline = new OutlinePass(new THREE.Vector2(4, 4), scene, camera);
  outline.edgeStrength = 4;
  outline.edgeGlow = 0.35;
  outline.edgeThickness = 1.2;
  outline.visibleEdgeColor.set('#4c8dff');
  outline.hiddenEdgeColor.set('#1d3f80');
  composer.addPass(outline);
  composer.addPass(new OutputPass());

  const c: any = { renderer, scene, camera, controls, world, floor, key, composer, gtao, outline, objs: [] as Obj[], features: [] as Feature[], frames: {} as Record<string, number[]>, dirty: true, fitted: '', tween: null, hover: null as THREE.Mesh | null, radius: 100, ranks: 0, highlights: new THREE.Group(), anim: { t: Infinity, explode: 0 }, afterFrame: [] as (() => void)[], result: null as GenResult | null };
  world.add(c.highlights);
  // the live glows and pulses stay out of the ambient-occlusion pass's own renders (a glow would darken the board round it)
  const aoRender = gtao.render.bind(gtao);
  gtao.render = (...a: Parameters<typeof aoRender>) => { c.fx?.hide(true); aoRender(...a); c.fx?.hide(false); };
  // dev-only handle for scripted checks and screenshots: point the camera, then it renders
  if (import.meta.env.DEV) (window as any).__bdView = { ctx: c, look: (pos: number[], target: number[]) => { c.tween = null; camera.position.set(pos[0], pos[1], pos[2]); controls.target.set(target[0], target[1], target[2]); controls.update(); c.dirty = true; composer.render(); }, pose: (t: number) => { c.anim = { t, explode: 0 }; applyPose(c); composer.render(); } };
  c.invalidate = () => { c.dirty = true; };
  controls.addEventListener('change', c.invalidate);
  return c;
}

export function Viewer3D({ result, mode, bed, spacing, theme, camera: camReq, installed, overhangs, layers, sel, onPick, label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const ctx = useRef<any>(null);
  // t: animation time in steps (Infinity = assembled); on: playing; until: pause when t reaches it (one step at a time)
  const [play, setPlay] = useState<{ on: boolean; t: number; n: number; until?: number }>({ on: false, t: Infinity, n: 0 });
  const [explode, setExplode] = useState(0);
  // the live touches (blinking lights, pulses along cables): on unless turned off, remembered
  const [liveOn, setLiveOn] = useState(() => { try { return localStorage.getItem('boarddock.live') !== 'off'; } catch { return true; } });
  const liveOnRef = useRef(liveOn);
  liveOnRef.current = liveOn;
  useEffect(() => { try { localStorage.setItem('boarddock.live', liveOn ? 'on' : 'off'); } catch { /* private window */ } const c = ctx.current; if (c) { c.liveOn = liveOn; c.fx?.setLive(liveOn); c.invalidate(); } }, [liveOn]);
  const cb = useRef({ onPick, label });
  cb.current = { onPick, label };

  // ---------------------------------------------------------------- setup (the renderer is made once and kept)
  useEffect(() => {
    const el = host.current!;
    // the renderer, scene and post chain outlive the view: switching to Wiring or the board editor and back keeps
    // its compiled shaders, so coming back to 3D doesn't compile them all again
    const c = kept ?? (kept = makeContext());
    c.liveOn = liveOnRef.current;
    ctx.current = c;
    const { renderer, camera, controls, composer } = c;
    el.appendChild(renderer.domElement);
    c.dirty = true;
    const invalidate = c.invalidate as () => void;

    const ro = new ResizeObserver(() => {
      const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
      renderer.setSize(w, h);
      composer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      invalidate();
    });
    ro.observe(el);

    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (c.tween) {
        const k = Math.min(1, (now - c.tween.t0) / c.tween.dur), e = ease(k);
        camera.position.lerpVectors(c.tween.p0, c.tween.p1, e);
        controls.target.lerpVectors(c.tween.q0, c.tween.q1, e);
        if (k >= 1) c.tween = null;
        c.dirty = true;
      }
      if (c.onFrame?.(now)) c.dirty = true;
      if (c.fx?.tick(now)) c.dirty = true;
      if (c.intro) {
        const k = (now - c.intro.t0) / 700;
        if (!Number.isFinite(c.anim?.t ?? Infinity)) for (const o of c.intro.objs as Obj[]) growTo(o.mesh, k);
        if (k >= 1) c.intro = null;
        c.dirty = true;
      }
      const moved = controls.update();
      if (!c.dirty && !moved) return;
      c.dirty = false;
      composer.render();
      c.placeLabels?.();
      // what the scene before this one used, freed only now it has been drawn without it
      if (c.afterFrame.length) for (const f of c.afterFrame.splice(0)) f();
    };
    raf = requestAnimationFrame(loop);

    // picking
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const hitAt = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const targets = (c.objs as Obj[]).filter((o) => o.mesh.visible && o.tag && o.tag.kind !== 'link' && o.tag.kind !== 'rivet').map((o) => o.mesh);
      const hits = ray.intersectObjects(targets, false);
      // prefer solid parts over see-through plugs when both are hit
      const solid = hits.find((h) => !(h.object as THREE.Mesh).userData.ghost || (h.object as any).userData.tag?.kind === 'board');
      const h = solid ?? hits[0];
      if (!h) return null;
      const o = (c.objs as Obj[]).find((x) => x.mesh === h.object)!;
      return { o, point: h.point };
    };
    const itemOf = (o: Obj, point: THREE.Vector3): SelItem | null => {
      const t = o.tag!;
      switch (t.kind) {
        case 'holder': case 'rod': {
          const f = featureAt(c, o, point);
          return f ? featureItem({ kind: f.kind, module: f.module, refs: f.refs }) : { kind: 'module', id: t.module! };
        }
        case 'board': case 'parts': return { kind: 'module', id: t.module! };
        case 'cap': return featureItem({ kind: 'cap', module: t.module!, refs: t.refs });
        case 'plug': return featureItem({ kind: 'plug', module: t.module!, refs: t.refs });
        case 'clip': return featureItem({ kind: 'clip', module: t.module! });
        case 'stand': return featureItem({ kind: 'stand', module: t.module! });
        case 'shoe': case 'socket': return t.mount ? { kind: 'mount', id: t.mount } : null;
        case 'rail': return t.rail ? { kind: 'rail', id: t.rail } : null;
        case 'cable': return t.refs?.[0] ? { kind: 'link', id: t.refs[0] } : null;
        case 'railstand': return t.refs?.[0] ? { kind: 'railstand', id: t.refs[0] } : null;
        default: return null;
      }
    };
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || e.button !== 0) { down = null; return; }
      down = null;
      if (c.mode !== 'assembly') return;
      const h = hitAt(e);
      cb.current.onPick(h ? itemOf(h.o, h.point) : null, e.shiftKey || e.metaKey || e.ctrlKey);
    };
    let hoverT = 0;
    const onMove = (e: PointerEvent) => {
      if (down || c.mode !== 'assembly' || e.buttons) return;
      const now = performance.now();
      if (now - hoverT < 50) return;
      hoverT = now;
      const h = hitAt(e);
      const it = h ? itemOf(h.o, h.point) : null;
      const m = h?.o.mesh ?? null;
      if (m !== c.hover) {
        setEmissive(c.hover, 0);
        c.hover = m;
        setEmissive(m, 1);
        invalidate();
      }
      const el2 = tip.current;
      if (el2) {
        if (it) {
          const d = cb.current.label(it);
          el2.innerHTML = `${escapeHtml(d.title)}<small>${escapeHtml(d.sub)}</small>`;
          const r = renderer.domElement.getBoundingClientRect();
          el2.style.left = `${e.clientX - r.left}px`;
          el2.style.top = `${e.clientY - r.top}px`;
          el2.style.display = 'block';
        } else el2.style.display = 'none';
      }
      renderer.domElement.style.cursor = it ? 'pointer' : '';
    };
    const onLeave = () => { if (tip.current) tip.current.style.display = 'none'; setEmissive(c.hover, 0); c.hover = null; invalidate(); };
    const onDbl = (e: MouseEvent) => {
      const h = hitAt(e as PointerEvent);
      if (!h) return;
      const box = new THREE.Box3().setFromObject(h.o.mesh);
      flyTo(c, box, null, 1.9);
    };
    const dom = renderer.domElement;
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointerup', onUp);
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerleave', onLeave);
    dom.addEventListener('dblclick', onDbl);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      dom.removeEventListener('pointerdown', onDown);
      dom.removeEventListener('pointerup', onUp);
      dom.removeEventListener('pointermove', onMove);
      dom.removeEventListener('pointerleave', onLeave);
      dom.removeEventListener('dblclick', onDbl);
      // kept for the next time the view opens: only what belongs to this page goes
      setEmissive(c.hover, 0);
      c.hover = null;
      c.onFrame = null;
      c.placeLabels = undefined;
      if (dom.parentElement === el) el.removeChild(dom);
      ctx.current = null;
    };
  }, []);

  // ---------------------------------------------------------------- theme
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    c.scene.background?.dispose?.();
    c.scene.background = backdrop(theme);
    c.theme = theme;
    c.outline.visibleEdgeColor.set(theme === 'dark' ? '#5b9bff' : '#2563eb');
    c.invalidate();
  }, [theme]);

  // ---------------------------------------------------------------- content
  // The new scene is made beside the one on screen. Any shader it needs that isn't compiled yet is compiled first
  // (in the background where the browser can), while the old scene stays up; then the two are swapped, and what
  // only the old one used is freed after the new one's first frame, so equal shaders are never compiled twice.
  const latest = useRef({ layers, sel });
  latest.current = { layers, sel };
  const [built, setBuilt] = useState(0);
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    let live = true;
    buildNo++;
    const next = prepare(c, result, mode, bed, spacing, theme, installed, !!overhangs);
    const commit = () => {
      // a newer scene took over (it clears the flag when drawn), or the view closed while this one compiled
      if (!live) { next.drop(); if (!ctx.current) store.set({ rendering: false }); return; }
      swapIn(c, next, result, mode, !!installed, theme);
      applyPose(c);
      applyLayers(c, latest.current.layers);
      applySel(c, latest.current.sel);
      c.invalidate();
      setBuilt((n) => n + 1);
    };
    const props = c.renderer.properties;
    const fresh = next.materials.some((m) => { const pr = props.get(m).currentProgram; return !pr || !pr.isReady(); });
    if (!fresh) { commit(); return () => { live = false; }; }
    store.set({ rendering: true });
    c.renderer.compileAsync(next.group, c.camera, c.scene).then(commit, commit);
    return () => { live = false; };
  }, [result, mode, bed[0], bed[1], spacing, theme, installed, overhangs]);

  useEffect(() => { const c = ctx.current; if (c) { applyLayers(c, layers); c.invalidate(); } }, [layers]);

  // ---------------------------------------------------------------- cable numbers: a badge on every cable
  const labelsEl = useRef<HTMLDivElement>(null);
  const showLabels = mode === 'assembly' && layers.labels !== false && layers.cables !== false && (!Number.isFinite(play.t) || play.t >= play.n);
  useEffect(() => {
    const c = ctx.current, host = labelsEl.current;
    if (!c || !host) return;
    host.replaceChildren();
    const list = showLabels ? ((c.result as GenResult | null)?.report.cables ?? []).filter((x) => x.mid && x.no) : [];
    const compact = list.length > 8; // a busy rack shows the numbers; the words come on hover
    const items = list.map((x) => {
      const el = document.createElement('button');
      el.className = `clabel${compact ? ' compact' : ''}`;
      el.style.setProperty('--k', KIND_COLOR[x.kind]);
      el.title = `Cable ${x.no}: ${x.label ?? ''} · ${Math.round(x.length / 10)} cm, buy ${x.buy} m`;
      el.innerHTML = `<b>${x.no}</b><span></span>`;
      (el.lastChild as HTMLElement).textContent = badgeText(x.label ?? '');
      el.onclick = (e) => { e.stopPropagation(); cb.current.onPick({ kind: 'link', id: x.id }, e.shiftKey || e.metaKey); };
      host.appendChild(el);
      // its cable's meshes: the label shows only once the cable is there (in the assembly steps)
      const meshes = (c.objs as Obj[]).filter((o) => o.tag?.kind === 'cable' && o.tag.refs?.[0] === x.id).map((o) => o.mesh);
      return { el, p: new THREE.Vector3(x.mid![0], x.mid![1], x.mid![2]), meshes };
    });
    const v = new THREE.Vector3();
    c.placeLabels = () => {
      const w = host.clientWidth, h = host.clientHeight;
      const at = items.map((it) => {
        v.copy(it.p).applyMatrix4(c.world.matrixWorld).project(c.camera);
        const vis = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 && (!it.meshes.length || it.meshes.some((m) => m.visible));
        return { it, vis, x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, bw: it.el.offsetWidth || 120, bh: it.el.offsetHeight || 22 };
      });
      // nearest labels first keep their spot; the others step down (or up) until they are clear
      const placed: number[][] = [];
      for (const a of at.filter((q) => q.vis).sort((p, q) => p.y - q.y)) {
        let y = a.y;
        for (let k = 0; k < 8; k++) {
          const r = [a.x - a.bw / 2 - 3, y - a.bh / 2 - 2, a.x + a.bw / 2 + 3, y + a.bh / 2 + 2];
          const hit = placed.find((q) => r[0] < q[2] && q[0] < r[2] && r[1] < q[3] && q[1] < r[3]);
          if (!hit) break;
          y = hit[3] + a.bh / 2 + 3;
        }
        placed.push([a.x - a.bw / 2 - 3, y - a.bh / 2 - 2, a.x + a.bw / 2 + 3, y + a.bh / 2 + 2]);
        a.y = y;
      }
      for (const a of at) {
        a.it.el.style.display = a.vis ? '' : 'none';
        if (a.vis) a.it.el.style.transform = `translate(${a.x}px, ${a.y}px) translate(-50%, -50%)`;
      }
    };
    c.invalidate();
    return () => { c.placeLabels = undefined; host.replaceChildren(); };
  }, [built, showLabels]);
  useEffect(() => { const c = ctx.current; if (c) { applySel(c, sel); c.invalidate(); } }, [sel, built]);

  // ---------------------------------------------------------------- animation and explode
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    c.anim = { t: play.t, explode };
    applyPose(c);
    c.invalidate();
  }, [play.t, explode, built]);
  useEffect(() => {
    const c = ctx.current;
    if (!c || !play.on) return;
    let last = performance.now();
    c.onFrame = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setPlay((p) => {
        if (!p.on) return p;
        const t = p.t + dt * 1.1;
        if (p.until != null && t >= p.until) return { on: false, t: p.until, n: p.n };
        return t >= p.n + 0.001 ? { on: false, t: p.n, n: p.n } : { ...p, t };
      });
      return true;
    };
    return () => { if (c) c.onFrame = null; };
  }, [play.on]);

  // camera presets
  useEffect(() => {
    const c = ctx.current;
    if (!c || !camReq) return;
    const box = contentBox(c);
    if (box.isEmpty()) return;
    flyTo(c, box, new THREE.Vector3(...camReq.dir), 1.3);
  }, [camReq?.n]);

  const nSteps = () => ctx.current?.ranks ?? 0;
  const started = Number.isFinite(play.t);
  const startPlay = () => {
    const n = nSteps();
    if (!n) return;
    setExplode(0);
    setPlay(started && play.t < n ? { on: true, t: play.t, n } : { on: true, t: 0, n });
  };
  const stepTo = (k: number) => { const n = nSteps(); setExplode(0); setPlay({ on: false, t: Math.max(0, Math.min(n, k)), n }); };
  const nextStep = () => { const n = nSteps(); if (!n) return; setExplode(0); const from = started ? play.t : 0; setPlay({ on: true, t: from >= n ? 0 : from, n, until: Math.min(n, Math.floor(from + 1e-6) + 1) }); };
  const stepIdx = started ? Math.max(0, Math.min(play.n - 1, Math.ceil(play.t - 1e-6) - 1)) : 0;
  const caption = (() => {
    if (!started || !ctx.current) return '';
    const seq = ctx.current.phases?.[stepIdx];
    const text = (ctx.current.result as GenResult | null)?.steps?.find((s) => s.seq === seq)?.text;
    if (!text && import.meta.env.DEV) console.warn('assembly step without a caption', seq);
    return text ?? 'Fit the parts that are moving now.';
  })();

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
      <div ref={labelsEl} className="clabels" />
      <div ref={tip} className="hovertip floating" style={{ display: 'none' }} />
      {mode === 'assembly' && result && (
        <div className="player floating" style={{ position: 'absolute', left: 12, bottom: 12, zIndex: 6 }}>
          <button className="play" title={play.on ? 'Pause' : started ? 'Carry on' : 'Play the assembly, step by step'} onClick={() => (play.on ? setPlay({ ...play, on: false, until: undefined }) : startPlay())}>
            {play.on ? <svg viewBox="0 0 16 16"><rect x="3.5" y="3" width="3" height="10" rx="1" fill="currentColor" /><rect x="9.5" y="3" width="3" height="10" rx="1" fill="currentColor" /></svg> : <svg viewBox="0 0 16 16"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor" /></svg>}
          </button>
          {started ? (
            <>
              <button className="stepbtn" title="Previous step" disabled={play.t <= 0} onClick={() => stepTo(Math.ceil(play.t - 1e-6) - 1)}>‹</button>
              <button className="stepbtn" title="Next step" disabled={play.t >= play.n} onClick={nextStep}>›</button>
              <span className="phase"><b>{stepIdx + 1}/{play.n}</b> {caption}</span>
              <button className="stepbtn" title="Show it assembled" onClick={() => setPlay({ on: false, t: Infinity, n: play.n })}>✕</button>
            </>
          ) : (
            <>
              <button className="stepbtn wide" title="Step through the assembly one step at a time" onClick={nextStep}>Steps</button>
              <button className={`stepbtn wide live${liveOn ? ' on' : ''}`} aria-pressed={liveOn} title={liveOn ? 'Switched on: lights blink and pulses run along the cables. Click to hold still.' : 'Switch it on: LEDs blink the way they do, boards without power stay dark, pulses run along the cables'} onClick={() => setLiveOn(!liveOn)}><i />Live</button>
              <label title="Pull the parts apart along the way they go together">Explode<input type="range" min={0} max={1} step={0.01} value={explode} onChange={(e) => setExplode(+e.target.value)} /></label>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- building a scene

/** A scene made beside the one on screen, not shown yet. */
interface Next {
  fx?: { gh: Ghost; mesh: THREE.Object3D }[]; // ghosts with live touches (lights, pulses, fading leads) and their meshes
  group: THREE.Group; // every new mesh, placed as it will be in the world (for its bounds, and to compile ahead)
  objs: Obj[];
  floor: THREE.Object3D[];
  grid: THREE.Mesh | null;
  shadow: THREE.Mesh | null;
  box: THREE.Box3;
  worldMatrix: THREE.Matrix4;
  ranks: number;
  phases: number[];
  materials: THREE.Material[];
  own: { dispose(): void }[]; // made for this scene alone (not cached): freed when it goes
  drop(): void;
}

function prepare(c: any, result: GenResult | null, mode: 'assembly' | 'print', bed: V2, spacing: number, theme: 'dark' | 'light', installed: 'h' | 'v' | null | undefined, overhangs: boolean): Next {
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  const objs: Obj[] = [], floor: THREE.Object3D[] = [], own: { dispose(): void }[] = [];
  const mats = new Set<THREE.Material>();
  const worldMatrix = new THREE.Matrix4();
  const next: Next = { group, objs, floor, grid: null, shadow: null, box: new THREE.Box3(), worldMatrix, ranks: 0, phases: [], materials: [], own, drop: () => { for (const d of own) d.dispose(); } };
  if (!result) return next;
  const edgeCol = theme === 'dark' ? 0x0a0d10 : 0x2a3138;

  const add = (m: MeshData, color: string, opacity: number, matrix: number[] | null, tag: PickTag | undefined, anim: Anim | undefined, ghost: boolean, edges = true, kind?: Ghost['mat'], smooth = false) => {
    const cg = geom(m, edges && opacity >= 1 && !smooth, smooth);
    const board = tag?.kind === 'board';
    const mat = pooled(`s|${kind ?? ''}|${color}|${opacity}|${board}|${smooth}`, () => surface(kind, color, opacity, ghost, board, smooth));
    mats.add(mat);
    const mesh = new THREE.Mesh(cg.g, mat);
    mesh.castShadow = opacity >= 0.8;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    if (matrix) mesh.matrix.fromArray(matrix);
    mesh.userData = { tag, ghost, cached: true };
    if (cg.e && edges && opacity >= 1) {
      const em = pooled(`e|${edgeCol}`, () => new THREE.LineBasicMaterial({ color: edgeCol, transparent: true, opacity: 0.22 }));
      mats.add(em);
      const e = new THREE.LineSegments(cg.e, em);
      e.matrixAutoUpdate = false;
      e.userData.cached = true;
      mesh.add(e);
    }
    group.add(mesh);
    objs.push({ mesh, tag, anim, rank: 0, base: mesh.matrix.clone(), ghost, moves: [], show: 0 });
  };
  const addFloor = (o: THREE.Mesh | THREE.LineSegments, m: THREE.Material) => { mats.add(m); own.push(o.geometry); floor.push(o); };

  if (mode === 'assembly') {
    for (const p of [...result.parts, ...(result.display ?? [])]) {
      if (p.toAssembly[14] <= -300) continue;
      const m = p.displayMesh ?? p.mesh;
      add(m, p.color, 1, p.toAssembly, p.tag, p.anim, false);
      (p.instances ?? []).forEach((T, k) => add(m, p.color, 1, T, p.tags?.[k] ?? p.tag, p.anims?.[k] ?? p.anim, false));
    }
    next.fx = [];
    for (const gh of result.ghosts) {
      add(gh.mesh, gh.color, gh.opacity, null, gh.tag, gh.anim, true, false, gh.mat, !!gh.smooth);
      if (gh.fx) next.fx.push({ gh, mesh: objs[objs.length - 1].mesh });
    }
    // animation ranks: every distinct step (moves and appearances) in order
    const movesOf = (a?: Anim): Motion[] => [...(a?.pre ?? []), { seq: a?.seq ?? 0, dir: a?.dir ?? [0, 0, 1], dist: a?.dist, style: a?.style, rot: a?.rot }];
    const seqs = [...new Set(objs.flatMap((o) => [...movesOf(o.anim).map((m) => m.seq), ...(o.anim?.show != null ? [o.anim.show] : [])]))].sort((a, b) => a - b);
    const rk = (s: number) => seqs.indexOf(s);
    for (const o of objs) {
      const mv = movesOf(o.anim);
      o.moves = mv.map((m) => ({ rank: rk(m.seq), dir: m.dir, dist: m.dist, style: m.style, rot: m.rot }));
      o.rank = rk(o.anim?.seq ?? 0);
      o.show = o.anim?.show != null ? rk(o.anim.show) : Math.min(...o.moves.map((m) => m.rank));
    }
    // the cables of one step are drawn out one after another (the wires of one cable together)
    const byRank = new Map<number, string[]>();
    for (const o of objs) if (o.anim?.grow) { const k = o.tag?.refs?.[0] ?? o.mesh.uuid, l = byRank.get(o.rank) ?? byRank.set(o.rank, []).get(o.rank)!; if (!l.includes(k)) l.push(k); }
    for (const o of objs) if (o.anim?.grow) { const l = byRank.get(o.rank)!, k = o.tag?.refs?.[0] ?? o.mesh.uuid; o.lag = l.length > 1 ? (0.45 * l.indexOf(k)) / (l.length - 1) : 0; }
    next.ranks = seqs.length;
    next.phases = seqs;
    const cf = result.report.clipFrame;
    if (installed && cf) {
      const W = installed === 'h' ? [0, -1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 0, 0, 0, 0, 1] : [0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      worldMatrix.copy(new THREE.Matrix4().fromArray(W).multiply(new THREE.Matrix4().fromArray(rigidInverse(cf))));
    }
  } else {
    const plates: Plate[] = packPlates(result.parts, bed, spacing);
    const gap = 30;
    const bedMat = pooled(`bed|${theme}`, () => new THREE.MeshStandardMaterial({ color: theme === 'dark' ? 0x1c2229 : 0xd9dee4, roughness: 0.85, metalness: 0.1 }));
    const borderMat = pooled('bedline', () => new THREE.LineBasicMaterial({ color: 0x4c8dff, transparent: true, opacity: 0.8 }));
    plates.forEach((pl, i) => {
      const ox = i * (bed[0] + gap);
      const bedMesh = new THREE.Mesh(new THREE.PlaneGeometry(bed[0], bed[1]), bedMat);
      bedMesh.position.set(ox + bed[0] / 2, bed[1] / 2, -0.05);
      bedMesh.receiveShadow = true;
      addFloor(bedMesh, bedMat);
      const border = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(bed[0], bed[1])), borderMat);
      border.position.copy(bedMesh.position);
      addFloor(border, borderMat);
      for (const it of pl.items) {
        const m = placedMesh(it, bed, pl.used);
        const pos = new Float32Array(m.pos);
        for (let k = 0; k < pos.length; k += 3) pos[k] += ox;
        add({ pos, idx: m.idx }, it.part.color, overhangs ? 0.35 : 1, null, undefined, undefined, false);
        if (overhangs) {
          const q = printability({ pos, idx: m.idx });
          for (const [k, col] of [[1, 0xff3b5c], [2, 0xffb020]] as const) {
            const tri: number[] = [];
            q.kind.forEach((v, t) => { if (v === k) tri.push(m.idx[3 * t], m.idx[3 * t + 1], m.idx[3 * t + 2]); });
            if (!tri.length) continue;
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            g.setIndex(tri);
            const om = pooled(`over|${col}`, () => new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
            addFloor(new THREE.Mesh(g, om), om);
          }
        }
      }
    });
  }

  // content box (world frame), and the floor or wall under it
  group.matrix.copy(worldMatrix);
  group.updateMatrixWorld(true);
  for (const o of objs) next.box.expandByObject(o.mesh);
  if (!next.box.isEmpty()) {
    const wall = mode === 'assembly' && !!installed;
    const size = next.box.getSize(new THREE.Vector3());
    const R = Math.max(size.x, size.y, size.z) * 1.4 + 120;
    const gm = pooled(`grid|${wall ? 1 : 0}`, () => gridMaterial(new THREE.Color(), wall ? 1 : 0));
    const sm = pooled(`shadow|${theme}`, () => new THREE.ShadowMaterial({ opacity: theme === 'dark' ? 0.38 : 0.2 }));
    next.grid = new THREE.Mesh(new THREE.PlaneGeometry(R * 2.2, R * 2.2), gm);
    next.shadow = new THREE.Mesh(new THREE.PlaneGeometry(R * 2, R * 2), sm);
    next.shadow.receiveShadow = true;
    addFloor(next.grid, gm);
    addFloor(next.shadow, sm);
  }
  // the floor goes in the compile group too (its own frame: it is not under the world matrix)
  const fl = new THREE.Group();
  for (const f of floor) fl.add(f);
  group.add(fl);
  next.materials = [...mats];
  return next;
}

/** Put a prepared scene on screen in place of the old one; the old one's leftovers go after the next frame. */
function swapIn(c: any, next: Next, result: GenResult | null, mode: 'assembly' | 'print', installed: boolean, theme: 'dark' | 'light') {
  const { world, camera } = c;
  setEmissive(c.hover, 0);
  c.hover = null;
  for (const o of c.objs as Obj[]) world.remove(o.mesh);
  const dead: { dispose(): void }[] = [...(c.own ?? [])];
  for (const o of [...c.floor.children]) c.floor.remove(o);
  c.fx?.dispose();
  c.objs = next.objs;
  c.own = next.own;
  // the live touches on the new scene; a cable that wasn't there before draws itself out from plug to plug
  c.fx = next.fx?.length ? liveFx(next.fx, c.liveOn !== false) : null;
  const was: Set<string> | undefined = c.cableIds;
  const cables = next.objs.filter((o) => o.tag?.kind === 'cable');
  const fresh = was ? cables.filter((o) => o.anim?.grow && !was.has(o.tag!.refs?.[0] ?? '')) : [];
  c.cableIds = new Set(cables.map((o) => o.tag!.refs?.[0] ?? ''));
  c.intro = fresh.length && fresh.length <= 12 ? { t0: performance.now(), objs: fresh } : null;
  for (const o of next.objs) world.add(o.mesh);
  for (const f of next.floor) c.floor.add(f);
  world.matrix.copy(next.worldMatrix);
  c.mode = mode;
  c.result = result;
  c.features = result?.report.features ?? [];
  c.frames = result?.report.frames ?? {};
  c.ranks = mode === 'assembly' ? next.ranks : 0;
  c.phases = next.phases;
  dead.push(...sweepCache(), ...sweepMaterials());
  c.afterFrame.push(() => { for (const d of dead) d.dispose(); store.set({ rendering: false }); });
  world.updateMatrixWorld(true);
  const box = next.box;
  if (box.isEmpty()) return;

  // floor or wall, lights
  const size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  c.radius = size.length() / 2;
  const wall = mode === 'assembly' && installed;
  const R = Math.max(size.x, size.y, size.z) * 1.4 + 120;
  const grid = next.grid!, shadow = next.shadow!;
  if (wall) {
    grid.rotation.x = Math.PI / 2; shadow.rotation.x = Math.PI / 2;
    grid.position.set(ctr.x, 0.3, ctr.z); shadow.position.set(ctr.x, 0.2, ctr.z);
  } else {
    grid.position.set(ctr.x, ctr.y, box.min.z - 0.12); shadow.position.set(ctr.x, ctr.y, box.min.z - 0.06);
  }
  const u = (grid.material as THREE.ShaderMaterial).uniforms;
  u.uColor.value.set(theme === 'dark' ? 0x7d8894 : 0x9aa5b1);
  u.uRadius.value = R;
  u.uCenter.value.copy(ctr);
  u.uMinor.value = size.length() > 600 ? 50 : 10;
  u.uMajor.value = size.length() > 600 ? 250 : 50;
  const k = c.key as THREE.DirectionalLight;
  const ldir = wall ? new THREE.Vector3(0.35, -1, 0.75) : new THREE.Vector3(0.45, -0.5, 1);
  k.target.position.copy(ctr);
  k.position.copy(ctr.clone().add(ldir.normalize().multiplyScalar(Math.max(size.length(), 60) * 1.5)));
  const S = size.length() * 0.62 + 20;
  Object.assign(k.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: Math.max(size.length(), 60) * 4 });
  k.shadow.camera.updateProjectionMatrix();
  c.gtao.updateGtaoMaterial({ radius: Math.max(3, Math.min(14, size.length() / 40)) });

  const fitKey = `${mode}:${installed}:${[...box.min.toArray(), ...box.max.toArray()].map((v) => Math.round(v / 25)).join(',')}`;
  if (c.fitted !== fitKey) {
    c.fitted = fitKey;
    const dir = wall ? new THREE.Vector3(0.42, -1, 0.38) : mode === 'assembly' ? new THREE.Vector3(0.6, -0.8, 0.62) : new THREE.Vector3(0.1, -0.72, 0.9);
    camera.near = Math.max(0.5, size.length() / 300);
    camera.far = size.length() * 30 + 2000;
    camera.updateProjectionMatrix();
    flyTo(c, box, dir, 1.25, !c.didFit);
    c.didFit = true;
  }
}

// ---------------------------------------------------------------- helpers
function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}

/** Light up the mesh under the pointer: it wears a lit copy of its (shared) material until the pointer moves on. */
function setEmissive(m: THREE.Mesh | null, level: number) {
  if (!m) return;
  const base = (m.userData.baseMat ?? m.material) as THREE.Material;
  if (!level) { m.material = base; delete m.userData.baseMat; return; }
  if (!(base as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
  let lit = hoverMats.get(base);
  if (!lit) {
    const h = base.clone() as THREE.MeshStandardMaterial;
    h.emissive = new THREE.Color(0x4c8dff);
    h.emissiveIntensity = 0.18;
    hoverMats.set(base, (lit = h));
  }
  m.userData.baseMat = base;
  m.material = lit;
}

function contentBox(c: any) {
  const box = new THREE.Box3();
  for (const o of c.objs as Obj[]) if (o.mesh.visible) box.expandByObject(o.mesh);
  return box;
}

function flyTo(c: any, box: THREE.Box3, dir: THREE.Vector3 | null, k = 1.3, instant = false) {
  const cam = c.camera as THREE.PerspectiveCamera;
  const center = box.getCenter(new THREE.Vector3());
  const r = Math.max(8, box.getSize(new THREE.Vector3()).length() / 2);
  const d = (dir ?? cam.position.clone().sub(c.controls.target)).clone().normalize();
  const aspect = Math.min(1, cam.aspect || 1);
  const dist = (r / Math.sin(((cam.fov / 2) * Math.PI) / 180)) * k * 0.72 / Math.sqrt(aspect);
  const p1 = center.clone().add(d.multiplyScalar(dist));
  if (instant) { cam.position.copy(p1); c.controls.target.copy(center); c.tween = null; c.invalidate(); return; }
  c.tween = { p0: cam.position.clone(), p1, q0: c.controls.target.clone(), q1: center, t0: performance.now(), dur: 480 };
}

/** Place every object: assembly animation (parts move in step by step, cables grow along their route) or the
 * exploded view (every part pulled back along the moves it makes). */
function applyPose(c: any) {
  const { t, explode } = c.anim ?? { t: Infinity, explode: 0 };
  const n = Math.max(1, c.ranks);
  const D = Math.max(35, c.radius * 0.75);
  const off = new THREE.Vector3(), M = new THREE.Matrix4(), R = new THREE.Matrix4();
  for (const o of c.objs as Obj[]) {
    const grow = !!o.anim?.grow;
    let shown = true, g = 1;
    off.set(0, 0, 0);
    R.identity();
    if (Number.isFinite(t)) {
      if (t - o.show <= 0) shown = false;
      if (grow) g = Math.max(0, Math.min(1, (t - o.rank - (o.lag ?? 0)) / 0.55)); // each cable of a step in turn, drawn out along its way
      else for (const m of o.moves) {
        const dist = m.dist ?? D, k = remaining(m.style, t - m.rank, dist);
        if (k !== 0) off.addScaledVector(new THREE.Vector3(m.dir[0], m.dir[1], m.dir[2]), dist * k);
        // a part that turns as it goes in (a board tipped in, a shoe swung down): about its axis, square once seated
        if (m.rot && k > 0) {
          const at = new THREE.Vector3(...m.rot.at), ax = new THREE.Vector3(...m.rot.axis).normalize();
          const Rm = new THREE.Matrix4().makeTranslation(at.x, at.y, at.z).multiply(new THREE.Matrix4().makeRotationAxis(ax, (m.rot.deg * Math.PI / 180) * Math.min(1, k))).multiply(new THREE.Matrix4().makeTranslation(-at.x, -at.y, -at.z));
          R.premultiply(Rm);
        }
      }
    } else if (explode > 0) {
      if (grow) shown = false;
      else for (const m of o.moves) {
        const k = m.dist != null ? explode : explode * (0.35 + (0.65 * m.rank) / Math.max(1, n - 1));
        off.addScaledVector(new THREE.Vector3(m.dir[0], m.dir[1], m.dir[2]), (m.dist ?? D) * k);
      }
    }
    if (grow) {
      growTo(o.mesh, g);
      if (g <= 0) shown = false;
    }
    o.mesh.userData.animHidden = !shown;
    o.mesh.matrix.copy(M.makeTranslation(off.x, off.y, off.z).multiply(R).multiply(o.base));
    o.mesh.userData.offset = off.clone();
    o.mesh.visible = shown && !o.mesh.userData.layerHidden;
  }
  c.world.updateMatrixWorld(true);
  placeHighlights(c);
}

function applyLayers(c: any, layers: Record<Layer, boolean>) {
  for (const o of c.objs as Obj[]) {
    const hidden = o.tag ? layers[LAYER[o.tag.kind]] === false : false;
    o.mesh.userData.layerHidden = hidden;
    o.mesh.visible = !hidden && !o.mesh.userData.animHidden;
  }
}

/** The feature under a point on a holder (smallest box that contains it). */
function featureAt(c: any, o: Obj, point: THREE.Vector3): Feature | null {
  const mid = o.tag?.module;
  const F = mid ? c.frames?.[mid] : null;
  if (!mid || !F) return null;
  const inWorld = new THREE.Matrix4().copy(c.world.matrixWorld).invert();
  const local = point.clone().applyMatrix4(inWorld).sub(o.mesh.userData.offset ?? new THREE.Vector3());
  const hp = local.applyMatrix4(new THREE.Matrix4().fromArray(rigidInverse(F)));
  let best: Feature | null = null, bv = Infinity;
  for (const f of c.features as Feature[]) {
    if (f.module !== mid || f.kind === 'seat' || f.kind === 'rim') continue;
    const b = f.box, pad = 0.6;
    if (hp.x < b[0] - pad || hp.x > b[3] + pad || hp.y < b[1] - pad || hp.y > b[4] + pad || hp.z < b[2] - pad || hp.z > b[5] + pad) continue;
    const v = (b[3] - b[0]) * (b[4] - b[1]) * (b[5] - b[2]);
    if (v < bv) { bv = v; best = f; }
  }
  return best;
}

/** Outline selected objects; draw a box round selected holder features. */
function applySel(c: any, sel: SelItem[]) {
  const picked: THREE.Object3D[] = [];
  const hl = c.highlights as THREE.Group;
  for (const o of [...hl.children]) { hl.remove(o); (o as any).geometry?.dispose?.(); (o as any).material?.dispose?.(); }
  c.selFeatures = [];
  for (const it of sel) {
    for (const o of c.objs as Obj[]) {
      const t = o.tag;
      if (!t) continue;
      const hit = it.kind === 'module' ? t.module === it.id && ['holder', 'rod', 'board', 'parts', 'clip'].includes(t.kind)
        : it.kind === 'mount' ? t.mount === it.id
        : it.kind === 'rail' ? t.rail === it.id
        : it.kind === 'link' ? t.kind === 'cable' && (t.refs ?? []).includes(it.id)
        : it.kind === 'railstand' ? t.kind === 'railstand' && (t.refs ?? []).includes(it.id)
        : it.kind === 'feature' && (it.fkind === 'cap' || it.fkind === 'plug' || it.fkind === 'clip' || it.fkind === 'stand') ? t.kind === it.fkind && t.module === it.module && (!it.refs?.length || (t.refs ?? []).some((r) => it.refs!.includes(r)))
        : false;
      if (hit) picked.push(o.mesh);
    }
    if (it.kind === 'feature' && !['cap', 'plug', 'clip', 'stand'].includes(it.fkind ?? '')) {
      const f = (c.features as Feature[]).find((x) => x.module === it.module && x.kind === it.fkind && (x.refs ?? []).join(',') === (it.refs ?? []).join(','));
      if (f) c.selFeatures.push(f);
    }
  }
  c.outline.selectedObjects = picked;
  placeHighlights(c);
}

function placeHighlights(c: any) {
  const hl = c.highlights as THREE.Group;
  for (const o of [...hl.children]) { hl.remove(o); (o as any).geometry?.dispose?.(); (o as any).material?.dispose?.(); }
  for (const f of (c.selFeatures ?? []) as Feature[]) {
    const F = c.frames?.[f.module];
    if (!F) continue;
    const holder = (c.objs as Obj[]).find((o) => o.tag?.kind === 'holder' && o.tag.module === f.module);
    const b = f.box, pad = 0.8;
    const g = new THREE.BoxGeometry(b[3] - b[0] + 2 * pad, b[4] - b[1] + 2 * pad, b[5] - b[2] + 2 * pad);
    const M = new THREE.Matrix4().makeTranslation(holder?.mesh.userData.offset ?? new THREE.Vector3()).multiply(new THREE.Matrix4().fromArray(F)).multiply(new THREE.Matrix4().makeTranslation((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2));
    const fill = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x4c8dff, transparent: true, opacity: 0.18, depthWrite: false }));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: 0x75a8ff, transparent: true, opacity: 0.95, depthTest: false }));
    for (const m of [fill, edges]) { m.matrixAutoUpdate = false; m.matrix.copy(M); m.renderOrder = 10; hl.add(m); }
  }
  hl.updateMatrixWorld(true);
}
