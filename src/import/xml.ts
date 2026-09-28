// A small, forgiving XML reader for the big fabrication files (IPC-2581 runs to tens of megabytes). It keeps
// element names (without any namespace prefix), attributes and children, and drops text, comments and the
// doctype: the formats we read keep everything in attributes. It works the same in the browser and in tests.

export interface XEl { name: string; a: Record<string, string>; kids: XEl[] }

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (s: string) => (s.includes('&') ? s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m)) : s);

/** Parse XML text into a tree; returns a synthetic root whose children are the document's top elements. */
export function parseXml(src: string): XEl {
  const root: XEl = { name: '#root', a: {}, kids: [] };
  const stack: XEl[] = [root];
  const n = src.length;
  let i = 0;
  const attrRe = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;
    const c = src[lt + 1];
    if (c === '!') {
      // comment, CDATA or doctype: skip to its end
      const end = src.startsWith('<!--', lt) ? src.indexOf('-->', lt) + 3 : src.startsWith('<![CDATA[', lt) ? src.indexOf(']]>', lt) + 3 : src.indexOf('>', lt) + 1;
      i = end > lt ? end : n;
      continue;
    }
    if (c === '?') { const e = src.indexOf('?>', lt); i = e < 0 ? n : e + 2; continue; }
    // find the tag's end, stepping over quoted attribute values (they may hold '>')
    let j = lt + 1, q = '';
    for (; j < n; j++) {
      const ch = src[j];
      if (q) { if (ch === q) q = ''; } else if (ch === '"' || ch === "'") q = ch; else if (ch === '>') break;
    }
    const body = src.slice(lt + 1, j);
    i = j + 1;
    if (body[0] === '/') {
      const nm = local(body.slice(1).trim());
      // pop to the matching element (tolerates a missing close tag)
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].name === nm) { stack.length = k; break; }
      continue;
    }
    const self = body.endsWith('/');
    const inner = self ? body.slice(0, -1) : body;
    const sp = inner.search(/\s/);
    const el: XEl = { name: local(sp < 0 ? inner : inner.slice(0, sp)), a: {}, kids: [] };
    if (sp >= 0) {
      attrRe.lastIndex = 0;
      const rest = inner.slice(sp);
      let m: RegExpExecArray | null;
      while ((m = attrRe.exec(rest))) el.a[local(m[1])] = unescape(m[3] ?? m[4] ?? '');
    }
    stack[stack.length - 1].kids.push(el);
    if (!self) stack.push(el);
  }
  return root;
}

const local = (s: string) => { const k = s.indexOf(':'); return k < 0 ? s : s.slice(k + 1); };

/** Direct children called `name`. */
export const kidsOf = (e: XEl | undefined, name: string) => (e ? e.kids.filter((k) => k.name === name) : []);
export const kidOf = (e: XEl | undefined, name: string) => e?.kids.find((k) => k.name === name);

/** Every element called `name` under `e` (depth first, document order). */
export function findAll(e: XEl | undefined, name: string, out: XEl[] = []): XEl[] {
  if (!e) return out;
  for (const k of e.kids) { if (k.name === name) out.push(k); findAll(k, name, out); }
  return out;
}
export function findOne(e: XEl | undefined, name: string): XEl | undefined {
  if (!e) return undefined;
  for (const k of e.kids) { if (k.name === name) return k; const f = findOne(k, name); if (f) return f; }
  return undefined;
}
