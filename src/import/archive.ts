// Opening archives: zip, tar, gzip (.tgz / .tar.gz) and Unix compress (.Z, which ODB++ uses for its features
// files), nested inside each other to any sensible depth. Every file keeps its path inside the archive, so a
// folder tree such as an ODB++ job (steps/pcb/profile, steps/pcb/layers/...) can still be found.
import { gunzipSync, unzipSync } from 'fflate';

/** One input file. `name` is the bare file name; `path` is where it sat inside an archive or dropped folder. */
export interface InFile { name: string; bytes: Uint8Array; path?: string }

const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5) && (b[3] === 4 || b[3] === 6);
const isGzip = (b: Uint8Array) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
const isLzw = (b: Uint8Array) => b.length > 3 && b[0] === 0x1f && b[1] === 0x9d;
const isTar = (b: Uint8Array) => b.length >= 512 && String.fromCharCode(...b.subarray(257, 262)) === 'ustar';
/** Old (pre-POSIX) tars have no "ustar" mark: accept a first header whose checksum adds up. */
function tarChecksumOk(b: Uint8Array): boolean {
  if (b.length < 512) return false;
  const want = parseInt(String.fromCharCode(...b.subarray(148, 156)).replace(/\0.*$/, '').trim(), 8);
  if (!Number.isFinite(want)) return false;
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : b[i];
  return sum === want && b[0] !== 0;
}

export const isArchiveName = (n: string) => /\.(zip|tgz|tar|gz|taz|tz)$/i.test(n);
export const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const dirOf = (p: string) => { const k = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')); return k < 0 ? '' : p.slice(0, k + 1); };

/** Read a tar archive into its files (ustar, GNU long names and pax path headers). */
export function untar(b: Uint8Array): { path: string; bytes: Uint8Array }[] {
  const out: { path: string; bytes: Uint8Array }[] = [];
  const str = (a: number, n: number) => { let s = ''; for (let i = a; i < a + n && b[i]; i++) s += String.fromCharCode(b[i]); return s; };
  let off = 0, longName = '';
  while (off + 512 <= b.length) {
    if (b[off] === 0) break; // two zero blocks end the archive
    const name = str(off, 100), size = parseInt(str(off + 124, 12).trim() || '0', 8) || 0, type = String.fromCharCode(b[off + 156] || 48);
    const prefix = str(off + 257, 6) === 'ustar' ? str(off + 345, 155) : '';
    const data = b.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = new TextDecoder().decode(data).replace(/\0.*$/s, ''); continue; }
    if (type === 'x') { const m = new TextDecoder().decode(data).match(/\d+ path=([^\n]*)\n/); if (m) longName = m[1]; continue; }
    if (type === 'g') continue;
    const path = longName || (prefix ? `${prefix}/${name}` : name);
    longName = '';
    if (type === '0' || type === '\0' || type === '7') out.push({ path, bytes: data });
  }
  return out;
}

/**
 * Unix `compress` (.Z) data, LZW coded. Codes grow from 9 bits; the encoder writes them in groups (8 codes of the
 * current width), and the stream skips to the end of a group whenever the width changes or the table is cleared.
 */
export function unlzw(inp: Uint8Array): Uint8Array {
  if (!isLzw(inp)) throw new Error('Not compress (.Z) data');
  const flags = inp[2], max = flags & 0x1f, block = (flags & 0x80) !== 0;
  if (max < 9 || max > 16) throw new Error('Unsupported .Z code size');
  const prefix = new Uint16Array(65536), suffix = new Uint8Array(65536), stack = new Uint8Array(65536);
  let out = new Uint8Array(Math.max(1024, inp.length * 4)), olen = 0;
  const put = (v: number) => { if (olen >= out.length) { const n = new Uint8Array(out.length * 2); n.set(out); out = n; } out[olen++] = v; };
  let p = 3, mark = 3, bits = 9, mask = 0x1ff, end = block ? 256 : 255, buf = 0, left = 0;
  const need = () => { while (left < bits) { if (p >= inp.length) return false; buf |= inp[p++] << left; left += 8; } return true; };
  const flushGroup = () => { const rem = (p - mark) % bits; if (rem) p += bits - rem; buf = 0; left = 0; mark = p; };
  if (!need()) return out.subarray(0, 0);
  let prev = buf & mask; buf >>>= bits; left -= bits;
  if (prev > 255) throw new Error('Damaged .Z data');
  let fin = prev;
  put(fin);
  for (;;) {
    if (end >= mask && bits < max) { flushGroup(); bits++; mask = (mask << 1) | 1; }
    if (!need()) break;
    let code = buf & mask; buf >>>= bits; left -= bits;
    if (code === 256 && block) { flushGroup(); bits = 9; mask = 0x1ff; end = 255; continue; }
    const temp = code;
    let sp = 0;
    if (code > end) {
      if (code !== end + 1 || prev > end) throw new Error('Damaged .Z data');
      stack[sp++] = fin;
      code = prev;
    }
    while (code >= 256) { stack[sp++] = suffix[code]; code = prefix[code]; }
    stack[sp++] = code;
    fin = code;
    if (end < mask) { end++; prefix[end] = prev; suffix[end] = fin; }
    prev = temp;
    while (sp) put(stack[--sp]);
  }
  return out.subarray(0, olen);
}

/**
 * Open every archive in the list (and archives inside those), keeping each file's path. Folders' own entries,
 * macOS resource forks and empty files are dropped. Compressed single files (.gz, .Z) are unpacked too.
 */
export function expandAll(files: InFile[], depth = 0): InFile[] {
  const out: InFile[] = [];
  for (const f of files) {
    const path = f.path ?? f.name, b = f.bytes;
    const inner = (entries: { path: string; bytes: Uint8Array }[]) => {
      const dir = depth || f.path ? dirOf(path) : '';
      const list = entries.filter((e) => e.bytes.length && !e.path.endsWith('/') && !/(^|\/)__MACOSX\/|(^|\/)\._/.test(e.path)).map((e) => ({ name: baseName(e.path), path: dir + e.path.replace(/^\.\//, ''), bytes: e.bytes }));
      out.push(...(depth < 4 ? expandAll(list, depth + 1) : list));
    };
    try {
      if (isZip(b)) { inner(Object.entries(unzipSync(b)).map(([p, bytes]) => ({ path: p, bytes }))); continue; }
      if (isGzip(b)) {
        const raw = gunzipSync(b);
        if (isTar(raw) || tarChecksumOk(raw)) inner(untar(raw));
        else inner([{ path: baseName(path).replace(/\.t?gz$/i, (m) => (m.toLowerCase() === '.tgz' ? '.tar' : '')), bytes: raw }]);
        continue;
      }
      if (isTar(b) || (/\.tar$/i.test(f.name) && tarChecksumOk(b))) { inner(untar(b)); continue; }
      if (isLzw(b)) { const nm = f.name.replace(/\.z$/i, ''); out.push({ name: nm, path: dirOf(path) + nm, bytes: unlzw(b) }); continue; }
    } catch (e: any) {
      if (isArchiveName(f.name)) throw new Error(`${f.name} could not be opened (${e?.message ?? e}). Is it complete?`);
    }
    out.push(f.path ? f : { ...f, path });
  }
  return out;
}
