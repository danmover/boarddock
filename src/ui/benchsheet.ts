// The debug bench sheet: one printed page with each board's J-Link or adapter, the header and its pinout, which way
// round the ribbon plugs in, what to buy, and how the computer sees it. Pure (rows in, HTML out), printed the way the
// build guide is (into #printguide, see styles.css).
import type { benchSheet } from '../model/debuggear';

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** The sheet's HTML (the inside of the div that only shows when printing). */
export function benchHtml(title: string, sheet: ReturnType<typeof benchSheet>): string {
  const out: string[] = [];
  const boards = new Set(sheet.rows.map((r) => r.board)).size;
  out.push(`<h1>${esc(title)}: debug bench sheet</h1>`);
  out.push(`<p class="g-sub">${sheet.rows.length} header${sheet.rows.length === 1 ? '' : 's'} on ${boards} board${boards === 1 ? '' : 's'}. Tick each one off as you plug it in.</p>`);
  if (!sheet.rows.length) out.push('<p>No board has a debug or UART header.</p>');
  else {
    out.push('<table class="g-sheet"><thead><tr><th>Board and header</th><th>J-Link or adapter</th><th>Which way round</th><th>Cable</th><th>USB and port</th><th></th></tr></thead><tbody>');
    for (const r of sheet.rows) {
      const way = r.kind === 'debug' ? `${esc(r.pin1)}${r.pinout ? `<br><small>Pins, 1 first: ${esc(r.pinout)}</small>` : ''}` : `${r.pins ? esc(r.pins) : ''}<br><small>${esc(r.pin1)}</small>${r.guess ? '<br><b>Pin names are a guess: check yours.</b>' : ''}`;
      const cable = [r.ribbon ? `Ribbon: ${esc(r.ribbon)}` : '', ...r.buy.map((b) => `Buy: ${esc(b)}`)].filter(Boolean).join('<br>');
      out.push(`<tr><td><b>${esc(r.board)}</b><br>${esc(r.header)}</td><td>${r.probe ? `${esc(r.probe)}<br><small>${esc(r.where)}</small>` : `<i>${esc(r.where)}</i>`}</td><td>${way}</td><td>${cable || '-'}</td><td>${r.probe ? `${esc(r.usb)}<br><small>${esc(r.port)}</small>` : ''}</td><td class="tick">&#9744;</td></tr>`);
    }
    out.push('</tbody></table>');
  }
  if (sheet.buy.length) out.push(`<h3>To buy</h3><ul>${sheet.buy.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`);
  out.push('<p class="g-note">The J-Link comes with its own ribbon. Plug a ribbon in with its red stripe on pin 1. A UART header\'s pin names differ from board to board: read yours off the silkscreen before you power it, and keep the adapter\'s VCC wire off unless the board wants it (3.3 V logic).</p>');
  return out.join('\n');
}
