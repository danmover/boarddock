// J-Links and USB-serial adapters as ordinary boards, standing on their long edges in columns: each holder on pegs on
// the landing of the one below, one release rod down through them all; old projects' probe boxes turned into boards.
import { describe, it, expect, beforeAll } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { connById, migrate, newModule, newProject } from '../src/model/library';
import { autoLinks, numberLinks } from '../src/model/links';
import { addAdapters, addProbes, fillWires, isProbe, isSmall, ribbonOf } from '../src/model/probes';
import { columnable, columnOf, stackMode } from '../src/model/holes';
import { applyBox } from '../src/model/boxes';
import { generatePanel } from '../src/cad/panelgen';
import { initKernel } from '../src/cad/kernel';
import { LANDING } from '../src/cad/dockdims';
import { stackTargets } from '../src/ui/RackBuilder';
import type { Board, BoxPortGroup } from '../src/model/types';
import { measure } from './collide/measure';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
beforeAll(async () => { await initKernel(); });

/** A probe or adapter as projects saved them before: a bare box that slid into a slot behind its board. */
function oldBox(name: string, l: number, w: number, h: number, groups: Omit<BoxPortGroup, 'id'>[], ribbon?: number): Board {
  const b: Board = { name, outline: [], cutouts: [], thickness: 1, holes: [], comps: [], source: 'box', notes: [], color: '#9c2b25' };
  applyBox(b, { l, w, h, groups: groups.map((g, i) => ({ ...g, id: `g${i}` })), ...(ribbon ? { ribbon } : {}) });
  return b;
}

describe('old projects', () => {
  it('turn their J-Link and adapter boxes into boards, keeping their ports, cables and ribbon, a stack a column', () => {
    const p = newProject(T('example_dual_swd'));
    const jl = newModule(oldBox('J-Link (Dual-MCU controller J_SWD1)', 50, 50, 3, [{ type: 'swd10', count: 1, face: 'top', role: 'debug' }, { type: 'usb_micro_b', count: 1, face: 'back', role: 'device' }], 250));
    const ad = newModule(oldBox('USB-serial adapter (Dual-MCU controller J_UART)', 36, 18, 1.6, [{ type: 'pins_ra', count: 1, face: 'left', role: 'uart', pins: ['DTR', 'RXD', 'TXD', 'VCC', 'CTS', 'GND'] }, { type: 'usb_mini_b', count: 1, face: 'right', role: 'device' }]));
    ad.on = jl.id; ad.onMode = 'towers';
    p.modules.push(jl, ad);
    const dbg = jl.board.comps.find((c) => c.role === 'debug')!, pins = ad.board.comps.find((c) => c.role === 'uart')!;
    p.links = numberLinks([{ id: 'l1', a: { module: jl.id, ref: dbg.ref }, b: { module: p.modules[0].id, ref: 'J_SWD1' }, kind: 'debug' }, { id: 'l2', a: { module: ad.id, ref: pins.ref }, b: { module: p.modules[0].id, ref: 'J_UART' }, kind: 'jumper' }]);
    const q = migrate(JSON.parse(JSON.stringify(p)));
    const [j2, a2] = [q.modules[1], q.modules[2]];
    expect([j2.board.kind, j2.board.box, j2.board.role, a2.board.kind, a2.board.role]).toEqual([undefined, undefined, 'probe', undefined, 'adapter']);
    expect(ribbonOf(j2.board)).toBe(250);
    // the same port names, so the cables still find them; an edge port gets its connector's own footprint
    expect(j2.board.comps.find((c) => c.ref === dbg.ref)?.conn?.type).toBe('swd10');
    const usb = a2.board.comps.find((c) => c.conn?.type === 'usb_mini_b')!;
    expect(usb.w).toBeCloseTo(connById('usb_mini_b').body.l, 6);
    expect([isProbe(j2), isProbe(a2), stackMode(q, a2)]).toEqual([true, true, 'column']);
  });
});

describe('a column of a J-Link and an adapter', () => {
  const rack = () => {
    const p = newProject(T('example_jtag'));
    addProbes(p, p.modules[0].id);
    addAdapters(p, p.modules[0].id);
    p.links = numberLinks([...(p.links ?? []), ...autoLinks(p)]).map((l) => fillWires(p, l));
    return p;
  };

  it('stands the adapter on the J-Link, behind the board it serves', () => {
    const p = rack(), [, jl, ad] = p.modules;
    expect([ad.on, stackMode(p, ad), columnOf(p, jl).map((m) => m.id)]).toEqual([jl.id, 'column', [ad.id]]);
    const r = generatePanel(p), dock = r.report.panel!.mounts.find((m) => m.slots.some((s) => s.module === p.modules[0].id))!;
    expect(dock.slots.map((s) => s.module)).toEqual([p.modules[0].id, jl.id]);
    expect(dock.turn % 180).toBe(0); // the column's long side along the rail
  });

  it('builds each holder on its own, pegged onto the landing below, one rod down through both, and nothing in the way', () => {
    const p = rack(), [, jl, ad] = p.modules, r = generatePanel(p);
    expect(r.report.warnings.filter((w) => /runs into|overlap|Nothing clips|ribbon is/.test(w))).toEqual([]);
    const col = (id: string) => r.report.checks.find((c) => c.name === 'Column' && c.group.startsWith(p.modules.find((m) => m.id === id)!.board.name));
    expect([col(jl.id)?.value, col(ad.id)?.value]).toEqual(['1 of 2', '2 of 2']);
    // the J-Link's holder plugs into the socket (its tongue carries the whole column), the adapter's has the button
    const tongue = r.report.checks.filter((c) => /^Tongue root/.test(c.name) && c.group.startsWith('J-Link'));
    expect(tongue.length).toBe(1);
    expect(tongue[0].status).not.toBe('bad');
    expect(r.report.checks.some((c) => /^Tongue root/.test(c.name) && c.group.startsWith('USB-serial'))).toBe(false);
    expect(r.report.checks.some((c) => c.name === 'Release' && c.group.startsWith('USB-serial'))).toBe(true);
    // one rod for the column, on the top holder, reaching from the socket to the button over the top
    const rods = r.parts.filter((x) => x.tag?.kind === 'rod' && (x.tag.module === jl.id || x.tag.module === ad.id));
    expect(rods.map((x) => x.tag!.module)).toEqual([ad.id]);
    const zs = (x: typeof rods[number]) => { const T = x.toAssembly, z: number[] = []; for (let i = 0; i < x.mesh.pos.length; i += 3) z.push(T[2] * x.mesh.pos[i] + T[6] * x.mesh.pos[i + 1] + T[10] * x.mesh.pos[i + 2] + T[14]); return [Math.min(...z), Math.max(...z)]; };
    const hz = (id: string) => { const h = r.parts.find((x) => x.tag?.kind === 'holder' && x.tag.module === id)!; return zs(h as typeof rods[number]); };
    const [r0, r1] = zs(rods[0]), [j0, j1] = hz(jl.id), [a0, a1] = hz(ad.id);
    expect(r0).toBeLessThan(j0 + 14); // down through the J-Link's holder to the socket's latch (its tongue reaches 14 mm further)
    expect(r1).toBeGreaterThan(a1); // its button over the adapter's holder
    // the adapter's holder stands a landing's thickness over the J-Link's far wall
    expect(a0).toBeGreaterThan(j0 + 20);
    expect(a0 - j1).toBeLessThan(LANDING.t + 0.5);
    // the rod slides in both holders' tunnels, the pegs in their holes: holders only touch at the pegs' crush ribs
    const m = measure(p, r);
    expect(m.cats['holder-holder'].vol).toBeLessThan(3);
    expect(m.cats['holder-board'].vol).toBeLessThan(0.5);
    // assembled: each board into its holder, the adapter's onto the J-Link's pegs, the rod, then the column into its dock
    const steps = (r.steps ?? []).map((s) => s.text).join('\n');
    expect(steps).toMatch(/Stand the USB-serial adapter .* holder on its long edge on the J-Link .* holder, its pegs in the holes on top/);
    expect(steps).toMatch(/Push the release rod down through the column/);
    expect(steps).toMatch(/Push the column straight into its dock/);
  }, 120_000);
});

describe('stacking by hand', () => {
  it('offers any small board a column, and a J-Link or adapter only a column', () => {
    const p = newProject(T('rpi4'));
    p.modules.push(newModule(T('jlink')), newModule(T('ftdi')), newModule(T('pico')));
    const [pi, jl, ad] = p.modules;
    expect([isSmall(jl.board), isSmall(ad.board), isSmall(pi.board)]).toEqual([true, true, true]);
    const on = (m: typeof pi) => stackTargets(p, m).map((x) => `${x.m.board.name.replace(/ \(.*$/, '')}${x.column ? ' (column)' : ''}`);
    // the adapter: on the J-Link or on the Pico, in a column; never on the Pi as a printed layer
    // (a Pi 4 is about a J-Link's size, so it can carry a column too); never a printed layer on towers
    expect(on(ad)).toContain('J-Link (column)');
    expect(on(ad).every((x) => /\(column\)$/.test(x))).toBe(true);
    expect(columnable(p, ad, jl)).toBe(true);
    // stacked: a J-Link or adapter on another small board stands in a column with it
    ad.on = jl.id;
    expect(stackMode(p, ad)).toBe('column');
    // anything offered on a J-Link is a column
    expect(stackTargets(p, pi).filter((x) => x.m === jl || x.m === ad).every((x) => x.column)).toBe(true);
    // taken off the stack: its own dock again
    ad.on = null;
    expect(columnOf(p, jl)).toEqual([]);
  });
});
