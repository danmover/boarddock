# Kiri:Moto in BoardDock

`public/kiri/` holds the FDM slicing engine of [Kiri:Moto](https://grid.space/kiri/) (Stewart Allen, MIT; source:
[GridSpace/grid-apps](https://github.com/GridSpace/grid-apps)). BoardDock loads it only when you press **Slice** in
Export. `build.mjs` makes it from the grid-apps source, following grid-apps' own `bin/esbuild.config.mjs`:

- `kiri-engine.js`, `kiri-worker.js`, `kiri-pool.js`: the engine API (`src/kiri/run/engine.js`), its worker and its pool of
  helper workers, minified. Only the FDM mode is included: CNC, laser, resin, wire EDM, waterjet and drag knife are stubbed out.
- `kiri-geo.wasm` (Clipper polygon operations) and `manifold.wasm`, loaded from next to the scripts.
- `profiles.json`: the printer profiles BoardDock maps printers to (`src/slice/profiles.ts`), machine fields only. The
  stock profiles' `extras` are dropped, because some carry their author's printer addresses and access codes. The A1 and K1
  profiles' fixed PLA temperatures become `{temp}` / `{bed_temp}`.
- `KIRI-LICENSE.md`, `version.json` (Kiri:Moto version and grid-apps commit).

Changes to the source, all made at build time: WebAssembly paths point next to the bundle; the engine switches on the
WebAssembly polygon library the way the Kiri:Moto app does; no device list is bundled.

## Rebuilding

grid-apps' full `npm install` pulls in Electron and Docusaurus. The build needs only the libraries the slicer uses:

```bash
git clone https://github.com/GridSpace/grid-apps && cd grid-apps && git checkout d138275
mkdir ../kiri-deps && cd ../kiri-deps && echo '{"private":true}' > package.json
npm install --ignore-scripts three@0.182.0 three-mesh-bvh@0.7.6 jszip@3.10.1 @gridspace/raster-path@1.1.1 @tracespace/parser@5.0.0-next.0 manifold-3d@3.3.2 base64-js earcut@3.0.1 @tweenjs/tween.js quickjs-emscripten@0.20.0 esbuild@0.25.5
ln -s "$PWD/node_modules" ../grid-apps/node_modules
cd /path/to/boarddock && node vendor/kiri/build.mjs ../grid-apps
```
