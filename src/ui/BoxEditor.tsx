// Boxes (hubs, chargers, powerboards, probes, adapters) made to match yours: the Box tab (size, corners, colour, and a
// card for every row of ports: how many, what, which face, where along it, how high, which way up), a live sketch of
// the box from above and of each face as you look at it, and "Build your own box" for the Start page.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Board, BoxFace, BoxPortGroup, BoxSpec } from '../model/types';
import { applyBox, BOX_KINDS, BOX_PORT_TYPES, BOX_PRESETS, BOX_ROLES, boxProblems, canTurn, faceLen, FACE_NAME, inferBox, isBare, layoutPorts, newBox, portHeight, portUp, portWidth, tightFaces, topAcross, turnOf, type PortAt } from '../model/boxes';
import { connById } from '../model/library';
import { plugName, plugRole } from '../model/links';
import { isProbe } from '../model/probes';
import { poweredHub, supplyOf, watts } from '../model/powerdata';
import { MAINS_RATING } from '../model/power';
import { activeModule, editMod, store, toast, uniqueName, useApp } from '../state';
import { Check, Num, Pick, Section, Seg, Text } from './controls';
import { Icon, I } from './icons';
import { uid } from '../geom/poly';

/** What each role is drawn in, in the sketch (theme colours). */
const TONE: Record<string, string> = { 'hub-down': 'var(--muted)', host: 'var(--muted)', 'hub-up': 'var(--accent)', device: 'var(--accent)', 'power-out': 'var(--bad)', 'power-in': 'var(--warn)', net: 'var(--info)', debug: 'var(--subtle)', uart: 'var(--good)', 'mains-out': 'var(--copper)', 'mains-in': 'var(--copper)', other: 'var(--warn)' };
const tone = (role: string) => TONE[role] ?? 'var(--muted)';
const ROLE_SHORT: Record<string, string> = { 'hub-down': 'hub port', 'hub-up': 'upstream', 'power-out': 'power out', 'power-in': 'power in', host: 'host', device: 'device', net: 'network', debug: 'debug', uart: 'serial pins', 'mains-out': 'outlet', 'mains-in': 'mains in', other: 'off the rack' };

/** Housing colours most boxes come in, and your own. */
const COLOURS: [string, string][] = [['#1c1f24', 'black'], ['#2b2f36', 'graphite'], ['#8d939b', 'grey'], ['#e9e7e2', 'white'], ['#c8201e', 'red'], ['#2a56b8', 'blue']];

const SIDES: BoxFace[] = ['front', 'back', 'left', 'right'];
const isEnd = (f: BoxFace) => f === 'left' || f === 'right';
/** The two ends of a face, as you would say them. */
const ends = (f: BoxFace): [string, string] => (isEnd(f) ? ['the front', 'the back'] : ['the left end', 'the right end']);
const r1 = (v: number) => Math.round(v * 10) / 10;

/** A socket's asymmetric feature, to say which way up it is. */
const FEATURE: Record<string, string> = { usb_a: 'tongue', rj45: 'latch', usb_micro_b: 'wide side', usb_mini_b: 'wide side', hdmi_a: 'wide side', usb_b: 'cut corners' };
function turnOptions(type: string): [number, string][] {
  const f = FEATURE[type];
  if (type === 'usb_c') return [[0, 'Flat'], [90, 'On its side (upright)']];
  return f
    ? [[0, `Flat, ${f} at the top`], [180, `Upside down, ${f} at the bottom`], [90, `On its side, ${f} to the right`], [270, `On its side, ${f} to the left`]]
    : [[0, 'Flat'], [180, 'Upside down'], [90, 'On its side, turned right'], [270, 'On its side, turned left']];
}

/** Any colour, from the system's picker: taken when the picker closes, so trying colours isn't a string of undo steps (keyed by the colour, so it shows the new one). */
function OwnColour({ value, onPick }: { value: string; onPick: (c: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => {
    const el = ref.current;
    const done = () => { if (el) pick.current(el.value); };
    el?.addEventListener('change', done);
    return () => el?.removeEventListener('change', done);
  }, []);
  return <label className="swatch own" title="Your own colour"><input ref={ref} type="color" defaultValue={value} aria-label="Your own colour" /></label>;
}

/** Size and ports of a box (hub, charger): presets, a card per row of ports, a live sketch. */
export function BoxEditor() {
  const p = useApp((s) => s.project)!;
  const m = activeModule(p), b = m.board;
  const spec = b.box;
  const [focus, setFocus] = useState<string | null>(null);
  const [more, setMore] = useState<Record<string, boolean>>({});
  const set = (fn: (s: BoxSpec) => void) => editMod((q, pp) => {
    const s = structuredClone(q.board.box ?? inferBox(q.board, (c) => plugRole(q, c)));
    fn(s);
    applyBox(q.board, s);
    // cables to ports that no longer exist go
    const refs = new Set(q.board.comps.map((c) => c.ref));
    pp.links = (pp.links ?? []).filter((l) => !((l.a.module === q.id && !refs.has(l.a.ref)) || (l.b.module === q.id && !refs.has(l.b.ref))));
  });
  const lay = useMemo(() => (spec ? layoutPorts(spec) : []), [spec]);
  if (!spec) return (
    <Section title="Box">
      <p className="hint" style={{ marginTop: 0 }}>This box's ports were placed one by one. Turn it into an editable box to set how many ports it has and where they are.</p>
      <button className="btn small soft" onClick={() => set(() => {})}>Edit as a box</button>
    </Section>
  );
  const probs = boxProblems(spec);
  const bare = isBare(spec);
  const count = (r: string) => spec.groups.filter((x) => x.role === r).reduce((a, x) => a + x.count, 0);
  const sum = [['hub-down', 'hub port'], ['hub-up', 'upstream'], ['power-out', 'power out'], ['power-in', 'power in'], ['host', 'host port'], ['device', 'USB device port'], ['debug', 'debug port'], ['uart', 'serial header'], ['mains-out', 'outlet']].map(([r, n]) => [count(r), n] as [number, string]).filter(([k]) => k).map(([k, n]) => `${k} ${n}${k > 1 ? 's' : ''}`).join(', ');
  const cornerNow = spec.corner ?? Math.min(4, spec.w / 6), shape = cornerNow <= 0 ? 'square' : spec.chamfer ? 'cut' : 'round';
  return (
    <Section title="Box" right={<span className="chip">{sum || 'no ports'}</span>}>
      <details className="boxpresets">
        <summary>Start again from a preset (it takes the preset's name too)</summary>
        <div className="btns" style={{ flexWrap: 'wrap', marginTop: 6 }}>
          {Object.entries(BOX_PRESETS).map(([k, P]) => <button key={k} className="btn small" onClick={() => {
            const was = b.name;
            // the box becomes that preset: its ports and size, and its name and colour with them (so the board chips say what it is)
            editMod((q, pp) => {
              const s = structuredClone(P.spec());
              applyBox(q.board, s);
              q.board.name = uniqueName(pp.modules.filter((x) => x.id !== q.id).map((x) => x.board.name), P.name);
              q.board.color = P.color;
              const refs = new Set(q.board.comps.map((c) => c.ref));
              pp.links = (pp.links ?? []).filter((l) => !((l.a.module === q.id && !refs.has(l.a.ref)) || (l.b.module === q.id && !refs.has(l.b.ref))));
            });
            toast(`${was} is now a ${P.name.toLowerCase()}: its ports, size, name and colour. ⌘Z undoes it.`);
          }}>{P.name}</button>)}
        </div>
      </details>
      <div className="row3" style={{ marginTop: 10 }}>
        <Num label="Length" value={spec.l} min={10} max={800} step={1} onChange={(v) => set((s) => { s.l = v; })} hint="Along its front: the long side." />
        <Num label="Width" value={spec.w} min={8} max={300} step={1} onChange={(v) => set((s) => { s.w = v; })} hint="Front to back." />
        <Num label="Height" value={spec.h} min={1} max={150} step={0.1} onChange={(v) => set((s) => { s.h = v; })} hint="Under 5 mm it is a bare board (a probe, an adapter): its ports stand on its top face." />
      </div>
      <div className="boxshape">
        <div className="field"><span>Corners, from above</span>
          <Seg value={shape} options={[['square', 'Square'], ['round', 'Rounded'], ['cut', 'Cut off']]} onChange={(v) => set((s) => {
            if (v === 'square') { s.corner = 0; delete s.chamfer; } else { s.corner = cornerNow > 0 ? cornerNow : 4; if (v === 'cut') s.chamfer = true; else delete s.chamfer; }
          })} />
        </div>
        {shape !== 'square' && <Num label={shape === 'cut' ? 'Cut' : 'Radius'} value={r1(Math.min(cornerNow, Math.min(spec.l, spec.w) / 2))} min={0.5} max={Math.min(spec.l, spec.w) / 2} step={0.5} onChange={(v) => set((s) => { s.corner = v; })} hint="Half the width makes the ends fully round." />}
      </div>
      <div className="field" style={{ marginTop: 8 }}><span>Colour</span>
        <div className="swatches">
          {COLOURS.map(([c, n]) => <button key={c} className={`swatch ${b.color === c ? 'on' : ''}`} style={{ background: c }} title={n} aria-label={`Colour: ${n}`} onClick={() => editMod((q) => { q.board.color = c; })} />)}
          <OwnColour key={b.color} value={b.color ?? '#2b2f36'} onPick={(c) => editMod((q) => { q.board.color = c; })} />
        </div>
      </div>
      {(count('power-out') > 0 || (count('hub-down') > 0 && poweredHub(b))) && (() => {
        const guess = supplyOf({ ...b, box: { ...spec, supply: undefined } }, b.comps.filter((c) => c.conn).map((c) => ({ c, role: plugRole(m, c) })).filter((x) => x.role === 'power-out' || x.role === 'hub-down')).total;
        return (
          <div className="row" style={{ marginTop: 8, alignItems: 'end' }}>
            <Num label={`Total output${spec.supply ? '' : ' (typical)'}`} unit="A at 5 V" value={spec.supply ?? guess} min={0.5} max={40} step={0.5} onChange={(v) => set((s) => { s.supply = v; })} hint="What the whole box gives at 5 V: its label's watts divided by 5." />
            <small className="hint" style={{ margin: 0 }}>{watts(spec.supply ?? guess)} W. {spec.supply ? '' : 'Check its label: the watts divided by 5.'}</small>
          </div>
        );
      })()}
      {spec.groups.some((g) => g.type.startsWith('ac_')) && <div className="row" style={{ marginTop: 8, alignItems: 'end' }}><Num label={`Rating${spec.rating ? '' : ' (typical)'}`} unit="A" value={spec.rating ?? MAINS_RATING[spec.groups.find((g) => g.type.startsWith('ac_'))!.type] ?? 10} min={1} max={20} step={0.5} onChange={(v) => set((s) => { s.rating = v; })} hint="What the powerboard may carry in all: it is on its label or plug." /><small className="hint" style={{ margin: 0 }}>{spec.rating ? '' : 'A typical figure for its outlets: check the label on yours.'}</small></div>}
      {spec.pack && <div className="row" style={{ marginTop: 8 }}><Num label="Its own lead" unit="mm" value={spec.pack.lead} min={100} max={5000} step={50} onChange={(v) => set((s) => { s.pack = { ...(s.pack ?? { lead: 1500 }), lead: v }; })} hint="A plug pack sits in an outlet: its lead has to reach the board it powers." /></div>}
      {spec.groups.some((g) => g.role === 'debug') && <div className="row" style={{ marginTop: 8 }}><Num label="Ribbon length" value={spec.ribbon ?? 200} min={50} max={2000} step={10} onChange={(v) => set((s) => { s.ribbon = v; })} hint="The ribbon it came with: the rack checks that it reaches the board." /></div>}
      <BoxSketch spec={spec} focus={focus} onPick={setFocus} />
      <div className="boxgroups">
        {spec.groups.map((g, i) => (
          <GroupCard key={g.id} spec={spec} g={g} i={i} lay={lay} focus={focus === g.id} setFocus={setFocus} open={!!more[g.id]} setOpen={(v) => setMore((x) => ({ ...x, [g.id]: v }))} set={set} />
        ))}
      </div>
      <button className="btn small" style={{ marginTop: 8 }} onClick={() => set((s) => { const hub = s.groups.some((x) => x.role === 'hub-down'); s.groups.push({ id: uid('pg'), type: 'usb_a', count: 1, face: 'front', role: hub ? 'hub-down' : s.groups.some((x) => x.role === 'power-out') ? 'power-out' : 'hub-down' }); })}><Icon d={I.plus} /> Add a row of ports</button>
      {probs.length > 0 && (
        <div className="warns" style={{ marginTop: 8 }}>
          {probs.map((x) => <div key={x}>{x}</div>)}
          {tightFaces(spec).slice(0, 1).map((t) => <button key={t.face} className="btn small soft" style={{ marginTop: 6 }} onClick={() => set((s) => { s[t.dim] = Math.max(s[t.dim], ...tightFaces(s).filter((x) => x.dim === t.dim).map((x) => x.need)); })}>Make the box {Math.max(...tightFaces(spec).filter((x) => x.dim === t.dim).map((x) => x.need))} mm {t.dim === 'l' ? 'long' : 'wide'}</button>)}
        </div>
      )}
      <p className="hint">{isProbe(m) ? 'It slides down into a slot in the back of its board\'s dock and stays there; the next probe or adapter for that board gets the next slot, on corner towers. Height is its thickness.' : spec.groups.some((x) => x.type.startsWith('ac_')) ? 'A powerboard lies on its base in its holder, strapped down between the outlets. Outlets spread evenly along the top; turn them 45° if your chargers are plug packs. Its own lead goes to the wall: never into another powerboard.' : 'Front and back are the long sides; the box lies on its base in its holder, strapped down. Ports on top are fine: the strap loops move to miss them.'} {bare ? '' : 'To copy your own: measure each port with calipers from the end of the box, or drag it in the editor to where it is on a photo. '}Cables to ports you remove are removed too.</p>
    </Section>
  );
}

/** One row of ports: what they are, and (under More) exactly where they are and which way up. */
function GroupCard({ spec, g, i, lay, focus, setFocus, open, setOpen, set }: { spec: BoxSpec; g: BoxPortGroup; i: number; lay: PortAt[]; focus: boolean; setFocus: (id: string | null) => void; open: boolean; setOpen: (v: boolean) => void; set: (fn: (s: BoxSpec) => void) => void }) {
  const mine = lay.filter((q) => q.group.id === g.id).sort((a, b) => a.i - b.i);
  const L = faceLen(spec, g.face), w = portWidth(g.type, g, spec);
  const side = g.face !== 'top', bare = isBare(spec);
  const mode = g.at?.length ? 'each' : g.from ?? 'auto';
  const step = mine.length > 1 ? mine[1].along - mine[0].along : w + 5;
  const [e0, e1] = ends(g.face);
  const G = (fn: (x: BoxPortGroup) => void) => set((s) => fn(s.groups[i]));
  // switching how a row is placed never moves it: the new way starts from where it is now
  const place = (v: string) => G((x) => {
    const first = mine[0]?.along ?? L / 2, last = mine[mine.length - 1]?.along ?? L / 2;
    delete x.at; delete x.off;
    if (v === 'auto') { delete x.from; delete x.edge; return; }
    if (v === 'each') { x.at = mine.map((q) => r1(q.along)); if (x.face === 'top') x.off = mine.map((q) => r1(topAcross(spec, g, q.i))); return; }
    x.from = v as 'start' | 'end';
    x.edge = r1(v === 'start' ? first - w / 2 : L - last - w / 2);
    if (x.count > 1 && x.pitch == null) x.pitch = r1(step);
  });
  const summary = [
    mode === 'auto' ? 'centred' : mode === 'each' ? 'each where you put it' : `${r1(g.edge ?? 0)} mm from ${mode === 'start' ? e0 : e1}`,
    side && !bare ? `${r1(portUp(spec, g))} mm up` : g.face === 'top' ? (g.across != null ? `${r1(g.across)} mm from the front` : g.near ? `by the ${g.near}` : 'across the middle') : '',
    turnOf(spec, g) ? turnOptions(g.type).find(([k]) => k === turnOf(spec, g))?.[1].toLowerCase() ?? '' : '',
    g.face === 'top' && g.rot ? `turned ${g.rot}°` : '',
  ].filter(Boolean).join(' · ');
  return (
    <div className={`boxgroup ${focus ? 'focus' : ''}`} onMouseEnter={() => setFocus(g.id)} onMouseLeave={() => setFocus(null)} onFocus={() => setFocus(g.id)}>
      <div className="bg-head">
        <i className="bg-dot" style={{ background: tone(g.role) }} aria-hidden />
        <b>{g.refs?.length ? (g.refs.length > 2 ? `${g.refs[0]}–${g.refs[g.refs.length - 1]}` : g.refs.join(', ')) : 'New row'}</b>
        <small>{summary}</small>
        <button className="btn small ghost icon" title="Remove these ports" aria-label="Remove these ports" onClick={() => set((s) => { s.groups.splice(i, 1); })}><Icon d={I.x} /></button>
      </div>
      <div className="row" style={{ gridTemplateColumns: '58px 1.25fr 1fr', alignItems: 'end' }}>
        <Num label="Ports" value={g.count} min={0} max={24} step={1} unit="" onChange={(v) => G((x) => { x.count = Math.max(0, Math.round(v)); })} />
        <Pick label="Type" value={g.type} options={BOX_PORT_TYPES.map((t) => [t, plugName(t)] as [string, string])} onChange={(v) => G((x) => { x.type = v; })} />
        <Pick label="On" value={g.face} options={(Object.keys(FACE_NAME) as BoxFace[]).map((f) => [f, FACE_NAME[f].replace(' end', '')] as [BoxFace, string])} onChange={(v) => G((x) => { x.face = v; delete x.at; delete x.off; })} />
      </div>
      <Pick label="What they are for" value={g.role} options={BOX_ROLES as [string, string][]} onChange={(v) => G((x) => { x.role = v; })} />
      {side && canTurn(spec, g) && (
        <Pick label="Which way up" value={turnOf(spec, g)} options={turnOptions(g.type)} onChange={(v) => G((x) => { if (v) x.turn = v as 90 | 180 | 270; else delete x.turn; })} />
      )}
      {g.type === 'pins_ra' && <div className="row" style={{ marginTop: 2 }}><Text label="Pin names, pin 1 first" value={(g.pins ?? []).join(', ')} onChange={(v) => G((x) => { x.pins = v.split(/[,\s]+/).filter(Boolean).slice(0, 40); })} placeholder="GND, CTS, VCC, TXD, RXD, DTR" /></div>}
      {(g.role === 'power-out' || g.role === 'dc-out') && (
              <div className="row" style={{ marginTop: 6, alignItems: 'end' }}>
                <Num label={`Each port gives${g.amps ? '' : ' (typical)'}`} unit="A" value={g.amps ?? (g.type === 'usb_c' ? 3 : g.type.startsWith('usb_a') ? 2.4 : 2)} min={0.5} max={10} step={0.1} onChange={(v) => G((x) => { x.amps = v; })} hint={g.type === 'usb_c' ? 'A 27 W USB-C PD port gives 5 A (what a Pi 5 wants); most give 3 A.' : 'From its label.'} />
                {g.role === 'dc-out' && <Num label="At" unit="V" value={g.volts ?? 12} min={3} max={48} step={0.5} onChange={(v) => G((x) => { x.volts = v; })} hint="Its label's output voltage. BoardDock can't check polarity." />}
              </div>
      )}
      {g.role === 'power-in-dc' && <div className="row" style={{ marginTop: 6 }}><Num label="Takes" unit="V" value={g.volts ?? 12} min={3} max={48} step={0.5} onChange={(v) => G((x) => { x.volts = v; })} hint="What its supply's label says it puts out: its own supply is made to match. BoardDock can't check polarity." /></div>}
      {g.face === 'top' && g.type.startsWith('ac_') && <Check label="A switch by each" value={!!g.switched} onChange={(v) => G((x) => { x.switched = v || undefined; })} />}
      <button className="bg-more" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} Where they are{side && !bare ? ', how high' : ''}{g.face === 'top' ? ', turned' : ''}</button>
      {open && (
        <div className="bg-where">
          <div className="row" style={{ alignItems: 'end' }}>
            <Pick label="Along the face" value={mode} options={[['auto', 'Centred with the others'], ['start', `From ${e0}`], ['end', `From ${e1}`], ['each', 'Each port where I put it']]} onChange={place} />
            {(mode === 'start' || mode === 'end') && <Num label={`From ${mode === 'start' ? e0 : e1}`} value={g.edge ?? 0} min={0} max={L} step={0.5} onChange={(v) => G((x) => { x.edge = v; })} hint={`From ${mode === 'start' ? e0 : e1} of the box to the near side of the nearest port: measure it with calipers.`} />}
            {mode === 'auto' && g.count > 1 && <Num label="Spacing" value={r1(g.pitch ?? step)} min={w} max={L} step={0.5} onChange={(v) => G((x) => { x.pitch = v; })} hint="From one port's centre to the next (or from one's left side to the next one's left side)." />}
          </div>
          {(mode === 'start' || mode === 'end') && g.count > 1 && <div className="row" style={{ marginTop: 6 }}><Num label="Spacing" value={r1(g.pitch ?? step)} min={w} max={L} step={0.5} onChange={(v) => G((x) => { x.pitch = v; })} hint="From one port's centre to the next (or from one's left side to the next one's left side)." /></div>}
          {mode === 'each' && (
            <div className="bg-each">
              {mine.map((q) => <Num key={q.i} label={g.refs?.[q.i] ?? `Port ${q.i + 1}`} value={r1(q.along)} min={0} max={L} step={0.5} onChange={(v) => G((x) => { x.at = mine.map((z) => r1(z.along)); x.at[q.i] = v; })} hint={`Its centre, mm from ${e0}.`} />)}
              <small className="hint" style={{ gridColumn: '1 / -1', margin: 0 }}>Centres, mm from {e0}. Drag a port in the editor to put it where it is, or type what your calipers read.</small>
            </div>
          )}
          {side && !bare && (
            <div className="row" style={{ marginTop: 6, alignItems: 'end' }}>
              <Num label="Height up the side" value={r1(portUp(spec, g))} min={0} max={spec.h} step={0.5} onChange={(v) => G((x) => { x.up = v; })} hint="From the bottom of the box to the middle of the port." />
              {g.up != null ? <button className="btn small ghost" onClick={() => G((x) => { delete x.up; })}>Halfway up</button> : <small className="hint" style={{ margin: 0 }}>Halfway up. {r1(portHeight(spec, g))} mm tall.</small>}
            </div>
          )}
          {g.face === 'top' && (
            <div className="row" style={{ marginTop: 6, alignItems: 'end' }}>
              <Pick label="Across the top" value={g.off?.length ? 'each' : g.across != null ? 'mm' : g.near ?? 'mid'} options={[['mid', 'Across the middle'], ['front', 'By the front edge'], ['back', 'By the back edge'], ['mm', 'Measured from the front'], ...(g.off?.length ? [['each', 'Where I put each one'] as [string, string]] : [])]} onChange={(v) => G((x) => {
                delete x.off;
                if (v === 'mm') { x.across = r1(topAcross(spec, g)); delete x.near; } else if (v !== 'each') { delete x.across; x.near = v === 'mid' ? undefined : (v as 'front' | 'back'); }
              })} />
              {g.across != null && !g.off?.length ? <Num label="From the front" value={g.across} min={0} max={spec.w} step={0.5} onChange={(v) => G((x) => { x.across = v; })} hint="From the front edge to the middle of the ports." /> : <span />}
            </div>
          )}
          {g.face === 'top' && (
            <div className="row" style={{ marginTop: 6, alignItems: 'end' }}>
              <Num label="Turned" unit="°" value={g.rot ?? 0} min={-180} max={360} step={15} onChange={(v) => G((x) => { const d = ((v % 360) + 360) % 360; x.rot = d || undefined; })} hint="0: their width along the box; 90: across it; 180: the other way round. 45 lets plug packs sit side by side." />
              <Seg value={[0, 45, 90, 180].includes(g.rot ?? 0) ? g.rot ?? 0 : -1} options={[[0, '0°'], [45, '45°'], [90, '90°'], [180, '180°']]} onChange={(v) => G((x) => { x.rot = v || undefined; })} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Where a port is drawn on a face seen from outside: across it from the viewer's left, and up it. */
const viewAlong = (s: BoxSpec, f: BoxFace, along: number) => (f === 'back' || f === 'left' ? faceLen(s, f) - along : along);

/** The outline of a socket's mouth, drawn flat (w across, h up, centred), with the feature that says which way up it is. */
function Mouth({ type, w, h }: { type: string; w: number; h: number }) {
  const hw = w / 2, hh = h / 2;
  const trap = (top: number, bot: number) => `M${-top / 2},${-hh}L${top / 2},${-hh}L${bot / 2},${hh}L${-bot / 2},${hh}Z`;
  if (type === 'usb_a') return <><rect x={-hw} y={-hh} width={w} height={h} rx={0.6} className="bs-mouth" /><rect x={-hw + 1.6} y={-hh + 0.9} width={w - 3.2} height={hh - 0.6} rx={0.3} className="bs-feat" /></>;
  if (type === 'usb_c') return <rect x={-hw} y={-hh} width={w} height={h} rx={hh} className="bs-mouth" />;
  if (type === 'usb_micro_b' || type === 'usb_mini_b' || type === 'hdmi_a') return <><path d={trap(w, w * 0.72)} className="bs-mouth" /><path d={`M${-hw * 0.8},${-hh + 0.6}L${hw * 0.8},${-hh + 0.6}`} className="bs-featline" /></>;
  if (type === 'usb_b') { const c = Math.min(w, h) * 0.22; return <path d={`M${-hw + c},${-hh}L${hw - c},${-hh}L${hw},${-hh + c}L${hw},${hh}L${-hw},${hh}L${-hw},${-hh + c}Z`} className="bs-mouth" />; }
  if (type === 'rj45') return <><rect x={-hw} y={-hh} width={w} height={h} rx={0.5} className="bs-mouth" /><rect x={-w * 0.18} y={-hh} width={w * 0.36} height={h * 0.22} className="bs-feat" /></>;
  if (type === 'barrel' || type === 'audio35' || type === 'mains_lead') { const r = Math.min(w, h) / 2; return <><circle r={r} className="bs-mouth" /><circle r={r * 0.3} className="bs-feat" /></>; }
  return <rect x={-hw} y={-hh} width={w} height={h} rx={Math.min(1, hh)} className="bs-mouth" />;
}

/**
 * A live sketch of a box: from above, each port on its face with an arrow the way its plug comes in (a dot for one
 * in the top), and each side with ports as you see it standing in front of it, every socket drawn the way up it is.
 * Hovering a row's card lights its ports up here; clicking a port lights its card.
 */
export function BoxSketch({ spec, focus, onPick }: { spec: BoxSpec; focus?: string | null; onPick?: (id: string | null) => void }) {
  const W = 300, lay = layoutPorts(spec), bare = isBare(spec);
  const s = Math.min((W - 40) / spec.l, 110 / spec.w), bw = spec.l * s, bh = spec.w * s, ox = (W - bw) / 2, oy = 28;
  const r = Math.max(0, Math.min(spec.corner ?? Math.min(4, spec.w / 6), Math.min(spec.l, spec.w) / 2)) * s;
  const faces = bare ? [] : SIDES.filter((f) => lay.some((q) => q.group.face === f));
  // the sides with ports, each as seen from in front of it, at the same scale (the long ones full width, the ends side by side)
  const hh = Math.max(12, spec.h * s);
  const longs = faces.filter((f) => !isEnd(f)), endsF = faces.filter(isEnd);
  let y = oy + bh + 46;
  const rows: { f: BoxFace; x: number; y: number; wid: number }[] = [];
  for (const f of longs) { rows.push({ f, x: ox, y: y + 12, wid: bw }); y += hh + 24; }
  if (endsF.length) {
    const ew = spec.w * s, gapX = 24, tot = endsF.length * ew + (endsF.length - 1) * gapX;
    endsF.forEach((f, k) => rows.push({ f, x: (W - tot) / 2 + k * (ew + gapX), y: y + 12, wid: ew }));
    y += hh + 24;
  }
  const H = y - 4;
  const lit = (q: PortAt) => (focus && q.group.id === focus ? ' lit' : '');
  const pick = (q: PortAt) => onPick?.(q.group.id);
  const outline = spec.chamfer && r > 0
    ? `M${ox + r},${oy}L${ox + bw - r},${oy}L${ox + bw},${oy + r}L${ox + bw},${oy + bh - r}L${ox + bw - r},${oy + bh}L${ox + r},${oy + bh}L${ox},${oy + bh - r}L${ox},${oy + r}Z`
    : null;
  const roles = [...new Set(spec.groups.filter((g) => g.count > 0).map((g) => g.role))];
  return (
    <div className="boxsketch">
      <svg className="boxpreview" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Sketch of the box: from above, then each side with ports as you look at it">
        <text x={W / 2} y={11} textAnchor="middle" className="bs-lab">back</text>
        <text x={W / 2} y={oy + bh + 21} textAnchor="middle" className="bs-lab">front · from above</text>
        {outline ? <path d={outline} className="bs-box" /> : <rect x={ox} y={oy} width={bw} height={bh} rx={Math.min(r, bh / 2, bw / 2)} className="bs-box" />}
        {lay.map((q) => {
          const g = q.group, t = connById(g.type), ww = Math.max(3, portWidth(g.type, g, spec) * s), c = tone(g.role), ref = g.refs?.[q.i] ?? '';
          if (g.face === 'top') {
            const cx = ox + q.along * s, cy = oy + bh - topAcross(spec, g, q.i) * s;
            return <g key={`${g.id}${q.i}`} className={`bs-port${lit(q)}`} onClick={() => pick(q)} transform={`translate(${cx},${cy}) rotate(${-(g.rot ?? 0)})`}>
              <title>{`${ref}: ${plugName(g.type)} in the top, ${ROLE_SHORT[g.role] ?? g.role}`}</title>
              <rect x={-Math.max(3, t.body.w * s) / 2} y={-Math.max(3, t.body.l * s) / 2} width={Math.max(3, t.body.w * s)} height={Math.max(3, t.body.l * s)} rx={1.5} fill={c} />
              <circle r={1.3} className="bs-in" />
            </g>;
          }
          // on a side: a block on the edge, an arrow out the way the plug comes in
          const k = 5, a = 5;
          const at = g.face === 'front' ? { x: ox + q.along * s, y: oy + bh, dx: 0, dy: 1 } : g.face === 'back' ? { x: ox + q.along * s, y: oy, dx: 0, dy: -1 } : g.face === 'left' ? { x: ox, y: oy + bh - q.along * s, dx: -1, dy: 0 } : { x: ox + bw, y: oy + bh - q.along * s, dx: 1, dy: 0 };
          const horiz = at.dy !== 0, rw = horiz ? ww : k, rh = horiz ? k : ww;
          const tip = [at.x + at.dx * (k / 2 + a), at.y + at.dy * (k / 2 + a)], base = [at.x + at.dx * (k / 2 + 1), at.y + at.dy * (k / 2 + 1)];
          const px = -at.dy * 2.2, py = at.dx * 2.2;
          return <g key={`${g.id}${q.i}`} className={`bs-port${lit(q)}`} onClick={() => pick(q)}>
            <title>{`${ref}: ${plugName(g.type)} on the ${FACE_NAME[g.face].toLowerCase()}, ${ROLE_SHORT[g.role] ?? g.role}`}</title>
            <rect x={at.x - rw / 2} y={at.y - rh / 2} width={rw} height={rh} rx={1.2} fill={c} />
            <path d={`M${tip[0]},${tip[1]}L${base[0] + px},${base[1] + py}L${base[0] - px},${base[1] - py}Z`} fill={c} opacity={0.7} />
          </g>;
        })}
        {rows.length > 0 && <text x={W / 2} y={oy + bh + 36} textAnchor="middle" className="bs-lab">each side as you look at it</text>}
        {rows.map(({ f, x, y: y0, wid }) => (
          <g key={f}>
            <text x={x + wid / 2} y={y0 - 4} textAnchor="middle" className="bs-lab">{FACE_NAME[f].toLowerCase()}</text>
            <rect x={x} y={y0} width={wid} height={hh} rx={Math.min(3, hh / 4)} className="bs-box" />
            {lay.filter((q) => q.group.face === f).map((q) => {
              const g = q.group, t = connById(g.type), turn = turnOf(spec, g);
              const cx = x + viewAlong(spec, f, q.along) * s, cy = y0 + hh - (portUp(spec, g) / spec.h) * hh;
              const mw = g.type === 'pins_ra' ? portWidth(g.type, g, spec) : t.body.w, mh = t.body.h;
              const sc = spec.h * s >= 12 ? s : hh / spec.h; // slim boxes are drawn a little taller, ports with them
              return (
                <g key={`${g.id}${q.i}`} className={`bs-port${lit(q)}`} onClick={() => pick(q)} transform={`translate(${cx},${cy}) scale(${sc}) rotate(${turn})`} style={{ color: tone(g.role) }}>
                  <title>{`${g.refs?.[q.i] ?? ''}: ${plugName(g.type)}${turn ? `, ${turnOptions(g.type).find(([k2]) => k2 === turn)?.[1].toLowerCase()}` : ''}`}</title>
                  <Mouth type={g.type} w={mw} h={mh} />
                </g>
              );
            })}
          </g>
        ))}
      </svg>
      {roles.length > 0 && <div className="bs-legend">{roles.map((ro) => <span key={ro}><i style={{ background: tone(ro) }} />{ROLE_SHORT[ro] ?? ro}</span>)}</div>}
    </div>
  );
}

/** "Build your own box": a kind, a name, a size and a colour; it opens with a typical port or two to change under Box. */
export function DrawBox({ put }: { put: (b: Board) => void }) {
  const [kind, setKind] = useState<keyof typeof BOX_KINDS>('hub');
  const K = BOX_KINDS[kind];
  const [name, setName] = useState('');
  const [size, setSize] = useState<Record<string, [number, number, number]>>({});
  const [l, w, h] = size[kind] ?? K.size;
  const put3 = (k: 0 | 1 | 2, v: number) => setSize((x) => { const n = [...(x[kind] ?? K.size)] as [number, number, number]; n[k] = v; return { ...x, [kind]: n }; });
  const [color, setColor] = useState<string | null>(null);
  const b = useMemo(() => newBox(kind, { l, w, h, name, color: color ?? undefined }), [kind, l, w, h, name, color]);
  const create = () => {
    put(structuredClone(b));
    store.set({ step: 'board', view: 'editor' });
    toast(`${b.name} is in. Set its ports under Box in the sidebar: how many, what, on which side, where along it and which way up. In the editor, drag a port to where it really is.`);
  };
  return (
    <div className="drawbox">
      <div className="db-form">
        <div className="field"><span>What it is</span></div>
        <div className="db-kinds" role="radiogroup" aria-label="What it is">
          {(Object.keys(BOX_KINDS) as (keyof typeof BOX_KINDS)[]).map((k) => <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{BOX_KINDS[k].name}</button>)}
        </div>
        <p className="hint" style={{ margin: '4px 0 8px' }}>{K.what[0].toUpperCase() + K.what.slice(1)}.</p>
        <Text label="Name" value={name} placeholder={b.name} onChange={setName} />
        <div className="row3" style={{ marginTop: 8 }}>
          <Num label="Length" value={l} min={10} max={800} step={1} onChange={(v) => put3(0, v)} hint="Along its front: the long side." />
          <Num label="Width" value={w} min={8} max={300} step={1} onChange={(v) => put3(1, v)} hint="Front to back." />
          <Num label="Height" value={h} min={1} max={150} step={0.1} onChange={(v) => put3(2, v)} hint="Under 5 mm it is a bare board (a probe, an adapter)." />
        </div>
        <div className="field" style={{ marginTop: 8 }}><span>Colour</span>
          <div className="swatches">
            {COLOURS.map(([c, n]) => <button key={c} className={`swatch ${b.color === c ? 'on' : ''}`} style={{ background: c }} title={n} aria-label={`Colour: ${n}`} onClick={() => setColor(c)} />)}
            <OwnColour key={b.color} value={b.color ?? '#2b2f36'} onPick={setColor} />
          </div>
        </div>
        <button className="btn primary db-go" onClick={create}><Icon d={I.pencil} /> Create and set its ports</button>
        <p className="hint" style={{ margin: '6px 0 0' }}>It starts with {b.box!.groups.map((g) => `${g.count} ${plugName(g.type)} as ${ROLE_SHORT[g.role] ?? g.role}`).join(' and ')}: change them, add rows and say where each port is under Box. Save it to My boards to use it in any rack.</p>
      </div>
      <div className="db-preview boxsk"><BoxSketch spec={b.box!} /></div>
    </div>
  );
}
