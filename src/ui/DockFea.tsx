// Check step: run the 2D FEA of the dock (socket latch and rail shoe) for the chosen material.
import { useEffect, useRef, useState } from 'react';
import type { DockFeaResult, DockField } from '../fea/dockfea';
import { MATERIALS } from '../model/library';
import { activeModule, useApp } from '../state';
import { runDockFea } from '../worker/client';
import { Check, Chip, Section } from './controls';

function heat(t: number) {
  const stops = [[30, 64, 175], [34, 197, 164], [250, 204, 21], [244, 63, 94]];
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function Heat({ f, allow }: { f: DockField; allow: number }) {
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const k = Math.max(1, Math.round(0.35 / f.h));
    c.width = Math.ceil(f.nx / k); c.height = Math.ceil(f.ny / k);
    const g = c.getContext('2d')!;
    g.fillStyle = '#0a0f14'; g.fillRect(0, 0, c.width, c.height);
    const best = new Float32Array(c.width * c.height).fill(-1);
    for (let e = 0; e < f.elems.length; e++) {
      const ge = f.elems[e], i = Math.floor((ge % f.nx) / k), j = Math.floor(Math.floor(ge / f.nx) / k);
      const idx = (c.height - 1 - j) * c.width + i;
      if (f.strain[e] > best[idx]) best[idx] = f.strain[e];
    }
    for (let idx = 0; idx < best.length; idx++) if (best[idx] >= 0) { g.fillStyle = heat(best[idx] / allow); g.fillRect(idx % c.width, Math.floor(idx / c.width), 1, 1); }
  }, [f, allow]);
  return <figure className="heatfig"><canvas ref={cv} className="heat" /><figcaption>{f.name}</figcaption></figure>;
}

export function DockFeaSection() {
  const p = useApp((s) => s.project)!;
  const matName = activeModule(p).holder.material;
  const mat = MATERIALS[matName];
  const [r, setR] = useState<DockFeaResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fine, setFine] = useState(false);
  const run = async () => {
    setErr(null); setBusy('Meshing…');
    try { setR(await runDockFea(mat.E, mat.nu, fine ? 0.06 : 0.1, setBusy)); } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };
  const allow = mat.strainAllow;
  return (
    <Section title="Dock FEA · latch, rail shoe, grip and anti-rattle leaves">
      <p className="hint" style={{ marginTop: 0 }}>2D plane-stress models of the springs every dock relies on, in {matName} (E {mat.E} MPa): the socket latch (18 mm wide), the rail shoe hinge (two 7 mm leaves) and the shoe's rail grip (21 mm), the shoe pulled off the rail as a whole, and the leaves on a holder's tongue and pedestal that press the socket. Each case is scaled to the travel it has to reach.</p>
      <div className="btns" style={{ alignItems: 'center' }}>
        <button className="btn primary" disabled={!!busy} onClick={run}>{busy ? 'Running…' : 'Run dock FEA'}</button>
        <Check label="Fine mesh (0.06 mm)" value={fine} onChange={setFine} />
      </div>
      {busy && <><div className="progress" style={{ marginTop: 8 }}><div /></div><p className="hint">{busy}</p></>}
      {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
      {r && (
        <div style={{ marginTop: 10 }}>
          <div className="heatrow">{r.fields.map((f) => <Heat key={f.name} f={f} allow={allow} />)}</div>
          <p className="hint">Strain as a fraction of the {(allow * 100).toFixed(1)}% limit for {matName}: blue low, red at the limit. {r.mesh.elements.toLocaleString()} elements.</p>
          <table className="table"><tbody>
            <tr><th>Case</th><th className="num">Force</th><th className="num">Peak / 99%</th></tr>
            {r.cases.map((c, i) => (
              <tr key={i}><td>{c.name}<div className="hint" style={{ marginTop: 2 }}>{c.target}{c.notes.length ? ` · ${c.notes.join(' · ')}` : ''}</div></td><td className="num">{c.force.toFixed(1)} N</td>
                <td className="num"><Chip status={c.peakStrain <= allow ? 'ok' : c.peakStrain <= allow * 1.15 ? 'warn' : 'bad'}>{(c.peakStrain * 100).toFixed(2)}%</Chip><div className="hint">{(c.p99Strain * 100).toFixed(2)}%</div></td></tr>
            ))}
          </tbody></table>
          <p className="hint">Peaks sit at spring roots, where the square-pixel mesh also adds a little. Linear and idealised: print one dock and try it before printing a batch.</p>
        </div>
      )}
    </Section>
  );
}
