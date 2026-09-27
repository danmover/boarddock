// Renders the 3D pictures the app shows straight away instead of rendering each one with WebGL when it starts:
// every board template (the tiles on Start and in "Add a board") into public/tiles/, and every part in the board
// editor's toolbox into public/tiles/pal/.
//
// Run it after changing a template or the toolbox, with the dev server running (npm run dev) and Playwright installed
// somewhere:
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs node scripts/render-tiles.mjs [http://localhost:5191/] [boards|parts]
// Then bump TILE_V in src/ui/panels.tsx (boards) or PAL_V in src/ui/Toolbox.tsx (parts) so browsers fetch the new ones.
import fs from 'node:fs';
import path from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');
const url = process.argv[2] ?? 'http://localhost:5191/';
const only = process.argv[3] ?? 'all';
const out = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'tiles');
fs.mkdirSync(path.join(out, 'pal'), { recursive: true });

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.goto(url);
await page.waitForFunction(() => !!window.__bd, null, { timeout: 60000 });
const tiles = await page.evaluate(async (only) => {
  const { picture } = await import('/src/ui/snapshot.ts');
  const { boardPicture } = await import('/src/worker/client.ts');
  const { PALETTE, demoBoard } = await import('/src/model/palette.ts');
  const out = {};
  if (only !== 'parts') for (const t of window.__bd.TEMPLATES) {
    const b = t.make();
    // the same size and view as BoardThumb's live picture
    out[t.id] = await picture(`tilegen:${t.id}:${Math.random()}`, () => boardPicture(b), 280, 180, [0.5, -1, 0.8]);
  }
  // the same size and view as the toolbox's live picture
  if (only !== 'boards') for (const it of PALETTE) out[`pal/${it.id}`] = await picture(`palgen:${it.id}:${Math.random()}`, () => boardPicture(demoBoard(it)), 168, 120, [0.42, -1, 0.9]);
  return out;
}, only);
for (const [id, dataUrl] of Object.entries(tiles)) {
  const [head, b64] = dataUrl.split(',');
  const ext = /webp/.test(head) ? 'webp' : 'png';
  fs.writeFileSync(path.join(out, `${id}.${ext}`), Buffer.from(b64, 'base64'));
  console.log(`${id}.${ext}`, Math.round(Buffer.from(b64, 'base64').length / 1024), 'KB');
}
await browser.close();
