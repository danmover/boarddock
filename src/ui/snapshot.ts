// Small 3D pictures (board tiles, toolbox parts, holder styles) rendered once off screen with the 3D view's materials
// and light (LIGHT: the same levels, from the same sides), then kept as images: the board, part or holder the way the
// 3D view shows it, instead of a sketch.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Ghost } from '../model/types';
import type { PicPart } from '../worker/client';
import { LIGHT, surface } from './Viewer3D';
import { store } from '../state';

// The renderer, lights, floor and materials are made once and kept: making them new for every picture made three.js
// compile its shaders and resize its buffers each time, which held the window up while boards were added.
type Kit = { renderer: THREE.WebGLRenderer; scene: THREE.Scene; env: THREE.Texture; hemi: THREE.HemisphereLight; key: THREE.DirectionalLight; rim: THREE.DirectionalLight; floor: THREE.Mesh; size: string };
let R: Kit | null = null;
const mats = new Map<string, THREE.Material>();
function setup() {
  if (R) return R;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = LIGHT.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const env = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = LIGHT.env;
  const hemi = new THREE.HemisphereLight(0xf4f7ff, 0x3a4048, LIGHT.hemi);
  const key = new THREE.DirectionalLight(0xfff6ec, LIGHT.key);
  key.castShadow = true;
  key.shadow.mapSize.set(512, 512);
  key.shadow.radius = 6; key.shadow.bias = -0.0005; key.shadow.normalBias = 0.4;
  const rim = new THREE.DirectionalLight(0xa9d4ff, LIGHT.rim);
  // a soft contact shadow on an invisible floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.22 }));
  floor.receiveShadow = true;
  scene.add(hemi, key, key.target, rim, floor);
  R = { renderer, scene, env, hemi, key, rim, floor, size: '' };
  return R;
}

let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, Promise<string>>();
// kept for the session under the light they were rendered in: pictures from before a change of light render again
const kept = `bd.pic.${LIGHT.exposure}.${LIGHT.key}.`;

/** Picture of these meshes, as a PNG data URL (cached by key; one render at a time). */
export function picture(key: string, make: () => Promise<PicPart[]>, w = 320, h = 220, view: [number, number, number] = [0.55, -0.9, 0.95]): Promise<string> {
  const hit = cache.get(key);
  if (hit) return hit;
  try { const s = sessionStorage.getItem(kept + key); if (s) { const p = Promise.resolve(s); cache.set(key, p); return p; } } catch { /* private mode */ }
  const job = queue.then(async () => {
    const parts = await make();
    // let clicks and typing through between pictures, and wait while the rack builds (the pictures can wait)
    await quiet();
    const url = await render(parts, w, h, view);
    try { sessionStorage.setItem(kept + key, url); } catch { /* full */ }
    return url;
  });
  queue = job.catch(() => undefined);
  cache.set(key, job);
  job.catch(() => cache.delete(key));
  return job;
}

/** Until the app is idle: not building, no new scene being drawn, and the browser has a spare moment. */
async function quiet() {
  for (let k = 0; k < 600 && (store.get().building || store.get().rendering); k++) await new Promise((r) => setTimeout(r, 100));
  await new Promise<void>((r) => ('requestIdleCallback' in window ? (window as any).requestIdleCallback(() => r(), { timeout: 400 }) : setTimeout(r, 16)));
}

async function render(parts: PicPart[], w: number, h: number, view: [number, number, number]): Promise<string> {
  const { renderer, scene, key, rim, floor } = R ?? setup();
  // resizing the drawing buffer is slow: only when a picture of another size comes up
  if (R!.size !== `${w}x${h}`) { renderer.setPixelRatio(2); renderer.setSize(w, h, false); R!.size = `${w}x${h}`; }
  const root = new THREE.Group();
  const made: { dispose(): void }[] = [];
  for (const q of parts) {
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(q.mesh.pos, 3));
    g.setIndex(new THREE.BufferAttribute(q.mesh.idx, 1));
    if (q.smooth) g = toCreasedNormals(g, (40 * Math.PI) / 180);
    else g.computeVertexNormals();
    const mk = `${q.mat ?? ''}|${q.color}|${q.opacity}|${!!q.smooth}`;
    let m = mats.get(mk);
    if (!m) mats.set(mk, (m = surface(q.mat as Ghost['mat'], q.color, q.opacity, false, !q.mat, !!q.smooth)));
    const mesh = new THREE.Mesh(g, m);
    if (q.M) { mesh.matrixAutoUpdate = false; mesh.matrix.fromArray(q.M); }
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    made.push(g);
  }
  scene.add(root);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root), c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2 || 10;
  // light and the floor, placed for this picture (the key and rim from where the 3D view has them)
  const kd = new THREE.Vector3(...LIGHT.keyDir).normalize(), rd = new THREE.Vector3(...LIGHT.rimDir).normalize();
  key.position.copy(c).addScaledVector(kd, r * 2.8);
  key.target.position.copy(c);
  Object.assign(key.shadow.camera, { left: -r * 1.6, right: r * 1.6, top: r * 1.6, bottom: -r * 1.6, near: 0.1, far: r * 8 });
  key.shadow.camera.updateProjectionMatrix();
  rim.position.copy(c).addScaledVector(rd, r * 2.7);
  floor.scale.set(r * 8, r * 8, 1);
  floor.position.set(c.x, c.y, box.min.z - 0.02);
  floor.updateMatrixWorld();
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
  scene.remove(root);
  for (const x of made) x.dispose();
  // encode off the main thread (toBlob; toDataURL blocks), as WebP: a third of the PNG's size, transparency kept
  const blob = await new Promise<Blob | null>((ok) => renderer.domElement.toBlob(ok, 'image/webp', 0.9));
  if (!blob) return renderer.domElement.toDataURL('image/png');
  return await new Promise<string>((ok, bad) => { const fr = new FileReader(); fr.onload = () => ok(fr.result as string); fr.onerror = () => bad(fr.error); fr.readAsDataURL(blob); });
}
