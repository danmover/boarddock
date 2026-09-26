// Linear 3D frame (beam) solver for the holder's support network: posts under the mounting holes, the ribs that
// tie them to the rim or the dock spine. Euler-Bernoulli beams, 6 DOF per node, dense solve (networks are small).

export interface FNode { x: number; y: number; z: number; fixed?: boolean }
export interface FSection { A: number; Iy: number; Iz: number; J: number; cy: number; cz: number } // cy, cz: extreme fibre distances
export interface FElem { a: number; b: number; s: FSection; name: string }
export interface FLoad { node: number; f: [number, number, number] }

export const rectSection = (b: number, h: number): FSection => {
  // b across (local y), h up (local z)
  const lo = Math.min(b, h), hi = Math.max(b, h);
  const J = hi * lo ** 3 * (1 / 3 - 0.21 * (lo / hi) * (1 - lo ** 4 / (12 * hi ** 4)));
  return { A: b * h, Iy: (b * h ** 3) / 12, Iz: (h * b ** 3) / 12, J, cy: b / 2, cz: h / 2 };
};
export const roundSection = (r: number): FSection => ({ A: Math.PI * r * r, Iy: (Math.PI * r ** 4) / 4, Iz: (Math.PI * r ** 4) / 4, J: (Math.PI * r ** 4) / 2, cy: r, cz: r });

/** Local axes of a member: x along it, z as close to global up as possible (global x for vertical members). */
function axes(n: FNode[], e: FElem) {
  const A = n[e.a], B = n[e.b];
  const dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
  const L = Math.hypot(dx, dy, dz);
  const x = [dx / L, dy / L, dz / L];
  const ref = Math.abs(x[2]) > 0.95 ? [1, 0, 0] : [0, 0, 1];
  // y = ref x x (normalised), z = x x y
  let y = [ref[1] * x[2] - ref[2] * x[1], ref[2] * x[0] - ref[0] * x[2], ref[0] * x[1] - ref[1] * x[0]];
  const ly = Math.hypot(y[0], y[1], y[2]);
  y = y.map((v) => v / ly);
  const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  return { L, R: [x, y, z] };
}

function localK(L: number, s: FSection, E: number, G: number): number[][] {
  const k = Array.from({ length: 12 }, () => new Array(12).fill(0));
  const a = (E * s.A) / L, t = (G * s.J) / L;
  const bz = (E * s.Iz) / L ** 3, by = (E * s.Iy) / L ** 3;
  const set = (i: number, j: number, v: number) => { k[i][j] += v; if (i !== j) k[j][i] += v; };
  set(0, 0, a); set(6, 6, a); set(0, 6, -a);
  set(3, 3, t); set(9, 9, t); set(3, 9, -t);
  // bending in the x-y plane (about local z): v (1, 7), rz (5, 11)
  set(1, 1, 12 * bz); set(7, 7, 12 * bz); set(1, 7, -12 * bz);
  set(1, 5, 6 * bz * L); set(1, 11, 6 * bz * L); set(7, 5, -6 * bz * L); set(7, 11, -6 * bz * L);
  set(5, 5, 4 * bz * L * L); set(11, 11, 4 * bz * L * L); set(5, 11, 2 * bz * L * L);
  // bending in the x-z plane (about local y): w (2, 8), ry (4, 10)
  set(2, 2, 12 * by); set(8, 8, 12 * by); set(2, 8, -12 * by);
  set(2, 4, -6 * by * L); set(2, 10, -6 * by * L); set(8, 4, 6 * by * L); set(8, 10, 6 * by * L);
  set(4, 4, 4 * by * L * L); set(10, 10, 4 * by * L * L); set(4, 10, 2 * by * L * L);
  return k;
}

export interface FrameResult {
  u: Float64Array; // 6 per node
  stress: number[]; // peak normal stress per element (MPa)
}

export function solveFrame(nodes: FNode[], elems: FElem[], E: number, nu: number, loads: FLoad[]): FrameResult {
  const G = E / (2 * (1 + nu));
  const n = nodes.length * 6;
  const K = Array.from({ length: n }, () => new Float64Array(n));
  const cache = elems.map((e) => {
    const { L, R } = axes(nodes, e);
    const kl = localK(L, e.s, E, G);
    // T = blockdiag(R, R, R, R); global k = T^T kl T
    const T = (i: number, j: number) => (Math.floor(i / 3) === Math.floor(j / 3) ? R[i % 3][j % 3] : 0);
    const kg = Array.from({ length: 12 }, () => new Array(12).fill(0));
    const tmp = Array.from({ length: 12 }, () => new Array(12).fill(0));
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) { let v = 0; for (let m = 0; m < 12; m++) v += kl[i][m] * T(m, j); tmp[i][j] = v; }
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) { let v = 0; for (let m = 0; m < 12; m++) v += T(m, i) * tmp[m][j]; kg[i][j] = v; }
    const dofs = [...Array(6)].map((_, q) => e.a * 6 + q).concat([...Array(6)].map((_, q) => e.b * 6 + q));
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) K[dofs[i]][dofs[j]] += kg[i][j];
    return { L, R, kl, dofs, T };
  });
  const f = new Float64Array(n);
  for (const l of loads) for (let q = 0; q < 3; q++) f[l.node * 6 + q] += l.f[q];
  const free: number[] = [];
  nodes.forEach((nd, i) => { if (!nd.fixed) for (let q = 0; q < 6; q++) free.push(i * 6 + q); });
  const m = free.length;
  const A = free.map((i) => Float64Array.from(free.map((j) => K[i][j])));
  const b = Float64Array.from(free.map((i) => f[i]));
  // Gaussian elimination with partial pivoting
  for (let c = 0; c < m; c++) {
    let p = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) continue; // mechanism: leave that DOF at zero
    if (p !== c) { [A[p], A[c]] = [A[c], A[p]]; [b[p], b[c]] = [b[c], b[p]]; }
    for (let r = c + 1; r < m; r++) {
      const k = A[r][c] / A[c][c];
      if (!k) continue;
      for (let j = c; j < m; j++) A[r][j] -= k * A[c][j];
      b[r] -= k * b[c];
    }
  }
  const x = new Float64Array(m);
  for (let r = m - 1; r >= 0; r--) {
    let v = b[r];
    for (let j = r + 1; j < m; j++) v -= A[r][j] * x[j];
    x[r] = Math.abs(A[r][r]) < 1e-12 ? 0 : v / A[r][r];
  }
  const u = new Float64Array(n);
  free.forEach((i, k) => { u[i] = x[k]; });
  const stress = elems.map((e, ei) => {
    const { kl, dofs, T } = cache[ei];
    const ug = dofs.map((d) => u[d]);
    const ul = new Array(12).fill(0);
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) ul[i] += T(i, j) * ug[j];
    const fl = new Array(12).fill(0);
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) fl[i] += kl[i][j] * ul[j];
    let peak = 0;
    for (const end of [0, 6]) {
      const N = fl[end], My = fl[end + 4], Mz = fl[end + 5];
      peak = Math.max(peak, Math.abs(N) / e.s.A + (Math.abs(My) * e.s.cz) / e.s.Iy + (Math.abs(Mz) * e.s.cy) / e.s.Iz);
    }
    return peak;
  });
  return { u, stress };
}
