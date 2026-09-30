// Cables settling into place, the way real ones do once they are plugged in and pressed down: the router plans each
// cable's way (out of its plug, down to its street, along it and back up), then this lets them all settle together.
// Each cable is a chain of beads; over a few dozen rounds, beads of two cables that touch push apart (one lies over
// the other where they cross, side by side where they run together), beads inside a holder, dock or plug are pushed
// out, every chain keeps its length, and bends ease out. The ends stay in their plugs. Like real cables they have
// weight (a span in the air sags, a cable leaving a plug droops towards the floor), a little slack (they are never
// pulled taut), and stiffness that grows with thickness (a thick power lead bends in wide curves, never tighter than
// a few times its own width; a jumper wire bends tight). Ribbons and other fixed runs take part as things the rest
// settle round. Rack frame: u along the rails, v across them, z up (mm). Pure.

export type Box = number[]; // [u0, v0, z0, u1, v1, z1]

export interface SimCable {
  id: string;
  pts: number[][]; // the planned path
  r: number; // radius
  pin: [number, number]; // mm at each end held straight in its plug
  fixed?: boolean; // doesn't move (a ribbon): the others settle round it
  free?: boolean; // settles wherever it lies best (loose jumper wires): no pull back to the laid line
  mods?: string[]; // the boards at its ends: their own holders don't push it within `own` mm of that end
  plugs?: string[]; // its own plugs: never push it
  grip?: number[][]; // where a comb or clip holds it (it stays in the slot there)
  stiff?: [number, number]; // mm beyond each pin where it keeps close to the shape it was laid in (springy, not held)
  floor?: number; // the lowest its middle can hang (where the streets are); default: the lowest point of its planned way
}
export interface SimObstacle { box: Box; module?: string; plug?: string; stand?: boolean; solid?: boolean }
export interface SimResult { paths: number[][][]; touching: [string, string][]; inside: string[]; kinked: string[] }

const STEP = 2.5; // bead spacing
const GAP = 0.25; // clearance kept between two cables
const BRUSH = 0.8; // a cable may brush a box by this much (as the router allows): boxes are the parts' bounds, not their shape
const BRUSH_SOLID = 0.1; // ... but a plug and its lead, or a rail (the crown under it, the lip beside it), fill their box: a cable settles beside one
const brush = (o: SimObstacle) => (o.plug || o.solid || o.module ? BRUSH_SOLID : BRUSH);
const SLACK = 0.03; // cables are a few per cent longer than the shortest way: they lie, not stretch
const SAG = 0.8; // how far weight pulls a free bead down each round (mm)
const BEND = 3; // tightest bend, in cable diameters
const KEEP = 0.05; // how firmly every bead keeps to where it was laid, all along (the plan spread the crossings and lanes: settling only resolves what touches, it must not cut the corners)

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
/** A stretch where a cable keeps to the line it was laid on across: under a rail (the two cables that cross there
 * must not drift into each other), plus a margin so that any turn starts outside. `k`: the axis across the band. */
export interface Band { k: number; lo: number; hi: number; e0: number; e1: number }

export function settleCables(cables: SimCable[], obs: SimObstacle[], rounds = 60, bands: Band[] = []): SimResult {
  const beads = cables.map((c) => resample(c.pts));
  const plan = beads.map((b) => b.map((q) => q.slice())); // where each bead was laid: the side of anything it is pushed back to
  // arc length of every bead from each end, and which are held in their plugs
  const arc = beads.map((b) => { const s = [0]; for (let i = 1; i < b.length; i++) s.push(s[i - 1] + len(sub(b[i], b[i - 1]))); return s; });
  const held = cables.map((c, k) => { const s = arc[k], L = s[s.length - 1]; return s.map((x) => c.fixed || x <= c.pin[0] || L - x <= c.pin[1]); });
  // beads laid across a band stay on their line across it (to within a little play): the crossings were spread
  const lat = cables.map((C, k) => beads[k].map((q) => {
    if (C.fixed || q[2] > (C.floor ?? q[2]) + 2) return null;
    const b = bands.find((x) => q[x.k] > x.lo && q[x.k] < x.hi && q[1 - x.k] > x.e0 && q[1 - x.k] < x.e1);
    return b ? { o: 1 - b.k, at: q[1 - b.k] } : null;
  }));
  const PLAY = 0.4;
  const pinLat = () => beads.forEach((b, c) => b.forEach((q, i) => { const p = lat[c][i]; if (p) q[p.o] = Math.max(p.at - PLAY, Math.min(p.at + PLAY, q[p.o])); }));
  // a comb holds the cable in its slot: the bead nearest it goes into the slot, and it and the one each side are held
  cables.forEach((C, k) => { for (const g of C.grip ?? []) { let bi = -1, bd = 4; beads[k].forEach((q, i) => { const dd = len(sub(q, g)); if (dd < bd) { bd = dd; bi = i; } }); if (bi < 0) continue; beads[k][bi] = g.slice(); plan[k][bi] = g.slice(); for (const j of [bi - 1, bi, bi + 1]) if (j >= 0 && j < beads[k].length) held[k][j] = true; } });
  // rest lengths: the free stretch a few per cent longer than laid (the held ends are exactly as laid, so their share
  // of the slack doesn't all bunch up in the middle)
  const rest = beads.map((b, c) => b.map((_, i) => (i ? len(sub(b[i], b[i - 1])) * (cables[c].fixed || held[c][i] || held[c][i - 1] ? 1 : 1 + SLACK) : 0)));
  const floor = beads.map((b, c) => Math.min(cables[c].floor ?? Infinity, ...b.map((q) => q[2])));
  // how much of its weight each bead hangs on (none by the plugs, all from a few diameters out)
  const carry = cables.map((C, k) => { const S = arc[k], L = S[S.length - 1], ramp = 40; return S.map((x) => { const e = Math.min(x - C.pin[0] - (C.stiff?.[0] ?? 12 * C.r), L - x - C.pin[1] - (C.stiff?.[1] ?? 12 * C.r)); return Math.max(0, Math.min(1, e / ramp)); }); });
  // and how firmly each keeps to where it was laid (its stiff stretches out of the plugs, easing off beyond them)
  const keep = cables.map((C, k) => { const S = arc[k], L = S[S.length - 1]; return S.map((x) => { const e = Math.min(x - C.pin[0] - (C.stiff?.[0] ?? 0), L - x - C.pin[1] - (C.stiff?.[1] ?? 0)); return C.stiff ? Math.max(C.free ? 0 : KEEP, 0.12 * Math.max(0, Math.min(1, 1 - e / 20))) : 0; }); });
  const rMax = Math.max(1, ...cables.map((c) => c.r));

  // obstacles on a coarse grid, so each bead only looks at the few near it
  const OC = 24, ogrid = new Map<string, number[]>();
  const okey = (i: number, j: number, k: number) => `${i},${j},${k}`;
  obs.forEach((o, n) => {
    const b = o.box, g = rMax + 1;
    for (let i = Math.floor((b[0] - g) / OC); i <= Math.floor((b[3] + g) / OC); i++)
      for (let j = Math.floor((b[1] - g) / OC); j <= Math.floor((b[4] + g) / OC); j++)
        for (let k = Math.floor((b[2] - g) / OC); k <= Math.floor((b[5] + g) / OC); k++) { const key = okey(i, j, k); const l = ogrid.get(key); if (l) l.push(n); else ogrid.set(key, [n]); }
  });
  const inBox = (q: number[], b: Box, r: number) => q[0] > b[0] - r && q[0] < b[3] + r && q[1] > b[1] - r && q[1] < b[4] + r && q[2] > b[2] - r && q[2] < b[5] + r;
  // its own plugs never push it; its own board's holder only lets it be where it was laid (the way out of the plug),
  // never lets it sink in further
  const ownOk = (c: number, i: number, o: SimObstacle) => {
    const C = cables[c];
    if (o.plug && C.plugs?.includes(o.plug)) return true;
    // a stand is solid, except where this cable lies in its comb
    if (o.stand) return (C.grip ?? []).some((g) => Math.hypot(beads[c][i][0] - g[0], beads[c][i][1] - g[1]) < 6 + C.r);
    return !!o.module && !!C.mods?.includes(o.module) && inBox(plan[c][i], o.box, C.r - 0.5);
  };
  const pushOut = (c: number, i: number) => {
    const q = beads[c][i];
    const l = ogrid.get(okey(Math.floor(q[0] / OC), Math.floor(q[1] / OC), Math.floor(q[2] / OC)));
    if (!l) return false;
    let moved = false;
    for (const n of l) {
      const o = obs[n], b = o.box, r = Math.max(0.3, cables[c].r - brush(o));
      if (q[0] <= b[0] - r || q[0] >= b[3] + r || q[1] <= b[1] - r || q[1] >= b[4] + r || q[2] <= b[2] - r || q[2] >= b[5] + r) continue;
      if (ownOk(c, i, o)) continue;
      // back out on the side it was laid (so it never pops through a thin board to the far side), by the shortest
      // way on that side
      const pen = [q[0] - (b[0] - r), b[3] + r - q[0], q[1] - (b[1] - r), b[4] + r - q[1], q[2] - (b[2] - r), b[5] + r - q[2]];
      const P = plan[c][i], was = [P[0] <= b[0] - r, P[0] >= b[3] + r, P[1] <= b[1] - r, P[1] >= b[4] + r, P[2] <= b[2] - r, P[2] >= b[5] + r];
      // laid inside it already (the route couldn't avoid it): out across its own way, sideways or up, never along
      // it (that would drag the cable lengthwise and stretch it) and never down
      const inside = !was.some(Boolean), t = inside ? tangent(c, i) : null;
      let best = -1, bv = Infinity;
      for (let f = 0; f < 6; f++) {
        const ok = inside ? f !== 4 && Math.abs(t![f >> 1]) < 0.7 : was[f];
        if (ok && pen[f] < bv) { bv = pen[f]; best = f; }
      }
      if (best < 0) continue;
      const ax = best >> 1, sg = best & 1 ? 1 : -1;
      q[ax] += sg * (bv + 0.05);
      moved = true;
    }
    return moved;
  };

  const tangent = (c: number, i: number) => { const b = beads[c]; return unit(sub(b[Math.min(b.length - 1, i + 1)], b[Math.max(0, i - 1)])); };
  // whether two beads (at q and p2, running t1 and t2) are closer than `need`: bead to bead, or where their cables cross,
  // between the beads (the nearest points are up to half a step from them): the lines through them
  const closer = (q: number[], t1: number[], p2: number[], t2: number[], need: number) => {
    const d = sub(p2, q), D = len(d);
    if (D < need) return true;
    if (D >= need + 1.8) return false;
    const across = cross(t1, t2), nn = len(across);
    if (nn < 0.5) return false;
    const k1 = dot(d, t1), k2 = dot(d, t2), cc = dot(t1, t2);
    return Math.abs(dot(d, across)) / nn < need && Math.abs(k1 - cc * k2) / (nn * nn) <= 1.5 && Math.abs(cc * k1 - k2) / (nn * nn) <= 1.5;
  };
  const CC = Math.max(4, 2 * rMax + GAP + 1);
  const ckey = (q: number[]) => `${Math.floor(q[0] / CC)},${Math.floor(q[1] / CC)},${Math.floor(q[2] / CC)}`;

  // cables that touch push apart
  const pushApart = () => {
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
          if (D >= need + 1.8) continue;
          const t1 = tangent(c, i), t2 = tangent(c2, i2), across = cross(t1, t2);
          if (!closer(q, t1, p2, t2, need)) continue;
          const h1 = held[c][i], h2 = held[c2][i2];
          if (h1 && h2) continue;
          // which way apart: where they cross, one goes over the other (the later one on top); alongside, straight apart
          let n: number[];
          if (len(across) > 0.5) {
            // keep whichever is already on top there on top; if neither is yet, the later one goes over
            n = unit(across);
            const k = dot(d, n);
            if (Math.abs(k) > 0.3 * need ? k < 0 : n[2] < 0 || (Math.abs(n[2]) < 0.2 && k < 0)) n = n.map((v) => -v);
          }
          else if (D > 1e-3) {
            // alongside: side by side on the level, as cables lying together do (one balanced on another rolls off
            // it); straight apart where the run is steep
            const k = dot(d, t1), side = cross([0, 0, 1], t1);
            if (len(side) > 0.5) { n = unit(side); if (dot(d, n) < 0) n = n.map((v) => -v); }
            else n = unit([d[0] - k * t1[0], d[1] - k * t1[1], d[2] - k * t1[2]]);
          }
          else { n = unit(cross(t1, Math.abs(t1[2]) < 0.9 ? cross([0, 0, 1], t1) : [1, 0, 0])); if (n[2] < 0) n = n.map((v) => -v); }
          // how far apart they already are that way
          const sep = dot(d, n), move = need - sep;
          if (move <= 0) continue;
          let w1 = h1 ? 0 : h2 ? 1 : 0.5, w2 = 1 - w1, m = move;
          // never through the floor: the one that would go under goes over instead
          if ((w1 > 0 && q[2] - n[2] * m * w1 < floor[c] - 0.01) || (w2 > 0 && p2[2] + n[2] * m * w2 < floor[c2] - 0.01)) {
            n = n.map((v) => -v);
            m = need - dot(d, n);
            if (w1 > 0 && w2 > 0) { const up = n[2] > 0 ? 'p2' : 'q'; w1 = up === 'q' ? 1 : 0; w2 = 1 - w1; }
          }
          // spread along each cable (a cable is pushed aside as a curve, not a single dent)
          const shove = (cc: number, ii: number, s2: number) => {
            const b = beads[cc];
            for (const [o, f] of [[0, 1], [-1, 0.5], [1, 0.5], [-2, 0.2], [2, 0.2]] as const) {
              const j = ii + o;
              if (j < 0 || j >= b.length || held[cc][j]) continue;
              for (let a = 0; a < 3; a++) b[j][a] += n[a] * m * s2 * f;
            }
          };
          if (w1 > 0) shove(c, i, -w1);
          if (w2 > 0) shove(c2, i2, w2);
        }
      }
    }));
  };

  // first, cables laid on top of one another (two out of neighbouring plugs down the same way) are eased apart, side
  // by side, keeping their lengths; that is the shape each then keeps near its plugs
  for (let k = 0; k < (rounds ? 24 : 0); k++) {
    pushApart();
    beads.forEach((b, c) => {
      if (cables[c].fixed) return;
      for (let i = 1; i < b.length; i++) {
        const d = sub(b[i], b[i - 1]), D = len(d), h0 = held[c][i - 1], h1 = held[c][i];
        if (D < 1e-9 || (h0 && h1)) continue;
        const e = (D - len(sub(plan[c][i], plan[c][i - 1]))) / D, w0 = h0 ? 0 : h1 ? 1 : 0.5;
        for (let a = 0; a < 3; a++) { b[i - 1][a] += d[a] * e * w0; b[i][a] -= d[a] * e * (1 - w0); }
      }
      b.forEach((_, i) => { if (!held[c][i]) pushOut(c, i); });
    });
    pinLat();
  }
  const shape = beads.map((b) => b.map((q) => q.slice()));

  for (let round = 0; round < rounds; round++) {
    // 0. weight: every free bead is pulled down (the floor, holders and other cables hold it up)
    const g = SAG * Math.min(1, 3.3 * (1 - round / Math.max(1, rounds))); // full weight, easing off over the last rounds so it comes to rest
    // (near a plug a cable is carried by its own stiffness: weight takes over only a few diameters out)
    beads.forEach((b, c) => { if (!cables[c].fixed) b.forEach((q, i) => { if (!held[c][i]) q[2] = Math.max(floor[c], q[2] - g * carry[c][i]); }); });
    // 1. every chain keeps its length (it can't stretch) and its stiffness: bends ease out (stiffer the thicker it
    // is), and nowhere tighter than it can bend, not even where it leaves a plug. A few passes, so weight and
    // stiffness settle into a smooth hang rather than a kink by the plug.
    beads.forEach((b, c) => {
      if (cables[c].fixed) return;
      const k0 = Math.min(0.25, 0.02 + 0.05 * cables[c].r), tight = STEP / (BEND * 2 * cables[c].r); // turn per bead (rad) at the tightest bend
      const H = held[c];
      for (let pass = 0; pass < 8; pass++) {
        // (each way in turn, so a pull at one end reaches the other within the pass)
        for (let k2 = 1; k2 < b.length; k2++) {
          const i = pass % 2 ? b.length - k2 : k2;
          const d = sub(b[i], b[i - 1]), D = len(d), L0 = rest[c][i];
          if (D < 1e-9) continue;
          const e = (D - L0) / D, h0 = H[i - 1], h1 = H[i];
          if (h0 && h1) continue;
          // the bead ahead in the sweep takes the whole step (follow the leader: a long chain comes to its length in
          // a few sweeps, where splitting each step between the two would take hundreds)
          const lead = pass % 2 ? i - 1 : i, w0 = h0 ? 0 : h1 ? 1 : lead === i - 1 ? 1 : 0, w1 = 1 - w0;
          for (let a = 0; a < 3; a++) { b[i - 1][a] += d[a] * e * w0; b[i][a] -= d[a] * e * w1; }
        }
        for (let i = 1; i + 1 < b.length; i++) {
          if (H[i - 1] && H[i] && H[i + 1]) continue;
          const u = unit(sub(b[i], b[i - 1])), w = unit(sub(b[i + 1], b[i])), turn = Math.acos(Math.max(-1, Math.min(1, dot(u, w))));
          const over = turn > tight ? 1 - tight / turn : 0;
          if (!H[i]) {
            // a free bead: towards the middle of its neighbours (always a little, a lot where it bends too tight)
            const k = Math.min(0.9, (pass ? 0 : k0) + over); // stiffness once a round (more straightens it like a string pulled taut)
            for (let a = 0; a < 3; a++) b[i][a] += k * ((b[i - 1][a] + b[i + 1][a]) / 2 - b[i][a]);
            // and its free neighbours the other way, so the bend spreads along the cable instead of just moving
            if (over > 0) for (const j2 of [i - 1, i + 1]) if (!H[j2]) for (let a = 0; a < 3; a++) b[j2][a] -= 0.25 * over * ((b[i - 1][a] + b[i + 1][a]) / 2 - b[i][a]);
          } else if (over > 0) {
            // the last bead the plug holds: the free one after it goes back towards the plug's line
            const f = H[i + 1] ? b[i - 1] : b[i + 1], h0 = H[i + 1] ? b[i + 1] : b[i - 1];
            if (H[i + 1] === H[i - 1]) continue;
            const t = unit(sub(b[i], h0)), d0 = len(sub(f, b[i]));
            for (let a = 0; a < 3; a++) f[a] += Math.min(0.9, over * 1.5) * (b[i][a] + t[a] * d0 - f[a]);
          }
        }
        for (let i = 0; i < b.length; i++) {
          if (H[i]) continue;
          if (keep[c][i]) for (let a = 0; a < 3; a++) b[i][a] += keep[c][i] * (shape[c][i][a] - b[i][a]);
          if (b[i][2] < floor[c]) b[i][2] = floor[c];
        }
      }
    });
    // 2. then what touches: cables push apart, and out of holders, docks and plugs, never below where it was laid
    pushApart();
    beads.forEach((b, c) => b.forEach((_, i) => { if (!held[c][i]) pushOut(c, i); }));
    pinLat();
  }
  // a last push apart and out of everything, so nothing ends up inside a holder or another cable
  pushApart();
  beads.forEach((b, c) => b.forEach((_, i) => { if (!held[c][i]) pushOut(c, i); }));
  pinLat();

  // 3. last, the ripples out: every free bead eased towards its neighbours a few times over, each step kept only
  // where it leaves the bead clear of everything (holders, plugs, other cables), so a cable over a box's edge drapes
  // over it rather than stepping down it bead by bead
  {
    const grid = new Map<string, [number, number][]>();
    beads.forEach((b, c) => b.forEach((q, i) => { const k = ckey(q); const l = grid.get(k); if (l) l.push([c, i]); else grid.set(k, [[c, i]]); }));
    const clear = (c: number, i: number, q: number[]) => {
      const r = cables[c].r;
      for (const n of ogrid.get(okey(Math.floor(q[0] / OC), Math.floor(q[1] / OC), Math.floor(q[2] / OC))) ?? []) if (inBox(q, obs[n].box, Math.max(0.3, r - brush(obs[n])) - 0.1) && !ownOk(c, i, obs[n])) return false;
      if (q[2] < floor[c] - 1e-6) return false;
      const gi = Math.floor(q[0] / CC), gj = Math.floor(q[1] / CC), gk = Math.floor(q[2] / CC);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) for (const [c2, i2] of grid.get(`${gi + di},${gj + dj},${gk + dk}`) ?? []) {
        if (c2 === c) continue;
        if (closer(q, tangent(c, i), beads[c2][i2], tangent(c2, i2), r + cables[c2].r + GAP)) return false;
      }
      return true;
    };
    for (let it = 0; it < 16; it++) beads.forEach((b, c) => {
      if (cables[c].fixed) return;
      for (let i = 1; i + 1 < b.length; i++) {
        if (held[c][i]) continue;
        const mid = b[i].map((_, a) => (b[i - 1][a] + b[i + 1][a]) / 2);
        const target = keep[c][i] > 0.1 && clear(c, i, shape[c][i]) ? shape[c][i] : mid; // its stiff stretch: back to the shape it was laid in, if that's free
        const nq = b[i].map((v, a) => v + 0.5 * (target[a] - v));
        if (clear(c, i, nq)) b[i] = nq;
      }
    });
    pinLat();
  }

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
      const bx = obs[n].box, r = Math.max(0.3, cables[c].r - brush(obs[n])) - 0.05;
      if (q[0] > bx[0] - r && q[0] < bx[3] + r && q[1] > bx[1] - r && q[1] < bx[4] + r && q[2] > bx[2] - r && q[2] < bx[5] + r && !ownOk(c, i, obs[n])) inside.add(cables[c].id);
    }
  }));
  // and where one still bends tighter than a cable can (squeezed between things)
  const kinked = cables.filter((C, c) => !C.fixed && beads[c].some((_, i) => {
    const b = beads[c];
    if (i < 1 || i + 1 >= b.length || held[c][i]) return false;
    const u = unit(sub(b[i], b[i - 1])), w = unit(sub(b[i + 1], b[i]));
    return Math.acos(Math.max(-1, Math.min(1, dot(u, w)))) > (1.6 * STEP) / (BEND * 2 * C.r);
  })).map((C) => C.id);
  return { paths: beads, touching: [...touching].map((k) => k.split('|') as [string, string]), inside: [...inside], kinked };
}
