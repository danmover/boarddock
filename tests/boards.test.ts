// `npm run boards`: the folders under boards/ become the community boards the app offers (public/boards/). Runs the
// script on the worked example (boards/example-sensor-jtag), checks its report and output, and follows the loop an AI
// job follows: a connector left Custom, a hint that fixes it, a hint that is wrong.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { apply, boardFolders, buildBoard, checkHints, dump, plan, stale } from '../scripts/boards-lib';
import type { CommunityIndex } from '../src/model/community';

const root = path.resolve(__dirname, '..');
const EXAMPLE = path.join(root, 'boards', 'example-sensor-jtag');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'boarddock-boards-test-'));

/** A board folder in a temp dir: the example's board file (with `edit` applied to its text) and this board.json. */
function folder(slug: string, hints: object | null, edit: (s: string) => string = (s) => s, parent = tmp()) {
  const dir = path.join(parent, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sensor.kicad_pcb'), edit(fs.readFileSync(path.join(EXAMPLE, 'sensor-jtag.kicad_pcb'), 'utf8')));
  if (hints) fs.writeFileSync(path.join(dir, 'board.json'), JSON.stringify(hints));
  return dir;
}
// J1 as a connector nobody has a library entry for
const oddJ1 = (s: string) => s.replace('Connector_USB:USB_Micro-B_Molex-105017-0001', 'Vendor:ZX-9000-A').replace('(property "Value" "USB_B_Micro")', '(property "Value" "ZX9000")');
const META = { maker: 'Someone', license: 'MIT' };

describe('the worked example, boards/example-sensor-jtag', () => {
  it('reads clean: outline, holes and every connector identified', async () => {
    const b = await buildBoard(EXAMPLE);
    expect(b.errors).toEqual([]);
    expect(b.warnings).toEqual([]);
    const bd = b.board!;
    expect(bd.name).toBe('Sensor board with JTAG (worked example)');
    expect(b.entry!.size).toEqual([70, 45]);
    expect(bd.holes.map((h) => [h.x, h.y, h.d, h.role]).sort()).toEqual([[3.5, 3.5, 3.2, 'mount'], [3.5, 41.5, 3.2, 'mount'], [66.5, 3.5, 3.2, 'mount'], [66.5, 41.5, 3.2, 'mount']].sort());
    const conns = Object.fromEntries(bd.comps.filter((c) => c.conn).map((c) => [c.ref, c.conn!.type]));
    expect(conns).toEqual({ J1: 'usb_micro_b', J2: 'jtag20', J3: 'header' });
    expect(bd.notes[0]).toMatch(/Community board, by BoardDock contributors, licence MIT/);
    expect(b.entry).toMatchObject({ id: 'example-sensor-jtag', plugs: 3, custom: 0, holes: 4, file: 'example-sensor-jtag.json' });
    // the report says what the AI job reads
    for (const want of ['outline     70 x 45 mm', '4 found, 4 to mount by', 'J1', 'usb_micro_b', 'jtag20', 'result      ok']) expect(b.report).toContain(want);
  });

  it('makes the same data every time (no random ids, no copper), and what is checked in is current', async () => {
    const a = await buildBoard(EXAMPLE), b = await buildBoard(EXAMPLE);
    expect(dump(a.board!)).toBe(dump(b.board!));
    expect(a.board!.comps.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(a.board!.traces).toBeUndefined();
    // public/boards holds exactly what the folders make: after adding a board, run `npm run boards` and commit it
    const all = await Promise.all(boardFolders(path.join(root, 'boards')).map(buildBoard));
    expect(all.flatMap((x) => x.errors)).toEqual([]);
    expect(stale(plan(all, path.join(root, 'public', 'boards')), path.join(root, 'public', 'boards')), 'public/boards is out of date: run `npm run boards` and commit it').toEqual([]);
  });
});

describe('the loop: report, hint, rerun', () => {
  it('a connector left Custom is a warning that says what to write; a hint clears it', async () => {
    const dir = folder('odd-board', META, oddJ1);
    const first = await buildBoard(dir);
    expect(first.errors).toEqual([]);
    expect(first.warnings).toHaveLength(1);
    expect(first.warnings[0]).toContain('J1 is a "custom" connector (footprint "ZX-9000-A", value "ZX9000")');
    expect(first.warnings[0]).toContain('"parts": { "J1": { "type": "<id>" } }');
    expect(first.report).toContain('NOT IDENTIFIED');
    expect(first.entry!.custom).toBe(1);

    fs.writeFileSync(path.join(dir, 'board.json'), JSON.stringify({ ...META, parts: { J1: { type: 'usb_micro_b' } } }));
    const fixed = await buildBoard(dir);
    expect(fixed.errors).toEqual([]);
    expect(fixed.warnings).toEqual([]);
    const j1 = fixed.board!.comps.find((c) => c.ref === 'J1')!;
    expect(j1.conn).toMatchObject({ type: 'usb_micro_b', entry: 'edge' });
    expect(fixed.report).toMatch(/J1\s+usb_micro_b\s+edge \S+\s+by hint/);
    expect(fixed.entry!.custom).toBe(0);

    // the same by footprint name (one line for every part that matches), and a part accepted as Custom, with its part number
    fs.writeFileSync(path.join(dir, 'board.json'), JSON.stringify({ ...META, footprints: { 'ZX-9000': 'usb_micro_b' } }));
    expect((await buildBoard(dir)).warnings).toEqual([]);
    fs.writeFileSync(path.join(dir, 'board.json'), JSON.stringify({ ...META, parts: { J1: { type: 'custom', note: 'ZX-9000-A 6-pin' } } }));
    const accepted = await buildBoard(dir);
    expect(accepted.warnings).toEqual([]);
    expect(accepted.report).toContain('(ZX-9000-A 6-pin)');
  });

  it('a hint that matches nothing, an unknown connector id, a typo and a missing board.json are hard errors', async () => {
    const e = async (h: object | null) => (await buildBoard(folder('bad-board', h))).errors.join('\n');
    expect(await e({ ...META, parts: { J99: { type: 'usb_c' } } })).toContain('parts.J99 matches no part. References in the file: ');
    expect(await e({ ...META, parts: { J1: { type: 'usb_z' } } })).toContain('connector type "usb_z"; use one of: usb_c');
    expect(await e({ ...META, part: {} })).toContain('unknown key "part"');
    expect(await e({ ...META, footprints: { 'NoSuchFootprint': 'usb_c' } })).toContain('matches no part');
    expect(await e({ ...META, holes: { ignore: [[50, 50]] } })).toContain('matches no hole. Holes in the file: ');
    expect(await e(null)).toContain('board.json is missing');
    expect(checkHints([])).toEqual(['board.json must be a JSON object']);
    const empty = tmp(), dir = path.join(empty, 'nothing-here');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'board.json'), '{}');
    expect((await buildBoard(dir)).errors.join()).toContain('has no board files');
    expect((await buildBoard(folder('Bad Name', META))).errors.join()).toContain('use lower case letters, digits and dashes');
    const junk = folder('not-a-board', META, () => 'this is not a board');
    expect((await buildBoard(junk)).errors.join()).toContain('Could not read the files');
  });

  it('holes: "use" picks the mounting holes (and adds one the file lacks), "ignore" frees one', async () => {
    const use = await buildBoard(folder('holes-use', { ...META, holes: { use: [[3.5, 3.5], [10, 10, 3]] } }));
    expect(use.errors).toEqual([]);
    const h = use.board!.holes;
    expect(h).toHaveLength(5);
    expect(h.filter((x) => x.role === 'mount').map((x) => [x.x, x.y, x.d])).toEqual([[3.5, 3.5, 3.2], [10, 10, 3]]);
    expect(use.entry!.holes).toBe(2);
    expect((await buildBoard(folder('holes-nod', { ...META, holes: { use: [[10, 10]] } }))).errors.join()).toContain('has no diameter to add one');
    const ign = await buildBoard(folder('holes-ignore', { ...META, holes: { ignore: [[66.5, 41.5]] } }));
    expect(ign.entry!.holes).toBe(3);
  });

  it('warns about missing credit, and about an outline that looks wrong', async () => {
    const b = await buildBoard(folder('no-credit', {}));
    expect(b.warnings.join('\n')).toMatch(/no "license" or "source"[\s\S]*no "maker" or "url"/);
    const tiny = await buildBoard(folder('tiny', META, (s) => s.replace(/\(end 170 (\d+)\)/g, '(end 101 $1)').replace('(start 170 145)', '(start 101 145)').replace('(start 170 100)', '(start 101 100)')));
    expect(tiny.warnings.join()).toContain('that looks wrong');
  });
});

describe('other formats', () => {
  it('reads an Eagle .brd (its XML needs a DOM, which the script borrows), and `files` narrows what is read', async () => {
    const eagle = `<?xml version="1.0"?><eagle version="9.6"><drawing><board><plain>
      <wire x1="0" y1="0" x2="50" y2="0" width="0" layer="20"/><wire x1="50" y1="0" x2="50" y2="30" width="0" layer="20"/>
      <wire x1="50" y1="30" x2="0" y2="30" width="0" layer="20"/><wire x1="0" y1="30" x2="0" y2="0" width="0" layer="20"/>
      <hole x="4" y="4" drill="3.2"/></plain>
      <libraries><library name="con"><packages><package name="USB-MICRO-B">
        <wire x1="-3.75" y1="-2.5" x2="3.75" y2="-2.5" width="0.1" layer="21"/><wire x1="3.75" y1="-2.5" x2="3.75" y2="2.5" width="0.1" layer="21"/>
        <smd name="1" x="0" y="2" dx="0.4" dy="1.3" layer="1"/></package></packages></library></libraries>
      <elements><element name="J1" library="con" package="USB-MICRO-B" value="" x="25" y="2" rot="R0"/></elements></board></drawing></eagle>`;
    const dir = path.join(tmp(), 'eagle-board');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'demo.brd'), eagle);
    fs.writeFileSync(path.join(dir, 'board.json'), JSON.stringify(META));
    const b = await buildBoard(dir);
    expect(b.errors).toEqual([]);
    expect(b.entry!.size).toEqual([50, 30]);
    expect(b.board!.comps.find((c) => c.ref === 'J1')!.conn!.type).toBe('usb_micro_b');
    expect(b.report).toContain('(Eagle');
    // `files` narrows what is read
    const two = folder('two-files', { ...META, files: ['sensor.kicad_pcb'] });
    fs.writeFileSync(path.join(two, 'other.kicad_pcb'), 'not a board');
    expect((await buildBoard(two)).errors).toEqual([]);
    expect((await buildBoard(folder('lists-missing', { ...META, files: ['nope.kicad_pcb'] }))).errors.join()).toContain('lists the file "nope.kicad_pcb"');
  });
});

describe('the generated files', () => {
  it('index.json lists a row per board with its picture only while that picture is current; one board can be rebuilt alone', async () => {
    const parent = tmp(), out = path.join(tmp(), 'out');
    const a = await buildBoard(folder('board-a', { ...META, name: 'Zed board' }, (s) => s, parent)), b = await buildBoard(folder('board-b', { ...META, name: 'Alpha board' }, oddJ1, parent));
    apply(plan([a, b], out), out);
    const list = () => (JSON.parse(fs.readFileSync(path.join(out, 'index.json'), 'utf8')) as CommunityIndex).boards;
    expect(list().map((r) => r.id)).toEqual(['board-b', 'board-a']); // by name
    expect(fs.readdirSync(out).sort()).toEqual(['board-a.json', 'board-b.json', 'index.json']);
    expect(list().every((r) => !r.pic)).toBe(true);
    // a rendered picture counts while tiles.json says it shows this revision of the board
    fs.writeFileSync(path.join(out, 'board-a.webp'), 'x');
    fs.writeFileSync(path.join(out, 'tiles.json'), JSON.stringify({ 'board-a': a.entry!.rev, 'board-b': 'old' }));
    apply(plan([a, b], out), out);
    expect(list().map((r) => r.pic)).toEqual([undefined, 'board-a.webp']);
    // rebuilding only board-b leaves board-a's row and file alone
    const b2 = await buildBoard(folder('board-b', { ...META, name: 'Alpha board', thickness: 1.2 }, oddJ1, tmp()));
    const p = plan([b2], out, 'board-b');
    expect([...p.files.keys()].sort()).toEqual(['board-b.json', 'index.json']);
    apply(p, out);
    expect(list().map((r) => [r.id, r.rev === b2.entry!.rev])).toEqual([['board-b', true], ['board-a', false]]);
    expect(list().find((r) => r.id === 'board-a')!.pic).toBe('board-a.webp');
    // a full run drops the files of a board that has gone
    const gone = plan([a], out);
    expect(stale(gone, out).sort()).toEqual(['board-b.json', 'index.json', 'tiles.json']);
    apply(gone, out);
    expect(fs.readdirSync(out).sort()).toEqual(['board-a.json', 'board-a.webp', 'index.json', 'tiles.json']);
    expect(JSON.parse(fs.readFileSync(path.join(out, 'tiles.json'), 'utf8'))).toEqual({ 'board-a': a.entry!.rev });
    expect(stale(plan([a], out), out)).toEqual([]);
  });

  it('an unlisted board is built and checked but not offered', async () => {
    const out = path.join(tmp(), 'out');
    const u = await buildBoard(folder('hidden-board', { ...META, listed: false }));
    expect(u.errors).toEqual([]);
    apply(plan([u], out), out);
    expect(JSON.parse(fs.readFileSync(path.join(out, 'index.json'), 'utf8')).boards).toEqual([]);
  });
});

describe('npm run boards (the command)', () => {
  const run = (...args: string[]) => {
    const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'boards.mjs'), ...args], { cwd: root, encoding: 'utf8' });
    return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
  };

  it('reports the example, writes the data, and --check notices when it goes stale', () => {
    const boards = tmp(), out = path.join(tmp(), 'out');
    fs.cpSync(EXAMPLE, path.join(boards, 'example-sensor-jtag'), { recursive: true });
    const args = ['--boards', boards, '--out', out];
    const r = run(...args);
    expect(r.code).toBe(0);
    expect(r.out).toContain('outline     70 x 45 mm');
    expect(r.out).toContain('1 board: 0 errors, 0 warnings');
    expect(JSON.parse(fs.readFileSync(path.join(out, 'index.json'), 'utf8')).boards.map((x: any) => x.id)).toEqual(['example-sensor-jtag']);
    const saved = JSON.parse(fs.readFileSync(path.join(out, 'example-sensor-jtag.json'), 'utf8'));
    expect(saved.holes).toHaveLength(4);
    expect(saved.comps.find((c: any) => c.ref === 'J1').conn.type).toBe('usb_micro_b');
    expect(run(...args, '--check').code).toBe(0);
    // one slug, and --dry writes nothing
    expect(run('example-sensor-jtag', ...args, '--dry').code).toBe(0);
    fs.appendFileSync(path.join(out, 'example-sensor-jtag.json'), ' ');
    const stale = run(...args, '--check');
    expect(stale.code).toBe(1);
    expect(stale.out).toContain('is out of date (example-sensor-jtag.json)');
  });

  it('exits 1 on a hard error and writes nothing; --strict fails on a warning; --types lists the ids', () => {
    const boards = tmp(), out = path.join(tmp(), 'out');
    fs.cpSync(EXAMPLE, path.join(boards, 'good-board'), { recursive: true });
    fs.mkdirSync(path.join(boards, 'no-json'));
    fs.writeFileSync(path.join(boards, 'no-json', 'x.kicad_pcb'), '(kicad_pcb)');
    const bad = run('--boards', boards, '--out', out);
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/ERROR {7}\S*no-json\/board.json is missing/);
    expect(bad.out).toContain('2 boards: 1 error, 0 warnings');
    expect(fs.existsSync(out)).toBe(false);
    expect(run('nothing', '--boards', boards, '--out', out).code).toBe(2);

    const warn = tmp();
    folder('odd-board', META, oddJ1, warn);
    expect(run('--boards', warn, '--out', out, '--dry').code).toBe(0);
    const strict = run('--boards', warn, '--out', out, '--dry', '--strict');
    expect(strict.code).toBe(1);
    expect(strict.out).toContain('WARNING     J1 is a "custom" connector');

    const t = run('--types');
    expect(t.code).toBe(0);
    expect(t.out).toMatch(/usb_c\s+USB-C/);
  });
});
