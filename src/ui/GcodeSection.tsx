// Export › G-code: slice a plate right here with Kiri:Moto, see its layers, download the G-code; or open the plate in
// the user's own slicer (desktop app).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MeshData, V2 } from '../model/types';
import { MATERIALS } from '../model/library';
import { printerByName } from '../model/printers';
import { defaultCode, machinePlan } from '../slice/profiles';
import { bambuVars, gcodeLayers, kiriProfiles, slicePlate, type Sliced } from '../slice/kiri';
import { fromProfileJson, renderTemplate } from '../slice/bambutpl';
import { activeModule, edit, toast, useApp } from '../state';
import { Pick, Section, download } from './controls';
import { Icon, I } from './icons';
import { zipSync } from 'fflate';

type Desk = { slicers: () => Promise<string[]>; openInSlicer: (app: string | null, name: string, bytes: Uint8Array) => Promise<string>; bambuProfile?: (preset: string) => Promise<{ start?: string; end?: string; layer?: string; from?: string; error?: string }> };

export function GcodeSection({ plates, plateMeshes, plate3mf, base, brim, plateKey, fits }: { plates: number; plateMeshes: (i: number) => MeshData[]; plate3mf: (i: number) => Uint8Array; base: string; brim: boolean; plateKey: unknown; fits?: boolean[] }) {
  const p = useApp((s) => s.project)!;
  const mat = activeModule(p).holder.material;
  const pr = printerByName(p.printer.name);
  const plan = machinePlan(pr, p.printer.name, p.printer.bambu?.from);
  const [prog, setProg] = useState<{ i: number; f: number; what: string } | null>(null);
  const [done, setDone] = useState<Record<number, Sliced>>({});
  const [fail, setFail] = useState<Record<number, string>>({});
  const [look, setLook] = useState<number | null>(null);
  const [queue, setQueue] = useState<{ k: number; n: number; t0: number } | null>(null);
  // a slice belongs to these plates on this printer with this filament and start code
  const stale = [plateKey, p.printer.name, p.printer.bed[0], p.printer.bed[1], p.printer.maxZ, p.printer.gcodeStart, p.printer.gcodeEnd, p.printer.bambu, p.printer.plate, mat, brim];
  useEffect(() => { setDone({}); setFail({}); setLook(null); }, stale);

  const run = async (list: number[]) => {
    const t0 = Date.now();
    for (const [k, i] of list.entries()) {
      if (list.length > 1) setQueue({ k, n: list.length, t0 });
      try {
        setFail((x) => ({ ...x, [i]: '' }));
        const r = await slicePlate({ meshes: plateMeshes(i), printer: p.printer, material: mat, brim, density: MATERIALS[mat].density, base: `${base}_plate${i + 1}` }, (f, what) => setProg({ i, f, what }));
        setDone((x) => ({ ...x, [i]: r }));
        setLook((l) => l ?? i);
      } catch (e: any) {
        setFail((x) => ({ ...x, [i]: String(e?.message ?? e) }));
      }
    }
    setProg(null);
    setQueue(null);
  };
  const busy = !!prog;
  const ok = (i: number) => fits?.[i] !== false;
  const left = [...Array(plates).keys()].filter((i) => !done[i] && ok(i));
  const finished = Object.keys(done).map(Number).sort((a, b) => a - b);
  // time left in a "slice all": the plates done so far set the pace
  const eta = queue && queue.k > 0 ? ((Date.now() - queue.t0) / queue.k) * (queue.n - queue.k) : null;
  const zipAll = () => {
    const files: Record<string, Uint8Array> = {};
    for (const i of finished) files[done[i].file] = done[i].bytes;
    download(`${base}_gcode.zip`, zipSync(files, { level: 6 }), 'application/zip');
  };

  return (
    <Section title="G-code" right={<span className="chip">Kiri:Moto</span>}>
      <p className="hint" style={{ marginTop: 0 }}>
        Slice here with <a href="https://grid.space/kiri/" target="_blank" rel="noreferrer">Kiri:Moto</a>, an open-source slicer that runs inside BoardDock. It uses the settings above for {mat}. {plan.firmware === 'bambu' ? 'Bambu Lab printers get a .gcode.3mf to send or copy to the SD card.' : 'You get a .gcode file for the SD card, USB stick or printer web page.'}
      </p>
      <div className={`fitnote ${plan.fit}`}>
        <b>{plan.fit === 'none' ? (pr?.firmware === 'bambu' ? `One step first: the ${p.printer.name}'s own start code` : `No in-app G-code for the ${p.printer.name}`) : `Start code: ${plan.label}`}</b>
        {plan.note && <span>{plan.note}</span>}
      </div>
      {pr?.firmware === 'bambu' && <BambuCode preset={pr.orca} />}
      {plan.fit !== 'none' && (
        <>
          <div className="slicelist">
            {[...Array(plates).keys()].map((i) => {
              const r = done[i], on = prog?.i === i;
              return (
                <div key={i} className={`slicerow${look === i && r ? ' on' : ''}`}>
                  <span className="nm">Plate {i + 1}{r && <small title="Kiri:Moto's estimate for its speeds">{fmtTime(r.seconds)} · {r.grams.toFixed(0)} g · {r.layers} layers</small>}</span>
                  {!ok(i) ? <span className="res"><small className="bad">bigger than the bed</small></span> : on ? (
                    <span className="prog"><span className="bar"><i style={{ width: `${Math.round(prog!.f * 100)}%` }} /></span><small>{prog!.what}…</small></span>
                  ) : r ? (
                    <span className="res">
                      <button className="btn small ghost" onClick={() => setLook(i)} aria-pressed={look === i}>Layers</button>
                      <button className="btn small soft" title={r.file} onClick={() => download(r.file, r.bytes)}><Icon d={I.download} /> G-code</button>
                    </span>
                  ) : (
                    <span className="res">
                      {fail[i] && <small className="bad" title={fail[i]}>{fail[i]}</small>}
                      <button className="btn small" disabled={busy} onClick={() => run([i])}>{fail[i] ? 'Try again' : 'Slice'}</button>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {queue && <p className="hint" style={{ margin: '8px 0 0' }}>Plate {queue.k + 1} of {queue.n}{eta != null ? `, about ${Math.max(1, Math.round(eta / 60000))} min left` : ''}. You can keep working: slicing runs in the background.</p>}
          <div className="btns" style={{ marginTop: 8 }}>
            {plates > 1 && left.length > 1 && <button className="btn soft" disabled={busy} onClick={() => run(left)}>Slice all {left.length} plates</button>}
            {finished.length > 1 && <button className="btn soft" onClick={zipAll}><Icon d={I.download} /> All G-code ({finished.length} plates, .zip)</button>}
          </div>
          {look != null && done[look] && <LayerView key={look} r={done[look]} bed={p.printer.bed} />}
          {!p.printer.bambu && <StartCode />}
          <p className="hint">Kiri:Moto has no first-layer (elephant-foot) compensation: if snap parts are tight right at the bed, trim the brim edge or squeeze the first layer less. Nothing BoardDock makes has been print-tested yet, so print the test-fit kit first.</p>
        </>
      )}
      <OpenInSlicer plates={plates} plate3mf={plate3mf} base={base} />
    </Section>
  );
}

/** One layer of the sliced plate from above, the layer below it faint. */
function LayerView({ r, bed }: { r: Sliced; bed: V2 }) {
  const layers = useMemo(() => gcodeLayers(r.gcode), [r.gcode]);
  // the area the print covers (every layer), with a margin: the view zooms to it
  const box = useMemo(() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const l of layers) for (let j = 0; j < l.segs.length; j += 2) { x0 = Math.min(x0, l.segs[j]); x1 = Math.max(x1, l.segs[j]); y0 = Math.min(y0, l.segs[j + 1]); y1 = Math.max(y1, l.segs[j + 1]); }
    const m = 4;
    return Number.isFinite(x0) ? [Math.max(0, x0 - m), Math.max(0, y0 - m), Math.min(bed[0], x1 + m), Math.min(bed[1], y1 + m)] : [0, 0, bed[0], bed[1]];
  }, [layers, bed[0], bed[1]]);
  const [k, setK] = useState(0);
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = cv.current;
    if (!c || !layers.length) return;
    const bw = box[2] - box[0], bh = box[3] - box[1];
    const W = c.clientWidth, s = Math.min(W / bw, 300 / bh), H = Math.round(bh * s), dpr = window.devicePixelRatio || 1;
    c.width = W * dpr; c.height = H * dpr; c.style.height = `${H}px`;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ox = (W - bw * s) / 2, css = getComputedStyle(c);
    const X = (x: number) => ox + (x - box[0]) * s, Y = (y: number) => H - (y - box[1]) * s;
    g.clearRect(0, 0, W, H);
    const draw = (segs: Float32Array, color: string, w: number) => {
      g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'round';
      g.beginPath();
      for (let j = 0; j < segs.length; j += 4) { g.moveTo(X(segs[j]), Y(segs[j + 1])); g.lineTo(X(segs[j + 2]), Y(segs[j + 3])); }
      g.stroke();
    };
    if (k > 0) draw(layers[k - 1].segs, css.getPropertyValue('--line-2').trim() || '#999', Math.max(0.6, 0.45 * s));
    draw(layers[k].segs, css.getPropertyValue('--accent').trim() || '#f60', Math.max(0.8, 0.45 * s));
  }, [layers, k, box]);
  if (!layers.length) return null;
  return (
    <div className="layerview">
      <canvas ref={cv} />
      <div className="row" style={{ alignItems: 'center', gap: 10 }}>
        <input type="range" min={0} max={layers.length - 1} value={k} onChange={(e) => setK(Number(e.target.value))} aria-label="Layer" />
        <small className="mono">layer {k + 1}/{layers.length} · z {layers[k].z.toFixed(2)}</small>
      </div>
    </div>
  );
}

const PLATES = ['Textured PEI Plate', 'Cool Plate', 'Engineering Plate', 'High Temp Plate'];

/**
 * A Bambu Lab printer's own start, end and layer-change code: read from the user's Bambu Studio or OrcaSlicer (the
 * desktop app finds it), from its profile files, or pasted in. BoardDock doesn't ship it (it is Bambu's, under their
 * licence); it keeps the copy in this project and fills it in for every print. And which build plate is on.
 */
function BambuCode({ preset }: { preset: string }) {
  const ps = useApp((s) => s.project!.printer);
  const desk = (window as any).boarddockDesktop as Desk | undefined;
  const [paste, setPaste] = useState<{ start: string; end: string; layer: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const own = ps.bambu;
  const put = (b: NonNullable<typeof ps.bambu>) => {
    // check it fills in before keeping it: every name it uses has to be one BoardDock knows
    const v = bambuVars(ps, 'PETG', { x0: 20, y0: 20, x1: 120, y1: 120, z1: 30, layers: 150 });
    const unknown = [...new Set([b.start, b.end, b.layer].flatMap((t) => { try { return t ? renderTemplate(t, v).unknown : []; } catch (e) { toast(`That code has a mistake in it: ${(e as Error).message}`); return ['?']; } }))];
    edit((q) => { q.printer.bambu = b; });
    toast(unknown.length ? `Loaded, but it uses ${unknown.join(', ')}, which BoardDock can't fill in yet: slicing will stop and say so.` : `The ${ps.name}'s own start code is in (from ${b.from}). Slice a plate: it is filled in for each print.`);
  };
  const readDesk = async () => {
    const r = await desk!.bambuProfile!(preset);
    if (r.error || !r.start) { toast(`${r.error ?? 'Nothing found'}. Open its profile file, or paste the code instead.`); return; }
    put({ start: r.start, end: r.end, layer: r.layer, from: r.from ?? 'your slicer' });
  };
  const readFiles = async (fl: FileList) => {
    let b: { start?: string; end?: string; layer?: string } = {};
    const names: string[] = [];
    for (const f of [...fl]) {
      try { const x = fromProfileJson(await f.text()); b = { start: x.start ?? b.start, end: x.end ?? b.end, layer: x.layer ?? b.layer }; names.push(f.name); } catch { toast(`${f.name} is not a Bambu Studio or OrcaSlicer profile (.json).`); }
    }
    if (!b.start) { toast('No machine start G-code in those files: pick the one ending "template machine_start_gcode.json" (or the printer\'s own .json), and the end and layer ones with it.'); return; }
    put({ start: b.start, end: b.end, layer: b.layer, from: names.join(', ') });
  };
  const lines = (t?: string) => (t ? t.split('\n').length : 0);
  return (
    <div className="bambucode">
      <div className="row" style={{ alignItems: 'end' }}>
        <Pick label="Build plate" value={ps.plate ?? PLATES[0]} options={PLATES.map((x) => [x, x] as [string, string])} onChange={(v) => edit((q) => { q.printer.plate = v; })} />
      </div>
      {own ? (
        <p className="hint" style={{ margin: '6px 0' }}>
          <b>Its own start code is in</b>, from {own.from}: start {lines(own.start)} lines{own.end ? `, end ${lines(own.end)}` : ''}{own.layer ? `, layer change ${lines(own.layer)}` : ''}. It is saved in this project.{' '}
          <button className="btn small ghost" onClick={() => edit((q) => { delete q.printer.bambu; })}>Forget it</button>
        </p>
      ) : (
        <p className="hint" style={{ margin: '6px 0' }}>Bambu's printers need their own start code (it heats, levels the area you print on, wipes and primes the nozzle, and knows where this printer's purge and wipe spots are). It comes with Bambu Studio and OrcaSlicer, free: {desk?.bambuProfile ? 'read it from yours,' : ''} open its profile files, or paste it in. BoardDock keeps a copy in this project and fills it in for each print.</p>
      )}
      <div className="btns">
        {desk?.bambuProfile && <button className="btn small soft" onClick={readDesk}>Read it from Bambu Studio / OrcaSlicer</button>}
        <button className="btn small ghost" onClick={() => file.current?.click()}>Open its profile files…</button>
        <button className="btn small ghost" onClick={() => setPaste(paste ? null : { start: own?.start ?? '', end: own?.end ?? '', layer: own?.layer ?? '' })}>{paste ? 'Close' : 'Paste it…'}</button>
        <input ref={file} type="file" accept=".json" multiple hidden onChange={(e) => { if (e.target.files?.length) readFiles(e.target.files); e.target.value = ''; }} />
      </div>
      {!own && (
        <details className="where">
          <summary>Where to find it</summary>
          <ul>
            <li><b>Paste:</b> in Bambu Studio or OrcaSlicer pick the {ps.name} printer, open its settings (the edit icon by the printer), go to <b>Machine G-code</b>, and copy <b>Machine start G-code</b>, <b>Machine end G-code</b> and <b>Layer change G-code</b> into the boxes here.</li>
            <li><b>Files:</b> they are in the slicer's install folder, <code>profiles/BBL/machine</code> (on a Mac: <code>/Applications/BambuStudio.app/Contents/Resources/profiles/BBL/machine</code>; on Windows: <code>C:\Program Files\Bambu Studio\resources\profiles\BBL\machine</code>). Pick <code>{preset} template machine_start_gcode.json</code>, <code>… machine_end_gcode.json</code> and <code>… layer_change_gcode.json</code> together (older versions: just <code>{preset}.json</code>).</li>
          </ul>
        </details>
      )}
      {paste && (
        <div className="bambupaste">
          <label className="field"><span>Machine start G-code</span><textarea className="mono" rows={7} spellCheck={false} value={paste.start} onChange={(e) => setPaste({ ...paste, start: e.target.value })} /></label>
          <label className="field"><span>Machine end G-code</span><textarea className="mono" rows={4} spellCheck={false} value={paste.end} onChange={(e) => setPaste({ ...paste, end: e.target.value })} /></label>
          <label className="field"><span>Layer change G-code</span><textarea className="mono" rows={3} spellCheck={false} value={paste.layer} onChange={(e) => setPaste({ ...paste, layer: e.target.value })} /></label>
          <button className="btn small primary" disabled={!paste.start.trim()} onClick={() => { put({ start: paste.start, end: paste.end || undefined, layer: paste.layer || undefined, from: 'code you pasted' }); setPaste(null); }}>Use it</button>
        </div>
      )}
    </div>
  );
}

/** The printer's start and end G-code, editable; empty means the profile's own. */
function StartCode() {
  const ps = useApp((s) => s.project!.printer);
  const plan = machinePlan(printerByName(ps.name), ps.name);
  const [def, setDef] = useState<{ start: string; end: string } | null>(null);
  const [start, setStart] = useState(ps.gcodeStart ?? '');
  const [end, setEnd] = useState(ps.gcodeEnd ?? '');
  useEffect(() => { setStart(ps.gcodeStart ?? ''); setEnd(ps.gcodeEnd ?? ''); }, [ps.gcodeStart, ps.gcodeEnd]);
  useEffect(() => {
    let live = true;
    (plan.kiri ? kiriProfiles().then((all) => all[plan.kiri!] ?? null) : Promise.resolve(null)).then((pro) => live && setDef(defaultCode(plan, pro, ps))).catch(() => live && setDef(null));
    return () => { live = false; };
  }, [ps.name, ps.bed[0], ps.bed[1]]);
  const save = (k: 'gcodeStart' | 'gcodeEnd', v: string) => {
    const was = ps[k] ?? '';
    const next = v.trim() && v !== (k === 'gcodeStart' ? def?.start : def?.end) ? v : '';
    if (next !== was) edit((q) => { if (next) q.printer[k] = next; else delete q.printer[k]; });
  };
  const custom = !!(ps.gcodeStart || ps.gcodeEnd);
  return (
    <details className="startcode">
      <summary>Start and end G-code{custom ? ' (edited)' : ''}</summary>
      <p className="hint">{'{temp}'} and {'{bed_temp}'} become the filament's temperatures. Paste your own slicer's start code here if you trust it more.</p>
      <label className="field"><span>Start</span><textarea className="mono" rows={8} spellCheck={false} value={start || def?.start || ''} onChange={(e) => setStart(e.target.value)} onBlur={(e) => save('gcodeStart', e.target.value)} /></label>
      <label className="field"><span>End</span><textarea className="mono" rows={5} spellCheck={false} value={end || def?.end || ''} onChange={(e) => setEnd(e.target.value)} onBlur={(e) => save('gcodeEnd', e.target.value)} /></label>
      {custom && <button className="btn small ghost" onClick={() => edit((q) => { delete q.printer.gcodeStart; delete q.printer.gcodeEnd; })}>Back to the profile's code</button>}
    </details>
  );
}

/** Desktop app: open a plate's 3MF in an installed slicer. In a browser: say how. */
function OpenInSlicer({ plates, plate3mf, base }: { plates: number; plate3mf: (i: number) => Uint8Array; base: string }) {
  const desk = (window as any).boarddockDesktop as Desk | undefined;
  const [found, setFound] = useState<string[] | null>(null);
  const [app, setApp] = useState('');
  useEffect(() => { desk?.slicers().then((l) => { setFound(l); setApp(l[0] ?? ''); }).catch(() => setFound([])); }, []);
  const open = async (i: number) => {
    const err = await desk!.openInSlicer(app || null, `${base}_plate${i + 1}.3mf`, plate3mf(i));
    toast(err ? `Could not open it: ${err}` : `Plate ${i + 1} opened in ${app || 'your slicer'}. Pick the printer preset and the settings above, then slice.`);
  };
  return (
    <div className="ownslicer">
      <h4>Or use your own slicer</h4>
      {desk ? (
        <>
          {found && found.length > 0 && (
            <Pick label="Slicer" value={app} options={[...found.map((x) => [x, x] as [string, string]), ['', 'The app your system opens 3MF files with']]} onChange={setApp} />
          )}
          {found && !found.length && <p className="hint">No slicer found in the usual places; plates open in whatever your system uses for 3MF files.</p>}
          <div className="btns" style={{ marginTop: 8 }}>{[...Array(plates).keys()].map((i) => <button key={i} className="btn small ghost" onClick={() => open(i)}>Open plate {i + 1}</button>)}</div>
        </>
      ) : (
        <p className="hint">Each plate's <b>3MF</b> above has every part placed. Open it in OrcaSlicer, PrusaSlicer, Bambu Studio or Cura (all free) with the settings above. Your printer maker's slicer knows its quirks best.</p>
      )}
    </div>
  );
}

function fmtTime(s: number) { const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; }
