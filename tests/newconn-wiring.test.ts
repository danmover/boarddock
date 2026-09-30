// The connectors added late (SFP, SATA, XLR, banana, M12, TOSLINK, SIM, small coax, the IEC C14 inlet, and the sockets a
// board or card goes on): each is wired as what it is. An SFP takes a DAC or a module, a C14 a kettle lead, TOSLINK only
// another TOSLINK, a banana jack is wires; Auto-connect uses a board's RJ45 before its SFP cage; the sockets take no
// cable; and a board with all of them generates holders and cables without trouble.
import { describe, it, expect, beforeAll } from 'vitest';
import { initKernel } from '../src/cad/kernel';
import { generate } from '../src/cad/assembly';
import { TEMPLATES } from '../src/model/templates';
import { classify, newModule, newProject } from '../src/model/library';
import { edgeConnector } from '../src/model/palette';
import { autoLinks, numberLinks, offRackTo, plugRole, plugsOf, refusal, type PlugInfo } from '../src/model/links';
import { buyText } from '../src/model/cablebuy';
import { cableLines } from '../src/model/cablelist';
import { portUses } from '../src/model/portuse';
import type { Board, Comp, Link, Project } from '../src/model/types';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
const outline = (w: number, l: number) => [[0, 0], [w, 0], [w, l], [0, l]] as [number, number][];
const blank = (name: string, w = 100, l = 60): Board => ({ name, outline: outline(w, l), thickness: 1.6, holes: [{ id: 'h1', x: 4, y: 4, d: 3.2, plated: true, use: 'auto', role: 'mount' }, { id: 'h2', x: w - 4, y: l - 4, d: 3.2, plated: true, use: 'auto', role: 'mount' }], cutouts: [], comps: [], source: 't', notes: [] } as unknown as Board);
/** A board with these connectors on its bottom edge: [type id, ref]. */
const edged = (name: string, conns: [string, string][], w = 100): Board => {
  const b = blank(name, w);
  conns.forEach(([t, ref], i) => b.comps.push({ ...edgeConnector(b, t, [14 + i * 32, 0]), ref }));
  return b;
};
const plug = (p: Project, module: string, ref: string): PlugInfo => plugsOf(p).find((x) => x.ref.module === module && x.ref.ref === ref)!;
const link = (p: Project, a: PlugInfo, b: PlugInfo, kind: Link['kind']): Link => ({ id: `l${Math.random().toString(36).slice(2, 8)}`, a: a.ref, b: b.ref, kind });

describe('what to buy for the new connectors', () => {
  it('SFP: a DAC or a module and fibre; a copper module and an Ethernet cable to an RJ45', () => {
    expect(buyText('net', 1, 'SFP', 'SFP')).toMatch(/direct-attach.*DAC.*fibre patch/);
    expect(buyText('net', 2, 'SFP', 'RJ45')).toMatch(/Ethernet cable, 2 m, and a copper \(1000BASE-T\) SFP module/);
    expect(buyText('net', 2, 'RJ45', 'SFP')).toMatch(/copper \(1000BASE-T\) SFP module/);
    expect(buyText('net', 1, 'RJ45', 'RJ45')).toBe('1 m RJ45 to RJ45 cable');
  });
  it('a C14 inlet takes a kettle lead, not a figure-8 one; a C7 still does', () => {
    expect(buyText('mains', 2, 'mains (C13)', 'AU outlet')).toMatch(/kettle-type \(C13\) to AU plug/);
    expect(buyText('mains', 2, 'mains (C7)', 'UK outlet')).toMatch(/figure-8 \(C7\) to UK plug/);
  });
  it('banana leads are banana leads, bare at a screw terminal', () => {
    expect(buyText('wire', 1, '4 mm plug', 'wires')).toMatch(/banana-plug test leads.*bare at the screw terminal end with a ferrule/);
    expect(buyText('wire', 1, '4 mm plug', '4 mm plug')).toMatch(/^4 mm banana-plug test leads \(red and black\), 1 m each$/);
    expect(buyText('audio', 1, 'TOSLINK', 'TOSLINK')).toBe('1 m TOSLINK to TOSLINK cable');
  });
});

describe('what can be cabled to what', () => {
  it('TOSLINK goes to TOSLINK, never straight to an analog jack; XLR takes RCA and 3.5 mm', () => {
    const p = newProject(edged('A', [['toslink', 'J1'], ['xlr', 'J2']]));
    p.modules.push(newModule(edged('B', [['toslink', 'J1'], ['rca', 'J2'], ['audio35', 'J3']])));
    const [A, B] = p.modules.map((m) => m.id);
    expect(refusal(p, plug(p, A, 'J1'), plug(p, B, 'J1'))).toBeNull();
    expect(refusal(p, plug(p, A, 'J1'), plug(p, B, 'J2'))).toMatch(/optical digital audio/);
    expect(refusal(p, plug(p, A, 'J1'), plug(p, B, 'J3'))).toMatch(/TOSLINK/);
    expect(refusal(p, plug(p, A, 'J2'), plug(p, B, 'J2'))).toBeNull(); // XLR to RCA: a cable that exists
    expect(refusal(p, plug(p, A, 'J2'), plug(p, B, 'J3'))).toBeNull();
  });
  it('a banana jack is wires you connect: to a screw terminal or another banana jack, never to a mains outlet', () => {
    const p = newProject(edged('A', [['banana', 'J1'], ['terminal', 'J2']]));
    p.modules.push(newModule(edged('B', [['banana', 'J1']])), newModule(T('pb4')));
    const [A, B, PB] = p.modules.map((m) => m.id);
    expect(plugRole(p.modules[0], p.modules[0].board.comps[0])).toBe('wire');
    expect(refusal(p, plug(p, A, 'J1'), plug(p, B, 'J1'))).toBeNull();
    expect(refusal(p, plug(p, A, 'J2'), plug(p, B, 'J1'))).toBeNull();
    const outlet = plugsOf(p).find((x) => x.ref.module === PB && x.role === 'mains-out')!;
    expect(refusal(p, plug(p, A, 'J1'), outlet)).toMatch(/mains/i);
  });
  it('sockets a card or board goes on, an SATA port and a M12 take no cable and say so', () => {
    const b = blank('Carrier', 200, 100);
    const at = (pkg: string, ref: string, x: number, y: number): Comp => ({ ...classify({ id: ref, ref, pkg, side: 'top', x, y, rot: 0, w: 1, l: 1, h: 1, kind: 'generic', tht: false } as Comp, false), x, y });
    b.comps.push(at('SAMTEC_QSH-060-01-L-D-A', 'J1', 40, 50), at('M.2_KEY_M', 'J2', 100, 50), at('PCIE_X1', 'J3', 150, 50), at('SODIMM_DDR4', 'J4', 60, 30), at('POGO_PIN', 'J5', 150, 30));
    b.comps.push({ ...edgeConnector(b, 'sim', [30, 0]), ref: 'J6' });
    const p = newProject(b), m = p.modules[0];
    for (const c of m.board.comps.filter((x) => x.ref !== 'J6')) expect(offRackTo(m, c), c.ref).toMatch(/no cable/);
    expect(offRackTo(m, m.board.comps.find((x) => x.ref === 'J6')!)).toMatch(/no cable/);
    // nothing to cable to, so nothing is printed for them: no port is in use
    for (const [ref, why] of portUses(p, m)) expect(why, ref).not.toBe('cable');
    expect(plugsOf(p).every((x) => x.role === 'other')).toBe(true);
    expect(autoLinks(p)).toEqual([]);
  });
});

describe('Auto-connect and the cable list', () => {
  beforeAll(async () => { await initKernel(); });

  it('a board with an RJ45 and an SFP cage goes to the switch by its RJ45; one with only an SFP goes by the cage', () => {
    const p = newProject(edged('Both', [['rj45', 'J1'], ['sfp', 'J2']]));
    p.modules.push(newModule(edged('Cage only', [['sfp', 'J1']])), newModule(T('net_switch8')));
    const [both, cage] = p.modules.map((m) => m.id);
    const links = autoLinks(p);
    const net = links.filter((l) => l.kind === 'net' && (l.a.module === both || l.b.module === both || l.a.module === cage || l.b.module === cage));
    const mine = (id: string) => net.find((l) => l.a.module === id || l.b.module === id);
    expect(mine(both)!.a.module === both ? mine(both)!.a.ref : mine(both)!.b.ref).toBe('J1'); // the RJ45, not the cage
    expect(mine(cage)).toBeTruthy();
  });

  it('routed cables from an SFP cage to an RJ45, and a C14 inlet to an outlet, are listed as what to buy', () => {
    const p = newProject(edged('Both', [['rj45', 'J1'], ['sfp', 'J2']]));
    p.modules.push(newModule(edged('Cage', [['sfp', 'J1'], ['iec_c14', 'J2']], 120)), newModule(T('pb4')));
    const [A, B, PB] = p.modules.map((m) => m.id);
    const outlet = plugsOf(p).find((x) => x.ref.module === PB && x.role === 'mains-out')!;
    p.links = numberLinks([link(p, plug(p, A, 'J2'), plug(p, B, 'J1'), 'net'), link(p, plug(p, B, 'J2'), outlet, 'mains')]);
    const r = generate(p);
    const text = cableLines(p, r.report.cables ?? []).buy.join('\n');
    expect(text).toMatch(/direct-attach copper cable/);
    expect(text).toMatch(/kettle-type \(C13\) to AU plug/);
    expect(text).not.toMatch(/figure-8/);
  });

  it('one board with all of them, docked and printed for: holders come out, nothing throws', () => {
    const b = edged('Everything', [['sfp', 'J1'], ['sata', 'J2'], ['xlr', 'J3'], ['banana', 'J4'], ['m12', 'J5']], 200);
    b.comps.push({ ...edgeConnector(b, 'toslink', [14, 60]), ref: 'J6' }, { ...edgeConnector(b, 'rf_mini', [46, 60]), ref: 'J7' }, { ...edgeConnector(b, 'minidin', [78, 60]), ref: 'J8' }, { ...edgeConnector(b, 'iec_c14', [130, 60]), ref: 'J9' }, { ...edgeConnector(b, 'sim', [170, 60]), ref: 'J10' });
    b.outline = outline(200, 60);
    b.holes = [{ id: 'h1', x: 4, y: 30, d: 3.2, plated: true, use: 'auto', role: 'mount' } as never, { id: 'h2', x: 196, y: 30, d: 3.2, plated: true, use: 'auto', role: 'mount' } as never];
    const at = (pkg: string, ref: string, x: number, y: number): Comp => ({ ...classify({ id: ref, ref, pkg, side: 'top', x, y, rot: 0, w: 1, l: 1, h: 1, kind: 'generic', tht: false } as Comp, false), x, y });
    b.comps.push(at('SAMTEC_QSH-060-01-L-D-A', 'J11', 40, 30), at('M.2_KEY_M', 'J12', 100, 30), at('POGO_PIN', 'J13', 150, 30));
    const p = newProject(b);
    const r = generate(p);
    expect(r.ghosts.length).toBeGreaterThan(0);
    expect(r.parts.length).toBeGreaterThan(0);
    for (const g of r.ghosts) for (const v of g.mesh.pos) if (!Number.isFinite(v)) throw new Error(`${g.name}: a mesh point is not a number`);
    expect(r.report.warnings.filter((w) => /error|failed|could not/i.test(w))).toEqual([]);
  });
});
