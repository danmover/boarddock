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
import type { Anim, Feature, GenResult, MeshData, PickTag, V2 } from '../model/types';
import { packPlates, placedMesh, printability, type Plate } from '../cad/export';
import type { Layer, SelItem } from '../state';
import { featureItem } from './pickOps';

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
  shoe: 'docks', socket: 'docks', cap: 'caps', rail: 'rails', board: 'boards', parts: 'boards', plug: 'plugs',
};

interface Obj { mesh: THREE.Mesh; tag?: PickTag; anim?: Anim; rank: number; base: THREE.Matrix4; ghost: boolean }

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
  const p = m.pos, n = p.length;
  let h = n * 31 + m.idx.length;
  for (let k = 0; k < 24 && n; k++) h = (h * 33 + Math.round(p[Math.floor((k * n) / 24)] * 1000)) | 0;
  return `${n}:${m.idx.length}:${h}`;
}
function geom(m: MeshData, edges: boolean) {
  const key = meshKey(m);
  let c = geoCache.get(key);
  if (!c) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
    g.setIndex(new THREE.BufferAttribute(m.idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    c = { g, e: null, used: buildNo };
    geoCache.set(key, c);
  }
  c.used = buildNo;
  if (edges && !c.e && m.idx.length < 90000) c.e = new THREE.EdgesGeometry(c.g, 28);
  return c;
}
function sweepCache() {
  for (const [k, c] of geoCache) if (buildNo - c.used > 2) { c.g.dispose(); c.e?.dispose(); geoCache.delete(k); }
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
  if (theme === 'dark') { gr.addColorStop(0, '#232a32'); gr.addColorStop(0.55, '#161b20'); gr.addColorStop(1, '#0d1013'); }
  else { gr.addColorStop(0, '#fdfdfe'); gr.addColorStop(0.6, '#eef1f4'); gr.addColorStop(1, '#dde2e7'); }
  g.fillStyle = gr; g.fillRect(0, 0, 16, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const ease = (x: number) => 1 - Math.pow(1 - x, 3);

export function Viewer3D({ result, mode, bed, spacing, theme, camera: camReq, installed, overhangs, layers, sel, onPick, label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const ctx = useRef<any>(null);
  const [play, setPlay] = useState<{ on: boolean; t: number; n: number }>({ on: false, t: Infinity, n: 0 });
  const [explode, setExplode] = useState(0);
  const cb = useRef({ onPick, label });
  cb.current = { onPick, label };

  // ---------------------------------------------------------------- setup (once)
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.22;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
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
    scene.environmentIntensity = 0.85;
    const hemi = new THREE.HemisphereLight(0xf2f6ff, 0x20262c, 0.55);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff3e6, 2.1);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.6;
    key.shadow.radius = 5;
    scene.add(key, key.target);
    const rim = new THREE.DirectionalLight(0xa9d4ff, 0.7);
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
    gtao.blendIntensity = 0.85;
    gtao.updateGtaoMaterial({ radius: 6, distanceExponent: 1.4, thickness: 2, scale: 1.1, samples: 12 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    composer.addPass(gtao);
    const outline = new OutlinePass(new THREE.Vector2(4, 4), scene, camera);
    outline.edgeStrength = 4;
    outline.edgeGlow = 0.35;
    outline.edgeThickness = 1.2;
    outline.visibleEdgeColor.set('#ff7a2f');
    outline.hiddenEdgeColor.set('#7a3a16');
    composer.addPass(outline);
    composer.addPass(new OutputPass());

    const c: any = { renderer, scene, camera, controls, world, floor, key, composer, gtao, outline, objs: [] as Obj[], features: [] as Feature[], frames: {} as Record<string, number[]>, dirty: true, fitted: '', tween: null, hover: null as THREE.Mesh | null, radius: 100, ranks: 0, highlights: new THREE.Group(), anim: { t: Infinity, explode: 0 } };
    world.add(c.highlights);
    ctx.current = c;
    const invalidate = () => { c.dirty = true; };
    c.invalidate = invalidate;
    controls.addEventListener('change', invalidate);

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
      const moved = controls.update();
      if (!c.dirty && !moved) return;
      c.dirty = false;
      composer.render();
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
      controls.dispose();
      composer.dispose();
      renderer.dispose();
      el.removeChild(dom);
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
    c.outline.visibleEdgeColor.set(theme === 'dark' ? '#ff7a2f' : '#f0600f');
    c.invalidate();
  }, [theme]);

  // ---------------------------------------------------------------- content
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    const { world, camera, controls } = c;
    buildNo++;
    for (const o of c.objs as Obj[]) { world.remove(o.mesh); (o.mesh.material as THREE.Material).dispose(); o.mesh.children.forEach((k: any) => k.material?.dispose?.()); }
    c.objs = [];
    c.hover = null;
    c.mode = mode;
    c.features = result?.report.features ?? [];
    c.frames = result?.report.frames ?? {};
    for (const o of [...c.floor.children]) { c.floor.remove(o); o.traverse((x: any) => { if (x.geometry && !x.userData.cached) x.geometry.dispose?.(); x.material?.dispose?.(); }); }
    world.matrix.identity();
    if (!result) { c.invalidate(); return; }
    const edgeCol = new THREE.Color(theme === 'dark' ? 0x0a0d10 : 0x2a3138);

    const add = (m: MeshData, color: string, opacity: number, matrix: number[] | null, tag: PickTag | undefined, anim: Anim | undefined, ghost: boolean, edges = true) => {
      const cg = geom(m, edges && opacity >= 1);
      const board = tag?.kind === 'board';
      const mat = new THREE.MeshStandardMaterial({ color, roughness: board ? 0.42 : ghost ? 0.5 : 0.56, metalness: board ? 0.05 : 0, flatShading: true, transparent: opacity < 1, opacity, depthWrite: opacity >= 0.9, side: THREE.DoubleSide, emissive: new THREE.Color(0xff7a2f), emissiveIntensity: 0 });
      const mesh = new THREE.Mesh(cg.g, mat);
      mesh.castShadow = opacity >= 0.8;
      mesh.receiveShadow = false;
      mesh.matrixAutoUpdate = false;
      if (matrix) mesh.matrix.fromArray(matrix);
      mesh.userData = { tag, ghost, cached: true };
      if (cg.e && edges && opacity >= 1) {
        const e = new THREE.LineSegments(cg.e, new THREE.LineBasicMaterial({ color: edgeCol, transparent: true, opacity: 0.22 }));
        e.matrixAutoUpdate = false;
        e.userData.cached = true;
        mesh.add(e);
      }
      world.add(mesh);
      c.objs.push({ mesh, tag, anim, rank: 0, base: mesh.matrix.clone(), ghost });
    };

    if (mode === 'assembly') {
      for (const p of result.parts) {
        if (p.toAssembly[14] <= -300) continue;
        add(p.mesh, p.color, 1, p.toAssembly, p.tag, p.anim, false);
        (p.instances ?? []).forEach((T, k) => add(p.mesh, p.color, 1, T, p.tags?.[k] ?? p.tag, p.anims?.[k] ?? p.anim, false));
      }
      for (const gh of result.ghosts) add(gh.mesh, gh.color, gh.opacity, null, gh.tag, gh.anim, true, false);
      // animation ranks: distinct steps in order
      const seqs = [...new Set((c.objs as Obj[]).map((o) => o.anim?.seq ?? 0))].sort((a, b) => a - b);
      for (const o of c.objs as Obj[]) o.rank = seqs.indexOf(o.anim?.seq ?? 0);
      c.ranks = seqs.length;
      c.phases = seqs;
      const cf = result.report.clipFrame;
      if (installed && cf) {
        const W = installed === 'h' ? [0, -1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 0, 0, 0, 0, 1] : [0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        world.matrix.copy(new THREE.Matrix4().fromArray(W).multiply(new THREE.Matrix4().fromArray(rigidInverse(cf))));
      }
    } else {
      const plates: Plate[] = packPlates(result.parts, bed, spacing);
      const gap = 30;
      plates.forEach((pl, i) => {
        const ox = i * (bed[0] + gap);
        const bedMesh = new THREE.Mesh(new THREE.PlaneGeometry(bed[0], bed[1]), new THREE.MeshStandardMaterial({ color: theme === 'dark' ? 0x1c2229 : 0xd9dee4, roughness: 0.85, metalness: 0.1 }));
        bedMesh.position.set(ox + bed[0] / 2, bed[1] / 2, -0.05);
        bedMesh.receiveShadow = true;
        c.floor.add(bedMesh);
        const border = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(bed[0], bed[1])), new THREE.LineBasicMaterial({ color: 0xff7a2f, transparent: true, opacity: 0.8 }));
        border.position.copy(bedMesh.position);
        c.floor.add(border);
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
              c.floor.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
            }
          }
        }
      });
      c.ranks = 0;
    }
    sweepCache();
    world.updateMatrixWorld(true);

    // content box (world frame), floor or wall, lights
    const box = new THREE.Box3();
    for (const o of c.objs as Obj[]) { o.mesh.updateMatrixWorld(true); box.expandByObject(o.mesh); }
    if (box.isEmpty()) { c.invalidate(); return; }
    const size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
    c.radius = size.length() / 2;
    const wall = mode === 'assembly' && !!installed;
    const R = Math.max(size.x, size.y, size.z) * 1.4 + 120;
    const gridCol = new THREE.Color(theme === 'dark' ? 0x3b4550 : 0x9aa5b1);
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(R * 2.2, R * 2.2), gridMaterial(gridCol, wall ? 1 : 0));
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(R * 2, R * 2), new THREE.ShadowMaterial({ opacity: theme === 'dark' ? 0.5 : 0.2 }));
    shadow.receiveShadow = true;
    if (wall) {
      grid.rotation.x = Math.PI / 2; shadow.rotation.x = Math.PI / 2;
      grid.position.set(ctr.x, 0.3, ctr.z); shadow.position.set(ctr.x, 0.2, ctr.z);
    } else {
      grid.position.set(ctr.x, ctr.y, box.min.z - 0.12); shadow.position.set(ctr.x, ctr.y, box.min.z - 0.06);
    }
    (grid.material as THREE.ShaderMaterial).uniforms.uRadius.value = R;
    (grid.material as THREE.ShaderMaterial).uniforms.uCenter.value.copy(ctr);
    (grid.material as THREE.ShaderMaterial).uniforms.uMinor.value = size.length() > 600 ? 50 : 10;
    (grid.material as THREE.ShaderMaterial).uniforms.uMajor.value = size.length() > 600 ? 250 : 50;
    c.floor.add(grid, shadow);
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
    void controls;
    applyPose(c);
    applyLayers(c, layers);
    applySel(c, sel);
    c.invalidate();
  }, [result, mode, bed[0], bed[1], spacing, theme, installed, overhangs]);

  useEffect(() => { const c = ctx.current; if (c) { applyLayers(c, layers); c.invalidate(); } }, [layers]);
  useEffect(() => { const c = ctx.current; if (c) { applySel(c, sel); c.invalidate(); } }, [sel, result]);

  // ---------------------------------------------------------------- animation and explode
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    c.anim = { t: play.t, explode };
    applyPose(c);
    c.invalidate();
  }, [play.t, explode, result]);
  useEffect(() => {
    const c = ctx.current;
    if (!c || !play.on) return;
    let last = performance.now();
    c.onFrame = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setPlay((p) => {
        if (!p.on) return p;
        const t = p.t + dt * 1.5;
        return t >= p.n + 0.001 ? { on: false, t: Infinity, n: p.n } : { ...p, t };
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

  const startPlay = () => {
    const n = ctx.current?.ranks ?? 0;
    if (!n) return;
    setExplode(0);
    setPlay({ on: true, t: 0, n });
  };
  const phaseName = (() => {
    if (!play.on || !ctx.current) return '';
    const s = ctx.current.phases?.[Math.min(Math.floor(play.t), (ctx.current.phases?.length ?? 1) - 1)] ?? 0;
    return s < 1 ? 'rails' : s < 2 ? 'rail shoes' : s < 3 ? 'sockets, clips' : s < 3.6 ? 'holders' : s < 20 ? 'boards' : s < 30 ? 'plug caps' : 'plugs';
  })();

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
      <div ref={tip} className="hovertip floating" style={{ display: 'none' }} />
      {mode === 'assembly' && result && (
        <div className="player floating" style={{ position: 'absolute', left: 12, bottom: 12, zIndex: 6 }}>
          <button className="play" title={play.on ? 'Stop' : 'Play the assembly'} onClick={() => (play.on ? setPlay({ on: false, t: Infinity, n: play.n }) : startPlay())}>
            {play.on ? <svg viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" /></svg> : <svg viewBox="0 0 16 16"><path d="M4.5 2.8v10.4L13 8z" fill="currentColor" /></svg>}
          </button>
          {play.on ? <span className="phase">{phaseName}…</span> : (
            <label title="Pull the parts apart along the way they go together">Explode<input type="range" min={0} max={1} step={0.01} value={explode} onChange={(e) => setExplode(+e.target.value)} /></label>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- helpers
function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}

function setEmissive(m: THREE.Mesh | null, level: number) {
  if (!m) return;
  const mat = m.material as THREE.MeshStandardMaterial;
  mat.emissiveIntensity = level ? 0.18 : 0;
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
  const dist = (r / Math.sin(((cam.fov / 2) * Math.PI) / 180)) * k * 0.82 / Math.sqrt(aspect);
  const p1 = center.clone().add(d.multiplyScalar(dist));
  if (instant) { cam.position.copy(p1); c.controls.target.copy(center); c.tween = null; c.invalidate(); return; }
  c.tween = { p0: cam.position.clone(), p1, q0: c.controls.target.clone(), q1: center, t0: performance.now(), dur: 480 };
}

/** Place every object: assembly animation (parts fly in step by step) or exploded view. */
function applyPose(c: any) {
  const { t, explode } = c.anim ?? { t: Infinity, explode: 0 };
  const n = Math.max(1, c.ranks);
  const D = Math.max(35, c.radius * 0.75);
  const off = new THREE.Vector3(), M = new THREE.Matrix4();
  for (const o of c.objs as Obj[]) {
    const dir = o.anim?.dir ?? [0, 0, 1];
    let k = 0;
    let shown = true;
    if (Number.isFinite(t)) {
      const local = t - o.rank;
      if (local <= 0) shown = false;
      else k = 1 - ease(Math.min(1, local));
    } else if (explode > 0) k = explode * (0.35 + (0.65 * o.rank) / Math.max(1, n - 1));
    o.mesh.userData.animHidden = !shown;
    off.set(dir[0], dir[1], dir[2]).multiplyScalar(D * k);
    o.mesh.matrix.copy(M.makeTranslation(off.x, off.y, off.z).multiply(o.base));
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
    const fill = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xff7a2f, transparent: true, opacity: 0.16, depthWrite: false }));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: 0xff7a2f, transparent: true, opacity: 0.95, depthTest: false }));
    for (const m of [fill, edges]) { m.matrixAutoUpdate = false; m.matrix.copy(M); m.renderOrder = 10; hl.add(m); }
  }
  hl.updateMatrixWorld(true);
}
