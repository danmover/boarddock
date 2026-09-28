// Wiring view: every board as a card with its plugs, cables drawn between them, on a canvas you pan and zoom. Drag a
// card by its title to move it (it stays there); Arrange lays them all out as the power and data flow, or as they
// stand on the rails. To connect: drag from a plug to the plug (or just the card) it goes to, or click a plug and
// pick from its best matches, or click one plug and then another; dragging a plug that has a cable moves that end of
// the cable. A pin header opens into its pins, and a pin then a pin adds a jumper wire. The side panel lists what still
// needs connecting (and what the rack is short of) and every cable. Click a cable (or a wire) to select it, Del
// removes it.
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPE } from 'react';
import type { Link, Pin, PlugRef, Project } from '../model/types';
import { allPlugs, autoLinks, cableFlow, canCable, connectNote, KIND_COLOR, KIND_NAME, linkKind, numberLinks, PC, pcModule, rankTargets, refusal, sameRef, shortName, wiringAdvice, type PlugInfo } from '../model/links';
import { isPlugPack } from '../model/powerdata';
import { TEMPLATES } from '../model/templates';
import { fillWires, headerPins } from '../model/probes';
import { flowLayout, rackLayout, type Pos, type Size } from '../model/wirelayout';
import { edit, isSel, select, store, toast, useApp } from '../state';
import { Icon, I } from './icons';
import { addAccessory, addLinks, plugPlaces, removeLinks, rewire } from './linkOps';

const W = 236, HEAD = 40, ROW = 24, PROW = 19;
// USB cables are drawn near-black in 3D; on this graph they take the text colour so they show in both themes
const wire = (k: keyof typeof KIND_COLOR) => (k === 'usb' ? 'var(--muted)' : KIND_COLOR[k]);
const PIN_TYPES = new Set(['header', 'pins_ra', 'jst_ph', 'jst_xh']);
// jumper wire colours, in the order a new wire takes them (ground black, a supply red)
const JUMPER = ['#e0a030', '#3b7dd8', '#8a5cc7', '#e87b2a', '#2f9e44', '#e6e6e2', '#8b5a2b', '#9aa0a6'];

const ROLE_TEXT: Record<string, string> = { host: 'USB host', device: 'USB device', 'power-in': 'power in', 'power-in-dc': 'DC in', 'power-out': 'power out', 'dc-out': 'DC out', 'mains-in': 'mains plug', 'mains-out': 'outlet', 'hub-up': 'to host', 'hub-down': 'hub port', net: 'Ethernet', video: 'video', audio: 'audio', wire: 'wires', debug: 'debug', uart: 'serial', other: '' };

type Row = { q: PlugInfo; pin?: Pin };
type View = { x: number; y: number; k: number };

const keyOf = (q: PlugInfo) => `${q.ref.module}/${q.ref.ref}`;
const pinsOf = (q: PlugInfo): Pin[] => (q.comp.conn && PIN_TYPES.has(q.comp.conn.type) ? headerPins(q.comp) : []);

/** The rows of cards as the boards stand on the rails: rail by rail, along each, stacked boards after their base. */
function railRows(p: Project, panel: NonNullable<NonNullable<ReturnType<typeof store.get>['result']>['report']['panel']> | undefined): string[][] {
  const rows: string[][] = [];
  const placed = new Set<string>();
  if (panel) for (const r of panel.rails) {
    const ids = panel.mounts.filter((m) => m.rail === r.id).sort((a, b) => a.at - b.at).flatMap((m) => m.slots.map((s) => s.module)).filter(Boolean) as string[];
    const row: string[] = [];
    // each board, then whatever is stacked on it (and on that)
    const put = (id: string) => { if (placed.has(id)) return; row.push(id); placed.add(id); for (const r2 of p.modules.filter((x) => x.on === id)) put(r2.id); };
    for (const id of ids) put(id);
    if (row.length) rows.push(row);
  }
  return rows;
}

export function WiringView() {
  const p = useApp((s) => s.project)!;
  const rep = useApp((s) => s.result?.report ?? null);
  const sel = useApp((s) => s.sel);
  const [pending, setPending] = useState<PlugInfo | null>(null);
  const [pendingPin, setPendingPin] = useState<{ q: PlugInfo; pin: string } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [find, setFind] = useState('');
  const [view, setView] = useState<View | null>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [selWire, setSelWire] = useState<{ link: string; i: number } | null>(null);
  // a cable being drawn from a plug (drag to connect), in canvas coordinates; `pressed`: a plug pressed, not yet dragged
  const [wireDrag, setWireDrag] = useState<{ from: PlugInfo; x: number; y: number } | null>(null);
  const pressed = useRef<{ q: PlugInfo; sx: number; sy: number; dragged: boolean } | null>(null);
  const dragClick = useRef(false); // the click that ends a drag is not a click on the plug
  const sideRef = useRef<string | null>(null);
  const [side, setSide] = useState<'todo' | 'cables' | null>(() => (typeof window !== 'undefined' && window.innerWidth < 760 ? null : 'todo'));
  const box = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ kind: 'pan' | 'card'; id?: string; sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null);
  const plugs = useMemo(() => allPlugs(p), [p]);
  const links = p.links ?? [];
  sideRef.current = side;
  // the cards: every board and box, and "Your computer" (off the rack) when anything could go to it
  const mods = useMemo(() => (links.some((l) => l.a.module === PC || l.b.module === PC) || plugs.some((q) => q.role === 'device' || q.role === 'hub-up') ? [...p.modules, pcModule(p)] : p.modules), [p, plugs]);

  const jumperOf = (q: PlugInfo) => links.find((l) => l.kind === 'jumper' && (sameRef(l.a, q.ref) || sameRef(l.b, q.ref)));
  const showsPins = (q: PlugInfo) => pinsOf(q).length >= 2 && (open.has(keyOf(q)) || !!jumperOf(q) || pendingPin?.q.module === q.module && pendingPin.q.ref.ref === q.ref.ref);

  // each card's rows: its plugs, and under a pin header that is open, its pins
  const rows = useMemo(() => {
    const out = new Map<string, Row[]>();
    for (const m of mods) out.set(m.id, []);
    for (const q of plugs) {
      const r = out.get(q.module.id);
      if (!r) continue;
      r.push({ q });
      if (showsPins(q)) for (const pin of pinsOf(q)) r.push({ q, pin });
    }
    return out;
  }, [plugs, mods, open, links, pendingPin]);
  const cardH = (id: string) => HEAD + (rows.get(id) ?? []).reduce((s, r) => s + (r.pin ? PROW : ROW), 0) + Math.max(0, (rows.get(id)?.length ? 0 : ROW)) + 10;
  const sizes = useMemo(() => new Map<string, Size>(mods.map((m) => [m.id, { w: W, h: cardH(m.id) }])), [rows, mods]);

  // where each card is: where it was put, else as on the rails; cards new since then go in a row underneath
  const pos: Pos = useMemo(() => {
    const saved = p.wiring?.pos ?? {};
    const def = withMissing(rackLayout(p, railRows(p, rep?.panel ?? undefined), sizes));
    const have = mods.filter((m) => saved[m.id]);
    if (!have.length) return def;
    const out: Pos = new Map(have.map((m) => [m.id, saved[m.id]]));
    let x = 20, y = Math.max(...have.map((m) => saved[m.id][1] + sizes.get(m.id)!.h)) + 50;
    for (const m of mods) if (!out.has(m.id)) { out.set(m.id, [x, y]); x += W + 60; }
    return out;
  }, [p.wiring, mods, rep, sizes]);
  /** Cards a layout left out (your computer, a plug pack off the rails): in a column to the left of the rest. */
  function withMissing(q: Pos): Pos {
    const miss = mods.filter((m) => !q.has(m.id));
    if (!miss.length) return q;
    const xs = [...q.values()].map((c) => c[0]), ys = [...q.values()].map((c) => c[1]);
    let x = (xs.length ? Math.min(...xs) : 20) - W - 80, y = ys.length ? Math.min(...ys) : 20;
    for (const m of miss) { q.set(m.id, [x, y]); y += (sizes.get(m.id)?.h ?? 100) + 40; }
    return q;
  }
  const at = (id: string) => { const q = pos.get(id) ?? [20, 20]; return drag?.id === id ? [q[0] + drag.dx, q[1] + drag.dy] : q; };

  // ---- the canvas: fit, pan, zoom at the pointer ----
  const bounds = () => {
    const ids = [...pos.keys()];
    if (!ids.length) return [0, 0, 600, 400];
    return [Math.min(...ids.map((id) => pos.get(id)![0])), Math.min(...ids.map((id) => pos.get(id)![1])), Math.max(...ids.map((id) => pos.get(id)![0] + W)), Math.max(...ids.map((id) => pos.get(id)![1] + sizes.get(id)!.h))];
  };
  const fit = (): View => {
    const el = box.current, [x0, y0, x1, y1] = bounds();
    // (the side panel takes the right of a wide window)
    const w = (el?.clientWidth ?? 800) - (sideRef.current && (el?.clientWidth ?? 0) > 760 ? 344 : 0), h = el?.clientHeight ?? 600;
    const k = Math.max(0.2, Math.min(1.15, (w - 40) / (x1 - x0 + 40), (h - 170) / (y1 - y0 + 40)));
    return { k, x: (w - (x1 - x0) * k) / 2 - x0 * k, y: 104 - y0 * k };
  };
  useEffect(() => { if (!view && box.current) setView(fit()); }, [pos, view]);
  const v = view ?? { x: 0, y: 0, k: 1 };
  const zoomAt = (f: number, cx?: number, cy?: number) => setView((o) => {
    const c = o ?? fit(), el = box.current;
    const px = cx ?? (el ? el.clientWidth / 2 : 0), py = cy ?? (el ? el.clientHeight / 2 : 0);
    const k = Math.max(0.2, Math.min(3, c.k * f));
    return { k, x: px - ((px - c.x) * k) / c.k, y: py - ((py - c.y) * k) / c.k };
  });
  // a pinch (or ⌘/Ctrl + wheel) zooms where the pointer is; scrolling pans
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const w = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0025)), e.clientX - r.left, e.clientY - r.top);
      else setView((o) => { const c = o ?? fit(); const s = e.deltaMode ? 30 : 1; return { ...c, x: c.x - e.deltaX * s, y: c.y - e.deltaY * s }; });
    };
    el.addEventListener('wheel', w, { passive: false });
    return () => el.removeEventListener('wheel', w);
  }, []);
  const down = (e: RPE, kind: 'pan' | 'card', id?: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    gesture.current = { kind, id, sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y, moved: false };
  };
  const toCanvas = (e: { clientX: number; clientY: number }) => { const r = box.current!.getBoundingClientRect(); return { x: (e.clientX - r.left - v.x) / v.k, y: (e.clientY - r.top - v.y) / v.k }; };
  const move = (e: RPE) => {
    const pr = pressed.current;
    if (pr) {
      if (!pr.dragged && Math.hypot(e.clientX - pr.sx, e.clientY - pr.sy) < 6) return;
      pr.dragged = true;
      setWireDrag({ from: pr.q, ...toCanvas(e) });
      return;
    }
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
    if (!g.moved && Math.hypot(dx, dy) < 3) return;
    g.moved = true;
    if (g.kind === 'pan') setView((o) => ({ ...(o ?? fit()), x: g.vx + dx, y: g.vy + dy }));
    else setDrag({ id: g.id!, dx: dx / v.k, dy: dy / v.k });
  };
  const up = (e?: RPE) => {
    const pr = pressed.current;
    if (pr) {
      pressed.current = null;
      if (pr.dragged) dragClick.current = true;
      if (pr.dragged && e) {
        // dropped on a plug, or on a card (its best free plug that fits)
        setWireDrag(null);
        const el = document.elementFromPoint(e.clientX, e.clientY) as Element | null;
        const pk = el?.closest('[data-plug]')?.getAttribute('data-plug'), ck = el?.closest('[data-card]')?.getAttribute('data-card');
        let to = pk ? plugs.find((x) => keyOf(x) === pk) : undefined;
        const from = pr.q, cur = links.find((l) => sameRef(l.a, from.ref) || sameRef(l.b, from.ref));
        // dragging a plug that has a cable moves that end of it: the other end looks for its new partner
        const keep = cur ? info(sameRef(cur.a, from.ref) ? cur.b : cur.a) : undefined;
        const seeker = keep ?? from;
        if (!to && ck && ck !== seeker.module.id) to = rankTargets(p, seeker.ref, plugPlaces(), 50).find((t) => t.plug.module.id === ck)?.plug;
        if (to && to !== from) { if (keep && cur) replug(cur, keep, to); else connect(from, to); }
        else if (!to && ck) toast('Nothing free on that board fits this plug.');
      }
      return;
    }
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.kind === 'card' && g.moved && drag) {
      // the first card moved keeps every other card where it is now
      const all = Object.fromEntries(mods.map((m) => [m.id, pos.get(m.id) ?? [20, 20]])) as Record<string, [number, number]>;
      const q = all[drag.id];
      all[drag.id] = [Math.round(q[0] + drag.dx), Math.round(q[1] + drag.dy)];
      edit((pp) => { pp.wiring = { ...(pp.wiring ?? {}), pos: all }; });
      setDrag(null);
      return;
    }
    setDrag(null);
    if (!g.moved) {
      if (g.kind === 'card') setFocus((f) => (f === g.id ? null : g.id!));
      else { setPending(null); setPendingPin(null); setSelWire(null); select([]); setFocus(null); }
    }
  };
  const arrange = (how: 'flow' | 'rack') => {
    const next = withMissing(how === 'flow' ? flowLayout(p, sizes) : rackLayout(p, railRows(p, rep?.panel ?? undefined), sizes));
    edit((pp) => { pp.wiring = { ...(pp.wiring ?? {}), pos: Object.fromEntries([...next].map(([id, q]) => [id, [Math.round(q[0]), Math.round(q[1])]])) }; });
    setView(null);
    toast(how === 'flow' ? 'Laid out as the power and data flow: chargers and hosts, then hubs, then probes and adapters, then the boards they serve. ⌘Z undoes it.' : 'Laid out as the boards stand on the rails. ⌘Z undoes it.');
  };

  // a board picked (its title clicked, or found): its cables and the boards at their other ends stay bright
  const near = useMemo(() => {
    if (!focus) return null;
    const ids = new Set([focus]);
    for (const l of links) if (l.a.module === focus || l.b.module === focus) { ids.add(l.a.module); ids.add(l.b.module); }
    return ids;
  }, [focus, links]);
  const findIt = (q: string) => {
    setFind(q);
    const t = q.trim().toLowerCase();
    const m = t ? p.modules.find((x) => x.board.name.toLowerCase().includes(t)) : null;
    setFocus(m ? m.id : null);
    const c = m && pos.get(m.id), el = box.current;
    if (c && el) setView({ k: Math.max(v.k, 0.8), x: el.clientWidth / 2 - (c[0] + W / 2) * Math.max(v.k, 0.8), y: el.clientHeight / 3 - c[1] * Math.max(v.k, 0.8) });
  };

  // ---- where a plug or a pin is on its card ----
  const rowY = (q: PlugInfo, pin?: string) => {
    let y = HEAD;
    for (const r of rows.get(q.module.id) ?? []) {
      const h = r.pin ? PROW : ROW;
      if (r.q === q && (pin ? r.pin?.n === pin : !r.pin)) return y + h / 2 - (r.pin ? 0 : 1);
      y += h;
    }
    return y;
  };
  const portAt = (q: PlugInfo, side: 1 | -1, pin?: string) => { const c = at(q.module.id); return { x: c[0] + (side > 0 ? W : 0), y: c[1] + rowY(q, pin) }; };
  const info = (r: PlugRef) => plugs.find((q) => sameRef(q.ref, r));
  const curve = (A: PlugInfo, B: PlugInfo, pa?: string, pb?: string) => {
    const ca = at(A.module.id), cb = at(B.module.id);
    const sa: 1 | -1 = cb[0] > ca[0] + 1 ? 1 : cb[0] < ca[0] - 1 ? -1 : 1;
    const sb: 1 | -1 = ca[0] > cb[0] + 1 ? 1 : ca[0] < cb[0] - 1 ? -1 : 1;
    const a = portAt(A, sa, pa), b = portAt(B, sb, pb);
    const k = Math.max(40, Math.abs(b.x - a.x) * 0.4);
    return { d: `M${a.x},${a.y} C${a.x + sa * k},${a.y} ${b.x + sb * k},${b.y} ${b.x},${b.y}`, mid: { x: (a.x + b.x) / 2 + (sa === sb ? sa * k * 0.75 : 0), y: (a.y + b.y) / 2 } };
  };

  // ---- connecting ----
  /** Cable plug a to plug b (whatever either had goes), then offer to do the same for the other boards like it. */
  const connect = (a: PlugInfo, b: PlugInfo) => {
    // never what doesn't fit or isn't safe (a powerboard into another, an outlet onto wires), said in plain words
    const no = refusal(p, a, b);
    if (no) { toast(no); return; }
    const kind = linkKind(a.role, b.role);
    edit((pp) => {
      pp.links = (pp.links ?? []).filter((l) => !sameRef(l.a, a.ref) && !sameRef(l.b, a.ref) && !sameRef(l.a, b.ref) && !sameRef(l.b, b.ref));
      pp.links = numberLinks([...pp.links, { id: `l${Math.random().toString(36).slice(2, 8)}`, a: a.ref, b: b.ref, kind }]).map((l) => fillWires(pp, l));
    });
    setPending(null);
    // the same for the others: what Auto-connect would add of this kind now
    const more = autoLinks(store.get().project!, plugPlaces()).filter((l) => l.kind === kind).length;
    const note = connectNote(a, b);
    if (more) toast(`Connected ${shortName(a.module.board.name)} ${a.label} to ${shortName(b.module.board.name)} ${b.label}.${note ? ` ${note}` : ''}`, { label: `Connect ${more} more ${KIND_NAME[kind!]} like this`, run: () => addLinks(kind) });
    else if (note) toast(note);
  };
  /** Move one end of a cable: `keep` stays, the end that was elsewhere now goes to `to` (the cable keeps its number). */
  const replug = (l: Link, keep: PlugInfo, to: PlugInfo) => {
    const no = refusal(p, keep, to);
    if (no) { toast(no); return; }
    edit((pp) => {
      const x = (pp.links ?? []).find((q) => q.id === l.id);
      if (!x) return;
      pp.links = (pp.links ?? []).filter((q) => q.id === l.id || (!sameRef(q.a, to.ref) && !sameRef(q.b, to.ref)));
      const y = pp.links.find((q) => q.id === l.id)!;
      if (sameRef(y.a, keep.ref)) y.b = to.ref; else y.a = to.ref;
      y.kind = linkKind(keep.role, to.role);
      delete y.auto; delete y.why;
      pp.links = pp.links.map((q) => (q.id === l.id ? fillWires(pp, q) : q));
    });
    toast(`Moved the cable's end to ${shortName(to.module.board.name)} ${to.label}. ⌘Z undoes it.`);
  };
  const clickPlug = (q: PlugInfo) => {
    setPendingPin(null);
    const existing = links.find((l) => sameRef(l.a, q.ref) || sameRef(l.b, q.ref));
    if (!pending) { if (existing) select([{ kind: 'link', id: existing.id }]); setPending(q); return; }
    if (pending === q) { setPending(null); return; }
    connect(pending, q);
  };
  const clickPin = (q: PlugInfo, pin: string) => {
    setPending(null);
    const pp0 = pendingPin;
    if (!pp0) { setPendingPin({ q, pin }); return; }
    if (pp0.q === q && pp0.pin === pin) { setPendingPin(null); return; }
    if (pp0.q.module === q.module) { setPendingPin({ q, pin }); return; }
    const A = pp0.q, B = q;
    edit((pp) => {
      let l = (pp.links ?? []).find((x) => x.kind === 'jumper' && ((sameRef(x.a, A.ref) && sameRef(x.b, B.ref)) || (sameRef(x.a, B.ref) && sameRef(x.b, A.ref))));
      if (!l) {
        // a header wired to another header: whatever either was plugged into goes
        pp.links = (pp.links ?? []).filter((x) => !sameRef(x.a, A.ref) && !sameRef(x.b, A.ref) && !sameRef(x.a, B.ref) && !sameRef(x.b, B.ref));
        l = { id: `l${Math.random().toString(36).slice(2, 8)}`, a: A.ref, b: B.ref, kind: 'jumper', wires: [] };
        pp.links = numberLinks([...pp.links, l]);
        l = pp.links.find((x) => x.id === l!.id)!;
      }
      const [pa, pb] = sameRef(l.a, A.ref) ? [pp0.pin, pin] : [pin, pp0.pin];
      const net = `${pinsOf(A).find((x) => x.n === pp0.pin)?.net ?? ''} ${pinsOf(B).find((x) => x.n === pin)?.net ?? ''}`;
      const used = new Set((l.wires ?? []).map((w) => w.colour));
      const colour = /gnd|vss|ground/i.test(net) ? '#1f2124' : /vcc|vdd|3v3|5v|\+/i.test(net) ? '#d0443a' : JUMPER.find((c) => !used.has(c)) ?? JUMPER[(l.wires ?? []).length % JUMPER.length];
      // a pin takes one wire
      l.wires = [...(l.wires ?? []).filter((w) => w.a !== pa && w.b !== pb), { a: pa, b: pb, colour }];
    });
    setPendingPin(null);
  };
  const removeWire = (id: string, i: number) => {
    edit((pp) => {
      const l = (pp.links ?? []).find((x) => x.id === id);
      if (!l?.wires) return;
      l.wires = l.wires.filter((_, k) => k !== i);
      if (!l.wires.length) pp.links = (pp.links ?? []).filter((x) => x.id !== id);
    });
    setSelWire(null);
  };

  const cableOf = (id: string) => rep?.cables?.find((c) => c.id === id);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'Escape') { setPending(null); setPendingPin(null); setSelWire(null); select([]); }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selWireRef.current) { e.preventDefault(); removeWire(selWireRef.current.link, selWireRef.current.i); return; }
        const ids = store.get().sel.filter((x) => x.kind === 'link').map((x) => x.id);
        if (ids.length) { e.preventDefault(); removeLinks(ids); }
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  const selWireRef = useRef(selWire);
  selWireRef.current = selWire;

  // cables (a jumper link as its wires, pin to pin), and number pills pushed apart where cables cross close together
  const drawn = links.map((l) => {
    const A = info(l.a), B = info(l.b);
    if (!A || !B) return null;
    const ws = l.kind === 'jumper' && l.wires?.length && showsPins(A) && showsPins(B) ? l.wires : null;
    return { l, A, B, main: curve(A, B, ws?.[0]?.a, ws?.[0]?.b), ws };
  }).filter(Boolean) as { l: Link; A: PlugInfo; B: PlugInfo; main: ReturnType<typeof curve>; ws: Link['wires'] | null }[];
  const pills: { x: number; y: number }[] = [];
  const pillAt = new Map<string, { x: number; y: number }>();
  for (const { l, main } of [...drawn].sort((a, b) => a.main.mid.y - b.main.mid.y)) {
    const q = { ...main.mid };
    for (let k = 0; k < 12 && pills.some((o) => Math.abs(o.x - q.x) < 80 && Math.abs(o.y - q.y) < 24); k++) q.y += 24;
    pills.push(q); pillAt.set(l.id, q);
  }
  const where = (id: string) => {
    const mt = rep?.panel?.mounts.find((m) => m.slots.some((s) => s.module === id));
    if (id === PC) return 'off the rack';
    if (!mt) { const m = p.modules.find((x) => x.id === id); return m?.on ? 'stacked on another board' : m && isPlugPack(m.board) ? 'in an outlet, off the rails' : 'not on a rail yet'; }
    const s = mt.slots.findIndex((x) => x.module === id);
    return `rail ${mt.rail.replace(/^r/, '')}, ${mt.slots.length > 1 ? `${s ? 'back' : 'front'} of the dock` : 'on a flat clip'}`;
  };

  return (
    <div className="editor wiring" style={{ position: 'absolute', inset: 0 }}>
      <div ref={box} style={{ position: 'absolute', inset: 0, overflow: 'hidden', touchAction: 'none', cursor: gesture.current?.kind === 'pan' ? 'grabbing' : 'default' }}>
        <svg width="100%" height="100%" style={{ display: 'block' }} onPointerDown={(e) => down(e, 'pan')} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { pressed.current = null; setWireDrag(null); up(); }}>
          <g transform={`translate(${v.x},${v.y}) scale(${v.k})`}>
            {drawn.map(({ l, A, B, main, ws }) => {
              const on = isSel(sel, l.id) || hover === l.id;
              const dim = near && !(l.a.module === focus || l.b.module === focus);
              const c = cableOf(l.id), q = pillAt.get(l.id) ?? main.mid, col = wire(l.kind ?? 'usb');
              return (
                <g key={l.id} style={{ cursor: 'pointer' }} opacity={dim ? 0.12 : 1} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setSelWire(null); select([{ kind: 'link', id: l.id }], e.shiftKey ? 'toggle' : 'set'); }} onMouseEnter={() => setHover(l.id)} onMouseLeave={() => setHover(null)}>
                  {ws ? ws.map((w, i) => {
                    const cv = curve(A, B, w.a, w.b), picked = selWire?.link === l.id && selWire.i === i;
                    return (
                      <g key={i} onClick={(e) => { e.stopPropagation(); select([{ kind: 'link', id: l.id }]); setSelWire({ link: l.id, i }); }}>
                        <title>{`Jumper wire: ${A.module.board.name} pin ${w.a} → ${B.module.board.name} pin ${w.b} (Del removes it)`}</title>
                        <path d={cv.d} fill="none" stroke="transparent" strokeWidth={10} />
                        <path d={cv.d} fill="none" stroke="var(--bg)" strokeWidth={picked || on ? 5 : 3.6} strokeLinecap="round" opacity={0.7} />
                        <path d={cv.d} fill="none" stroke={w.colour ?? KIND_COLOR.jumper} strokeWidth={picked ? 3.4 : on ? 2.8 : 2} strokeLinecap="round" />
                      </g>
                    );
                  }) : <>
                    <title>{`${c ? `Cable ${c.no}: ${c.label ?? ''}` : KIND_NAME[l.kind ?? 'usb']}${l.why ? `\n${l.why}` : l.auto ? '' : '\nconnected by you'}\nclick to select · Del removes it · drag either end to another plug`}</title>
                    <path d={main.d} fill="none" stroke="transparent" strokeWidth={12} />
                    <path d={main.d} fill="none" stroke={col} strokeWidth={on || (near && !dim) ? 4 : 2.6} strokeLinecap="round" opacity={on ? 1 : 0.85} strokeDasharray={l.kind === 'debug' ? '8 3' : undefined} />
                  </>}
                  {c && q.y !== main.mid.y && <line x1={main.mid.x} y1={main.mid.y} x2={q.x} y2={q.y} stroke={col} strokeWidth={1} strokeDasharray="2 3" />}
                  {c && <g transform={`translate(${q.x},${q.y})`}><title>{`Cable ${c.no}: ${c.label ?? ''}${c.wires ? ` — ${c.wires}` : ''}`}</title><rect x={-40} y={-11} width={80} height={22} rx={11} fill="var(--surface)" stroke={col} /><circle cx={-28} cy={0} r={8.5} fill={col} /><text x={-28} y={3.8} textAnchor="middle" fontSize={10.5} fontWeight={700} className="mono" fill="#fff">{c.no}</text><text x={8} textAnchor="middle" y={4} fontSize={11} className="mono" fill="var(--fg)">{c.ribbon != null ? `${Math.round(c.length / 10)} cm` : l.kind === 'jumper' ? `${Math.round(c.buy * 100)} cm` : `${c.buy} m`}</text></g>}
                </g>
              );
            })}
            {mods.map((m) => {
              const c = at(m.id);
              const rs = rows.get(m.id) ?? [];
              const isBox = m.board.kind === 'box', h = sizes.get(m.id)!.h;
              const nCables = links.filter((l) => l.a.module === m.id || l.b.module === m.id).length;
              let y = HEAD;
              return (
                <g key={m.id} data-card={m.id} transform={`translate(${c[0]},${c[1]})`} opacity={near && !near.has(m.id) ? 0.25 : 1}>
                  <rect width={W} height={h} rx={12} fill="var(--surface-2)" stroke={focus === m.id ? 'var(--accent)' : isBox ? 'var(--line-2)' : 'var(--accent-line)'} strokeWidth={focus === m.id ? 2 : 1} style={{ filter: drag?.id === m.id ? 'drop-shadow(0 6px 14px rgb(0 0 0 / 0.35))' : undefined }} />
                  <g style={{ cursor: drag?.id === m.id ? 'grabbing' : 'grab' }} onPointerDown={(e) => down(e, 'card', m.id)}>
                    <title>{`${m.board.name}\n${isBox ? 'accessory' : 'board'}${m.board.box ? `, ${m.board.box.l} × ${m.board.box.w} × ${m.board.box.h} mm` : ''} · ${where(m.id)}\n${rs.filter((r) => !r.pin).length} plugs, ${nCables} cable${nCables === 1 ? '' : 's'}\nDrag to move · click to show only its cables`}</title>
                    <rect width={W} height={HEAD - 6} rx={12} fill={isBox ? 'var(--surface-3)' : 'var(--accent-soft)'} />
                    <text x={14} y={16} fontSize={12.5} fontWeight={650} fill="var(--fg)">{m.board.name.length > 30 ? `${m.board.name.slice(0, 29)}…` : m.board.name}</text>
                    <text x={14} y={29} fontSize={10} fill="var(--subtle)">{where(m.id)}</text>
                  </g>
                  {rs.map((r) => {
                    const q = r.q, top = y;
                    y += r.pin ? PROW : ROW;
                    if (r.pin) {
                      const pin = r.pin, pk = pendingPin && pendingPin.q === q && pendingPin.pin === pin.n;
                      const jl = jumperOf(q), wired = jl?.wires?.find((w) => (sameRef(jl.a, q.ref) ? w.a : w.b) === pin.n);
                      const can = pendingPin && pendingPin.q.module !== q.module;
                      return (
                        <g key={`${q.ref.ref}#${pin.n}`} style={{ cursor: 'pointer' }} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); clickPin(q, pin.n); }}>
                          <title>{`${q.label} pin ${pin.n}${pin.net ? ` · ${pin.net.replace(/^\//, '')}` : ''}${wired ? ' · wired' : ' · click, then a pin on another header, to add a jumper wire'}`}</title>
                          <rect x={22} y={top + 1} width={W - 44} height={PROW - 2} rx={5} fill={pk ? 'var(--accent-soft)' : can ? 'color-mix(in srgb, var(--good) 12%, transparent)' : 'transparent'} stroke={pk ? 'var(--accent)' : 'transparent'} />
                          <text x={30} y={top + 13} fontSize={10.5} className="mono" fill="var(--muted)">{pin.n}</text>
                          <text x={52} y={top + 13} fontSize={10.5} className="mono" fill="var(--fg)">{pin.net ? pin.net.replace(/^\//, '').slice(0, 18) : '—'}</text>
                          {[0, W].map((x) => <circle key={x} cx={x} cy={top + PROW / 2} r={wired ? 3.6 : 2.6} fill={wired ? wired.colour ?? KIND_COLOR.jumper : 'var(--surface)'} stroke={wired ? 'var(--bg)' : 'var(--line-2)'} strokeWidth={1.2} />)}
                        </g>
                      );
                    }
                    const l = links.find((x) => sameRef(x.a, q.ref) || sameRef(x.b, q.ref));
                    const isP = pending === q || wireDrag?.from === q;
                    const src = wireDrag?.from ?? pending;
                    const ok = src && src !== q && src.module.id !== q.module.id && canCable(p, src, q);
                    const pins = pinsOf(q), shown = showsPins(q), cab = l && cableOf(l.id);
                    return (
                      <g key={q.ref.ref} data-plug={keyOf(q)} style={{ cursor: wireDrag ? 'copy' : 'pointer' }} onPointerDown={(e) => { e.stopPropagation(); if (e.button === 0) pressed.current = { q, sx: e.clientX, sy: e.clientY, dragged: false }; }}
                        onClick={(e) => { e.stopPropagation(); if (dragClick.current) { dragClick.current = false; return; } clickPlug(q); }}>
                        <title>{`${q.label} · ${ROLE_TEXT[q.role] || q.role}${cab ? ` · cable ${cab.no}, ${cab.label ?? ''}` : ' · free'}${pins.length >= 2 ? `\n${pins.length} pins: ▸ opens them, to wire pin by pin` : ''}`}</title>
                        <rect x={6} y={top} width={W - 12} height={ROW - 3} rx={6} fill={isP ? 'var(--accent-soft)' : ok ? 'color-mix(in srgb, var(--good) 14%, transparent)' : 'transparent'} stroke={isP ? 'var(--accent)' : 'transparent'} />
                        {pins.length >= 2 && <g onClick={(e) => { e.stopPropagation(); setOpen((o) => { const n = new Set(o); if (n.has(keyOf(q))) n.delete(keyOf(q)); else n.add(keyOf(q)); return n; }); }}>
                          <rect x={8} y={top + 2} width={14} height={ROW - 7} fill="transparent" />
                          <text x={11} y={top + 15} fontSize={10} fill="var(--muted)">{shown ? '▾' : '▸'}</text>
                        </g>}
                        <text x={pins.length >= 2 ? 24 : 16} y={top + 15} fontSize={11.5} fill="var(--fg)" className="mono">{q.label}</text>
                        <text x={W - 16} y={top + 15} fontSize={10.5} textAnchor="end" fill={l ? wire(l.kind ?? 'usb') : 'var(--subtle)'}>{l ? '● ' : ''}{ROLE_TEXT[q.role]}</text>
                        {!shown && [0, W].map((x) => <circle key={x} cx={x} cy={top + ROW / 2 - 1} r={l || isP ? 4.5 : 3.5} fill={l ? wire(l.kind ?? 'usb') : 'var(--surface)'} stroke={l ? 'none' : 'var(--line-2)'} strokeWidth={1.5} />)}
                      </g>
                    );
                  })}
                  {!rs.length && <text x={14} y={HEAD + 15} fontSize={11.5} fill="var(--subtle)">no plugs</text>}
                </g>
              );
            })}
            {/* the cable being drawn from a plug */}
            {wireDrag && (() => {
              const a = portAt(wireDrag.from, wireDrag.x >= at(wireDrag.from.module.id)[0] + W / 2 ? 1 : -1), sg = wireDrag.x >= a.x ? 1 : -1, k = Math.max(30, Math.abs(wireDrag.x - a.x) * 0.4);
              return <path d={`M${a.x},${a.y} C${a.x + sg * k},${a.y} ${wireDrag.x - sg * k},${wireDrag.y} ${wireDrag.x},${wireDrag.y}`} fill="none" stroke="var(--accent)" strokeWidth={3} strokeDasharray="7 5" strokeLinecap="round" style={{ pointerEvents: 'none' }} />;
            })()}
          </g>
        </svg>
      </div>
      {/* a plug picked: its best matches, one click to connect */}
      {pending && !wireDrag && (() => {
        const el = box.current, a = portAt(pending, 1), sx = a.x * v.k + v.x + 12, sy = a.y * v.k + v.y - 10;
        const best = rankTargets(p, pending.ref, plugPlaces(), 5), cur = links.find((l) => sameRef(l.a, pending.ref) || sameRef(l.b, pending.ref));
        const left = el && sx + 300 > el.clientWidth ? Math.max(8, a.x * v.k + v.x - W * v.k - 312) : sx;
        return (
          <div className="wpop floating" style={{ left, top: Math.max(56, Math.min(sy, (el?.clientHeight ?? 600) - 260)) }} onPointerDown={(e) => e.stopPropagation()}>
            <div className="wpop-head"><b>{shortName(pending.module.board.name)} · {pending.label}</b><span>{ROLE_TEXT[pending.role] || pending.role}</span></div>
            {best.length ? <>
              <small>Best matches</small>
              {best.map((t) => (
                <button key={keyOf(t.plug)} onClick={() => connect(pending, t.plug)} title={`Connect to ${t.plug.module.board.name} ${t.plug.label}`}>
                  <i style={{ background: wire(linkKind(pending.role, t.plug.role) ?? 'usb') }} />
                  <span><b>{shortName(t.plug.module.board.name)}</b> {t.plug.label}</span>
                  <em>{t.note}</em>
                </button>
              ))}
            </> : <p className="hint">Nothing free fits it{cur ? '' : ': free a plug, or add a hub or a charger'}.</p>}
            <div className="wpop-foot">
              {cur && <button className="btn small ghost" onClick={() => { removeLinks([cur.id]); setPending(null); }}>Disconnect</button>}
              <span>or click the plug it goes to · Esc</span>
            </div>
          </div>
        );
      })()}
      {side && <WiringSide tab={side} setTab={setSide} onPick={(q) => { setPending(q); const c = pos.get(q.module.id), el2 = box.current; if (c && el2) setView({ k: Math.max(v.k, 0.8), x: el2.clientWidth / 2 - (c[0] + W / 2) * Math.max(v.k, 0.8), y: el2.clientHeight / 3 - c[1] * Math.max(v.k, 0.8) }); }} />}
      <div className="toolbar floating">
        <button className="tbtn" onClick={() => addLinks()} title="Connect every free plug that has a partner: the shortest cables on the rack as it stands, power within what each port and charger gives, and why each was chosen"><Icon d={I.wand} /> Auto-connect</button>
        {links.some((l) => l.auto) && <button className="tbtn" onClick={rewire} title="Choose Auto-connect's cables again for the rack as it is laid out now (the ones you connected yourself stay)">Rewire</button>}
        <span className="tsep" />
        <select className="tbtn tsel2" value="" title="Lay every card out again" onChange={(e) => { const v2 = e.target.value; if (v2) arrange(v2 as 'flow' | 'rack'); }}>
          <option value="">Arrange…</option>
          <option value="flow">As the cables flow</option>
          <option value="rack">As on the rack</option>
        </select>
        <span className="tsep" />
        <button className="tbtn" disabled={!links.length} onClick={() => { edit((pp) => { pp.links = []; }); select([]); }}>Clear all</button>
        <span className="tsep" />
        {p.modules.length > 4 && <input className="wfind" type="search" placeholder="Find a board" value={find} onChange={(e) => findIt(e.target.value)} aria-label="Find a board" />}
        <button className="tbtn" onClick={() => zoomAt(1 / 1.25)} title="Zoom out (pinch, or ⌘ + scroll)" aria-label="Zoom out">−</button>
        <button className="tbtn mono" onClick={() => setView(fit())} title="Fit everything in the window">{Math.round(v.k * 100)}%</button>
        <button className="tbtn" onClick={() => zoomAt(1.25)} title="Zoom in (pinch, or ⌘ + scroll)" aria-label="Zoom in">+</button>
        {focus && <button className="tbtn" onClick={() => { setFocus(null); setFind(''); }}>Show all</button>}
        <span className="tsep" />
        <button className={`tbtn ${side ? 'on' : ''}`} onClick={() => setSide((x) => (x ? null : 'todo'))} title="What still needs connecting, and every cable">List</button>
      </div>
      <div className="hud floating mono">
        <span>{pendingPin ? `${pendingPin.q.module.board.name} pin ${pendingPin.pin}: now click the pin on another header it goes to · Esc cancels` : pending ? `${pending.module.board.name} ${pending.label}: now click the plug it goes to (green ones fit) · Esc cancels` : 'drag from a plug to where it goes (or click it for its best matches) · drag a connected plug to move that end · ▸ opens a header for jumper wires · drag a card by its title · pinch or ⌘ + scroll zooms'}</span>
        <span className="xy">{links.length} cable{links.length === 1 ? '' : 's'}{rep?.cables?.length ? ` · ${(rep.cables.reduce((a, c) => a + c.length, 0) / 1000).toFixed(1)} m` : ''}</span>
      </div>
      <div className="legend2 floating" style={{ bottom: 52 }}>
        {(Object.keys(KIND_COLOR) as (keyof typeof KIND_COLOR)[]).filter((k) => k !== 'uart' || links.some((l) => l.kind === 'uart')).map((k) => <span key={k}><i style={{ background: wire(k) }} />{KIND_NAME[k]}</span>)}
      </div>
    </div>
  );
}

/** The side panel: what still needs connecting (and what the rack is short of), and every cable. */
function WiringSide({ tab, setTab, onPick }: { tab: 'todo' | 'cables'; setTab: (t: 'todo' | 'cables' | null) => void; onPick: (q: PlugInfo) => void }) {
  const p = useApp((s) => s.project)!;
  const rep = useApp((s) => s.result?.report ?? null);
  const sel = useApp((s) => s.sel);
  const links = p.links ?? [];
  const plugs = useMemo(() => allPlugs(p), [p]);
  const advice = useMemo(() => wiringAdvice(p), [p]);
  const linked = new Set(links.flatMap((l) => [`${l.a.module}/${l.a.ref}`, `${l.b.module}/${l.b.ref}`]));
  // plugs that want something: a board's power, a device's host, a hub's uplink, a header's probe or serial cable
  const WANT: Record<string, string> = { 'power-in': 'needs power', 'power-in-dc': 'needs a DC supply', device: 'needs a USB port', 'hub-up': 'needs a host', debug: 'no probe on it', uart: 'no serial on it', 'mains-in': 'needs an outlet' };
  // (a powerboard's own lead goes to the wall, not to anything in the rack)
  const todo = plugs.filter((q) => WANT[q.role] && q.module.id !== PC && !linked.has(keyOf(q)) && !((q.role === 'debug' || q.role === 'uart') && q.module.board.kind === 'box') && !(q.role === 'mains-in' && q.module.board.comps.some((c) => c.conn?.type.startsWith('ac_'))));
  const best = (q: PlugInfo) => rankTargets(p, q.ref, plugPlaces(), 1)[0];
  const nos = numberLinks(links);
  const nameOf = (id: string) => (id === PC ? 'Your computer' : shortName(p.modules.find((m) => m.id === id)?.board.name ?? '?'));
  return (
    <div className="wside floating" onPointerDown={(e) => e.stopPropagation()}>
      <div className="wside-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'todo'} className={tab === 'todo' ? 'on' : ''} onClick={() => setTab('todo')}>To do {todo.length + advice.filter((a) => a.add).length > 0 && <small>{todo.length + advice.filter((a) => a.add).length}</small>}</button>
        <button role="tab" aria-selected={tab === 'cables'} className={tab === 'cables' ? 'on' : ''} onClick={() => setTab('cables')}>Cables <small>{links.length}</small></button>
        <button className="btn small ghost icon" onClick={() => setTab(null)} aria-label="Close the list">×</button>
      </div>
      {tab === 'todo' ? (
        <div className="wside-body">
          {advice.map((a, i) => (
            <div key={i} className="wadv">
              <span>{a.text}</span>
              {a.add && <button className="btn small soft" onClick={() => addAccessory(a.add!, a.count ?? 1)}>Add {a.count && a.count > 1 ? `${a.count} × ` : 'a '}{(TEMPLATES.find((t) => t.id === a.add)?.name ?? a.add).replace(/ \(.*$/, '')}</button>}
            </div>
          ))}
          {todo.length ? <>
            {todo.length > 1 && <button className="btn small primary" style={{ width: '100%', marginBottom: 6 }} onClick={() => addLinks()}><Icon d={I.wand} /> Connect all {todo.length} the best way</button>}
            {todo.map((q) => {
              const b = best(q);
              return (
                <div key={keyOf(q)} className="wtodo">
                  <button className="wtodo-main" onClick={() => onPick(q)} title="Show its best matches">
                    <b>{shortName(q.module.board.name)}</b> <span className="mono">{q.label}</span>
                    <em>{WANT[q.role]}{b ? ` · best: ${shortName(b.plug.module.board.name)} ${b.plug.label}` : ' · nothing free fits'}</em>
                  </button>
                  {b && <button className="btn small ghost" onClick={() => {
                    edit((pp) => { pp.links = numberLinks([...(pp.links ?? []), { id: `l${Math.random().toString(36).slice(2, 8)}`, a: q.ref, b: b.plug.ref, kind: linkKind(q.role, b.plug.role) }]).map((l) => fillWires(pp, l)); });
                  }}>Connect</button>}
                </div>
              );
            })}
          </> : !advice.length && <p className="hint">Everything that needs a cable has one.</p>}
        </div>
      ) : (
        <div className="wside-body">
          {!links.length && <p className="hint">No cables yet: Auto-connect, or drag from one plug to another.</p>}
          {nos.map((l) => {
            const c = rep?.cables?.find((x) => x.id === l.id), f = cableFlow(p, l), on = isSel(sel, l.id);
            return (
              <div key={l.id} className={`wcab ${on ? 'on' : ''}`}>
                <button className="wcab-main" onClick={() => select([{ kind: 'link', id: l.id }])} title={l.why ?? (l.auto ? '' : 'connected by you')}>
                  <i style={{ background: wire(l.kind ?? 'usb') }}>{l.no}</i>
                  <span><b>{nameOf(f.from.module)}</b> {f.from.ref} → <b>{nameOf(f.to.module)}</b> {f.to.ref}</span>
                  <em>{KIND_NAME[l.kind ?? 'usb']}{c ? ` · ${c.ribbon != null ? `${Math.round(c.length / 10)} cm` : l.kind === 'jumper' ? `${Math.round(c.buy * 100)} cm` : `${c.buy} m`}` : ''}{l.auto ? '' : ' · yours'}</em>
                </button>
                <button className="btn small ghost icon" onClick={() => removeLinks([l.id])} aria-label="Remove this cable">×</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
