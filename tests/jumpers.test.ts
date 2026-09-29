// Jumper wires from a USB-serial adapter to a board's UART header (and a serial cable's loose ends), measured in the
// rack's frame: each wire ends on its own pin at both ends, past the pin's tip where the back of the housing pushed on
// it is, leaves straight out, and runs through nothing on its way (no board, holder, plug, rail, other cable or tag).
import { describe, it, expect, beforeAll } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { autoLinks, numberLinks } from '../src/model/links';
import { addAdapters, addUartLinks, fillWires, headerPins, isAdapter, markDebug, stackCompanions, uartHeaders, uartPins } from '../src/model/probes';
import { generate } from '../src/cad/assembly';
import { initKernel } from '../src/cad/kernel';
import type { GenResult, Link, Project } from '../src/model/types';
import { measure } from './collide/measure';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();

/** A rack of these boards, built once as it is (as the app does when they go in), then each board's UART header given
 * an adapter and everything connected (as Board › Add USB-serial adapter and Auto-connect do). */
function rack(ids: string[], f?: (p: Project) => void): { p: Project; r: GenResult } {
  const p = newProject(T(ids[0]));
  for (const id of ids.slice(1)) p.modules.push(newModule(T(id)));
  f?.(p);
  generate(p);
  for (const m of [...p.modules]) if (uartHeaders(m.board).length) addAdapters(p, m.id);
  p.links = numberLinks([...(p.links ?? []), ...autoLinks(p)]).map((l) => fillWires(p, l));
  stackCompanions(p);
  return { p, r: generate(p) };
}

const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** A point of the rack in a module's own frame (its holder's: the board in x, y, its top face up). */
const local = (F: number[], q: number[]) => { const d = sub(q, [F[12], F[13], F[14]]); return [0, 1, 2].map((k) => F[4 * k] * d[0] + F[4 * k + 1] * d[1] + F[4 * k + 2] * d[2]); };

/**
 * One end of one wire, against its pin as drawn: how far the wire's end is off the pin's axis and how far past the
 * pin's tip it is (the back of the housing); the same 2 mm further along the wire; and the least it is past the tip
 * over its first 10 mm (less than at its end: it doubles back over its housing).
 */
function atPin(p: Project, r: GenResult, end: Link['a'], pinN: string, tube: number[][]) {
  const m = p.modules.find((x) => x.id === end.module)!, c = m.board.comps.find((x) => x.ref === end.ref)!;
  const F = r.report.frames![m.id], q = headerPins(c).find((x) => x.n === pinN)!;
  // the way its housing goes on: straight down onto an upright pin, along a right-angle one over the edge
  const a = c.conn!.type === 'pins_ra' ? [Math.cos((c.conn!.angle * Math.PI) / 180), Math.sin((c.conn!.angle * Math.PI) / 180), 0] : [0, 0, 1];
  // the pin as drawn: the gold within half a millimetre of its axis, and its tip (its furthest out along it)
  const gold: number[][] = [];
  for (const g of r.ghosts) {
    if (g.tag?.module !== m.id || g.mat !== 'gold') continue;
    for (let i = 0; i < g.mesh.pos.length; i += 3) {
      const v = local(F, [g.mesh.pos[i], g.mesh.pos[i + 1], g.mesh.pos[i + 2]]), dx = v[0] - q.x, dy = v[1] - q.y, t = dx * a[0] + dy * a[1];
      if (Math.hypot(dx - a[0] * t, dy - a[1] * t) < 0.5 && (a[2] || t > 0)) gold.push(v);
    }
  }
  const out = Math.max(...gold.map((v) => dot(v, a))), tipPts = gold.filter((v) => dot(v, a) > out - 0.05);
  const tip = [0, 1, 2].map((k) => tipPts.reduce((s, v) => s + v[k], 0) / tipPts.length);
  const off = (v: number[]) => { const d = sub(v, tip), t = dot(d, a); return Math.hypot(d[0] - a[0] * t, d[1] - a[1] * t, d[2] - a[2] * t); };
  const past = (v: number[]) => dot(sub(v, tip), a);
  // from the end on this pin's side
  const ends = [tube[0], tube[tube.length - 1]].map((x) => local(F, x));
  const k = off(ends[0]) + Math.abs(past(ends[0])) < off(ends[1]) + Math.abs(past(ends[1])) ? 0 : 1;
  const run = (k ? [...tube].reverse() : tube).map((x) => local(F, x));
  let s = 0, at2 = run[0], least = Infinity;
  for (let i = 1; i < run.length && s < 10; i++) {
    const L = Math.hypot(...sub(run[i], run[i - 1]));
    if (s < 2 && s + L >= 2) at2 = run[i - 1].map((v, j) => v + ((run[i][j] - v) * (2 - s)) / L);
    s += L;
    least = Math.min(least, past(run[i]));
  }
  return { found: gold.length, off: off(run[0]), past: past(run[0]), off2: off(at2), past2: past(at2), least };
}

/** A wire's centre line: the middle of each ring of its tube. */
function centreLine(pos: Float32Array, sides = 8) {
  const n = (pos.length / 3 - 2 - 2 * sides) / sides, out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const c = [0, 0, 0];
    for (let k = 0; k < sides; k++) for (let j = 0; j < 3; j++) c[j] += pos[(i * sides + k) * 3 + j] / sides;
    out.push(c);
  }
  return out;
}

/** Every jumper wire of the rack measured at both its pins, and what it runs into. */
function check(p: Project, r: GenResult) {
  const jumpers = (p.links ?? []).filter((l) => l.kind === 'jumper');
  expect(jumpers.length).toBeGreaterThan(0);
  for (const l of jumpers) {
    const tubes = r.ghosts.filter((g) => g.name.startsWith(`cable ${l.id} wire `));
    // every wire drawn: three for a serial crossover
    expect(tubes.length).toBe(l.wires!.length);
    l.wires!.forEach((w, i) => {
      const tube = centreLine(tubes.find((g) => g.name === `cable ${l.id} wire ${i}`)!.mesh.pos);
      for (const [end, n] of [[l.a, w.a], [l.b, w.b]] as const) {
        const e = atPin(p, r, end, n, tube);
        const what = `wire ${i} at ${end.ref} pin ${n}`;
        expect(e.found, what).toBeGreaterThan(0);
        // on the pin's axis, past its tip by the housing's length or less: where the housing's back is
        expect(e.off, what).toBeLessThan(0.3);
        expect(e.past, what).toBeGreaterThan(1);
        expect(e.past, what).toBeLessThan(16);
        // out of the housing's back straight on, and not doubled back over it
        expect(e.off2, what).toBeLessThan(0.3);
        expect(e.past2, what).toBeGreaterThan(e.past + 1.5);
        expect(e.least, what).toBeGreaterThan(e.past);
      }
    });
  }
  // nothing in the way but its own housings and the wires beside it: no board, holder, dock, plug, rail, stand, other
  // cable or cable tag (its own tags go round the bundle)
  const linkOf = (name: string) => jumpers.find((l) => name.startsWith(`cable ${l.id} wire `));
  const into = measure(p, r).worst.filter((o) => (linkOf(o.a) || linkOf(o.b)) && !(o.cat === 'cable-cable' && linkOf(o.a) === linkOf(o.b)));
  expect(into.map((o) => `${o.a} into ${o.b}: ${o.vol.toFixed(2)} mm³`)).toEqual([]);
}

describe('jumper wires from a USB-serial adapter', () => {
  beforeAll(async () => { await initKernel(); });

  it('reach the pins of a board built before its adapter was added, standing in its dock', () => {
    const { p, r } = rack(['example_dual_swd']);
    check(p, r);
    // (standing, its header facing the front of the rack)
    expect(r.report.frames![p.modules[0].id][9]).toBeCloseTo(-1, 3);
  }, 120_000);

  it('reach the pins lying flat', () => {
    const { p, r } = rack(['example_dual_swd'], (q) => { q.panel.lie = 'flat'; });
    check(p, r);
  }, 120_000);

  it('reach the pins on a rack of several boards', () => {
    const { p, r } = rack(['example_dual_swd', 'example_jtag', 'usb_hub7', 'rpi4']);
    expect(p.links!.filter((l) => l.kind === 'jumper').length).toBe(2);
    check(p, r);
  }, 120_000);

  it('go over a board from the adapter behind it, not through it', () => {
    // a relay board's pin header marked as a UART header (Board › Debug & UART headers); its adapter stands in the
    // back slot of its dock, back to back with it, so the wires go over the board to the header on its face
    const { p, r } = rack(['relay4'], (q) => markDebug(q.modules[0].board.comps.find((c) => c.ref === 'J1')!, 'uart'));
    const F0 = r.report.frames![p.modules[0].id], F1 = r.report.frames![p.modules.find(isAdapter)!.id];
    expect(F0[8] * F1[8] + F0[9] * F1[9] + F0[10] * F1[10]).toBeCloseTo(-1, 3);
    check(p, r);
  }, 120_000);

  it('follow a wire moved to another pin in the Wiring view', () => {
    const { p } = rack(['example_jtag']);
    const l = p.links!.find((x) => x.kind === 'jumper')!;
    // the ground wire moved to pin 1 (as for a board whose ground is there)
    const b = l.b.module === p.modules[0].id ? 'b' : 'a';
    l.wires = l.wires!.map((w, i) => (i === 0 ? { ...w, [b]: '1' } : w));
    check(p, generate(p));
  }, 120_000);

  it("put a serial cable's loose ends on the header's pins when it goes on after Auto-connect", () => {
    // (the same fault: a board whose USB was already cabled had its holder built again without them)
    const p = newProject(T('example_dual_swd'));
    p.modules.push(newModule(T('usb_hub7')));
    p.links = numberLinks(autoLinks(p));
    generate(p);
    expect(addUartLinks(p, p.modules[0].id).added).toBe(1);
    const r = generate(p), l = p.links!.find((x) => x.kind === 'uart')!, u = uartPins(uartHeaders(p.modules[0].board)[0])!;
    const head = l.a.module === p.modules[0].id ? l.a : l.b;
    [u.gnd, u.rx, u.tx].forEach((pin, i) => {
      const g = r.ghosts.find((x) => x.name === `cable ${l.id} wire ${i}`);
      expect(g, `loose end ${i}`).toBeDefined();
      const e = atPin(p, r, head, pin.n, centreLine(g!.mesh.pos));
      expect(e.off, `loose end ${i}`).toBeLessThan(0.3);
      expect(e.past, `loose end ${i}`).toBeGreaterThan(1);
      expect(e.past, `loose end ${i}`).toBeLessThan(16);
    });
  }, 120_000);
});
