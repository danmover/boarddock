import { describe, it, beforeAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initKernel } from '../src/cad/kernel';
import { generatePanel } from '../src/cad/panelgen';
import { RACKS } from './collide/racks';

// draws a rack's top view (u right, v down) with its cables to a PNG: RACK="name" [CLIP="u0,v0,u1,v1"] [ONLY="id1,id2"]
const S = '/tmp/claude-0/-home-user-boarddock/9f8d8d26-36fa-584d-87d3-c19a32c74ffd/scratchpad';
const sharp = createRequire(import.meta.url)('sharp');
const hue = (i: number) => `hsl(${(i * 67) % 360},80%,45%)`;
describe('draw', () => {
  beforeAll(async () => { await initKernel(); });
  it('draw', async () => {
    (globalThis as any).__dbgOn = true;
    const name = process.env.RACK ?? 'Pi cluster';
    const rack = RACKS.find((r) => r.name === name)!;
    const p = rack.make();
    generatePanel(p);
    const D = (globalThis as any).__dbg;
    const only = process.env.ONLY?.split(',');
    const boxes = D.obs.map((o: any) => o.box);
    let [u0, v0, u1, v1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const b of boxes) { u0 = Math.min(u0, b[0]); v0 = Math.min(v0, b[1]); u1 = Math.max(u1, b[3]); v1 = Math.max(v1, b[4]); }
    if (process.env.CLIP) [u0, v0, u1, v1] = process.env.CLIP.split(',').map(Number);
    const sc = Number(process.env.SC ?? 3);
    const X = (u: number) => ((u - u0) * sc).toFixed(1), Y = (v: number) => ((v - v0) * sc).toFixed(1);
    const W = Math.ceil((u1 - u0) * sc) + 4, H = Math.ceil((v1 - v0) * sc) + 4;
    const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="monospace"><rect width="100%" height="100%" fill="white"/>`];
    for (const o of D.obs) {
      const b = o.box;
      const rail = /^rail /.test(o.label), st = o.stand, plug = !!o.plug, holder = /holder/.test(o.label), dock = /^dock/.test(o.label), cap = /cap/.test(o.label);
      const col = rail ? '#888' : st ? '#a52' : plug ? '#f80' : holder ? '#36c' : dock ? '#90c' : cap ? '#c3c' : '#2a2';
      out.push(`<rect x="${X(b[0])}" y="${Y(b[1])}" width="${((b[3] - b[0]) * sc).toFixed(1)}" height="${((b[4] - b[1]) * sc).toFixed(1)}" fill="${col}" fill-opacity="${rail ? 0.12 : st ? 0.18 : 0.10}" stroke="${col}" stroke-width="${st ? 1.5 : 0.6}" stroke-opacity="0.7"/>`);
    }
    D.cables.forEach((c: any, i: number) => {
      if (only && !only.includes(c.id)) return;
      const pl = c.path.map((q: number[]) => `${X(q[0])},${Y(q[1])}`).join(' ');
      out.push(`<polyline points="${pl}" fill="none" stroke="${hue(i)}" stroke-width="${(c.d * sc * 0.8).toFixed(1)}" stroke-opacity="0.55" stroke-linejoin="round"/>`);
      // planned route thin dashed
      const rp = c.route.pts.map((q: number[]) => `${X(q[0])},${Y(q[1])}`).join(' ');
      out.push(`<polyline points="${rp}" fill="none" stroke="${hue(i)}" stroke-width="1" stroke-dasharray="4 3"/>`);
      // under-rail parts of the settled path: black core
      let seg: number[][] = [];
      const flush = () => { if (seg.length > 1) out.push(`<polyline points="${seg.map((q) => `${X(q[0])},${Y(q[1])}`).join(' ')}" fill="none" stroke="black" stroke-width="1.2"/>`); seg = []; };
      for (const q of c.path) { if (q[2] < -1) seg.push(q); else flush(); }
      flush();
      const m = c.path[Math.floor(c.path.length / 2)];
      out.push(`<text x="${X(m[0])}" y="${Y(m[1])}" font-size="10" fill="${hue(i)}">${c.id.slice(-3)}${c.kind && c.kind !== 'usb' ? c.kind[0] : ''}</text>`);
      for (const h of c.hit) out.push(`<circle cx="${X(h.at[0])}" cy="${Y(h.at[1])}" r="6" fill="none" stroke="red"/>`);
    });
    for (const t of D.tags) for (const T of t.T) out.push(`<circle cx="${X(T[12])}" cy="${Y(T[13])}" r="3" fill="none" stroke="black"/>`);
    out.push('</svg>');
    const svg = out.join('\n');
    writeFileSync(`${S}/draw.svg`, svg);
    await sharp(Buffer.from(svg)).png().toFile(`${S}/draw.png`);
    writeFileSync(`${S}/draw.txt`, `${name}: u ${u0.toFixed(0)}..${u1.toFixed(0)} v ${v0.toFixed(0)}..${v1.toFixed(0)}, vert=${D.vert}, streets ${D.streets.map((s: number) => s.toFixed(1))}\n` + D.cables.map((c: any) => `${c.id.slice(-3)} ${c.kind} d=${c.d} street ${c.street} ${c.A.plug}->${c.B.plug}`).join('\n'));
  }, 300000);
});
