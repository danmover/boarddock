# Development

Building BoardDock, its tests, and where the code lives. Code conventions and releases are in [CONTRIBUTING.md](../CONTRIBUTING.md); what is still to do, in order, is in [TODO.md](../TODO.md). Back to the [README](../README.md).

Contents:
- [Commands](#commands)
- [The collision test](#the-collision-test)
- [Board tiles and toolbox pictures](#board-tiles-and-toolbox-pictures)
- [Project layout](#project-layout)

## Commands

```bash
npm install
npm run dev                # web app at http://localhost:5173
npm test                   # vitest: importers, holders, panels, dock FEA, and a quick collision check
npm run typecheck
npm run collisions         # the whole collision test (144 racks, a minute or two)
npm run collisions:update  # write a new collision baseline (only on purpose)
npm run boards             # community boards: read boards/<slug>/, update public/boards/
npm run parts              # contributed parts: check parts/*.json, write src/model/parts.json
npm run build              # production web build in dist/
npm run desktop            # Electron app from the build
npm run dist               # installers for the current OS in release/
```

One test file: `npx vitest run tests/<file>`.

## The collision test

`tests/collide/` builds racks through the real generator (every template alone in each pose; boards back to back and stacked; probes; boxes; stands on and off; rails at every angle; a Pi cluster and a busy mixed rack with Auto-connect; a rack changed by hand; a built rack with boards added) and intersects every printed part, board, plug, rail, stand and cable exactly with manifold. A plug in its own jack, a cable in its own plug, a board on its own holder's pins and a DIN clip's hooks in its own holder are allowed. For automatic layouts it also looks for failing Check lines, overlap and clash warnings, rails over **Longest rail** and blocked plugs in use.

Each of the 144 racks' figures is held against `tests/collide/baseline.json`: the test fails when one grows past it, and prints the worst overlaps with part names and coordinates. `npm test` runs a few quick racks and `npm run collisions` all of them (CI runs both). When a fix lowers the figures, `npm run collisions:update` writes the new baseline; only do that on purpose.

## Board tiles and toolbox pictures

The board tiles on Start and in **Add a board**, and the toolbox's pictures, are shipped in `public/tiles/`, each rendered from the thing's own 3D model with a fingerprint of that model in `src/ui/tiles.json`. `npm test` (`tests/toolbox.test.ts`) fails as soon as a model no longer matches its picture (a changed part, template or toolbox entry). Render the ones that changed with the dev server running:

```bash
PLAYWRIGHT=/path/to/playwright/index.mjs node scripts/render-tiles.mjs http://localhost:5173/
```

Add `all` as a second argument to render every one, and commit the pictures with `tiles.json`.

## Project layout

- `src/import/`: the importers (KiCad, Gerber, Excellon, pick-and-place, IDF, Eagle XML in `other.ts` and binary in `eaglebin.ts`, board-viewer in `boardview.ts`, DXF, STEP, IPC-2581, ODB++, GenCAD), Allegro detection, and archives (zip, tar, gzip, Unix compress).
- `src/cad/`: geometry and layout.
  - The holder: `generate.ts` (the holder round one board), `levels.ts` (holder heights), `grip.ts` (the clip sums: sizing, push and hold), `leafplan.ts` (a clip leaf's outline, shared by the model and the FEA), `plugcap.ts` (plug caps), `joints.ts` (the 1.2 mm joint rule), `printcheck.ts` (the layer-by-layer printability check).
  - The dock: `dock.ts` (the rail shoe, socket, tongue, spine and rod), `dockdims.ts` (their dimensions), `dinclip.ts` (the pull-tab DIN clip and the rail grip), `column.ts` (column pegs and holes), `testkit.ts` (the test-fit kit).
  - The rack: `dockplan.ts` (plug access, orientation, column seats and auto-assignment; no geometry kernel), `autoplan.ts` (Auto-arrange's planner; no geometry kernel), `arrange.ts` (its best layout confirmed by the real router), `arrangelock.ts` (Auto-arrange round locked docks and rails), `packnew.ts` (**Pack new boards only**), `panelgen.ts` (the panel: placement, rows, added boards, collisions, parts, assembly steps), `railstand.ts` (table stands).
  - Cables: `cableroute.ts` (routes and their collision checks; no geometry kernel), `cablesim.ts` (cables settling), `cabletag.ts` (numbered tags).
  - Loose layouts and output: `assembly.ts` (loose layouts), `rivet.ts` (the pin-and-U-clip rivet), `boardviz.ts` (board, part and plug detail for the 3D view), `export.ts` (STL and 3MF output, plate packing and estimates), `kernel.ts` (the manifold wrapper).
- `src/fea/`: the 2D solver (`fea2d.ts`), the flat clip (`clipfea.ts`), the dock (`dockfea.ts`), a clip's leaf (`springfea.ts`), beam helpers (`beamfea.ts`), the flexure table and its rule (`flexures.ts`, with rows from `dockflex.ts`, `boardflex.ts` and `rackflex.ts`), and a 3D beam solver for the holder's support ribs (`frame3d.ts`).
- `src/geom/`: plain geometry with no WASM: 2D polygons (`poly.ts`), editing a board's shape (`shape.ts`), 4 × 4 matrices (`mat.ts`) and the rotation box's angles (`angle.ts`).
- `src/model/`: `types.ts`; `templates.ts` (the library's boards and accessories); `holes.ts` (the hole wizard and stacks); `portuse.ts` (which ports are in use); `links.ts` (plug roles, Auto-connect, the port budget and cable sizes); `power.ts` and `powerdata.ts` (the power budget and its estimates); `poe.ts`; `zones.ts` (mains zones); `built.ts` (what was built, and what changed since); `boxes.ts` (boxes from a size and rows of ports); `copper.ts` (decorative copper for boards without their own); `library.ts` (reference data: connectors and their plugs, materials, defaults); `printers.ts` (printers from OrcaSlicer's machine profiles, filament settings and the print settings list).
- `src/ui/`: the React UI. `Viewer3D.tsx` is the 3D view; `pickOps.ts` what a selection is and how it is removed; `panels.tsx` the step panels; `RackBuilder.tsx` the Rails step; `BoardEditor.tsx`, `PanelEditor.tsx` and `WiringView.tsx` the board editor, the Rails view and the Wiring view; `BoxEditor.tsx` the Box tab and Build your own box.
- `src/worker/`: geometry and FEA run in web workers.
- `src/slice/`: in-app slicing with Kiri:Moto: printer start code and settings (`profiles.ts`), running the engine and reading the G-code back (`kiri.ts`), Bambu's template language (`bambutpl.ts`) and the check of a printer's own start code (`startcheck.ts`).
- `vendor/kiri/`: how `public/kiri/` (the Kiri:Moto engine, its workers and printer profiles) is built from the grid-apps source.
- `boards/`, `parts/`: community boards and contributed connectors, each with a guide for people (`README.md`) and steps for an AI job (`AGENTS.md`); `scripts/boards.mjs` and `scripts/parts.mjs` turn them into `public/boards/` and `src/model/parts.json`.
- `electron/`: the desktop shell; `preload.cjs` exposes finding installed slicers and opening a plate in one.
- `.github/workflows/`: CI, and a release job that builds installers for all three platforms and publishes the web app.

Geometry uses [manifold](https://github.com/elalish/manifold) (WebAssembly), which always produces watertight, printable meshes.
