// J-Links and USB-serial adapters as one action: the right J-Link for each debug header and an adapter for each UART
// header, on every board, cabled and docked beside their boards; the headers that have none; a drawn board's headers;
// what to buy, which way round each plugs in, the UART pin-name warning; the bench sheet.
import { describe, it, expect, beforeAll } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject, connById, connSetup } from '../src/model/library';
import { autoLinks, numberLinks } from '../src/model/links';
import { debugHeaders, isProbe, markDebug, probeKeyFor, uartHeaders } from '../src/model/probes';
import { addDebugGear, benchSheet, debugOffer, freeHeaders, headerRows, pin1Words, pinoutText, ribbonToBuy, sheetRow } from '../src/model/debuggear';
import { generatePanel } from '../src/cad/panelgen';
import { initKernel } from '../src/cad/kernel';
import { benchHtml } from '../src/ui/benchsheet';
import type { Board, Comp, Project } from '../src/model/types';

const T = (id: string): Board => TEMPLATES.find((t) => t.id === id)!.make();
const rack = (ids: string[]) => { const p = newProject(T(ids[0])); for (const id of ids.slice(1)) p.modules.push(newModule(T(id))); p.links = numberLinks(autoLinks(p)); return p; };
const typeOf = (p: Project, name: RegExp) => p.modules.filter((m) => name.test(m.board.name)).map((m) => m.board.comps.find((c) => c.role === 'debug')?.conn?.type);
beforeAll(async () => { await initKernel(); });

describe('one action adds the right J-Links and adapters', () => {
  it('a J-Link for each debug header by its connector (10-pin, JTAG box header, 20-pin Cortex) and an adapter for each UART header, on every board', () => {
    const p = rack(['example_dual_swd', 'example_jtag', 'usb_hub7']);
    // a third board with the 20-pin Cortex header, drawn: a plain board and a marked part
    const b = T('blank'); b.name = 'My board';
    const c: Comp = { id: 'cx', ref: 'J_DBG', pkg: 'PinHeader_2x10_P1.27mm', side: 'top', x: 20, y: 20, rot: 0, w: 25, l: 5, h: 5, kind: 'header', tht: false, conn: connSetup(connById('header'), 0) };
    b.comps.push(c);
    markDebug(c, 'cortex20');
    p.modules.push(newModule(b));
    expect(freeHeaders(p).map((r) => r.comp.ref).sort()).toEqual(['J_DBG', 'J_JTAG', 'J_SWD1', 'J_SWD2', 'J_UART', 'J_UART']);
    expect(debugOffer(p).map((o) => o.offer).sort()).toEqual(['ftdi', 'ftdi', 'jlink', 'jlink10', 'jlink10', 'jlinkjtag']);
    const g = addDebugGear(p);
    expect(g.probes.length).toBe(4);
    expect(g.adapters.length).toBe(2);
    expect(g.boards).toEqual(['Dual-MCU controller', 'Sensor board', 'My board']);
    // each J-Link's own connector is the header's kind
    expect(typeOf(p, /J_SWD/)).toEqual(['swd10', 'swd10']);
    expect(typeOf(p, /J_JTAG/)).toEqual(['jtag20']);
    expect(typeOf(p, /J_DBG/)).toEqual(['cortex20']);
    // cabled to its header, its USB to the hub (and no other cable was made)
    const links = p.links ?? [];
    expect(links.filter((l) => l.kind === 'debug').length).toBe(4);
    expect(links.filter((l) => l.kind === 'jumper').length).toBe(2);
    expect(g.usb).toBe(6);
    for (const m of p.modules.filter((x) => isProbe(x))) expect(links.some((l) => l.kind === 'usb' && (l.a.module === m.id || l.b.module === m.id)), m.board.name).toBe(true);
    // nothing left over: every header has something on it, and pressing again adds nothing
    expect(freeHeaders(p)).toEqual([]);
    const again = addDebugGear(p);
    expect(again.probes.length + again.adapters.length).toBe(0);
    expect(p.modules.length).toBe(10); // 3 boards, the hub and 6 J-Links and adapters
  });

  it('a J-Link whose connector is the header\'s own needs no adapter to buy', () => {
    const p = rack(['example_jtag']);
    const j = p.modules[0].board.comps.find((c) => c.ref === 'J_JTAG')!;
    expect(probeKeyFor(j)).toBe('jlinkjtag');
    const g = addDebugGear(p);
    const row = headerRows(p).find((r) => r.kind === 'debug')!;
    expect(row.probe?.id).toBe(g.probes[0].id);
    expect(sheetRow(p, row).buy).toEqual([]); // its own connector: nothing to buy
  });

  it('lists the headers with no J-Link or adapter, and one board added leaves the others listed', () => {
    const p = rack(['example_dual_swd', 'example_jtag']);
    addDebugGear(p, [p.modules[1].id]);
    expect(freeHeaders(p).map((r) => `${r.board.board.name}/${r.comp.ref}`)).toEqual(['Dual-MCU controller/J_SWD1', 'Dual-MCU controller/J_SWD2', 'Dual-MCU controller/J_UART']);
  });

  it('offers a J-Link for a header of a board that was drawn: marked by hand it is listed with its pinout', () => {
    const b = T('blank');
    const c: Comp = { id: 'h1', ref: 'J9', pkg: 'PinHeader_2x05_P1.27mm', side: 'top', x: 20, y: 20, rot: 0, w: 6.35, l: 2.54, h: 5, kind: 'header', tht: false, conn: connSetup(connById('header'), 0) };
    b.comps.push(c);
    const p = newProject(b);
    expect(debugHeaders(p.modules[0].board)).toEqual([]);
    markDebug(c, 'swd10');
    expect(debugHeaders(p.modules[0].board).map((x) => x.ref)).toEqual(['J9']);
    expect(pinoutText(c)).toBe('VTref, SWDIO, GND, SWCLK, GND, SWO, KEY, NC, GNDdet, nRESET');
    expect(freeHeaders(p).map((r) => r.comp.ref)).toEqual(['J9']);
    expect(probeKeyFor(c)).toBe('jlink10');
    expect(uartHeaders(p.modules[0].board)).toEqual([]);
  });
});

describe('docked, cabled, and said plainly', () => {
  it('the gear stands beside its board on the rack, cabled, with ribbons and jumper wires routed', () => {
    const p = rack(['example_jtag', 'usb_hub7']);
    addDebugGear(p);
    const r = generatePanel(p), pr = r.report.panel!;
    // every J-Link and adapter is on a rail (in a column with the others)
    const placed = new Set(pr.modules.map((m) => m.id));
    for (const m of p.modules) expect(placed.has(m.id) || pr.modules.some((x) => x.id === m.id) || r.parts.some((x) => x.tag?.module === m.id), m.board.name).toBe(true);
    expect(r.report.warnings.filter((w) => /overlap|runs into|not on a rail/.test(w))).toEqual([]);
    const ribbon = r.report.cables!.find((c) => c.ribbon != null)!, wires = r.report.cables!.find((c) => c.kind === 'jumper')!;
    expect(ribbon.length).toBeGreaterThan(50);
    expect(wires.length).toBeGreaterThan(20);
    // and the sheet says what to do
    const rows = headerRows(p).map((h) => sheetRow(p, h, r.report.cables, pr));
    const dbg = rows.find((x) => x.kind === 'debug')!, uart = rows.find((x) => x.kind === 'uart')!;
    expect(dbg.where).toMatch(/^dock \d\.\d( front| back)?$/);
    expect(dbg.pin1).toMatch(/Red stripe \(pin 1\) on the (bottom|top)-(left|right) pin of J_JTAG/);
    expect(dbg.usb).toMatch(/Powered USB hub P\d/);
    expect(uart.buy[0]).toMatch(/^3 × \d+ cm jumper wires \(Dupont\), female at the adapter's pins and female at J_UART$/);
    expect(uart.port).toMatch(/COM/);
  }, 240_000);

  it('the 4-pin UART pin names are a guess unless the file names them: the sheet and the toast say to check', () => {
    const named = rack(['example_jtag']); // pins named by their nets
    addDebugGear(named);
    expect(benchSheet(named).guess).toBe(false);
    const b = T('example_jtag'); const u = b.comps.find((c) => c.ref === 'J_UART')!; delete u.pins;
    const bare = newProject(b);
    const g = addDebugGear(bare);
    expect(g.guess).toEqual(['Sensor board']);
    const sh = benchSheet(bare);
    expect(sh.guess).toBe(true);
    const html = benchHtml('Bench <rack> & "co"', sh);
    expect(html).toContain('Pin names are a guess: check yours.');
    expect(html).not.toContain('<rack>');
    expect(html).toContain('Bench &lt;rack&gt; &amp; &quot;co&quot;');
  });

  it('a ribbon too short for its run is a longer one to buy, in a standard length', () => {
    expect(ribbonToBuy(146)).toBe(20);
    expect(ribbonToBuy(248)).toBe(30);
    expect(ribbonToBuy(300)).toBe(50);
    const p = rack(['example_jtag']);
    addDebugGear(p);
    const row = headerRows(p).find((r) => r.kind === 'debug')!;
    const cab = [{ id: row.link!.id, a: '', b: '', kind: 'debug' as const, length: 248, buy: 0.3, ribbon: 200 }];
    const s = sheetRow(p, row, cab);
    expect(s.ribbon).toMatch(/has to run about 25 cm/);
    expect(s.buy).toEqual(['1 × 30 cm 20-pin 2.54 mm IDC ribbon, and set its length to 300 mm here']);
  });

  it('says which end pin 1 is on', () => {
    const b = T('example_jtag');
    expect(pin1Words(b.comps.find((c) => c.ref === 'J_JTAG')!)).toBe('the bottom-left pin');
    expect(pin1Words(b.comps.find((c) => c.ref === 'J_UART')!)).toBe('the left end');
  });
});
