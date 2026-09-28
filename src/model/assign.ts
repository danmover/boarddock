// The cheapest way to pair things up: given the cost of every row with every column (plugs that need a cable with
// plugs that can take one), which column each row gets so the total is least, each column used at most once. The
// Hungarian method (Kuhn-Munkres, with potentials), O(n^3): exact, and quick for the few dozen plugs of a rack.

/** Column for each row (or -1 if it got none: more rows than columns, or only impossible pairs). `Infinity` = never. */
export function assign(cost: number[][]): number[] {
  const n = cost.length, m = n ? cost[0].length : 0;
  if (!n || !m) return new Array(n).fill(-1);
  // square it: padding rows/columns cost nothing, impossible pairs cost a lot (and are dropped after)
  const N = Math.max(n, m);
  const BIG = 1e9;
  const c = (i: number, j: number) => (i < n && j < m ? (Number.isFinite(cost[i][j]) ? cost[i][j] : BIG) : 0);
  const u = new Array(N + 1).fill(0), v = new Array(N + 1).fill(0), p = new Array(N + 1).fill(0), way = new Array(N + 1).fill(0);
  for (let i = 1; i <= N; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(N + 1).fill(Infinity), used = new Array(N + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= N; j++) {
        if (used[j]) continue;
        const cur = c(i0 - 1, j - 1) - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= N; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const out = new Array(n).fill(-1);
  for (let j = 1; j <= N; j++) {
    const i = p[j] - 1;
    if (i >= 0 && i < n && j - 1 < m && c(i, j - 1) < BIG) out[i] = j - 1;
  }
  return out;
}
