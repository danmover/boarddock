// Small 3D pictures (board tiles, holder styles) rendered once off screen with the 3D view's materials and light,
// then kept as images: a real look at the board or holder instead of a sketch.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Ghost } from '../model/types';
import type { PicPart } from '../worker/client';
import { surface } from './Viewer3D';

let R: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; env: THREE.Texture } | null = null;
function setup() {
  if (R) return R;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const env = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.75;
  R = { renderer, scene, env };
  return R;
}

let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, Promise<string>>();

/** Picture of these meshes, as a PNG data URL (cached by key; one render at a time). */
export function picture(key: string, make: () => Promise<PicPart[]>, w = 320, h = 220, view: [number, number, number] = [0.55, -0.9, 0.95]): Promise<string> {
  const hit = cache.get(key);
  if (hit) return hit;
  try { const s = sessionStorage.getItem(`bd.pic.${key}`); if (s) { const p = Promise.resolve(s); cache.set(key, p); return p; } } catch { /* private mode */ }
  const job = queue.then(async () => {
    const parts = await make();
    // let clicks and typing through between pictures: each render holds the main thread while it draws
    await new Promise((r) => setTimeout(r, 16));
    const url = await render(parts, w, h, view);
    try { sessionStorage.setItem(`bd.pic.${key}`, url); } catch { /* full */ }
    return url;
  });
  queue = job.catch(() => undefined);
  cache.set(key, job);
  job.catch(() => cache.delete(key));
  return job;
}

async function render(parts: PicPart[], w: number, h: number, view: [number, number, number]): Promise<string> {
  const { renderer, scene } = setup();
  const dpr = 2;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  const root = new THREE.Group();
  const made: { dispose(): void }[] = [];
  for (const q of parts) {
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(q.mesh.pos, 3));
    g.setIndex(new THREE.BufferAttribute(q.mesh.idx, 1));
    if (q.smooth) g = toCreasedNormals(g, (40 * Math.PI) / 180);
    else g.computeVertexNormals();
    const m = surface(q.mat as Ghost['mat'], q.color, q.opacity, false, !q.mat, !!q.smooth);
    const mesh = new THREE.Mesh(g, m);
    if (q.M) { mesh.matrixAutoUpdate = false; mesh.matrix.fromArray(q.M); }
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    made.push(g, m);
  }
  scene.add(root);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root), c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2 || 10;
  // light and a soft contact shadow on an invisible floor
  const hemi = new THREE.HemisphereLight(0xf4f7ff, 0x3a4048, 0.8);
  const key = new THREE.DirectionalLight(0xfff6ec, 2.6);
  key.position.set(c.x + r * 1.2, c.y - r * 0.8, c.z + r * 2.4);
  key.target.position.copy(c);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -r * 1.6, right: r * 1.6, top: r * 1.6, bottom: -r * 1.6, near: 0.1, far: r * 8 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.radius = 6; key.shadow.bias = -0.0005; key.shadow.normalBias = 0.4;
  const rim = new THREE.DirectionalLight(0xa9d4ff, 0.8);
  rim.position.set(c.x - r * 2, c.y + r * 1.5, c.z + r);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(r * 8, r * 8), new THREE.ShadowMaterial({ opacity: 0.22 }));
  floor.position.set(c.x, c.y, box.min.z - 0.02);
  floor.receiveShadow = true;
  scene.add(hemi, key, key.target, rim, floor);
  const cam = new THREE.PerspectiveCamera(24, w / h, 0.1, r * 40);
  cam.up.set(0, 0, 1);
  const d = new THREE.Vector3(...view).normalize();
  // fit what the camera actually sees: step the distance until the box's corners fill 88% of the frame
  let dist = r / Math.sin(THREE.MathUtils.degToRad(12));
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
  const v = new THREE.Vector3();
  for (let k = 0; k < 4; k++) {
    cam.position.copy(c).addScaledVector(d, dist); cam.lookAt(c); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const q of corners) { v.copy(q).project(cam); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
    // re-centre on the projected box and scale the distance to fill the frame
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const half = Math.tan(THREE.MathUtils.degToRad(12)) * dist;
    c.addScaledVector(right, mx * half * (w / h)).addScaledVector(up, my * half);
    dist *= Math.max((x1 - x0) / 2, (y1 - y0) / 2) / 0.88;
  }
  cam.position.copy(c).addScaledVector(d, dist);
  cam.lookAt(c);
  renderer.render(scene, cam);
  scene.remove(root, hemi, key, key.target, rim, floor);
  floor.geometry.dispose(); (floor.material as THREE.Material).dispose(); key.shadow.map?.dispose();
  for (const x of made) x.dispose();
  // encode off the main thread (toBlob; toDataURL blocks), as WebP: a third of the PNG's size, transparency kept
  const blob = await new Promise<Blob | null>((ok) => renderer.domElement.toBlob(ok, 'image/webp', 0.9));
  if (!blob) return renderer.domElement.toDataURL('image/png');
  return await new Promise<string>((ok, bad) => { const fr = new FileReader(); fr.onload = () => ok(fr.result as string); fr.onerror = () => bad(fr.error); fr.readAsDataURL(blob); });
}
