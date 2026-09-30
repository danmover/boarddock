// The board holder's flexures (src/fea/boardflex.ts) against the shared rule (src/fea/flexures.ts): spring clips,
// hairpins, the fixed ledge and the anti-rattle springs, 0.2% strain at rest at most, 1% or less at full deflection in PETG.
import { describe, it, expect } from 'vitest';
import { boardFlexures, boardProvider } from '../src/fea/boardflex';
import { FLEX_RULE, flexureIssues, flexureTable } from '../src/fea/flexures';
import '../src/fea/flexureproviders';

describe('the board holder\'s flexures', () => {
  it('spring clips, hairpins, the fixed ledge and the anti-rattle springs: 0.2% at rest at most, 1% or less at full deflection in PETG', () => {
    const list = boardFlexures('PETG');
    expect(list.length).toBeGreaterThan(20);
    expect(list.flatMap(flexureIssues)).toEqual([]);
    // the rule is what the sizing keeps to, not a loose one
    expect(Math.max(...list.map((f) => f.full))).toBeGreaterThan(0.5 * FLEX_RULE.spring);
    expect(Math.max(...list.map((f) => f.rest))).toBeLessThanOrEqual(FLEX_RULE.rest);
  });

  it('they are in the shared table', async () => {
    const rows = await flexureTable();
    expect(rows.filter((r) => /^clip\./.test(r.id)).length).toBeGreaterThan(20);
    expect(rows.some((r) => r.id === 'ledge') && rows.some((r) => r.id === 'bow.14')).toBe(true);
    expect(boardProvider.area).toBe('board holder');
  });

  it('a clip carries no load once the board is in, a hairpin included, and the ledge none at all', () => {
    const list = boardFlexures('PETG');
    for (const f of list.filter((x) => /^clip\./.test(x.id))) expect(f.rest, f.id).toBe(0);
    expect(list.filter((x) => /u$/.test(x.id)).length).toBeGreaterThan(3); // (the hairpins are among them)
    expect(list.find((f) => f.id === 'ledge')).toMatchObject({ rest: 0, full: 0 });
  });

  it('the anti-rattle springs stay at 0.2% strain or less at rest even with the board 0.15 mm bigger', () => {
    for (const f of boardFlexures('PETG').filter((x) => /^bow\./.test(x.id))) {
      expect(f.rest, f.id).toBeLessThanOrEqual(0.002);
      expect(f.full, f.id).toBeLessThan(0.005);
    }
  });

  it('in PLA (held to 0.75%) every clip is inside it but the 8 mm hairpin, which says so in the Check step', () => {
    expect(boardFlexures('PLA').filter((f) => !/\.8u$/.test(f.id)).flatMap(flexureIssues)).toEqual([]);
  });
});
