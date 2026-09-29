// The build guide: the assembly steps one at a time (the 3D view's Guide), and the same steps printed, each with a
// picture of the 3D view at that step, with the bill of materials at the end. Pure (text in, HTML out), so the viewer
// only has to take the pictures.
import type { BomGroup } from '../model/bom';
import type { Anim, GenResult, Motion } from '../model/types';

export interface GuideStep { n: number; text: string; img?: string }

/** What a step says when the build has no words for it. */
export const NO_TEXT = 'Fit the parts that are moving now.';

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** A part's moves in order: the ones before (pre), then its own. */
export const movesOf = (a?: Anim): Motion[] => [...(a?.pre ?? []), { seq: a?.seq ?? 0, dir: a?.dir ?? [0, 0, 1], dist: a?.dist, style: a?.style, rot: a?.rot }];

/** The assembly animation's steps: every distinct build step a part moves or appears in, in order. */
export const stepSeqs = (anims: (Anim | undefined)[]): number[] => [...new Set(anims.flatMap((a) => [...movesOf(a).map((m) => m.seq), ...(a?.show != null ? [a.show] : [])]))].sort((a, b) => a - b);

/** Every animated thing the 3D view draws for an assembly (the parts on the rack, what's shown with them, the ghosts). */
export const assemblyAnims = (r: GenResult): (Anim | undefined)[] => [
  ...[...r.parts, ...(r.display ?? [])].filter((p) => p.toAssembly[14] > -300).flatMap((p) => [p.anim, ...(p.instances ?? []).map((_, k) => p.anims?.[k] ?? p.anim)]),
  ...r.ghosts.map((g) => g.anim),
];

/** One step per step of the assembly animation (phases: each animation step's build step), with its words. */
export function guideSteps(phases: number[], steps: { seq: number; text: string }[] | undefined): GuideStep[] {
  return phases.map((seq, i) => ({ n: i + 1, text: steps?.find((s) => s.seq === seq)?.text ?? NO_TEXT }));
}

/** The printable guide (the inside of a div that only shows when printing). */
export function guideHtml(title: string, steps: GuideStep[], bom: BomGroup[]): string {
  const out: string[] = [];
  out.push(`<h1>${esc(title)}: build guide</h1>`);
  out.push(`<p class="g-sub">${steps.length} step${steps.length === 1 ? '' : 's'}. The parts each step adds are outlined in blue. The bill of materials is at the end.</p>`);
  for (const s of steps) {
    out.push('<section class="g-step">');
    out.push(`<h2>Step ${s.n} of ${steps.length}</h2>`);
    if (s.img) out.push(`<img src="${esc(s.img)}" alt="The rack after step ${s.n}">`);
    out.push(`<p>${esc(s.text)}</p>`);
    out.push('</section>');
  }
  out.push('<section class="g-bom"><h2>Bill of materials</h2>');
  for (const g of bom) {
    out.push(`<h3>${esc(g.head)}</h3><table><tbody>`);
    for (const r of g.rows) out.push(`<tr><td class="q">${r.qty}</td><td>${esc(r.item)}</td><td class="n">${esc(r.note ?? '')}</td></tr>`);
    out.push('</tbody></table>');
  }
  out.push('</section>');
  return out.join('\n');
}
