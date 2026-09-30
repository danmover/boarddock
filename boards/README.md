# Community boards

Boards added here appear in BoardDock's library (Start page and **Add a board**, under **Community boards**, after the built-in ones), so anyone can add yours to a rack without drawing it.

## What to upload

One folder per board, `boards/<slug>/`. The slug is the board's id: lower case, digits and dashes (`acme-sensor-v2`). It holds:

1. **Your board's files.** One is enough; BoardDock reads the one that tells it most.

   | You have | Upload |
   |---|---|
   | KiCad | the `.kicad_pcb` (best: outline, holes, part sizes, pin names) |
   | Allegro / OrCAD | open it in KiCad 10 (File > Import > Non-KiCad Board File), save, and upload the `.kicad_pcb` |
   | Altium, PADS, Xpedition, others | IPC-2581 `.xml`, or ODB++ (`.tgz` or the job folder), or GenCAD `.cad`, or IDF `.emn` + `.emp`, or Gerbers (outline layer) + NC drill + pick and place |
   | Eagle / Fusion | the `.brd` |
   | only a drawing | a `.dxf` of the outline (holes from round cut-outs) |

   A STEP file works in the app but not in `npm run boards` (it needs a browser): add one of the above too.
2. **`board.json`**, a few lines about the board (below).

Only upload what you may share. Say in `board.json` where it comes from and under what terms.

## board.json

```json
{
  "name": "Sensor board with JTAG (worked example)",
  "maker": "BoardDock contributors",
  "url": "https://github.com/danmover/boarddock/tree/main/examples",
  "license": "MIT",
  "source": "A made-up board that ships with BoardDock."
}
```

`name`, `maker`, `url`, `license` and `source` (a note on where the files came from) are shown with the board. Give `license` or `source`, and `maker` or `url`. Everything else is a hint, only for when the report (below) says something is wrong:

```json
{
  "parts":      { "J3": { "type": "usb_c" }, "J7": { "type": "custom", "note": "Wurth 61300811121" } },
  "footprints": { "USB_C_Receptacle": "usb_c" },
  "holes":      { "use": [[3.5, 3.5], [66.5, 3.5], [10, 40, 3.2]], "ignore": [[35, 20]] }
}
```

| Hint | Meaning |
|---|---|
| `parts.<ref>.type` | what part `<ref>` really is: a connector id (`npm run boards -- --types` lists them), `none` (not a connector), or `custom` (a plug the library has no entry for: put its part number in `note`) |
| `parts.<ref>.angle`, `.size`, `.hide` | which way its plug comes out (0 right, 90 top, 180 left, -90 bottom; found from the nearest edge if left out), its `[width, depth, height]` in mm, or leave it out |
| `footprints.<regex>` | the same connector id for every part whose footprint name matches |
| `holes.use` | exactly these are the mounting holes, as `[x, y]` or `[x, y, diameter]` (one the file lacks is added); positions are the ones the report prints, in mm from the board's lower left |
| `holes.ignore` | holes to leave alone |
| `thickness`, `notes`, `files`, `copper`, `listed` | board thickness in mm, extra notes for the app, which files to read, keep the copper tracks (bigger file), `false` to keep it out of the app |

## Turn the files into a board

```bash
npm ci                          # once
npm run boards -- <slug>        # read boards/<slug>/, print the report, update public/boards/
npm run boards                  # the same for every folder
```

The report is what you check, for the worked example, `boards/example-sensor-jtag/`:

```
boards/example-sensor-jtag: Sensor board with JTAG (worked example) (KiCad: sensor-jtag.kicad_pcb)
  outline     70 x 45 mm, 4 corners, 0 cut-outs, 1.6 mm thick
  holes       4 found, 4 to mount by
    (3.50, 41.50)    d3.20  mount    Ø3.2 near a corner: a mounting hole
    ...
  connectors  3
    J1       usb_micro_b  edge -180° by name        USB_Micro-B_Molex-105017-0001
    J2       jtag20       top       by name        IDC-Header_2x10_P2.54mm_Vertical
    J3       header       top       by name        PinHeader_1x04_P2.54mm_Vertical
  result      ok
```

Does the outline match your board? Are the mounting holes the right ones, and no others? Is every plug the right kind (a `NOT IDENTIFIED` one is a **Custom** connector: fix it with a `parts` hint)? Fix, run again, until it says `ok` with no `WARNING` lines. The script exits with an error (and writes nothing) only when a board can't be read or `board.json` is wrong. `--dry` only reports, `--strict` also fails on warnings, `--check` fails when `public/boards/` is out of date.

Then `npx vitest run tests/boards.test.ts`, commit `boards/<slug>/` and `public/boards/`, and open a pull request. Two pull requests adding boards can conflict in `public/boards/index.json`: take either side and run `npm run boards` again.

## Don't want to run anything?

Open the pull request with just the folder (files and `board.json`, or the files alone). CI (`.github/workflows/boards.yml`) runs the script on it and shows the report. If the repository has an `ANTHROPIC_API_KEY` secret, a maintainer adds the **`boards`** label and an AI job follows [`AGENTS.md`](AGENTS.md) on the PR branch: it writes the hints, regenerates `public/boards/` and commits. It only runs for branches of this repository, only when that label is added (not on every push), and does nothing in forks without the secret. For a PR from a fork, a maintainer can push its branch here first, or run the steps of `AGENTS.md` locally.

## Pictures

A board without a picture shows a plain top view, so this is optional. Maintainers can render 3D pictures of all boards that lack one (needs the dev server and Playwright, see the top of `scripts/render-tiles.mjs`): `node scripts/render-tiles.mjs http://localhost:5173/ community`, then `npm run boards`.

## How it fits together

`boards/<slug>/` (source of truth) -> `npm run boards` (`scripts/boards.mjs` and `scripts/boards-lib.ts`, using the app's own importers, so what the report says is what the app would read) -> `public/boards/index.json` (one row per board) and `public/boards/<slug>.json` (the board). The app fetches `index.json` only when the library opens and a board's file only when you add it: none of it is in the main JavaScript.
