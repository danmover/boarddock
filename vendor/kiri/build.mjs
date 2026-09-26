// Builds Kiri:Moto's FDM slicing engine (engine + worker + worker pool) into public/kiri for BoardDock, following
// grid-apps' own bin/esbuild.config.mjs, plus the few printer profiles BoardDock maps to. See vendor/kiri/README.md.
//
//   node vendor/kiri/build.mjs <path to a grid-apps checkout with its node_modules> [out dir, default public/kiri]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const grid = path.resolve(process.argv[2] ?? '');
const out = path.resolve(process.argv[3] ?? path.join(path.dirname(new URL(import.meta.url).pathname), '../../public/kiri'));
if (!fs.existsSync(path.join(grid, 'src/kiri/run/engine.js'))) throw new Error(`not a grid-apps checkout: ${grid}`);
const nm = path.join(grid, 'node_modules');
const { build } = createRequire(path.join(nm, 'noop.js'))('esbuild'); // esbuild comes from the grid-apps checkout
fs.mkdirSync(out, { recursive: true });

// Generated inputs grid-apps normally makes with webpack (npm run webpack-ext) and its esbuild config.
await build({ entryPoints: [path.join(grid, 'bin/webpack-three-bundle.js')], bundle: true, format: 'esm', outfile: path.join(grid, 'src/ext/three.js'), logLevel: 'warning' });
await build({ entryPoints: [path.join(grid, 'bin/webpack-jszip-bundle.js')], bundle: true, format: 'esm', outfile: path.join(grid, 'src/ext/jszip-esm.js'), logLevel: 'warning' });
// The engine never lists devices, so none are bundled (BoardDock passes the one it needs). Some stock profiles
// carry their author's printer addresses and access codes; they stay out of the bundle this way.
fs.mkdirSync(path.join(grid, 'src/pack'), { recursive: true });
fs.writeFileSync(path.join(grid, 'src/pack/kiri-devs.js'), 'export const devices = { fdm: {} };');

const empty = (a) => ({ path: a.path, namespace: 'empty' });
const patched = (file, pairs) => {
  const src = fs.readFileSync(file, 'utf8');
  let s = src;
  for (const [from, to] of pairs) {
    if (from instanceof RegExp ? !from.test(s) : !s.includes(from)) throw new Error(`patch target moved in ${file}: ${from}`);
    s = s.replace(from, to);
  }
  return { contents: s, loader: 'js', resolveDir: path.dirname(file) };
};
const plugin = {
  name: 'boarddock-kiri',
  setup(b) {
    b.onResolve({ filter: /ext\/tween\.js$/ }, () => ({ path: path.join(nm, '@tweenjs/tween.js/dist/tween.esm.js') }));
    b.onResolve({ filter: /ext\/quickjs\.js$/ }, () => ({ path: path.join(nm, 'quickjs-emscripten/dist/index.js') }));
    // QuickJS (the sandbox for G-code macros like {temp}) only ever uses its release-sync build
    b.onResolve({ filter: /generated\/(ffi|emscripten-module)\.WASM_(DEBUG_SYNC|DEBUG_ASYNCIFY|RELEASE_ASYNCIFY)$/ }, empty);
    // node-only branches inside emscripten glue
    b.onResolve({ filter: /^(fs|path|crypto|url|worker_threads|perf_hooks)$/ }, empty);
    b.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: 'module.exports = {}', loader: 'js' }));
    // WebAssembly next to the bundle instead of at the site root
    b.onLoad({ filter: /geo\/wasm\.js$/ }, (a) => patched(a.path, [["fetch('/wasm/kiri-geo.wasm')", "fetch(new URL('./kiri-geo.wasm', import.meta.url))"]]));
    // the Kiri app switches its WebAssembly polygon library on from its preferences; the bare engine never does,
    // which leaves every offset and boolean in plain JS (about 20 times slower here). Switch it on with the pool.
    b.onLoad({ filter: /kiri\/run\/engine\.js$/ }, (a) => patched(a.path, [['client.restart();\n            client.pool.start();', 'client.restart();\n            client.pool.start();\n            client.wasm(true);']]));
    b.onLoad({ filter: /geo\/csg\.js$/ }, (a) => patched(a.path, [['return "../wasm/manifold.wasm"', "return new URL('./manifold.wasm', import.meta.url).href"]]));
    // FDM only: the CNC, laser, resin, wire-EDM, waterjet and drag-knife modes are stubbed out
    b.onLoad({ filter: /kiri\/run\/worker\.js$/ }, (a) => {
      const src = fs.readFileSync(a.path, 'utf8'), re = /^import \{ (\w+) \} from '\.\.\/mode\/(cam|drag|laser|sla|wedm|wjet)\/[^']+';$/gm;
      if ((src.match(re) ?? []).length !== 6) throw new Error('worker mode imports moved');
      return { contents: src.replace(re, 'const $1 = { init() {} };'), loader: 'js', resolveDir: path.dirname(a.path) };
    });
    b.onLoad({ filter: /kiri\/run\/minion\.js$/ }, (a) => {
      const src = fs.readFileSync(a.path, 'utf8'), re = /^import \{ ([^}]+) \} from '\.\.\/mode\/cam\/work\/[^']+';$/gm;
      const names = [...src.matchAll(re)].flatMap((m) => m[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop()));
      if (names.length !== 7) throw new Error('minion CAM imports moved');
      return { contents: src.replace(re, '') + `\nvar ${names.map((n) => `${n} = null`).join(', ')};`, loader: 'js', resolveDir: path.dirname(a.path) };
    });
  },
};

for (const [entry, name] of [['src/kiri/run/engine.js', 'kiri-engine.js'], ['src/kiri/run/worker.js', 'kiri-worker.js'], ['src/kiri/run/minion.js', 'kiri-pool.js']]) {
  await build({
    entryPoints: [path.join(grid, entry)],
    outfile: path.join(out, name),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: !process.env.KIRI_DEBUG,
    legalComments: 'eof',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env.QTS_DEBUG': 'false' },
    // grid-apps marks these optional voronoi helpers external too; FDM slicing never loads them
    external: ['module', 'node:module', './constants', './voronoi_structures', './voronoi_ctypes', '../thirdparty/jsbn', './collections', './voronoi_predicates', './voronoi_builder', './point_data', './segment_data', './cppgen', './voronoi_diagram', './voronoi'],
    logOverride: { 'duplicate-class-member': 'silent', 'duplicate-object-key': 'silent', 'direct-eval': 'silent' },
    plugins: [plugin],
  });
}
for (const w of ['kiri-geo.wasm', 'manifold.wasm']) fs.copyFileSync(fs.realpathSync(path.join(grid, 'src/wasm', w)), path.join(out, w));

// Printer profiles BoardDock uses as-is (src/slice/profiles.ts maps printers to them). Only the machine fields are
// kept; "extras" (printer addresses, access codes) is dropped. Where a stock profile hard-codes PLA temperatures,
// they become the {temp} / {bed_temp} macros so the chosen filament's temperatures are used.
const PROFILES = {
  'Bambu.P1S': [],
  'Bambu.A1': [
    [/^(\s*)(M140|M190) S65\b/, '$1$2 S{bed_temp}'],
    [/^(\s*)(M104|M109) S220\b/, '$1$2 S{temp}'],
    [/set_filament_type:PLA/, 'set_filament_type:@MATERIAL@'],
  ],
  'Prusa.i3.MK3S+': [],
  'Prusa.mini': [],
  'Creality.K1': [[/EXTRUDER_TEMP=220\.000000 BED_TEMP=45\.000000/, 'EXTRUDER_TEMP={temp} BED_TEMP={bed_temp}']],
};
const KEEP = ['deviceName', 'bedWidth', 'bedDepth', 'maxHeight', 'originCenter', 'extrudeAbs', 'fwRetract', 'gcodePre', 'gcodePost', 'gcodeLayer', 'gcodeFan', 'gcodeTrack', 'gcodeFeature', 'gcodeTime', 'gcodeFExt', 'extruders'];
const profiles = {};
for (const [id, fixes] of Object.entries(PROFILES)) {
  const d = JSON.parse(fs.readFileSync(path.join(grid, 'src/kiri/dev/fdm', `${id}.json`), 'utf8'));
  const p = Object.fromEntries(KEEP.filter((k) => k in d).map((k) => [k, d[k]]));
  if (d.extras?.bbl) p.extras = { bbl: {} }; // marks Bambu output (object labels), nothing else
  for (const [re, to] of fixes) {
    let n = 0;
    p.gcodePre = p.gcodePre.map((l) => (re.test(l) ? (n++, l.replace(re, to)) : l));
    if (!n) throw new Error(`profile patch found nothing in ${id}: ${re}`);
  }
  profiles[id] = p;
}
fs.writeFileSync(path.join(out, 'profiles.json'), JSON.stringify(profiles, null, 1));
fs.copyFileSync(path.join(grid, 'license.md'), path.join(out, 'KIRI-LICENSE.md'));

let commit = '';
try { commit = fs.readFileSync(path.join(grid, '.git/HEAD'), 'utf8').trim(); if (commit.startsWith('ref:')) commit = fs.readFileSync(path.join(grid, '.git', commit.slice(5)), 'utf8').trim(); } catch {}
const version = JSON.parse(fs.readFileSync(path.join(grid, 'package.json'), 'utf8')).version;
fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify({ kiri: version, commit }, null, 1));
console.log(`Kiri:Moto ${version} (${commit.slice(0, 7)}) ->`, fs.readdirSync(out).map((f) => `${f} ${(fs.statSync(path.join(out, f)).size / 1024).toFixed(0)}K`).join(', '));
