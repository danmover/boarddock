# BoardDock

**Dock any PCB. No screws. No supports.**

BoardDock turns a board's design files, or a few measurements, into 3D-printable holders that dock onto TS35 DIN rails with every plug reachable. It lays out the rails, routes and sizes the cables between the boards, checks the springs, and packs the parts onto print plates for your printer. It runs in the browser or as a desktop app for Windows, macOS and Linux. It is open source (MIT), and all sizes are in mm.

![A panel of boards on a DIN rail](docs/images/hero.png)

## Status

One rack has been printed so far, from 3.0.0. The DIN rail clip worked. The rest showed what to fix: the release button's tunnel was too tight and the button broke, the snap pins broke, the socket latch let a holder pop out (the model has it slipping at about 10 N), and the tongue stoppers snapped.

3.1.0 redesigns those parts:
- boards are held by spring clips only, with fixed ledges and hairpin clips; there are no snap pins;
- the socket latch has a hook undercut 15°, so a pull draws it in;
- the release rod's tunnel has 0.8 mm of play and a gate the rod clicks under;
- two crush ribs on the tongue replace the stoppers;
- cable tags are held on by zip ties, and back-to-back holders by a pin and a U clip.

Nothing from 3.1 has been reprinted yet, so every number comes from models. Print the test-fit kit first, and read [the known limits](docs/limits.md).

## Download

- **Web app:** [danmover.github.io/boarddock](https://danmover.github.io/boarddock). Nothing is uploaded: it all runs in your browser.
- **Desktop app:** from [Releases](https://github.com/danmover/boarddock/releases). The builds are not code-signed yet, so your system asks you to confirm the first time.
- **From source:** `npm install`, then `npm run dev` (see [Development](#development)).

| System | File | First time |
|---|---|---|
| **Windows** | `BoardDock-3.1.1-win-x64-setup.exe` (installer) or `BoardDock-3.1.1-win-x64-portable.exe` (no install) | Choose **More info › Run anyway**. |
| **macOS** (Apple Silicon) | `BoardDock-3.1.1-mac-arm64.dmg` (open it and drag BoardDock into Applications), or `BoardDock-3.1.1-mac-arm64.zip` | Right-click the app and choose **Open**. |
| **Linux** | `BoardDock-3.1.1-linux-x86_64.AppImage` (`chmod +x` it, then run it) or `BoardDock-3.1.1-linux-amd64.deb` (`sudo apt install ./BoardDock-3.1.1-linux-amd64.deb`) | Nothing. |

The desktop app does two things the browser can't: it opens Cadence Allegro `.brd` boards (with KiCad 10 or newer installed, free from kicad.org), and **Open plate** hands a print plate to a slicer you have installed.

## Quick start

You need a 3D printer and a length of TS35 DIN rail (the 35 mm metal top-hat rail from electrical cabinets, cut with a hacksaw). Or pick **Loose holders** in the Rails step and skip the rail.

1. **Start.** Drop your board's files (several at once is fine), choose **Draw your own**, or **Open a saved rack**. Pick **Your printer** above them. Click a board in the library below to add it, or press **+ Board** (or **A**) from any step. The **cluster** preset adds a Pi cluster with its switch, powerboard and supplies.
2. **Board.** Check the outline, the parts and the hole wizard. Fix anything in the board editor.
3. **Plugs.** Press **Auto-connect** to cable the rack. Tap a port's *empty* or *cable* tag to say whether you'll plug something into it yourself.
4. **Holder.** Choose a frame or a tray, a preset, and **Firm** or **Gentle** spring clips.
5. **Rails.** Every board is already on a rail. Drag, turn, pair or stack boards if you like, and lock what you want to keep.
6. **Check.** Failing checks come first, each with **Show in 3D**. Press **Run dock FEA** for your material.
7. **Export.** First print the **Test-fit kit · print this first**: a rail shoe, a socket and a tongue key with its release rod (30 to 40 minutes). Clip the shoe on your rail, push the key in until it clicks, then press its button and lift. If the key is tight, raise **Tongue fit (looser +)** under Rails › **Fit and spacing** by 0.05 to 0.1 mm. Then print the plates in PETG with no supports, or slice them in the app. The shopping list, the **Bill of materials** and the **Checklist** say what to buy and have to hand.
8. **Build it**, following the play button or **Guide** in the 3D view. Then press **Mark the rack as built** in Export.

Every step has **Back** and **Next** at the foot of the sidebar. The full walk-through is in [docs/guide.md](docs/guide.md), and printing is in [docs/printing.md](docs/printing.md).

## What it does

- **Boards.** Read a board from its design files, draw one, or pick one from the library. The board editor has a toolbox of plugs and parts, a measure tool and a photo underlay, and the hole wizard sorts every hole into mounting holes, connector pegs, part leads and standoffs. [More](docs/guide.md#the-board-editor)
- **The dock.** A rail shoe clips onto the rail; press its red lever down to lift it off. A socket snaps into the shoe in any of four turns and takes two holders back to back. The holder's tongue has two crush ribs, and a latch with an undercut hook holds it. The button on top of the holder is the head of a release rod that opens the latch. [More](docs/design.md#the-dock)
- **Holders.** A light frame (or a full tray) round each board, held by spring clips only: tapered leaves, hairpins on short stretches of edge, and a fixed ledge where plugs take most of the edges. A mounting hole gets at most a locating pin. Only the ports you use get a plug cradle, cap, guard or zip-tie anchor; the rest keep a bare opening. [More](docs/design.md#the-holder)
- **Layout.** Auto-arrange places every board for plug access and short cables: back to back, standing up or lying flat, and stacked (a HAT bolted on standoffs, a board on a printed layer, or small boards in a column on their long edges). A board below the top of a column stands with its plugs to the side; one that can't gets a **Plug up the column** check. Lock what you have placed, and automatic changes leave it alone. [More](docs/guide.md#the-rails-step)
- **Boxes, power and cables.** USB hubs, chargers, network and PoE switches, powerboards and plug packs are boxes with ports. **Auto-connect** cables the rack, every cable is routed clear of the parts and sized to a length you can buy, a power budget checks every supply, and numbered cable tags go on with 2.5 mm zip ties. [More](docs/guide.md#cables-and-the-wiring-view)
- **Stands.** Printed table stands hold the rails, with no screws. To hang a rack on a wall, screw the rails up yourself and clip the docks on. [More](docs/design.md#table-stands)
- **Checks.** Hand sums for the clips, caps, tongue and stands, 2D FEA of the dock's springs, and a layer-by-layer printability check of every part. [More](docs/design.md#checks-fea-and-printability)
- **Printing.** Parts are packed onto as few plates as your printer's bed allows, already in print orientation, as STL or 3MF, or sliced to G-code in the app. [More](docs/printing.md)
- **Coming back later.** Add a board to a built rack, and Export lists only the new parts, cables and rails. [More](docs/guide.md#coming-back-to-add-a-board)

## Supported files

KiCad; Altium through STEP or fab files; Eagle (XML and old binary boards); Cadence Allegro `.brd` in the desktop app, through KiCad 10; board-viewer files; IDF; DXF; Gerber with drill and pick-and-place; IPC-2581, ODB++ and GenCAD. Or draw a board, start from a template, or pick one from the library. Details are in [docs/files.md](docs/files.md).

## Documentation

| Page | What is in it |
|---|---|
| [docs/guide.md](docs/guide.md) | Using BoardDock, step by step: the board editor, plugs, holders, rails, stacks, boxes and power, cables, the 3D view, and adding to a built rack |
| [docs/design.md](docs/design.md) | How the printed parts work: the dock, holders and clips, stacks, table stands, cable routing, and the checks and FEA |
| [docs/printing.md](docs/printing.md) | Printing and export: the test-fit kit, material, printers, print settings and G-code |
| [docs/files.md](docs/files.md) | Supported files, and how connectors are recognised |
| [docs/limits.md](docs/limits.md) | Honest limits: what is untested or approximate |
| [docs/development.md](docs/development.md) | Commands, the collision test, tile pictures and the project layout |
| [docs/din-clip-review.md](docs/din-clip-review.md) | The DIN rail clip review, and what the first print showed |
| [boards/README.md](boards/README.md) | Adding a board to the library |
| [parts/README.md](parts/README.md) | Teaching BoardDock a connector |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Reporting a bad import, code conventions and releases |
| [TODO.md](TODO.md) | What is still to do, in order |

## Adding boards and parts

Two folders take contributions by pull request, each checked by one command:

- **`boards/`** adds a board to the library, under **Community boards**. Put its files in `boards/<slug>/` with a small `board.json` saying who made it and on what terms, then run `npm run boards -- <slug>`. Guide: [boards/README.md](boards/README.md).
- **`parts/`** teaches BoardDock a connector with one small JSON file: `names-….json` maps part numbers or footprint names to a type it has (this fixes a `NOT IDENTIFIED`), and `type-<id>.json` adds a new connector type. Then run `npm run parts`. Guide: [parts/README.md](parts/README.md).

[CONTRIBUTING.md](CONTRIBUTING.md) has the rest. A maintainer can also add the `boards` or `parts` label to a pull request, and an optional Claude job does the work on its branch ([docs/files.md](docs/files.md#adding-boards-and-parts) has the details).

## Development

```bash
npm install
npm run dev          # web app at http://localhost:5173
npm test             # vitest: importers, holders, panels, dock FEA, and a quick collision check
npm run typecheck
npm run collisions   # the whole collision test (144 racks, a minute or two)
npm run boards       # community boards: read boards/<slug>/, update public/boards/
npm run parts        # contributed parts: check parts/*.json, write src/model/parts.json
npm run build        # production web build in dist/
npm run desktop      # Electron app from the build
npm run dist         # installers for the current OS in release/
```

The collision test, the tile pictures and the project layout are in [docs/development.md](docs/development.md). Code conventions and releases are in [CONTRIBUTING.md](CONTRIBUTING.md), and what is still to do is in [TODO.md](TODO.md).

## Licence

MIT for BoardDock itself; see [LICENSE](LICENSE). Third-party components and their licences are listed in [NOTICE](NOTICE).
