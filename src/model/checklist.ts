// The live buy / print / tools checklist: what to buy (the shopping list), what to print (plates and parts) and the
// tools, each line tickable. It is worked out from the rack as it stands, so it changes as the rack does; ticks are kept
// in the project (`ticks`, by line key) and a tick whose line is gone goes with it. Pure: from the project and its build.
import { billOfMaterials, type BomGroup } from './bom';
import type { GenResult, Project } from './types';

export interface CheckLine { key: string; qty: number; item: string; note?: string }
export interface CheckGroup { head: string; lines: CheckLine[] }
export interface CheckSection { id: 'buy' | 'print' | 'tools'; title: string; groups: CheckGroup[] }

const TITLE: Record<CheckSection['id'], string> = { buy: 'To buy', print: 'To print', tools: 'Tools' };

/**
 * A line is told apart by what it is and how many: when the rack changes how many of a part it needs (a fourth Pi
 * holder), that is a new line and starts unticked, as you have only got what the old line said. A note (a part's
 * weight) is not part of the key.
 */
const keyOf = (id: CheckSection['id'], head: string, qty: number, item: string) => `${id}|${head}|${qty}|${item}`;

/** The checklist for the rack: what to buy, what to print, the tools. Sections with nothing in them are left out. */
export function checklist(p: Project, res: GenResult): CheckSection[] {
  const bom = billOfMaterials(p, res);
  const make = (id: CheckSection['id'], groups: BomGroup[], head: (g: BomGroup) => string): CheckSection => ({
    id, title: TITLE[id],
    groups: groups.map((g) => ({ head: head(g), lines: g.rows.map((r) => ({ key: keyOf(id, g.head, r.qty, r.item), qty: r.qty, item: r.item, ...(r.note ? { note: r.note } : {}) })) })).filter((g) => g.lines.length),
  });
  const print = bom.filter((g) => g.head.startsWith('Print: '));
  const tools = bom.filter((g) => g.head === 'Tools');
  const buy = bom.filter((g) => g.buy);
  return [make('buy', buy, (g) => g.head), make('print', print, (g) => g.head.replace(/^Print: /, '').replace(/^./, (c) => c.toUpperCase())), make('tools', tools, () => 'Tools')].filter((s) => s.groups.length);
}

/** Every line's key in the checklist. */
export const lineKeys = (sections: CheckSection[]): string[] => sections.flatMap((s) => s.groups.flatMap((g) => g.lines.map((l) => l.key)));

/** The ticks whose lines are still there, in the order they were made, each once. */
export function pruneTicks(ticks: string[] | undefined, sections: CheckSection[]): string[] {
  const live = new Set(lineKeys(sections));
  return [...new Set(ticks ?? [])].filter((k) => live.has(k));
}

/** The ticks with this line ticked or unticked. */
export const setTick = (ticks: string[] | undefined, key: string, on: boolean): string[] => (on ? [...new Set([...(ticks ?? []), key])] : (ticks ?? []).filter((k) => k !== key));

/** Tick or untick every line of a group or a section at once (`keys`). */
export const setTicks = (ticks: string[] | undefined, keys: string[], on: boolean): string[] => (on ? [...new Set([...(ticks ?? []), ...keys])] : (ticks ?? []).filter((k) => !keys.includes(k)));

/** How many lines are ticked of how many, in all and in each section. */
export function progress(sections: CheckSection[], ticks: string[] | undefined): { done: number; total: number; by: Record<string, { done: number; total: number }> } {
  const on = new Set(ticks ?? []), by: Record<string, { done: number; total: number }> = {};
  let done = 0, total = 0;
  for (const s of sections) {
    const keys = s.groups.flatMap((g) => g.lines.map((l) => l.key)), d = keys.filter((k) => on.has(k)).length;
    by[s.id] = { done: d, total: keys.length };
    done += d; total += keys.length;
  }
  return { done, total, by };
}
