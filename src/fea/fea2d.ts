// 2D plane-stress FEA on a pixel grid. Elements are Wilson/Taylor incompatible-mode quads (Q6), which bend
// accurately with only a few elements through a thin wall. Solver: preconditioned conjugate gradient.
import type { Loop } from '../model/types';

export interface Mesh2D {
  h: number;
  x0: number;
  y0: number;
  nx: number; // elements in x
  ny: number;
  elems: Int32Array; // active element grid indices (i + j*nx)
  node: Int32Array; // grid node (i + j*(nx+1)) -> node id or -1
  nNodes: number;
  nodeXY: Float64Array;
  en: Int32Array; // 4 node ids per element (CCW from bottom-left)
  w?: Float32Array; // per element: the fraction of it the outline covers (stiffness scale)
}

function pointInLoops(x: number, y: number, loops: Loop[]): boolean {
  let c = false;
  for (const p of loops) {
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const xi = p[i][0], yi = p[i][1], xj = p[j][0], yj = p[j][1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
  }
  return c;
}

/**
 * Rasterise polygons (even-odd) into square elements of size h. The grid sits on multiples of h, so it does not move
 * when the outline's bounds do (adding geometry elsewhere used to shift the origin and the peaks by about 7%).
 * An element the outline only cuts through is kept with the share of it the outline covers (4 x 4 samples) as its
 * stiffness weight, so a thin wall is as thick as it is drawn, whichever way the grid falls on it (a 0.85 mm beam on a
 * 0.1 mm grid was 8 or 9 pixels thick, and its stiffness moved by a third with the grid's phase). `phase`: shifts the
 * grid by that fraction of h (for testing).
 */
export function meshPolygons(loops: Loop[], h: number, phase: [number, number] = [0, 0]): Mesh2D {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of loops) for (const [x, y] of l) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  x0 = (Math.floor(x0 / h + 1e-9) - 1 + phase[0]) * h; y0 = (Math.floor(y0 / h + 1e-9) - 1 + phase[1]) * h;
  const nx = Math.ceil((x1 - x0) / h) + 1, ny = Math.ceil((y1 - y0) / h) + 1;
  const act: number[] = [], wts: number[] = [], NS = 4, W = nx + 1;
  const inn = new Uint8Array(W * (ny + 1));
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) inn[i + j * W] = pointInLoops(x0 + i * h, y0 + j * h, loops) ? 1 : 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const g = i + j * W;
    let f = 1;
    if (inn[g] + inn[g + 1] + inn[g + W] + inn[g + W + 1] < 4) {
      let c = 0;
      for (let b = 0; b < NS; b++) for (let a = 0; a < NS; a++) if (pointInLoops(x0 + (i + (a + 0.5) / NS) * h, y0 + (j + (b + 0.5) / NS) * h, loops)) c++;
      f = c / (NS * NS);
      if (f < 0.05) continue;
      if (f > 0.97) f = 1;
    }
    act.push(i + j * nx); wts.push(f);
  }
  const node = new Int32Array((nx + 1) * (ny + 1)).fill(-1);
  const elems = Int32Array.from(act);
  const en = new Int32Array(elems.length * 4);
  let nNodes = 0;
  const nid = (i: number, j: number) => { const g = i + j * (nx + 1); if (node[g] < 0) node[g] = nNodes++; return node[g]; };
  elems.forEach((e, k) => {
    const i = e % nx, j = (e / nx) | 0;
    en[k * 4] = nid(i, j); en[k * 4 + 1] = nid(i + 1, j); en[k * 4 + 2] = nid(i + 1, j + 1); en[k * 4 + 3] = nid(i, j + 1);
  });
  const nodeXY = new Float64Array(nNodes * 2);
  for (let g = 0; g < node.length; g++) if (node[g] >= 0) { nodeXY[node[g] * 2] = x0 + (g % (nx + 1)) * h; nodeXY[node[g] * 2 + 1] = y0 + Math.floor(g / (nx + 1)) * h; }
  return { h, x0, y0, nx, ny, elems, node, nNodes, nodeXY, en, w: Float32Array.from(wts) };
}

/**
 * Strain per element averaged over its 3 x 3 neighbourhood (weighted by how much of each the outline covers): a pixel
 * corner on a fillet or a notch reads up to twice the true strain and jumps with the grid, the average does not.
 */
export function smoothStrain(m: Mesh2D, eps: ArrayLike<number>): Float64Array {
  const cell = new Int32Array(m.nx * m.ny).fill(-1), out = new Float64Array(m.elems.length);
  m.elems.forEach((g, k) => { cell[g] = k; });
  for (let k = 0; k < m.elems.length; k++) {
    const i = m.elems[k] % m.nx, j = (m.elems[k] / m.nx) | 0;
    let s = 0, ws = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= m.nx || b >= m.ny) continue;
      const q = cell[a + b * m.nx];
      if (q >= 0) { const w = m.w ? m.w[q] : 1; s += w * eps[q]; ws += w; }
    }
    out[k] = s / ws;
  }
  return out;
}

const GP = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)];
const CX = [-1, 1, 1, -1], CY = [-1, -1, 1, 1];

function Bmats(xi: number, eta: number, h: number) {
  const s = 2 / h;
  const Bu = new Float64Array(3 * 8), Ba = new Float64Array(3 * 4);
  for (let a = 0; a < 4; a++) {
    const dx = (CX[a] * (1 + CY[a] * eta)) / 4 * s, dy = (CY[a] * (1 + CX[a] * xi)) / 4 * s;
    Bu[0 * 8 + 2 * a] = dx; Bu[1 * 8 + 2 * a + 1] = dy; Bu[2 * 8 + 2 * a] = dy; Bu[2 * 8 + 2 * a + 1] = dx;
  }
  // incompatible modes: u += a0 (1-xi^2) + a1 (1-eta^2); v += a2 (1-xi^2) + a3 (1-eta^2)
  const p1x = -2 * xi * s, p2y = -2 * eta * s;
  Ba[0 * 4 + 0] = p1x; Ba[1 * 4 + 3] = p2y; Ba[2 * 4 + 1] = p2y; Ba[2 * 4 + 2] = p1x;
  return { Bu, Ba };
}

function Dps(E: number, nu: number) {
  const c = E / (1 - nu * nu);
  return [c, c * nu, 0, c * nu, c, 0, 0, 0, (c * (1 - nu)) / 2];
}

function matTmul(A: Float64Array, ra: number, ca: number, D: number[], B: Float64Array, cb: number, out: Float64Array, w: number) {
  // out (ca x cb) += A^T D B * w ; A is 3 x ca, B is 3 x cb
  for (let i = 0; i < ca; i++) {
    const a0 = A[i], a1 = A[ca + i], a2 = A[2 * ca + i];
    const d0 = a0 * D[0] + a1 * D[3] + a2 * D[6], d1 = a0 * D[1] + a1 * D[4] + a2 * D[7], d2 = a0 * D[2] + a1 * D[5] + a2 * D[8];
    for (let j = 0; j < cb; j++) out[i * cb + j] += (d0 * B[j] + d1 * B[cb + j] + d2 * B[2 * cb + j]) * w;
  }
  void ra;
}

function solveSmall(A: number[][], b: number[]): number[] {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/** Condensed 8x8 stiffness and bubble recovery R (4x8) for a square element of side h and thickness t. */
export function q6Element(h: number, E: number, nu: number, t: number) {
  const D = Dps(E, nu);
  const Kuu = new Float64Array(64), Kua = new Float64Array(32), Kaa = new Float64Array(16);
  const w = (h * h) / 4 * t;
  for (const xi of GP) for (const eta of GP) {
    const { Bu, Ba } = Bmats(xi, eta, h);
    matTmul(Bu, 3, 8, D, Bu, 8, Kuu, w);
    matTmul(Bu, 3, 8, D, Ba, 4, Kua, w);
    matTmul(Ba, 3, 4, D, Ba, 4, Kaa, w);
  }
  const KaaM = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => Kaa[i * 4 + j]));
  // R = -Kaa^-1 Kau  (4 x 8)
  const R = new Float64Array(32);
  for (let c = 0; c < 8; c++) {
    const col = solveSmall(KaaM, [0, 1, 2, 3].map((i) => Kua[c * 4 + i]));
    for (let i = 0; i < 4; i++) R[i * 8 + c] = -col[i];
  }
  const Ke = new Float64Array(64);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    let s = Kuu[i * 8 + j];
    for (let k = 0; k < 4; k++) s += Kua[i * 4 + k] * R[k * 8 + j];
    Ke[i * 8 + j] = s;
  }
  return { Ke, R, D };
}

export interface System2D { rowPtr: Int32Array; col: Int32Array; val: Float64Array; n: number }

/** Assemble the global stiffness in CSR using the 3x3 node stencil of the pixel grid. */
export function assemble2D(m: Mesh2D, Ke: Float64Array): System2D {
  const N = m.nNodes, n = 2 * N;
  const gridOf = new Int32Array(N);
  for (let g = 0; g < m.node.length; g++) if (m.node[g] >= 0) gridOf[m.node[g]] = g;
  const W = m.nx + 1;
  // neighbours present (node exists) -> slot map
  const slot = new Int32Array(N * 9).fill(-1);
  const rowPtr = new Int32Array(n + 1);
  let nnz = 0;
  for (let a = 0; a < N; a++) {
    const g = gridOf[a], gi = g % W, gj = (g / W) | 0;
    let k = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = gi + di, j = gj + dj;
      if (i >= 0 && j >= 0 && i < W && j <= m.ny) { const b = m.node[i + j * W]; if (b >= 0) { slot[a * 9 + (dj + 1) * 3 + (di + 1)] = k++; } }
    }
    rowPtr[2 * a + 1] = rowPtr[2 * a] + 2 * k;
    rowPtr[2 * a + 2] = rowPtr[2 * a + 1] + 2 * k;
    nnz += 4 * k;
  }
  const col = new Int32Array(nnz), val = new Float64Array(nnz);
  for (let a = 0; a < N; a++) {
    const g = gridOf[a], gi = g % W, gj = (g / W) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const s = slot[a * 9 + (dj + 1) * 3 + (di + 1)];
      if (s < 0) continue;
      const b = m.node[gi + di + (gj + dj) * W];
      for (let r = 0; r < 2; r++) { col[rowPtr[2 * a + r] + 2 * s] = 2 * b; col[rowPtr[2 * a + r] + 2 * s + 1] = 2 * b + 1; }
    }
  }
  for (let e = 0; e < m.elems.length; e++) {
    const ids = [m.en[e * 4], m.en[e * 4 + 1], m.en[e * 4 + 2], m.en[e * 4 + 3]], we = m.w ? m.w[e] : 1;
    for (let p = 0; p < 4; p++) {
      const a = ids[p], ga = gridOf[a];
      for (let q = 0; q < 4; q++) {
        const b = ids[q], gb = gridOf[b];
        const di = (gb % W) - (ga % W), dj = ((gb / W) | 0) - ((ga / W) | 0);
        const s = slot[a * 9 + (dj + 1) * 3 + (di + 1)];
        for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) val[rowPtr[2 * a + r] + 2 * s + c] += we * Ke[(2 * p + r) * 8 + 2 * q + c];
      }
    }
  }
  return { rowPtr, col, val, n };
}

/**
 * Incomplete Cholesky (no fill-in) of the free DOFs, for the conjugate gradient below: A is about L Lt on A's own
 * pattern. It takes a third of the iterations Jacobi does on a shoe that is held only at its rail contacts, and it
 * keeps going where the diagonal alone crawls. `shift` adds to the diagonal until the factorisation holds up.
 */
function ic0(S: System2D, fixed: Uint8Array): ((r: Float64Array, z: Float64Array) => void) | null {
  const n = S.n, rp = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    let c = 0;
    if (!fixed[i]) for (let k = S.rowPtr[i]; k < S.rowPtr[i + 1]; k++) { const j = S.col[k]; if (j < i && !fixed[j]) c++; }
    rp[i + 1] = rp[i] + c;
  }
  const lc = new Int32Array(rp[n]), lv = new Float64Array(rp[n]), a = new Float64Array(rp[n]), diag = new Float64Array(n), ad = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (fixed[i]) { ad[i] = 1; continue; }
    const row: [number, number][] = [];
    for (let k = S.rowPtr[i]; k < S.rowPtr[i + 1]; k++) { const j = S.col[k]; if (j === i) ad[i] = S.val[k]; else if (j < i && !fixed[j]) row.push([j, S.val[k]]); }
    row.sort((u, v) => u[0] - v[0]);
    row.forEach(([j, v], q) => { lc[rp[i] + q] = j; a[rp[i] + q] = v; });
  }
  for (const shift of [0, 0.02, 0.1, 0.3, 1]) {
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      if (fixed[i]) { diag[i] = 1; continue; }
      let dsum = 0;
      for (let k = rp[i]; k < rp[i + 1]; k++) {
        const j = lc[k];
        let sum = a[k], p = rp[i], q = rp[j];
        while (p < k && q < rp[j + 1]) { const cp = lc[p], cq = lc[q]; if (cp === cq) { sum -= lv[p] * lv[q]; p++; q++; } else if (cp < cq) p++; else q++; }
        lv[k] = sum / diag[j];
        dsum += lv[k] * lv[k];
      }
      const d = ad[i] * (1 + shift) - dsum;
      if (!(d > 1e-10 * ad[i])) ok = false; else diag[i] = Math.sqrt(d);
    }
    if (!ok) continue;
    return (r, z) => {
      for (let i = 0; i < n; i++) { let s = r[i]; for (let k = rp[i]; k < rp[i + 1]; k++) s -= lv[k] * z[lc[k]]; z[i] = s / diag[i]; }
      for (let i = n - 1; i >= 0; i--) { z[i] /= diag[i]; const zi = z[i]; for (let k = rp[i]; k < rp[i + 1]; k++) z[lc[k]] -= lv[k] * zi; }
    };
  }
  return null;
}

/** Preconditioned CG on the free DOFs (fixed = 1 means clamped). Incomplete Cholesky, or Jacobi if that breaks down. */
export function pcg(S: System2D, f: Float64Array, fixed: Uint8Array, tol = 1e-7, maxIt = 40000, onProgress?: (it: number, res: number) => void) {
  const n = S.n, x = new Float64Array(n), r = new Float64Array(n), z = new Float64Array(n), p = new Float64Array(n), q = new Float64Array(n);
  const dinv = new Float64Array(n), ic = ic0(S, fixed);
  for (let i = 0; i < n; i++) {
    for (let k = S.rowPtr[i]; k < S.rowPtr[i + 1]; k++) if (S.col[k] === i) dinv[i] = 1 / S.val[k];
    r[i] = fixed[i] ? 0 : f[i];
  }
  const prec = () => { if (ic) ic(r, z); else for (let i = 0; i < n; i++) z[i] = r[i] * dinv[i]; };
  const mv = (v: Float64Array, out: Float64Array) => {
    for (let i = 0; i < n; i++) {
      if (fixed[i]) { out[i] = 0; continue; }
      let s = 0;
      for (let k = S.rowPtr[i]; k < S.rowPtr[i + 1]; k++) { const c = S.col[k]; if (!fixed[c]) s += S.val[k] * v[c]; }
      out[i] = s;
    }
  };
  let rz = 0, bn = 0;
  prec();
  for (let i = 0; i < n; i++) { p[i] = z[i]; rz += r[i] * z[i]; bn += r[i] * r[i]; }
  bn = Math.sqrt(bn) || 1;
  let it = 0, res = 1;
  for (; it < maxIt; it++) {
    mv(p, q);
    let pq = 0;
    for (let i = 0; i < n; i++) pq += p[i] * q[i];
    const a = rz / pq;
    let rr = 0;
    for (let i = 0; i < n; i++) { x[i] += a * p[i]; r[i] -= a * q[i]; rr += r[i] * r[i]; }
    res = Math.sqrt(rr) / bn;
    if (res < tol) break;
    let rz2 = 0;
    prec();
    for (let i = 0; i < n; i++) rz2 += r[i] * z[i];
    const b = rz2 / rz;
    rz = rz2;
    for (let i = 0; i < n; i++) p[i] = z[i] + b * p[i];
    if (onProgress && it % 500 === 0) onProgress(it, res);
  }
  return { u: x, iterations: it, residual: res };
}

/** Max |principal in-plane strain| per element, sampled at the 4 corners (bubble modes included). */
export function elementStrain(m: Mesh2D, u: Float64Array, R: Float64Array): Float64Array {
  const out = new Float64Array(m.elems.length);
  const Bc = [0, 1, 2, 3].map((a) => Bmats(CX[a], CY[a], m.h));
  const ue = new Float64Array(8), al = new Float64Array(4);
  for (let e = 0; e < m.elems.length; e++) {
    for (let a = 0; a < 4; a++) { const id = m.en[e * 4 + a]; ue[2 * a] = u[2 * id]; ue[2 * a + 1] = u[2 * id + 1]; }
    for (let i = 0; i < 4; i++) { let s = 0; for (let j = 0; j < 8; j++) s += R[i * 8 + j] * ue[j]; al[i] = s; }
    let best = 0;
    for (const { Bu, Ba } of Bc) {
      const eps = [0, 0, 0];
      for (let r = 0; r < 3; r++) {
        let s = 0;
        for (let j = 0; j < 8; j++) s += Bu[r * 8 + j] * ue[j];
        for (let j = 0; j < 4; j++) s += Ba[r * 4 + j] * al[j];
        eps[r] = s;
      }
      const c = (eps[0] + eps[1]) / 2, rad = Math.hypot((eps[0] - eps[1]) / 2, eps[2] / 2);
      best = Math.max(best, Math.abs(c + rad), Math.abs(c - rad));
    }
    out[e] = best;
  }
  return out;
}

export function nearestNode(m: Mesh2D, x: number, y: number): number {
  let best = -1, bd = Infinity;
  for (let i = 0; i < m.nNodes; i++) { const d = (m.nodeXY[2 * i] - x) ** 2 + (m.nodeXY[2 * i + 1] - y) ** 2; if (d < bd) { bd = d; best = i; } }
  return best;
}

/** Textbook check: tip-loaded cantilever vs Euler-Bernoulli. */
export function cantileverCheck(h = 0.1) {
  const L = 20, t = 1, W = 4, E = 3000;
  const m = meshPolygons([[[0, 0], [L, 0], [L, t], [0, t]]], h);
  const { Ke, R } = q6Element(h, E, 0, W);
  const S = assemble2D(m, Ke);
  const fixed = new Uint8Array(S.n), f = new Float64Array(S.n);
  const tip: number[] = [];
  for (let i = 0; i < m.nNodes; i++) {
    const x = m.nodeXY[2 * i];
    if (x < 1e-9) { fixed[2 * i] = 1; fixed[2 * i + 1] = 1; }
    if (x > L - 1e-9) tip.push(i);
  }
  for (const i of tip) f[2 * i + 1] = 1 / tip.length;
  const { u } = pcg(S, f, fixed, 1e-10);
  const fea = tip.reduce((s, i) => s + u[2 * i + 1], 0) / tip.length;
  const exact = L ** 3 / (3 * E * ((W * t ** 3) / 12));
  const eps = Math.max(...elementStrain(m, u, R));
  const epsExact = (L * (t / 2)) / (E * ((W * t ** 3) / 12));
  return { fea, exact, eps, epsExact };
}
