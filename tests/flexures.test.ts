// The flexure table (src/fea/flexures.ts): every printed spring in the rack, with its strain at rest and at full
// deflection from the FEA, held to one rule. Each area registers its rows as a provider; this test runs them all.
import { describe, expect, it } from 'vitest';
import '../src/fea/flexureproviders';
import { FLEX_RULE, flexureIssues, flexureTable, formatTable, type Flexure } from '../src/fea/flexures';

const row = (o: Partial<Flexure> = {}): Flexure => ({ id: 't', name: 'test', part: 'test', kind: 'spring', material: 'PETG', E: 2100, rest: 0, full: 0.008, deflection: '1 mm', restState: 'free', ...o });

describe('the rule', () => {
  it('a spring: 1% at full deflection, 0.2% at rest (PLA: 0.75% at full deflection)', () => {
    expect(flexureIssues(row())).toEqual([]);
    expect(flexureIssues(row({ full: 0.0101 }))).toHaveLength(1);
    expect(flexureIssues(row({ rest: 0.0021 }))[0]).toMatch(/at rest/);
    expect(flexureIssues(row({ rest: FLEX_RULE.rest, full: FLEX_RULE.spring }))).toEqual([]);
    expect(flexureIssues(row({ E: 3500, full: 0.008 }))).toHaveLength(1);
    expect(flexureIssues(row({ E: 3500, full: 0.007 }))).toEqual([]);
  });
  it('a load case beside the two (a pull on a latch) is held to 1.25%', () => {
    expect(flexureIssues(row({ also: [{ label: '20 N pull', strain: 0.012 }] }))).toEqual([]);
    expect(flexureIssues(row({ also: [{ label: '20 N pull', strain: 0.013 }] }))[0]).toMatch(/20 N pull/);
    expect(flexureIssues(row({ E: 3500, full: 0.006, also: [{ label: '20 N pull', strain: 0.0095 }] }))[0]).toMatch(/20 N pull/);
  });
  it('a one-time feature (a barb, a crush rib) may strain more, and has to say what deforms and when', () => {
    expect(flexureIssues(row({ kind: 'once', full: 0.012, rest: 0.005 }))[0]).toMatch(/say what deforms/);
    expect(flexureIssues(row({ kind: 'once', full: 0.012, rest: 0.005, note: 'the barb bends once, at the click' }))).toEqual([]);
    expect(flexureIssues(row({ kind: 'once', full: 0.016, note: 'x' }))).toHaveLength(1);
  });
});

describe('the table', () => {
  it('every flexure meets the rule', async () => {
    const rows = await flexureTable();
    console.log('\n' + formatTable(rows));
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length); // (ids are unique)
    const issues = rows.flatMap(flexureIssues);
    expect(issues).toEqual([]);
  }, 900000);
});
