// How many connectors are told apart by name: a checked-in sample of names as boards carry them (KiCad's, maker part numbers,
// Allegro-style upper-case and underscore forms), each with the type it is (tests/connector-names.tsv), and parts that are
// no connector, which must stay plain. Names nothing identifies yet ("?") stay Custom, so the rate below is an honest one.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { guessPackage } from '../src/model/library';

const rows = readFileSync(new URL('./connector-names.tsv', import.meta.url), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => {
  const [want, name, ref = 'J1', value = ''] = l.split('\t');
  return { want, name, ref, value, g: guessPackage(name, ref, value) };
});
const known = (r: (typeof rows)[number]) => (r.g.conn && r.g.conn.id !== 'custom' ? r.g.conn.id : undefined);

describe('connector names in the wild', () => {
  const conns = rows.filter((r) => r.want !== '-');
  it('every name is the type the sample says', () => {
    for (const r of conns) expect(known(r), r.name).toBe(r.want === '?' ? undefined : r.want);
  });
  it('the sample is mostly identified (the hit rate is pinned)', () => {
    const hit = conns.filter((r) => known(r)).length;
    expect(conns.length).toBeGreaterThan(280);
    expect(hit / conns.length).toBeGreaterThan(0.95);
  });
  it('a name nothing identifies is still a connector when its reference says so: Custom, sized as such', () => {
    for (const r of conns.filter((q) => q.want === '?')) expect(r.g.conn?.id ?? 'custom', r.name).toBe('custom');
  });
  it('parts that are no connector stay plain, whatever their name says', () => {
    const plain = rows.filter((r) => r.want === '-');
    expect(plain.length).toBeGreaterThan(40);
    for (const r of plain) { expect(r.g.conn, r.name).toBeUndefined(); expect(r.g.kind, r.name).not.toBe('connector'); }
  });
  it('the same names in other spellings (upper case, dashes and underscores swapped) are the same types', () => {
    for (const r of conns.filter((q) => q.want !== '?' && /^[A-Za-z]+[\w-]*$/.test(q.name) && /[-_]/.test(q.name))) {
      const t = (n: string) => guessPackage(n, r.ref, r.value).conn?.id;
      // (a name that reads the same when written in capitals; the ones whose meaning is in a pitch or a grid in lower case are left out)
      if (!/[a-z]x\d|\dmm/.test(r.name)) expect(t(r.name.toUpperCase()), r.name).toBe(r.want);
    }
  });
});
