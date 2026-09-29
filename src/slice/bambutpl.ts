// Bambu Studio's (and OrcaSlicer's, and PrusaSlicer's) G-code templates, filled in: the printer's own start, end and
// layer-change code comes from the user's own copy of Bambu Studio or OrcaSlicer (BoardDock does not ship it), in
// their template language, and this turns it into plain G-code for one print. The language: `[name]` and
// `[name[i]]` (a value), `{expression}` (arithmetic, comparisons, && || !, "strings", name[index], min, max, int,
// round, abs), and `{if ...}` / `{elsif ...}` / `{else}` / `{endif}` blocks. A name it doesn't know is never
// guessed: the print is refused and the names are listed. Pure.
import type { Material, PrinterSettings } from '../model/types';
import { FILAMENTS } from '../model/printers';

export type TplValue = number | string | boolean | (number | string | boolean)[];
export interface Rendered { text: string; unknown: string[] }

type Tok = { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'id'; v: string } | { t: 'op'; v: string };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c) && /[0-9]/.test(src[i + (c === '.' ? 1 : 0)] ?? '')) {
      let j = i + 1;
      while (j < src.length && /[0-9.eE]/.test(src[j])) { if (/[eE]/.test(src[j]) && /[+-]/.test(src[j + 1] ?? '')) j++; j++; }
      out.push({ t: 'num', v: Number(src.slice(i, j)) }); i = j; continue;
    }
    if (c === '"' || c === "'") { const j = src.indexOf(c, i + 1); if (j < 0) throw new Error('unclosed string'); out.push({ t: 'str', v: src.slice(i + 1, j) }); i = j + 1; continue; }
    if (/[A-Za-z_]/.test(c)) { let j = i + 1; while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++; out.push({ t: 'id', v: src.slice(i, j) }); i = j; continue; }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/%()<>![],?:'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    throw new Error(`unexpected "${c}"`);
  }
  return out;
}

/** Evaluate one expression. Unknown names are collected in `unknown` (and count as 0). */
export function evalExpr(src: string, vars: Record<string, TplValue>, unknown: Set<string> = new Set()): TplValue {
  const toks = lex(src);
  let k = 0;
  const peek = () => toks[k], next = () => toks[k++];
  const op = (v: string) => { const t = peek(); if (t?.t === 'op' && t.v === v) { k++; return true; } return false; };
  const word = (v: string) => { const t = peek(); if (t?.t === 'id' && t.v === v) { k++; return true; } return false; };
  const num = (x: TplValue): number => (typeof x === 'number' ? x : typeof x === 'boolean' ? (x ? 1 : 0) : Array.isArray(x) ? num(x[0] ?? 0) : Number(x));
  const truthy = (x: TplValue): boolean => (Array.isArray(x) ? truthy(x[0] ?? false) : typeof x === 'string' ? x !== '' && x !== 'false' && x !== '0' : !!x);
  const scalar = (x: TplValue) => (Array.isArray(x) ? x[0] ?? 0 : x);
  const FN: Record<string, (a: TplValue[]) => TplValue> = {
    min: (a) => Math.min(...a.map(num)), max: (a) => Math.max(...a.map(num)), int: (a) => Math.trunc(num(a[0])), round: (a) => Math.round(num(a[0])), abs: (a) => Math.abs(num(a[0])),
  };
  const primary = (): TplValue => {
    const t = next();
    if (!t) throw new Error('unexpected end');
    if (t.t === 'num' || t.t === 'str') return t.v;
    if (t.t === 'op' && t.v === '(') { const v = ternary(); if (!op(')')) throw new Error('missing )'); return v; }
    if (t.t === 'op' && t.v === '-') return -num(unary());
    if (t.t === 'op' && t.v === '!') return !truthy(unary());
    if (t.t === 'id') {
      if (t.v === 'true') return true;
      if (t.v === 'false') return false;
      if (t.v === 'not') return !truthy(unary());
      if (FN[t.v] && op('(')) { const args: TplValue[] = []; if (!op(')')) { do args.push(ternary()); while (op(',')); if (!op(')')) throw new Error('missing )'); } return FN[t.v](args); }
      let v: TplValue = t.v in vars ? vars[t.v] : (unknown.add(t.v), 0);
      if (op('[')) { const i = num(ternary()); if (!op(']')) throw new Error('missing ]'); v = Array.isArray(v) ? v[Math.max(0, Math.min(v.length - 1, Math.round(i)))] ?? 0 : v; }
      return v;
    }
    throw new Error(`unexpected "${t.v}"`);
  };
  const unary = (): TplValue => primary();
  const term = (): TplValue => { let a = unary(); for (;;) { if (op('*')) a = num(a) * num(unary()); else if (op('/')) a = num(a) / num(unary()); else if (op('%')) a = num(a) % num(unary()); else return a; } };
  const sum = (): TplValue => { let a = term(); for (;;) { if (op('+')) { const b = term(); a = typeof scalar(a) === 'string' || typeof scalar(b) === 'string' ? `${scalar(a)}${scalar(b)}` : num(a) + num(b); } else if (op('-')) a = num(a) - num(term()); else return a; } };
  const cmp = (): TplValue => {
    let a = sum();
    for (;;) {
      const t = peek();
      if (t?.t !== 'op' || !['<', '>', '<=', '>=', '==', '!='].includes(t.v)) return a;
      k++;
      const b = sum(), sa = scalar(a), sb = scalar(b);
      const str = typeof sa === 'string' || typeof sb === 'string';
      a = t.v === '==' ? (str ? String(sa) === String(sb) : num(sa) === num(sb)) : t.v === '!=' ? (str ? String(sa) !== String(sb) : num(sa) !== num(sb)) : t.v === '<' ? num(sa) < num(sb) : t.v === '>' ? num(sa) > num(sb) : t.v === '<=' ? num(sa) <= num(sb) : num(sa) >= num(sb);
    }
  };
  const and = (): TplValue => { let a = cmp(); while (op('&&') || word('and')) { const b = cmp(); a = truthy(a) && truthy(b); } return a; };
  const or = (): TplValue => { let a = and(); while (op('||') || word('or')) { const b = and(); a = truthy(a) || truthy(b); } return a; };
  const ternary = (): TplValue => { const c = or(); if (op('?')) { const a = ternary(); if (!op(':')) throw new Error('missing :'); const b = ternary(); return truthy(c) ? a : b; } return c; };
  const v = ternary();
  if (k < toks.length) throw new Error(`unexpected "${(toks[k] as { v: unknown }).v}"`);
  return v;
}

/** A value the way it goes into G-code: whole numbers plain, others to three places without trailing zeros. */
export function fmt(v: TplValue): string {
  const s = Array.isArray(v) ? v[0] ?? '' : v;
  if (typeof s === 'boolean') return s ? 'true' : 'false';
  if (typeof s === 'number') return Number.isInteger(s) ? String(s) : String(Math.round(s * 1000) / 1000);
  return s;
}

/**
 * Fill in a template. Lines that hold nothing but a control tag ({if}, {else}, {endif}...) go; `[name]` is only
 * a value when `name` looks like a setting (lower case, underscores), so ordinary G-code like "M620 S[...]A" and
 * bracketed comments keep working. Unknown names in comments are left as they are; anywhere else they are reported.
 */
export function renderTemplate(tpl: string, vars: Record<string, TplValue>): Rendered {
  const unknown = new Set<string>();
  // the control flow first, over the whole text: a stack of [taking this branch, a branch was taken already, parent taking]
  const out: string[] = [];
  const stack: { on: boolean; done: boolean; parent: boolean }[] = [];
  const live = () => stack.every((s) => s.on);
  const TAG = /\{\s*(if|elsif|else|endif)\b([^}]*)\}/g;
  for (const raw of tpl.replace(/\r\n?/g, '\n').split('\n')) {
    TAG.lastIndex = 0;
    if (!TAG.test(raw)) { if (live()) out.push(raw); continue; }
    // a line with control tags: keep what is in the branches taken; drop it if it was only tags
    TAG.lastIndex = 0;
    let line = '', last = 0, content = false, m: RegExpExecArray | null;
    while ((m = TAG.exec(raw))) {
      const before = raw.slice(last, m.index);
      if (before.trim()) content = true;
      if (live()) line += before;
      const kind = m[1], cond = m[2].trim();
      const test = () => { try { return evalBool(cond, vars, unknown); } catch (e) { throw new Error(`{${kind} ${cond}}: ${(e as Error).message}`); } };
      if (kind === 'if') { const parent = live(); const on = parent && test(); stack.push({ on, done: on, parent }); }
      else if (kind === 'elsif') { const s = stack[stack.length - 1]; if (!s) throw new Error('{elsif} without {if}'); const on = s.parent && !s.done && test(); s.on = on; s.done ||= on; }
      else if (kind === 'else') { const s = stack[stack.length - 1]; if (!s) throw new Error('{else} without {if}'); s.on = s.parent && !s.done; s.done = true; }
      else if (!stack.pop()) throw new Error('{endif} without {if}');
      last = TAG.lastIndex;
    }
    const rest = raw.slice(last);
    if (rest.trim()) content = true;
    if (live()) line += rest;
    if (content && line.trim()) out.push(line);
  }
  if (stack.length) throw new Error(`{if} without {endif} (${stack.length})`);
  // then the values
  const text = out.map((line) => {
    const c = line.indexOf(';'), code = c < 0 ? line : line.slice(0, c), comment = c < 0 ? '' : line.slice(c);
    const fill = (s: string, inComment: boolean) => s
      .replace(/\{([^{}]+)\}/g, (all, ex: string) => {
        const u = new Set<string>();
        try { const v = evalExpr(ex, vars, u); if (u.size && inComment) return all; u.forEach((n) => unknown.add(n)); return fmt(v); } catch (e) { if (inComment) return all; throw new Error(`{${ex}}: ${(e as Error).message}`); }
      })
      .replace(/\[([a-z][a-z0-9_]*)(?:\[([^\]]+)\])?\]/g, (all, name: string, idx?: string) => {
        if (!(name in vars)) { if (!inComment) unknown.add(name); return all; }
        const v = vars[name];
        return fmt(Array.isArray(v) ? v[idx != null ? Math.round(Number(evalExpr(idx, vars, unknown))) : 0] ?? v[0] : v);
      });
    return fill(code, false) + fill(comment, true);
  }).join('\n');
  return { text, unknown: [...unknown].sort() };
}

function evalBool(cond: string, vars: Record<string, TplValue>, unknown: Set<string>) {
  const v = evalExpr(cond, vars, unknown);
  return Array.isArray(v) ? !!v[0] : typeof v === 'string' ? v !== '' : !!v;
}

/** Does this text use Bambu's (or PrusaSlicer's) template language rather than Kiri:Moto's {temp} and {bed_temp}? */
export const isSlicerTemplate = (s: string) => /\{\s*if\b|\[[a-z][a-z0-9_]*\]|\{[a-z_]+\[/.test(s);

/** The start, end and layer-change code out of a Bambu Studio / OrcaSlicer machine profile (.json). */
export function fromProfileJson(text: string): { start?: string; end?: string; layer?: string; name?: string } {
  const d = JSON.parse(text);
  const s = (v: unknown) => (typeof v === 'string' ? v : Array.isArray(v) ? v.join('\n') : undefined);
  return { start: s(d.machine_start_gcode), end: s(d.machine_end_gcode), layer: s(d.layer_change_gcode), name: typeof d.name === 'string' ? d.name : undefined };
}

/**
 * What a Bambu Studio template needs for this print: the filament's temperatures and type, the plate, the first
 * layer's area (the printer levels just there), the height, a few fixed answers (one extruder, 0.4 mm nozzle, printed
 * layer by layer). Names used by Bambu's own start, end and layer code for its printers.
 */
export function bambuVars(ps: PrinterSettings, mat: Material, g: { x0: number; y0: number; x1: number; y1: number; z1: number; layers: number }): Record<string, TplValue> {
  const f = FILAMENTS[mat], flow = f.flow;
  const plateTemp = { cool_plate_temp: [f.bed], eng_plate_temp: [f.bed], hot_plate_temp: [f.bed], textured_plate_temp: [f.bed], cool_plate_temp_initial_layer: [f.bedFirst], eng_plate_temp_initial_layer: [f.bedFirst], hot_plate_temp_initial_layer: [f.bedFirst], textured_plate_temp_initial_layer: [f.bedFirst] };
  return {
    ...plateTemp,
    nozzle_temperature_initial_layer: [f.nozzleFirst], nozzle_temperature: [f.nozzle], nozzle_temperature_range_low: [f.range[0]], nozzle_temperature_range_high: [f.range[1]],
    bed_temperature: [f.bed], bed_temperature_initial_layer: [f.bedFirst], bed_temperature_initial_layer_single: f.bedFirst,
    filament_type: [mat], filament_max_volumetric_speed: [flow], flush_temperatures: [f.nozzle], flush_volumetric_speeds: [flow],
    initial_extruder: 0, initial_no_support_extruder: 0, nozzle_diameter: [0.4], filament_diameter: [1.75],
    curr_bed_type: ps.plate ?? 'Textured PEI Plate',
    outer_wall_volumetric_speed: Math.min(flow, 12),
    first_layer_print_min: [Math.round(g.x0 * 10) / 10, Math.round(g.y0 * 10) / 10], first_layer_print_max: [Math.round(g.x1 * 10) / 10, Math.round(g.y1 * 10) / 10],
    first_layer_print_size: [Math.round((g.x1 - g.x0) * 10) / 10, Math.round((g.y1 - g.y0) * 10) / 10],
    first_layer_center_no_wipe_tower: [Math.round(((g.x0 + g.x1) / 2) * 10) / 10, Math.round(((g.y0 + g.y1) / 2) * 10) / 10],
    max_layer_z: Math.round(g.z1 * 100) / 100, printable_height: ps.maxZ ?? 180, total_layer_count: g.layers, layer_num: 0, layer_z: 0,
    spiral_mode: false, print_sequence: 'by layer', timelapse_type: 0, has_wipe_tower: false,
  };
}
