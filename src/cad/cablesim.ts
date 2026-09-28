// Cables settling into place, the way real ones do once they are plugged in and pressed down: the router plans each
// cable's way (out of its plug, down to its street, along it and back up), then this lets them all settle together.
// Each cable is a chain of beads; over a few dozen rounds, beads of two cables that touch push apart (one lies over
// the other where they cross, side by side where they run together), beads inside a holder, dock or plug are pushed
// out, every chain keeps its length, and bends ease out. The ends stay in their plugs. Ribbons and other fixed runs
// take part as things the rest settle round. Rack frame: u along the rails, v across them, z up (mm). Pure.

export type Box = number[]; // [u0, v0, z0, u1, v1, z1]

export interface SimCable {
  id: string;
  pts: number[][]; // the planned path
  r: number; // radius
  pin: [number, number]; // mm at each end held straight in its plug
  fixed?: boolean; // doesn't move (a ribbon): the others settle round it
  mods?: string[]; // the boards at its ends: their own holders don't push it within `own` mm of that end
  plugs?: string[]; // its own plugs: never push it
}
export interface SimObstacle { box: Box; module?: string; plug?: string; stand?: boolean }
export interface SimResult { paths: number[][][]; touching: [string, string][]; inside: string[] }

const STEP = 2.5; // bead spacing
const GAP = 0.25; // clearance kept between two cables

const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: number[]) => Math.hypot(a[0], a[1], a[2]);
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: number[]) => { const L = len(a); return L > 1e-9 ? [a[0] / L, a[1] / L, a[2] / L] : [0, 0, 1]; };

/** A polyline resampled at even steps (its ends kept). */
export function resample(pts: number[][], step = STEP): number[][] {
  const out: number[][] = [pts[0].slice()];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], d = sub(b, a), L = len(d);
    let s = step - carry;
    while (s < L) { out.push([a[0] + (d[0] * s) / L, a[1] + (d[1] * s) / L, a[2] + (d[2] * s) / L]); s += step; }
    carry = L - (s - step);
  }
  const last = pts[pts.length - 1];
  if (len(sub(out[out.length - 1], last)) > step * 0.35) out.push(last.slice()); else out[out.length - 1] = last.slice();
  return out;
}

/**
 * Let the cables settle. `rounds`: how many passes (more: calmer). Returns each cable's settled path, the pairs still
 * touching afterwards and the cables still inside something, for the report.
 */
export function settleCables(cables: SimCable[], obs: SimObstacle[], rounds = 60): SimResult {
  const beads = cables.map((c) => resample(c.pts));
  const rest = beads.map((b) => b.map((_, i) => (i ? len(sub(b[i], b[i - 1])) : 0)));
  // arc length of every bead from each end, and which are held in their plugs
  const arc = beads.map((b) => { const s = [0]; for (let i = 1; i < b.length; i++) s.push(s[i - 1] + len(sub(b[i], b[i - 1]))); return s; });
  const held = cables.map((c, k) => { const s = arc[k], L = s[s.length - 1]; return s.map((x) => c.fixed || x <= c.pin[0] || L - x <= c.pin[1]); });
  const floor = beads.map((b) => Math.min(...b.map((q) => q[2])));
  const rMax = Math.max(1, ...cables.map((c) => c.r));

  // obstacles on a coarse grid, so each bead only looks at the few near it
  const OC = 24, ogrid = new Map<string, number[]>();
  const okey = (i: number, j: number, k: number) => `${i},${j},${k}`;
  obs.forEach((o, n) => {
    if (o.stand) return; // cables lie in the stands' combs
    const b = o.box, g = rMax + 1;
    for (let i = Math.floor((b[0] - g) / OC); i <= Math.floor((b[3] + g) / OC); i++)
      for (let j = Math.floor((b[1] - g) / OC); j <= Math.floor((b[4] + g) / OC); j++)
        for (let k = Math.floor((b[2] - g) / OC); k <= Math.floor((b[5] + g) / OC); k++) { const key = okey(i, j, k); const l = ogrid.get(key); if (l) l.push(n); else ogrid.set(key, [n]); }
  });
  const ownOk = (c: number, i: number, o: SimObstacle) => {
    const C = cables[c];
    if (o.plug && C.plugs?.includes(o.plug)) return true;
    if (!o.module || !C.mods?.includes(o.module)) return false;
    // its own board's holder is fine close to the end it plugs into there
    const s = arc[c][i], L = arc[c][arc[c].length - 1], near = 26;
    return (C.mods[0] === o.module && s < near + C.pin[0]) || (C.mods[C.mods.length - 1] === o.module && L - s < near + C.pin[1]);
  };
  const pushOut = (c: number, i: number) => {
    const q = beads[c][i], r = cables[c].r;
    const l = ogrid.get(okey(Math.floor(q[0] / OC), Math.floor(q[1] / OC), Math.floor(q[2] / OC)));
    if (!l) return false;
    let moved = false;
    for (const n of l) {
      const o = obs[n], b = o.box;
      if (q[0] <= b[0] - r || q[0] >= b[3] + r || q[1] <= b[1] - r || q[1] >= b[4] + r || q[2] <= b[2] - r || q[2] >= b[5] + r) continue;
      if (ownOk(c, i, o)) continue;
      // out through the nearest face (never down through the floor it lies on)
      const pen = [q[0] - (b[0] - r), b[3] + r - q[0], q[1] - (b[1] - r), b[4] + r - q[1], q[2] - (b[2] - r), b[5] + r - q[2]];
      let best = 5, bv = pen[5];
      for (let f = 0; f < 6; f++) if (f !== 4 && pen[f] < bv) { bv = pen[f]; best = f; }
      const ax = best >> 1, sg = best & 1 ? 1 : -1;
      q[ax] += sg * (bv + 0.05);
      moved = true;
    }
    return moved;
  };

  const tangent = (c: number, i: number) => { const b = beads[c]; return unit(sub(b[Math.min(b.length - 1, i + 1)], b[Math.max(0, i - 1)])); };
  const CC = Math.max(4, 2 * rMax + GAP + 1);
  const ckey = (q: number[]) => `${Math.floor(q[0] / CC)},${Math.floor(q[1] / CC)},${Math.floor(q[2] / CC)}`;

  for (let round = 0; round < rounds; round++) {
    // 1. cables that touch push apart
    const grid = new Map<string, [number, number][]>();
    beads.forEach((b, c) => b.forEach((q, i) => { const k = ckey(q); const l = grid.get(k); if (l) l.push([c, i]); else grid.set(k, [[c, i]]); }));
    beads.forEach((b, c) => b.forEach((q, i) => {
      const gi = Math.floor(q[0] / CC), gj = Math.floor(q[1] / CC), gk = Math.floor(q[2] / CC);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) {
        const l = grid.get(`${gi + di},${gj + dj},${gk + dk}`);
        if (!l) continue;
        for (const [c2, i2] of l) {
          if (c2 <= c) continue; // each pair once
          const p2 = beads[c2][i2], need = cables[c].r + cables[c2].r + GAP;
          const d = sub(p2, q), D = len(d);
          if (D >= need) continue;
          const h1 = held[c][i], h2 = held[c2][i2];
          if (h1 && h2) continue;
          // which way apart: where they cross, one goes over the other (the later one on top); alongside, straight apart
          const t1 = tangent(c, i), t2 = tangent(c2, i2);
          let n: number[];
          const across = cross(t1, t2);
          if (len(across) > 0.5) {
            // keep whichever is already on top there on top; if neither is yet, the later one goes over
            n = unit(across);
            const k = dot(d, n);
            if (Math.abs(k) > 0.3 * need ? k < 0 : n[2] < 0 || (Math.abs(n[2]) < 0.2 && k < 0)) n = n.map((v) => -v);
          }
          else if (D > 1e-3) { const k = dot(d, t1); n = unit([d[0] - k * t1[0], d[1] - k * t1[1], d[2] - k * t1[2]]); }
          else { n = unit(cross(t1, Math.abs(t1[2]) < 0.9 ? cross([0, 0, 1], t1) : [1, 0, 0])); if (n[2] < 0) n = n.map((v) => -v); }
          // how far apart they already are that way
          const sep = dot(d, n), move = need - sep;
          if (move <= 0) continue;
          const w1 = h1 ? 0 : h2 ? 1 : 0.5, w2 = 1 - w1;
          for (let a = 0; a < 3; a++) { q[a] -= n[a] * move * w1; p2[a] += n[a] * move * w2; }
        }
      }
    }));
    // 2. out of holders, docks and plugs, and never below where the cable was laid
    beads.forEach((b, c) => b.forEach((_, i) => { if (!held[c][i]) pushOut(c, i); }));
    // 3. every chain keeps its length (it can't stretch), and bends ease out
    beads.forEach((b, c) => {
      if (cables[c].fixed) return;
      for (let pass = 0; pass < 2; pass++) for (let i = 1; i < b.length; i++) {
        const d = sub(b[i], b[i - 1]), D = len(d), L0 = rest[c][i];
        if (D < 1e-9) continue;
        const e = (D - L0) / D, h0 = held[c][i - 1], h1 = held[c][i];
        if (h0 && h1) continue;
        const w0 = h0 ? 0 : h1 ? 1 : 0.5, w1 = 1 - w0;
        for (let a = 0; a < 3; a++) { b[i - 1][a] += d[a] * e * w0; b[i][a] -= d[a] * e * w1; }
      }
      for (let i = 1; i + 1 < b.length; i++) {
        if (held[c][i]) continue;
        for (let a = 0; a < 3; a++) b[i][a] += 0.12 * ((b[i - 1][a] + b[i + 1][a]) / 2 - b[i][a]);
        if (b[i][2] < floor[c]) b[i][2] = floor[c];
      }
    });
  }
  // a last push out of everything, so nothing ends up inside a holder
  beads.forEach((b, c) => b.forEach((_, i) => { if (!held[c][i]) pushOut(c, i); }));

  // what still touches, for the report
  const touching = new Set<string>(), inside = new Set<string>();
  const grid = new Map<string, [number, number][]>();
  beads.forEach((b, c) => b.forEach((q, i) => { const k = ckey(q); const l = grid.get(k); if (l) l.push([c, i]); else grid.set(k, [[c, i]]); }));
  beads.forEach((b, c) => b.forEach((q, i) => {
    if (held[c][i]) return;
    const gi = Math.floor(q[0] / CC), gj = Math.floor(q[1] / CC), gk = Math.floor(q[2] / CC);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) for (const [c2, i2] of grid.get(`${gi + di},${gj + dj},${gk + dk}`) ?? []) {
      if (c2 <= c || held[c2][i2]) continue;
      if (len(sub(beads[c2][i2], q)) < cables[c].r + cables[c2].r - 0.3) touching.add(`${cables[c].id}|${cables[c2].id}`);
    }
    const l = ogrid.get(okey(Math.floor(q[0] / OC), Math.floor(q[1] / OC), Math.floor(q[2] / OC)));
    for (const n of l ?? []) {
      const bx = obs[n].box, r = cables[c].r - 0.5;
      if (q[0] > bx[0] - r && q[0] < bx[3] + r && q[1] > bx[1] - r && q[1] < bx[4] + r && q[2] > bx[2] - r && q[2] < bx[5] + r && !ownOk(c, i, obs[n])) inside.add(cables[c].id);
    }
  }));
  return { paths: beads, touching: [...touching].map((k) => k.split('|') as [string, string]), inside: [...inside] };
}
