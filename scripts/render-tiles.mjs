// Renders the 3D pictures the app shows straight away instead of rendering each one with WebGL when it starts:
// every board template (the tiles on Start and in "Add a board") into public/tiles/, and every part in the board
// editor's toolbox into public/tiles/pal/. Each picture is of the thing's own 3D model (boardviz.ts, the same meshes
// the 3D view draws), and src/ui/tiles.json keeps the fingerprint of the model it was rendered from: the app asks for
// the picture by that fingerprint, and tests/toolbox.test.ts fails as soon as a model no longer matches its picture.
//
// Run it when that test says so (after changing a part's 3D model, a template or the toolbox), with the dev server
// running (npm run dev) and Playwright installed somewhere:
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs node scripts/render-tiles.mjs [http://localhost:5173/] [stale|all|boards|parts]
// stale (the default): only the pictures whose model changed, or that are missing; all: every one again; boards or
// parts: every one of those. Pictures of things that are gone are deleted.
//
// community: the pictures of the community boards (boards/, listed in public/boards/index.json by `npm run boards`) into
// public/boards/<id>.webp, for the boards that have none or whose board has changed since; public/boards/tiles.json
// records which revision each shows. Run `npm run boards` again afterwards: that lists the new pictures in index.json.
// A community board without a picture shows a plain top view, so this step is optional.
import fs from 'node:fs';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');
const url = process.argv[2] ?? 'http://localhost:5173/';
const mode = process.argv[3] ?? 'stale';
if (!['stale', 'all', 'boards', 'parts', 'community'].includes(mode)) throw new Error(`stale, all, boards, parts or community, not ${mode}`);
const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
if (mode === 'community') {
  const dir = path.join(root, 'public', 'boards'), tilesFile = path.join(dir, 'tiles.json');
  const list = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')).boards;
  const shown = fs.existsSync(tilesFile) ? JSON.parse(fs.readFileSync(tilesFile, 'utf8')) : {};
  const todo = list.filter((e) => shown[e.id] !== e.rev || !fs.existsSync(path.join(dir, `${e.id}.webp`)));
  if (todo.length) {
    const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(url);
    await page.waitForFunction(() => !!window.__bd, null, { timeout: 60000 });
    // the same size and view as the built-in boards' pictures
    const pics = await page.evaluate(async (todo) => {
      const { picture } = await import('/src/ui/snapshot.ts');
      const { boardPicture } = await import('/src/worker/client.ts');
      const res = {};
      for (const e of todo) {
        const board = await (await fetch(`/boards/${e.file}`)).json();
        const parts = await boardPicture(board);
        res[e.id] = await picture(`community:${e.id}:${e.rev}:${Math.random()}`, async () => parts, 280, 180, [0.5, -1, 0.8]);
      }
      return res;
    }, todo);
    await browser.close();
    for (const e of todo) {
      const [head, b64] = pics[e.id].split(',');
      if (!/webp/.test(head)) throw new Error(`${e.id}: the browser made a ${head}, not a WebP`);
      fs.writeFileSync(path.join(dir, `${e.id}.webp`), Buffer.from(b64, 'base64'));
      shown[e.id] = e.rev;
      console.log(`boards/${e.id}.webp`, Math.round(Buffer.from(b64, 'base64').length / 1024), 'KB');
    }
  }
  for (const id of Object.keys(shown)) if (!list.some((e) => e.id === id)) delete shown[id];
  fs.writeFileSync(tilesFile, JSON.stringify(shown, null, 1) + '\n');
  console.log(`${todo.length} rendered, ${list.length - todo.length} already up to date. Now run: npm run boards`);
  process.exit(0);
}
const out = path.join(root, 'public', 'tiles'), sigFile = path.join(root, 'src', 'ui', 'tiles.json');
fs.mkdirSync(path.join(out, 'pal'), { recursive: true });
const known = fs.existsSync(sigFile) ? JSON.parse(fs.readFileSync(sigFile, 'utf8')) : {};
const files = [...fs.readdirSync(out).map((f) => f), ...fs.readdirSync(path.join(out, 'pal')).map((f) => `pal/${f}`)].filter((f) => f.endsWith('.webp'));
const have = files.map((f) => f.slice(0, -5));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.goto(url);
await page.waitForFunction(() => !!window.__bd, null, { timeout: 60000 });
const got = await page.evaluate(async ({ mode, known, have }) => {
  const { picture } = await import('/src/ui/snapshot.ts');
  const { boardPicture } = await import('/src/worker/client.ts');
  const { pictureSig } = await import('/src/cad/boardviz.ts');
  const { PALETTE, demoBoard } = await import('/src/model/palette.ts');
  const { TEMPLATES } = await import('/src/model/templates.ts');
  // the same sizes and views as the live pictures (BoardThumb's, and the toolbox's PartPic)
  const jobs = [
    ...(mode === 'parts' ? [] : TEMPLATES.map((t) => ({ id: t.id, make: () => t.make(), w: 280, h: 180, view: [0.5, -1, 0.8] }))),
    ...(mode === 'boards' ? [] : PALETTE.map((it) => ({ id: `pal/${it.id}`, make: () => demoBoard(it), w: 168, h: 120, view: [0.42, -1, 0.9] }))),
  ];
  const res = {};
  for (const j of jobs) {
    const parts = await boardPicture(j.make());
    const sig = pictureSig(parts);
    if (mode === 'stale' && known[j.id] === sig && have.includes(j.id)) { res[j.id] = { sig }; continue; }
    res[j.id] = { sig, url: await picture(`tilegen:${j.id}:${Math.random()}`, async () => parts, j.w, j.h, j.view) };
  }
  return res;
}, { mode, known, have });
await browser.close();

// the fingerprints: this run's, and the other kind's as they were when only boards or parts were rendered
const kind = (id) => (id.startsWith('pal/') ? 'parts' : 'boards');
const sigs = Object.fromEntries(Object.entries(known).filter(([id]) => mode !== 'stale' && mode !== 'all' && kind(id) !== mode));
for (const [id, r] of Object.entries(got)) {
  sigs[id] = r.sig;
  if (!r.url) continue;
  const [head, b64] = r.url.split(',');
  if (!/webp/.test(head)) throw new Error(`${id}: the browser made a ${head}, not a WebP`);
  fs.writeFileSync(path.join(out, `${id}.webp`), Buffer.from(b64, 'base64'));
  console.log(`${id}.webp`, Math.round(Buffer.from(b64, 'base64').length / 1024), 'KB');
}
const ran = (id) => mode === 'stale' || mode === 'all' || kind(id) === mode;
for (const f of files) if (ran(f.slice(0, -5)) && !(f.slice(0, -5) in sigs)) { fs.unlinkSync(path.join(out, f)); console.log('deleted', f, '(nothing of that name any more)'); }
fs.writeFileSync(sigFile, JSON.stringify(Object.fromEntries(Object.entries(sigs).sort(([a], [b]) => a.localeCompare(b))), null, 1) + '\n');
const fresh = Object.values(got).filter((r) => r.url).length;
console.log(`${fresh} rendered, ${Object.keys(got).length - fresh} already up to date; fingerprints in src/ui/tiles.json`);
