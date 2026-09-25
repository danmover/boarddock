import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GenResult, MeshData, V2 } from '../model/types';
import { packPlates, placedMesh, printability, type Plate } from '../cad/export';

interface Props {
  result: GenResult | null;
  mode: 'assembly' | 'print';
  showGhosts: boolean;
  bed: V2;
  spacing: number;
  theme: 'dark' | 'light';
  camera?: { dir: [number, number, number]; n: number };
  installed?: 'h' | 'v' | null; // show the assembly on a horizontal / vertical rail against a wall
  overhangs?: boolean; // print view: paint faces that need support (red) and bridges (amber)
}

function rigidInverse(m: number[]): number[] {
  const r = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
  const t = [m[12], m[13], m[14]];
  r[12] = -(r[0] * t[0] + r[4] * t[1] + r[8] * t[2]);
  r[13] = -(r[1] * t[0] + r[5] * t[1] + r[9] * t[2]);
  r[14] = -(r[2] * t[0] + r[6] * t[1] + r[10] * t[2]);
  return r;
}

function geom(m: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
  g.setIndex(new THREE.BufferAttribute(m.idx, 1));
  g.computeBoundingBox();
  return g;
}

export function Viewer3D({ result, mode, showGhosts, bed, spacing, theme, camera: camReq, installed, overhangs }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const ctx = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; group: THREE.Group; fitted: string; key: THREE.DirectionalLight } | null>(null);

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 5000);
    camera.up.set(0, 0, 1);
    camera.position.set(140, -180, 150);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    // studio reflections: soft, even, and they make the printed plastic read as plastic
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
    scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x1b2a22, 0.8));
    const key = new THREE.DirectionalLight(0xfff4e6, 1.9);
    key.position.set(120, -160, 260);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.8;
    key.shadow.radius = 6;
    scene.add(key, key.target);
    const rim = new THREE.DirectionalLight(0x9fd8ff, 0.8);
    rim.position.set(-220, 180, 90);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0x3ddc97, 0.25);
    fill.position.set(0, 0, -200);
    scene.add(fill);
    const group = new THREE.Group();
    scene.add(group);
    ctx.current = { renderer, scene, camera, controls, group, fitted: '', key } as any;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    });
    ro.observe(el);
    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      ctx.current = null;
    };
  }, []);

  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    const { group, camera, controls } = c;
    for (const o of [...group.children]) {
      group.remove(o);
      o.traverse((x: any) => { x.geometry?.dispose?.(); x.material?.dispose?.(); });
    }
    group.matrixAutoUpdate = true;
    group.matrix.identity();
    group.position.set(0, 0, 0);
    group.rotation.set(0, 0, 0);
    group.updateMatrix();
    if (!result) return;
    const edgeColor = theme === 'dark' ? 0x06120c : 0x1d3328;
    const addMesh = (m: MeshData, color: string, opacity: number, matrix?: number[], edges = true) => {
      const g = geom(m);
      const mat = new THREE.MeshStandardMaterial({ color, roughness: opacity < 1 ? 0.3 : 0.52, metalness: 0.0, flatShading: true, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = opacity >= 0.8;
      mesh.receiveShadow = false; // self-shadowing on flat-shaded parts shows acne; only the ground and wall receive
      if (matrix) { mesh.matrixAutoUpdate = false; mesh.matrix.fromArray(matrix); }
      group.add(mesh);
      // outline only simple meshes: the stepped chamfers on holders would turn into a noisy line texture
      if (edges && opacity >= 1 && m.idx.length < 60000) {
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(g, 28), new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.32 }));
        if (matrix) { e.matrixAutoUpdate = false; e.matrix.fromArray(matrix); }
        group.add(e);
      }
    };
    if (mode === 'assembly') {
      for (const p of result.parts) if (p.toAssembly[14] > -300) for (const T of [p.toAssembly, ...(p.instances ?? [])]) addMesh(p.mesh, p.color, 1, T);
      if (showGhosts) for (const gh of result.ghosts) addMesh(gh.mesh, gh.color, gh.opacity, undefined, false);
      const cf = result.report.clipFrame;
      if (installed && cf) {
        // world: wall = XZ plane, device sticks out towards -Y; clip u -> -Y, v and w by rail direction
        const W = installed === 'h' ? [0, -1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 0, 0, 0, 0, 1] : [0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        const M = new THREE.Matrix4().fromArray(W).multiply(new THREE.Matrix4().fromArray(rigidInverse(cf)));
        group.matrixAutoUpdate = false;
        group.matrix.copy(M);
        group.updateMatrixWorld(true);
        if (showGhosts) {
          const panelMode = !!result.report.panel;
          const long = new THREE.Mesh(new THREE.BoxGeometry(installed === 'h' ? 600 : 35, 7.5, installed === 'h' ? 35 : 600), new THREE.MeshStandardMaterial({ color: 0x9aa8b6, metalness: 0.6, roughness: 0.4, transparent: true, opacity: 0.5 }));
          long.position.set(0, -3.75, 0);
          const wall = new THREE.Mesh(new THREE.PlaneGeometry(panelMode ? 3000 : 700, panelMode ? 3000 : 700), new THREE.MeshStandardMaterial({ color: theme === 'dark' ? 0x223040 : 0xcfd8e0, side: THREE.DoubleSide }));
          wall.rotation.x = Math.PI / 2;
          wall.position.set(0, 0.05, 0);
          wall.receiveShadow = true;
          long.castShadow = true;
          // these live outside the transformed group
          const extras = new THREE.Group();
          extras.add(wall);
          if (!panelMode) extras.add(long);
          const grid = new THREE.GridHelper(3000, 120, theme === 'dark' ? 0x33414f : 0xb8c4cf, theme === 'dark' ? 0x26313c : 0xc8d2db);
          grid.position.set(0, 0.03, 0);
          extras.add(grid);
          extras.userData.extras = true;
          c.scene.children.filter((o) => o.userData.extras).forEach((o) => c.scene.remove(o));
          c.scene.add(extras);
        }
      }
    } else {
      const plates: Plate[] = packPlates(result.parts, bed, spacing);
      const gap = 30;
      plates.forEach((pl, i) => {
        const ox = i * (bed[0] + gap);
        const bedMesh = new THREE.Mesh(new THREE.PlaneGeometry(bed[0], bed[1]), new THREE.MeshStandardMaterial({ color: theme === 'dark' ? 0x1b2632 : 0xd5dde4, roughness: 0.9 }));
        bedMesh.position.set(ox + bed[0] / 2, bed[1] / 2, -0.05);
        group.add(bedMesh);
        const border = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(bed[0], bed[1])), new THREE.LineBasicMaterial({ color: 0x2dd4bf }));
        border.position.copy(bedMesh.position);
        group.add(border);
        for (const it of pl.items) {
          const m = placedMesh(it, bed, pl.used);
          const pos = new Float32Array(m.pos);
          for (let k = 0; k < pos.length; k += 3) pos[k] += ox;
          addMesh({ pos, idx: m.idx }, it.part.color, overhangs ? 0.35 : 1);
          if (overhangs) {
            const q = printability({ pos, idx: m.idx });
            for (const [k, col] of [[1, 0xff3b5c], [2, 0xffb020]] as const) {
              const tri: number[] = [];
              q.kind.forEach((v, t) => { if (v === k) tri.push(m.idx[3 * t], m.idx[3 * t + 1], m.idx[3 * t + 2]); });
              if (!tri.length) continue;
              const g = new THREE.BufferGeometry();
              g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
              g.setIndex(tri);
              group.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
            }
          }
        }
      });
    }
    if (!(installed && mode === 'assembly' && showGhosts)) c.scene.children.filter((o) => o.userData.extras).forEach((o) => c.scene.remove(o));
    // fit camera when the content changes shape
    const box = new THREE.Box3().setFromObject(group);
    // soft contact shadow on a ground plane under everything (not in the installed view, where the wall is)
    c.scene.children.filter((o) => o.userData.ground).forEach((o) => c.scene.remove(o));
    if (!box.isEmpty() && !(installed && mode === 'assembly')) {
      const size = box.getSize(new THREE.Vector3());
      const ctr = box.getCenter(new THREE.Vector3());
      const R = Math.max(size.x, size.y) * 3 + 200;
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(R, R), new THREE.ShadowMaterial({ opacity: theme === 'dark' ? 0.45 : 0.18 }));
      ground.position.set(ctr.x, ctr.y, box.min.z - 0.05);
      ground.receiveShadow = true;
      ground.userData.ground = true;
      c.scene.add(ground);
      const grid = new THREE.GridHelper(Math.ceil(R / 10) * 10, Math.ceil(R / 10), theme === 'dark' ? 0x1b2a33 : 0xc9d6cf, theme === 'dark' ? 0x121d24 : 0xdbe4dd);
      grid.rotation.x = Math.PI / 2;
      grid.position.set(ctr.x, ctr.y, box.min.z - 0.08);
      (grid.material as THREE.Material).transparent = true;
      (grid.material as THREE.Material).opacity = 0.55;
      grid.userData.ground = true;
      c.scene.add(grid);
    }
    if (!box.isEmpty()) {
      // aim the shadow-casting light at whatever is on screen (also in the installed view)
      const size = box.getSize(new THREE.Vector3());
      const ctr = box.getCenter(new THREE.Vector3());
      const k = c.key;
      const dir = installed && mode === 'assembly' ? new THREE.Vector3(0.35, -1, 0.7) : new THREE.Vector3(0.4, -0.55, 1);
      k.target.position.copy(ctr);
      k.position.copy(ctr.clone().add(dir.normalize().multiplyScalar(Math.max(size.length(), 60) * 1.4)));
      const S = size.length() * 0.6 + 20;
      Object.assign(k.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: Math.max(size.length(), 60) * 4 });
      k.shadow.camera.updateProjectionMatrix();
    }
    const key = `${mode}:${installed}:${box.min.toArray().map((v) => v.toFixed(0))}:${box.max.toArray().map((v) => v.toFixed(0))}`;
    if (c.fitted !== key && !box.isEmpty()) {
      c.fitted = key;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length();
      const dir = installed && mode === 'assembly' ? new THREE.Vector3(0.45, -1, 0.35) : mode === 'assembly' ? new THREE.Vector3(0.55, -0.75, 0.62) : new THREE.Vector3(0.1, -0.7, 0.9);
      camera.position.copy(center.clone().add(dir.normalize().multiplyScalar(size * 1.35)));
      controls.target.copy(center);
      camera.near = size / 200;
      camera.far = size * 20;
      camera.updateProjectionMatrix();
    }
  }, [result, mode, showGhosts, bed[0], bed[1], spacing, theme, installed, overhangs]);

  // camera presets
  useEffect(() => {
    const c = ctx.current;
    if (!c || !camReq) return;
    const box = new THREE.Box3().setFromObject(c.group);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const d = new THREE.Vector3(...camReq.dir).normalize();
    c.camera.position.copy(center.clone().add(d.multiplyScalar(size * 1.3)));
    c.camera.up.set(0, 0, 1);
    c.controls.target.copy(center);
    c.camera.lookAt(center);
  }, [camReq?.n]);

  return <div ref={host} style={{ position: 'absolute', inset: 0 }} />;
}
