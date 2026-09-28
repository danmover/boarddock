// Allegro boards: recognised, and in the desktop app read through the user's KiCad 10 (here a stand-in converter).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { zipSync } from 'fflate';
import { importMany, type Converter } from '../src/import';
import { isAllegroBrd } from '../src/import/allegro';

// a stand-in Allegro file: release 17.4's magic number and the "all" version string at 0xf8
const fakeBrd = () => { const b = new Uint8Array(0x2000); b.set([0x00, 0x09, 0x14, 0x00]); b.set([0x61, 0x6c, 0x6c], 0xf8); return b; };
const kicad = readFileSync('examples/dual-mcu-swd.kicad_pcb', 'utf8');

describe('Allegro boards', () => {
  it('are recognised', () => {
    expect(isAllegroBrd(fakeBrd())).toBe(true);
    expect(isAllegroBrd(new TextEncoder().encode('<?xml version="1.0"?><eagle>'.padEnd(0x300, ' ')))).toBe(false);
  });
  it('without a converter (the web app) say how to get a file BoardDock reads', async () => {
    const r = await importMany([{ name: 'ctrl.brd', bytes: fakeBrd() }]);
    expect(r.boards).toHaveLength(0);
    expect(r.errors[0]).toMatch(/Allegro/);
    expect(r.errors[0]).toMatch(/KiCad 10/);
  });
  it('with a converter (the desktop app and KiCad 10), loose or in a zip with other files, come in as boards', async () => {
    const seen: string[] = [];
    const conv: Converter = async (name) => { seen.push(name); return { text: kicad }; };
    const loose = await importMany([{ name: 'ctrl.brd', bytes: fakeBrd() }], conv);
    expect(loose.errors).toEqual([]);
    expect(loose.boards).toHaveLength(1);
    expect(loose.boards[0].comps.length).toBeGreaterThan(3);
    const zip = zipSync({ 'ctrl/ctrl.brd': fakeBrd(), 'ctrl/readme.txt': new TextEncoder().encode('hello') });
    const zipped = await importMany([{ name: 'ctrl.zip', bytes: zip }], conv);
    expect(zipped.errors).toEqual([]);
    expect(zipped.boards).toHaveLength(1);
    expect(seen).toEqual(['ctrl.brd', 'ctrl.brd']);
  });
  it("when KiCad isn't installed, or can't read it, it says so", async () => {
    const none = await importMany([{ name: 'ctrl.brd', bytes: fakeBrd() }], async () => ({ error: 'no-kicad' }));
    expect(none.boards).toHaveLength(0);
    expect(none.errors.join(' ')).toMatch(/isn't installed/);
    const bad = await importMany([{ name: 'ctrl.brd', bytes: fakeBrd() }], async () => ({ error: 'KiCad could not import it (unsupported version)' }));
    expect(bad.errors.join(' ')).toMatch(/could not import it/);
  });
});
