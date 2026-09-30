// `npm run parts`: the files in parts/ (part numbers that mean a connector type, and new connector types) become the
// data the app reads. Checks the validator (a good file, bad ones, a plain word refused), that names are recognised
// through guessPackage, that a contributed type shows in the toolbox and draws, and that the generated file is current.
// The app reads its data from src/model/parts.json, which is empty until something is contributed, so the examples
// under parts/examples/ are loaded in place of it (a second copy of the modules, made after swapping that file).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { checkName, dump, readParts, stale } from '../scripts/parts-lib';
import { CONNECTORS } from '../src/model/library';
import type { Board, Comp, Ghost, Module, V2 } from '../src/model/types';

const root = path.resolve(__dirname, '..');
const EXAMPLES = path.join(root, 'parts', 'examples');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'boarddock-parts-test-'));
/** A folder of parts files (an object is written as JSON, a string as it is). */
function folder(files: Record<string, unknown>) {
  const d = tmp();
  for (const [f, v] of Object.entries(files)) fs.writeFileSync(path.join(d, f), typeof v === 'string' ? v : JSON.stringify(v));
  return d;
}
const read = (files: Record<string, unknown>) => readParts(folder(files));
const JACK = JSON.parse(fs.readFileSync(path.join(EXAMPLES, 'type-jack635.json'), 'utf8'));
const jack = (over: object) => ({ 'type-jack635.json': { ...JACK, ...over } });
/** A connector that plugs in from above, for what the examples do not cover (an edge one). */
const HDR = { id: 'acme_hdr', label: 'Acme power header', entry: 'top', body: { w: 12, l: 8, h: 9 }, plug: { w: 12, h: 8, len: 12, cable: 2 }, tht: true, role: 'power',
  look: [{ box: 'white', from: [0, 0, 0], to: [1, 1, 0.5] }, { pins: 'gold', n: 4, pitch: 2.5, d: 0.8, at: [0.5, 0.5, 0.3], len: 0.7 }] };

describe('the validator', () => {
  it('reads the worked examples clean, and says what they do', () => {
    const b = readParts(EXAMPLES);
    expect(b.errors).toEqual([]);
    expect(b.warnings).toEqual([]);
    expect(b.data.names.map((g) => [g.type, g.names, g.weak, g.pins, g.pitch])).toEqual([
      ['rj45', ['ACME-ETH-1A1', 'ACME-ETHJ-*'], ['Acme jack'], undefined, undefined],
      ['wtb_side', ['ACME-SIDE-06'], undefined, 6, 2.5],
    ]);
    expect(b.data.types.map((t) => [t.id, t.entry, t.role, t.look?.length, t.names, t.weak])).toEqual([['jack635', 'edge', 'audio', 4, ['ACME-J635-*'], ['6.35 mm jack']]]);
    for (const want of ['names for rj45, wtb_side', 'jack635', '14 x 20 x 12 mm, wired as audio, look of 4 shapes', '2 files: 4 names, 1 new type, 0 errors, 0 warnings']) expect(b.report).toContain(want);
  });

  it('writes the same compact data however the names are split over files, one line per group', () => {
    const a = read({ 'names-a.json': { type: 'rj45', names: ['ACME-ETH-1A1'] }, 'names-b.json': { type: 'rj45', names: ['ACME-ETHJ-*', 'ACME-ETH-1A1B'] }, 'type-jack635.json': JACK });
    const b = read({ 'names-all.json': [{ type: 'rj45', names: ['ACME-ETHJ-*', 'ACME-ETH-1A1B', 'ACME-ETH-1A1'] }], 'type-jack635.json': JACK });
    expect(a.errors).toEqual([]);
    expect(dump(a.data)).toBe(dump(b.data));
    const text = dump(a.data);
    expect(JSON.parse(text)).toEqual(a.data);
    expect(text.split('\n').filter((l) => l.startsWith('  {')).length).toBe(2); // one names group, one type
    expect(dump({ v: 1, names: [], types: [] })).toBe('{"v":1,"names":[],"types":[]}\n');
  });

  it('refuses a plain word unless it is flagged weak, and names too short or too like a chip', () => {
    for (const w of ['HDMI', 'Ethernet', '*USB*', 'SMA*', 'PJ-*']) expect(checkName(w), w).toMatch(/plain word|too short/);
    expect(checkName('HDMI')).toMatch(/plain word.*"weak"/);
    expect(checkName('J*')).toMatch(/too short/);
    expect(checkName('1234')).toMatch(/bare short number/);
    expect(checkName('D_SM*')).toMatch(/would also match "D_SMA"/);
    expect(checkName('TB66*')).toMatch(/would also match "TB6612FNG"/);
    expect(checkName('HDMI', true)).toBeNull(); // weak: it counts only on a connector's reference
    expect(checkName('connector', true)).toMatch(/far too general/);
    expect(checkName('ab', true)).toMatch(/too short/);
    for (const ok of ['A829-1A1T-91B', 'HFJ11-*', 'ACME-ETH-1A1', 'PJ-002*', 'Molex 105017']) expect(checkName(ok), ok).toBeNull();
    for (const bad of ['', ' x ', 'a<b>c', 'x'.repeat(61), 5]) expect(checkName(bad), String(bad)).toBeTruthy();
    // through a file: the message names the file and the entry
    const b = read({ 'names-x.json': { type: 'hdmi_a', names: ['HDMI'], weak: ['HDMI'] } });
    expect(b.errors).toHaveLength(1);
    expect(b.errors[0]).toMatch(/names-x\.json: the file\.names\[0\] "HDMI" is a plain word/);
  });

  it('refuses a names file that is wrong, each message saying what to write', () => {
    const one = (g: unknown, extra: Record<string, unknown> = {}) => read({ 'names-x.json': g, ...extra }).errors.join('\n');
    expect(one({ type: 'rj45', names: ['ACME-1234'], nmes: [] })).toContain('unknown key "nmes"');
    expect(one({ type: 'rj46', names: ['ACME-1234'] })).toMatch(/type "rj46"; use one of: usb_c/);
    expect(one({ type: 'custom', names: ['ACME-1234'] })).toMatch(/type "custom"/);
    expect(one({ type: 'rj45' })).toContain('neither "names" nor "weak"');
    expect(one({ type: 'rj45', names: 'ACME-1234' })).toContain('must be a list of names');
    expect(one({ type: 'rj45', names: ['ACME-1234'], pins: 0 })).toContain('.pins must be a whole number');
    expect(one({ type: 'rj45', names: ['ACME-1234'], rows: 3, pins: 4 })).toContain('.rows must be 1 or 2');
    expect(one({ type: 'rj45', names: ['ACME-1234'], rows: 2 })).toContain('.rows needs "pins"');
    expect(one({ type: 'rj45', names: ['ACME-1234'], pitch: 99, pins: 4 })).toContain('.pitch must be');
    expect(one([])).toContain('the list is empty');
    expect(one('not json {')).toMatch(/not valid JSON/);
    expect(one(7)).toContain('must be an object');
    // the same name for two types, in two files
    expect(one({ type: 'rj45', names: ['ACME-1234'] }, { 'names-y.json': { type: 'rj11', names: ['acme_1234'] } })).toMatch(/also given for type rj45 in .*names-x\.json/);
    // (a folder holds names-*.json and type-<id>.json, and nothing else)
    expect(read({ 'foo.json': {} }).errors.join()).toContain('not a parts file');
    expect(read({ 'type-bad-id.json': {} }).errors.join()).toContain('not a parts file');
  });

  it('warns, without refusing, about what does nothing or is already known', () => {
    const w = (g: object) => read({ 'names-x.json': g }).warnings.join('\n');
    expect(w({ type: 'usb_c', names: ['USBC-1234'] })).toMatch(/"USBC-1234" is already recognised as usb_c/);
    expect(w({ type: 'usb_a', names: ['USBC-1234'] })).toMatch(/read "USBC-1234" as usb_c; this file makes it usb_a/);
    expect(w({ type: 'rj45', names: ['ACME-1234'], pins: 8 })).toMatch(/width of rj45 does not follow its pins/);
    expect(w({ type: 'rj45', names: ['ACME-1234'], pitch: 2 })).toMatch(/pitch is used only together with "pins"/);
    expect(w({ type: 'rj45', names: ['ACME-1234', 'acme_1234'] })).toMatch(/listed twice/);
    expect(w({ type: 'wtb_side', names: ['ACME-1234'], pins: 6, pitch: 2.5 })).toBe('');
  });

  it('refuses a type file that is wrong', () => {
    const one = (over: object) => read(jack(over)).errors.join('\n');
    expect(read(jack({})).errors).toEqual([]);
    expect(one({ id: 'jack636' })).toMatch(/"id" is "jack636" but the file is called type-jack635\.json/);
    expect(read({ 'type-rj45.json': { ...JACK, id: 'rj45' } }).errors.join()).toContain('is taken by a connector type the library has');
    expect(one({ id: 'Jack 1' })).toContain('"id" must be lower case');
    expect(one({ label: 'x' })).toContain('"label" must be text');
    expect(one({ entry: 'side' })).toContain('"entry" must be "edge"');
    expect(one({ body: { w: 14, l: 20 } })).toContain('"body" must be');
    expect(one({ plug: { w: 16, h: 16, len: 30 } })).toContain('"plug" must be');
    expect(one({ role: 'sound' })).toMatch(/"role" must be one of: net, usb, power, audio, video, mains-in, wire, other/);
    expect(one({ tht: 'yes' })).toContain('"tht" must be true or false');
    expect(one({ zc: 99 })).toContain('"zc" must be');
    expect(one({ colour: 'red' })).toContain('unknown key "colour"');
    expect(one({ names: ['HDMI'] })).toContain('is a plain word');
    expect(one({ weak: ['jack'] })).toContain('far too general');
    // the look: every shape checked, and together they must fill the body the toolbox states
    const look = (l: unknown[]) => one({ look: l });
    const box = { box: 'black', from: [0, 0, 0], to: [1, 1, 1] };
    expect(look([{ box: 'black', from: [0, 0, 0], to: [0.5, 1, 1] }])).toMatch(/together are 7 mm across, but the body is 14 mm wide/);
    expect(look([{ box: 'black', from: [0, 0, 0], to: [1, 0.5, 1] }])).toMatch(/together are 10 mm long, but the body is 20 mm long/);
    expect(look([{ box: 'black', from: [0, 0, 0], to: [1, 1, 0.5] }])).toMatch(/reach 6 mm high, but the body is 12 mm high/);
    expect(look([{ mouth: 'rect', at: [0.5, 0.5], size: [0.5, 0.5], depth: 0.5 }, box])).toMatch(/put a box \(the housing\) first/);
    expect(look([{ box: 'lime', from: [0, 0, 0], to: [1, 1, 1] }])).toContain('must be a material');
    expect(look([{ box: 'black', from: [0, 0, 0], to: [1, 1, 2] }])).toContain('"from" and "to" must be');
    expect(look([{ box: 'black', from: [0.5, 0, 0], to: [0.5, 1, 1] }])).toContain('"to" must be larger');
    expect(look([box, { barrel: 'metal', at: [0.1, 0.5], d: 1, y: [0.5, 1] }])).toMatch(/sticks out of the body/);
    expect(look([box, { pins: 'gold', n: 9, pitch: 2.54, d: 0.6, at: [0.5, 0.5, 0.2], len: 0.5 }])).toMatch(/9 pins at 2.54 mm stretch/);
    expect(look([box, { pins: 'gold', n: 2, pitch: 2.54, d: 0.6, at: [0.5, 0.5, 0.8], len: 0.5 }])).toContain('runs out of the body');
    expect(look([box, { sphere: 'gold' }])).toContain('must have exactly one of');
    expect(look([box, { box: 'gold', from: [0, 0, 0], to: [1, 1, 1], colour: 1 }])).toContain('unknown key "colour"');
    expect(look([])).toContain('"look" must be a list of 1 to 12 shapes');
    expect(look([{ pins: 'gold', n: 1, pitch: 1, d: 1, at: [0.5, 0.5, 0.5], len: 0.5 }])).toMatch(/needs a box or a barrel/);
  });

  it('the command exits 1 on an error and writes nothing; --check finds a stale file; --types lists the ids', () => {
    const run = (...args: string[]) => { const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'parts.mjs'), ...args], { cwd: root, encoding: 'utf8' }); return { code: r.status, out: r.stdout + r.stderr }; };
    const out = path.join(tmp(), 'parts.json');
    const bad = run('--dir', folder({ 'names-x.json': { type: 'hdmi_a', names: ['HDMI'] } }), '--out', out);
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/ERROR {5}the file\.names\[0\] "HDMI" is a plain word/);
    expect(fs.existsSync(out)).toBe(false);
    const good = run('--dir', EXAMPLES, '--out', out);
    expect(good.code).toBe(0);
    expect(good.out).toContain('Wrote');
    expect(fs.readFileSync(out, 'utf8')).toBe(dump(readParts(EXAMPLES).data));
    expect(run('--dir', EXAMPLES, '--out', out, '--check').code).toBe(0);
    fs.writeFileSync(out, '{"v":1,"names":[],"types":[]}\n');
    const old = run('--dir', EXAMPLES, '--out', out, '--check');
    expect(old.code).toBe(1);
    expect(old.out).toContain('is out of date. Run `npm run parts`');
    expect(run('--dir', folder({ 'names-x.json': { type: 'usb_c', names: ['USBC-1234'] } }), '--out', out, '--dry').code).toBe(0);
    expect(run('--dir', folder({ 'names-x.json': { type: 'usb_c', names: ['USBC-1234'] } }), '--out', out, '--dry', '--strict').code).toBe(1);
    const t = run('--types');
    expect(t.code).toBe(0);
    expect(t.out).toMatch(/usb_c\s+USB-C/);
    expect(t.out).toContain('Wiring roles for a new type ("role"): net, usb, power, audio, video, mains-in, wire, other');
    expect(run('--nothing').code).toBe(2);
  });
});

describe('what is checked in', () => {
  it('src/model/parts.json is what parts/ makes (after adding a file, run `npm run parts` and commit it)', () => {
    const b = readParts(path.join(root, 'parts'));
    expect(b.errors).toEqual([]);
    expect(stale(b.data, path.join(root, 'src', 'model', 'parts.json')), 'src/model/parts.json is out of date: run `npm run parts` and commit it').toBe(false);
  });
  it('names are refused when they would break the library\'s own false-positive rules: every non-connector in the sample stays plain', () => {
    // (the same rows tests/connector-names.tsv marks "-": the validator refuses any name that matches one)
    const rows = fs.readFileSync(path.join(root, 'tests', 'connector-names.tsv'), 'utf8').split('\n').filter((l) => l.startsWith('-\t')).map((l) => l.split('\t')[1]);
    expect(rows.length).toBeGreaterThan(40);
    for (const r of rows) expect(checkName(r), r).toBeTruthy();
  });
});

// ---- the app with the examples loaded ----

type Mods = { lib: typeof import('../src/model/library'); pal: typeof import('../src/model/palette'); viz: typeof import('../src/cad/boardviz'); kernel: typeof import('../src/cad/kernel'); links: typeof import('../src/model/links'); contrib: typeof import('../src/model/contributed'); ui: typeof import('../src/ui/PartIcon') };
let M: Mods;
const blank = (W: number, H: number): Board => ({ name: '', outline: [[0, 0], [W, 0], [W, H], [0, H]] as V2[], cutouts: [], thickness: 1.6, holes: [], comps: [], source: 'test', notes: [] });
/** The box round every mesh of the picture above the board, near (x, y), as in tests/toolbox.test.ts. */
function above(gs: Ghost[], zt: number, x: number, y: number, r: number) {
  const bb = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z1: -Infinity };
  for (const g of gs) for (let i = 0; i < g.mesh.pos.length; i += 3) {
    const px = g.mesh.pos[i], py = g.mesh.pos[i + 1], pz = g.mesh.pos[i + 2];
    if (pz < zt + 0.08 || Math.abs(px - x) > r || Math.abs(py - y) > r) continue;
    bb.x0 = Math.min(bb.x0, px); bb.x1 = Math.max(bb.x1, px); bb.y0 = Math.min(bb.y0, py); bb.y1 = Math.max(bb.y1, py); bb.z1 = Math.max(bb.z1, pz);
  }
  return { w: bb.x1 - bb.x0, l: bb.y1 - bb.y0, h: bb.z1 - zt };
}

describe('contributed parts in the app', () => {
  beforeAll(async () => {
    // the examples, and one more type that plugs in from above
    const dir = folder({ 'type-acme_hdr.json': HDR, 'names-override.json': { type: 'usb_a', names: ['USBC-9999'] } });
    for (const f of fs.readdirSync(EXAMPLES)) fs.copyFileSync(path.join(EXAMPLES, f), path.join(dir, f));
    const built = readParts(dir);
    expect(built.errors).toEqual([]);
    vi.resetModules();
    vi.doMock('../src/model/parts.json', () => ({ default: built.data }));
    M = {
      lib: await import('../src/model/library'), pal: await import('../src/model/palette'), viz: await import('../src/cad/boardviz'), kernel: await import('../src/cad/kernel'),
      links: await import('../src/model/links'), contrib: await import('../src/model/contributed'), ui: await import('../src/ui/PartIcon'),
    };
    await M.kernel.initKernel();
  });
  afterAll(() => { vi.doUnmock('../src/model/parts.json'); vi.resetModules(); });

  it('the library has them: after the built-in types, ahead of Custom, drawn as any connector', () => {
    const ids = M.lib.CONNECTORS.map((c) => c.id);
    expect(ids.slice(-3)).toEqual(['acme_hdr', 'jack635', 'custom']);
    expect(ids.length).toBe(CONNECTORS.length + 2);
    expect(M.lib.connById('jack635')).toMatchObject({ name: '6.35 mm (1/4 in) audio jack', entry: 'edge', body: { w: 14, l: 20, h: 12 }, zc: 6, overhang: 0, cradle: false, plug: { w: 16, h: 16, len: 30, cable: 6 } });
    expect(M.lib.connById('acme_hdr')).toMatchObject({ entry: 'top', zc: 0 });
    expect(M.lib.connById('nothing').id).toBe('custom');
  });

  it('names are recognised through guessPackage: part numbers anywhere, patterns, other spellings, the value column', () => {
    const t = (pkg: string, ref = 'U1', value = '') => M.lib.guessPackage(pkg, ref, value).conn?.id;
    expect(t('ACME-ETH-1A1')).toBe('rj45');
    expect(t('ACME-ETHJ-77X')).toBe('rj45');
    expect(t('Vendor:ACME_ETH_1A1_Rev2')).toBe('rj45');
    expect(t('acme-eth-1a1')).toBe('rj45');
    expect(t('Conn_01x08', 'J1', 'ACME-ETH-1A1')).toBe('rj45');
    // (a whole word: not the start or the middle of another)
    expect(t('ACME-ETH-1A10')).toBeUndefined();
    expect(t('XACME-ETH-1A1')).toBeUndefined();
    // a new type by its own names
    expect(t('ACME-J635-A1')).toBe('jack635');
    const g = M.lib.guessPackage('ACME-J635-A1', 'J4');
    expect([g.w, g.l, g.h, g.kind, g.tht]).toEqual([14, 20, 12, 'connector', true]);
    // pins and pitch make its width: six contacts at 2.5 mm
    const s = M.lib.guessPackage('ACME-SIDE-06', 'J2');
    expect(s.conn?.id).toBe('wtb_side');
    expect(s.w).toBeCloseTo(5 * 2.5 + 4, 5);
    expect(s.conn!.plug.w).toBeCloseTo(M.lib.connById('wtb_side').plug.w + s.w - M.lib.connById('wtb_side').body.w, 5);
  });

  it('a weak name counts only on a connector reference, and never before the library\'s own; the false-positive rules hold', () => {
    const t = (pkg: string, ref: string, value = '') => M.lib.guessPackage(pkg, ref, value).conn?.id;
    expect(t('Acme jack', 'J3')).toBe('rj45');
    expect(t('Acme jack', 'CN2')).toBe('rj45');
    expect(t('Acme jack', 'U1')).toBeUndefined();
    expect(t('Acme jack', 'R4')).toBeUndefined();
    expect(t('6.35 mm jack', 'J1')).toBe('jack635');
    expect(t('6.35 mm jack', 'IC3')).toBeUndefined();
    // a strong library match is not overruled by a weak contributed word
    expect(t('USB_C_Receptacle Acme jack', 'J1')).toBe('usb_c');
    // the sample of parts that are no connector stays plain, whatever is contributed
    const rows = fs.readFileSync(path.join(root, 'tests', 'connector-names.tsv'), 'utf8').split('\n').filter((l) => l.startsWith('-\t')).map((l) => l.split('\t'));
    for (const [, name, ref = 'U1', value = ''] of rows) { const g = M.lib.guessPackage(name, ref, value); expect(g.conn, name).toBeUndefined(); }
  });

  it('a contributed part number wins over the library\'s own reading of it', () => {
    // (USBC-... is USB-C to the library; a file may say otherwise, and the validator says so as a warning)
    expect(M.lib.guessPackage('USBC-1234', 'J1').conn?.id).toBe('usb_c');
    expect(M.lib.guessPackage('USBC-9999', 'J1').conn?.id).toBe('usb_a');
    expect(readParts(folder({ 'names-x.json': { type: 'usb_a', names: ['USBC-9999'] } })).warnings.join()).toMatch(/read "USBC-9999" as usb_c; this file makes it usb_a/);
  });

  it('shows in the toolbox under Contributed, made and picked out again like any entry', () => {
    const { PALETTE, PALETTE_GROUPS, paletteFor, contribOf, demoBoard } = M.pal;
    expect(PALETTE_GROUPS.at(-1)).toBe('Contributed');
    const jackItem = PALETTE.find((x) => x.id === 'edge_jack635')!, hdrItem = PALETTE.find((x) => x.id === 'top_acme_hdr')!;
    expect(PALETTE.filter((x) => x.group === 'Contributed').map((x) => x.id)).toEqual(['top_acme_hdr', 'edge_jack635']);
    expect([jackItem.label, jackItem.edge, jackItem.size]).toEqual(['6.35 mm (1/4 in) audio jack', true, '14 × 20 × 12']);
    expect([hdrItem.label, hdrItem.edge, hdrItem.size]).toEqual(['Acme power header', undefined, '12 × 8 × 9']);
    expect(jackItem.hint).toContain('on an edge, facing out');
    expect(jackItem.hint).toContain('Typical catalogue size');
    const b = blank(120, 80);
    const jc = jackItem.make(b, [60, 0]).comp!, hc = hdrItem.make(b, [60, 40]).comp!;
    expect([jc.conn?.type, jc.conn?.entry, jc.pkg, jc.kind, jc.ref, jc.w, jc.l, jc.h]).toEqual(['jack635', 'edge', '6.35 mm (1/4 in) audio jack', 'connector', 'J1', 14, 20, 12]);
    expect(jc.y).toBeLessThan(20); // on the front edge, its mouth out of it
    expect([hc.conn?.type, hc.conn?.entry, hc.kind, hc.tht, hc.x, hc.y]).toEqual(['acme_hdr', 'top', 'connector', true, 60, 40]);
    // a part of that type gets its entry back, and the entry's own scrap of board is that very part
    expect(paletteFor(jc)?.id).toBe('edge_jack635');
    expect(paletteFor(hc)?.id).toBe('top_acme_hdr');
    for (const it of [jackItem, hdrItem]) { const demo = demoBoard(it).comps[0]; expect(paletteFor(demo)?.id).toBe(it.id); expect(M.pal.samePart(demo, it), it.id).toBe(true); expect(contribOf(it)?.id).toBe(it.id.replace(/^(edge|top)_/, '')); }
    expect(contribOf(PALETTE.find((x) => x.id === 'edge_usb_c')!)).toBeUndefined();
  });

  it('draws without errors, as big as the toolbox says, from its look', () => {
    const { PALETTE, demoBoard } = M.pal;
    for (const id of ['edge_jack635', 'top_acme_hdr']) {
      const it = PALETTE.find((x) => x.id === id)!, demo = demoBoard(it), c = demo.comps[0];
      const gs = M.viz.pictureOf(demo);
      const [w, l, h] = it.size.split('×').map(Number);
      const got = above(gs, demo.thickness, c.x, c.y, 80);
      const mats = new Set(gs.map((g) => g.mat));
      M.kernel.freeAll();
      for (const g of gs) { expect(g.mesh.pos.length, `${id} ${g.name}`).toBeGreaterThan(0); expect(Number.isFinite(g.mesh.pos[0]), id).toBe(true); }
      expect(Math.abs(got.w - w), `${id} width ${got.w.toFixed(2)} vs ${w}`).toBeLessThan(0.3);
      expect(Math.abs(got.l - l), `${id} depth ${got.l.toFixed(2)} vs ${l}`).toBeLessThan(0.3);
      expect(Math.abs(got.h - h), `${id} height ${got.h.toFixed(2)} vs ${h}`).toBeLessThan(0.35);
      expect(mats.has('gold'), `${id} pins`).toBe(true);
    }
    // the jack: a round opening cut in its housing (so a solid box would be a different mesh), a metal barrel round it
    const jackGs = M.viz.pictureOf(demoBoard(PALETTE.find((x) => x.id === 'edge_jack635')!));
    expect(jackGs.map((g) => g.mat)).toEqual(expect.arrayContaining(['black', 'metal', 'gold']));
    const solid = blank(30, 20);
    const it = PALETTE.find((x) => x.id === 'edge_jack635')!;
    solid.comps.push({ ...it.make(solid, [15, 0]).comp!, conn: undefined, kind: 'generic' as const });
    const boxSig = M.viz.pictureSig(M.viz.pictureOf(solid));
    M.kernel.freeAll();
    expect(M.viz.pictureSig(jackGs)).not.toBe(boxSig);
    M.kernel.freeAll();
    // and one part that cannot be drawn does not take the others with it (a barrel too big for a tiny part is refused by the file, not drawn wrong)
    const all = blank(120, 60);
    for (const [i, id] of ['edge_jack635', 'top_acme_hdr', 'edge_usb_c', 'jst_ph3'].entries()) { const x = PALETTE.find((q) => q.id === id)!; all.comps.push(x.make(all, x.edge ? [20 + i * 25, 0] : [20 + i * 25, 30]).comp!); }
    expect(() => M.viz.pictureOf(all)).not.toThrow();
    M.kernel.freeAll();
  });

  it('is wired like the built-in kind its role names, and says where its lead goes', () => {
    const mod = (c: Comp): Module => M.lib.newModule({ ...blank(60, 40), comps: [c] } as Board);
    const b = blank(120, 80), { PALETTE } = M.pal;
    const jc = PALETTE.find((x) => x.id === 'edge_jack635')!.make(b, [60, 0]).comp!, hc = PALETTE.find((x) => x.id === 'top_acme_hdr')!.make(b, [60, 40]).comp!;
    const jm = mod(jc), hm = mod(hc);
    expect(M.links.plugRole(jm, jm.board.comps[0])).toBe('audio');
    expect(M.links.offRackTo(jm, jm.board.comps[0])).toBe('to an amplifier or an instrument');
    expect(M.links.plugName('jack635')).toBe('6.35 mm plug');
    expect(M.links.plugName('acme_hdr')).toBe('Acme power header');
    // (a power port is a DC input, and with no offRack text it says so)
    expect(M.links.plugRole(hm, hm.board.comps[0])).toBe('power-in-dc');
    expect(M.links.offRackTo(hm, hm.board.comps[0])).toBe('to its power supply');
    // audio goes to an audio port, as a 3.5 mm jack does
    const aux = PALETTE.find((x) => x.id === 'edge_audio35')!.make(b, [60, 0]).comp!, am = mod(aux);
    expect(M.links.compatible(M.links.plugRole(jm, jm.board.comps[0]), M.links.plugRole(am, am.board.comps[0]))).toBe(true);
    expect(M.links.offRackTo(am, am.board.comps[0])).toBe('to speakers');
  });

  it('while no rendered picture is shipped, a drawing made from its look stands in', () => {
    const { PALETTE, contribOf } = M.pal;
    const { PartIcon } = M.ui, { iconShapes } = M.contrib;
    for (const id of ['edge_jack635', 'top_acme_hdr']) {
      const def = contribOf(PALETTE.find((x) => x.id === id)!)!;
      const { w, h, shapes } = iconShapes(def);
      expect([w, h]).toEqual(id === 'edge_jack635' ? [14, 12] : [12, 8]); // the front of a plug, the top of a part from above
      expect(shapes.length).toBeGreaterThan(1);
      for (const s of shapes) for (const n of [s.x, s.y, s.w, s.h]) expect(Number.isFinite(n), `${id} ${JSON.stringify(s)}`).toBe(true);
      for (const s of shapes) { expect(s.x).toBeGreaterThanOrEqual(-0.01); expect(s.y).toBeGreaterThanOrEqual(-0.01); expect(s.x + s.w).toBeLessThanOrEqual(w + 0.01); expect(s.y + s.h).toBeLessThanOrEqual(h + 0.01); }
      const svg = renderToStaticMarkup(createElement(PartIcon, { def }));
      expect(svg).toContain('<svg');
      expect(svg).toContain(`data-type="${def.id}"`);
      expect(svg.match(/<(rect|ellipse)/g)!.length).toBe(shapes.length + 1); // the outline and every shape
    }
    // (a type with no look of its own is a housing with a dark mouth)
    const plain = iconShapes({ ...M.contrib.contribDef('jack635')!, look: undefined });
    expect(plain.shapes.map((s) => s.mat)).toEqual(['metal', 'dark']);
  });
});
