// Plugs › Debug and serial: every board's debug and UART headers in one list, each with the J-Link or adapter on it
// (its ribbon length, its slot, which way round it plugs in), the ones with nothing on them, one button that adds a
// J-Link and an adapter for every header without, what to buy, and the printed bench sheet.
import { useMemo } from 'react';
import { benchSheet, freeHeaders, headerRows, PROBE_CHOICES, ribbonToBuy, sheetRow, type HeaderRow } from '../model/debuggear';
import { probeKeyFor, ribbonOf } from '../model/probes';
import { rackName } from '../model/diff';
import { edit, select, store, toast, useApp } from '../state';
import { Chip, Section } from './controls';
import { Icon, I } from './icons';
import { addDebugGearFor, addJLinks, addSerialAdapters } from './linkOps';
import { benchHtml } from './benchsheet';
import type { CompanionKey } from '../model/boxes';

/** Print the bench sheet (the page's only content while the print dialog is open, as the build guide is). */
export function printBenchSheet() {
  const s = store.get(), p = s.project;
  if (!p) return;
  if (!headerRows(p).length) { toast('No board has a debug or UART header yet.'); return; }
  document.getElementById('printguide')?.remove();
  const div = document.createElement('div');
  div.id = 'printguide';
  div.innerHTML = benchHtml(rackName(p), benchSheet(p, s.result?.report.cables ?? [], s.result?.report.panel));
  document.body.appendChild(div);
  const done = () => { div.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}

export function DebugPanel() {
  const p = useApp((s) => s.project)!;
  const res = useApp((s) => s.result);
  const rows = useMemo(() => headerRows(p), [p.modules, p.links]);
  if (!rows.length) return null;
  const cables = res?.report.cables ?? [], panel = res?.report.panel;
  const free = freeHeaders(p), freeDbg = free.filter((r) => r.kind === 'debug').length, freeUart = free.length - freeDbg;
  const sheet = benchSheet(p, cables, panel);
  const ribbon = (r: HeaderRow) => {
    const pm = r.probe!, len = ribbonOf(pm.board), run = cables.find((x) => x.id === r.link?.id && x.ribbon != null)?.length;
    return (
      <span className="ribbon" onClick={(e) => e.stopPropagation()} title={run != null ? `Its ribbon has to run about ${Math.round(run)} mm` : "The length of the J-Link's ribbon"}>
        {run != null && run > len && <>
          <Chip status="warn">needs ~{Math.round(run)}</Chip>
          <button className="btn small soft" title="Set the ribbon to the next standard length that reaches, and buy one that long (30 cm ribbons are common)"
            onClick={() => edit((q) => { const x = q.modules.find((y) => y.id === pm.id); if (!x) return; const v = ribbonToBuy(run) * 10; if (x.board.box) x.board.box.ribbon = v; else x.board.ribbon = v; })}>Use {ribbonToBuy(run) * 10}</button>
        </>}
        <input type="number" aria-label={`${pm.board.name} ribbon length (mm)`} value={len} step={10} min={50} max={1000}
          onChange={(e) => { const v = Math.max(50, Math.min(1000, +e.target.value || 200)); edit((q) => { const x = q.modules.find((y) => y.id === pm.id); if (!x) return; if (x.board.box) x.board.box.ribbon = v; else x.board.ribbon = v; }); }} />
        <small>mm</small>
      </span>
    );
  };
  return (
    <Section title={`Debug and serial · ${rows.length} header${rows.length > 1 ? 's' : ''}`} right={<span className="btns">
      {free.length > 0 && <button className="btn small soft" onClick={() => addDebugGearFor()} title="A J-Link on each debug header and a USB-serial adapter on each UART header that has none, on every board, with their USB cables: one undo step"><Icon d={I.plus} /> Add {[freeDbg ? `${freeDbg} J-Link${freeDbg > 1 ? 's' : ''}` : '', freeUart ? `${freeUart} adapter${freeUart > 1 ? 's' : ''}` : ''].filter(Boolean).join(' + ')}</button>}
      <button className="btn small ghost" onClick={printBenchSheet} title="One page to print: each board's J-Link or adapter, header pinout, ribbon, port notes">Bench sheet</button>
    </span>}>
      <div className="list">
        {rows.map((r) => {
          const s = sheetRow(p, r, cables, panel);
          const pick = probeKeyFor(r.comp);
          return (
            <div key={`${r.board.id}/${r.comp.ref}`} className="item" onClick={() => select([{ kind: 'comp', id: r.comp.id }])}>
              <span className="grow">
                <b>{r.board.board.name}</b> <small>{r.comp.ref} · {s.header.replace(/^[^,]*, /, '')}</small>
                <small className="cpurpose">{r.probe ? `${s.where}. ${s.pin1}` : r.other ? s.where : r.kind === 'debug' ? `No J-Link on it. ${s.pin1}` : `No adapter on it. ${s.pin1}`}</small>
              </span>
              {r.probe && r.kind === 'debug' && ribbon(r)}
              {r.probe ? <Chip status="ok">{r.probe.board.name.replace(/\s*\(.*\)$/, '')}</Chip>
                : r.other ? <Chip>cable</Chip>
                : r.kind === 'debug' ? (
                  <span className="btns" onClick={(e) => e.stopPropagation()}>
                    <button className="btn small soft" onClick={() => addJLinks(r.board.id, [r.comp.ref])} title={`A J-Link on ${r.comp.ref}, cabled to it, beside its board`}><Icon d={I.plus} /> J-Link</button>
                    <select className="btn small" value={pick} aria-label={`Which J-Link for ${r.comp.ref}`} title="Which J-Link: the one whose connector takes this header's ribbon is first"
                      onChange={(e) => { addJLinks(r.board.id, [r.comp.ref], e.target.value as CompanionKey); }}>
                      {[...PROBE_CHOICES].sort((a, b) => Number(b.key === pick) - Number(a.key === pick)).map((c) => <option key={c.key} value={c.key}>{c.label}{c.key === pick ? ' (fits)' : ''}</option>)}
                    </select>
                  </span>
                ) : <button className="btn small soft" onClick={(e) => { e.stopPropagation(); addSerialAdapters(r.board.id, [r.comp.ref]); }} title={`A USB-serial adapter on ${r.comp.ref}, with jumper wires`}><Icon d={I.plus} /> Adapter</button>}
            </div>
          );
        })}
      </div>
      {sheet.buy.length > 0 && (
        <>
          <div className="field"><span>To buy for these (the J-Link comes with its own ribbon)</span></div>
          <ul className="fmt" style={{ marginTop: 4 }}>{sheet.buy.map((b) => <li key={b}>{b}</li>)}</ul>
        </>
      )}
      {(sheet.guess || rows.some((r) => r.kind === 'uart')) && <p className="hint" style={{ margin: '4px 0 0' }}>{sheet.guess ? <b>A UART header's pin names here are a guess: check yours on the board before you power it. </b> : ''}Four-pin UART headers differ (GND RX TX VCC, VCC TX RX GND…): read yours off the silkscreen; set the pins under Board › Debug & UART headers.</p>}
    </Section>
  );
}
