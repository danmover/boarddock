# Contributed parts

Teach BoardDock a connector it does not know. Two kinds of contribution, each **one small JSON file** in this folder:

| You want | You add | Result |
|---|---|---|
| A board's report says `NOT IDENTIFIED` (or the app makes a part a **Custom** connector) but it is really an RJ45, a USB-C, a JST... | **names**: `parts/names-<anything>.json` | that part number or footprint name is recognised, on every board, from then on |
| A connector the library has no type for at all | **a new type**: `parts/type-<id>.json` | it joins the connector list, and the toolbox (board editor) under **Contributed** |

Everything is checked by one command, `npm run parts`, and written (compact) to `src/model/parts.json`, which is all the app reads. The app stays small: with nothing contributed the data is a few bytes, and a name costs about as much as its own text.

## Names

The quickest way to teach recognition: part numbers or footprint names, mapped to a connector type the library already has.

```json
{
  "type": "rj45",
  "names": ["ACME-ETH-1A1", "ACME-ETHJ-*"],
  "weak": ["Acme jack"],
  "source": "Acme datasheet ACME-ETH-1A1 rev C, page 2"
}
```

| Key | Meaning |
|---|---|
| `type` | a connector id: `npm run parts -- --types` lists them (`usb_c`, `rj45`, `jst_ph`, ...) |
| `names` | part numbers or footprint names. They count anywhere in a part's footprint or value, as a whole word, in any case, with `-`, `_` and space alike. `*` stands for any characters, `?` for one: `HFJ11-*` is every HFJ11 part |
| `weak` | plain words that name the connector but could name a chip too (`Ethernet`, `HDMI`): they count only when the part's reference says connector (`J1`, `CN2`, `HDMI1`), and never over the library's own reading |
| `pins`, `rows`, `pitch` | optional: for the connectors whose width follows their contacts (JST, Molex, box headers, FFC): this many contacts (in 1 or 2 `rows`) `pitch` mm apart, so the body is as wide as that. The report warns when a type ignores them |
| `note`, `source` | free text for people: where the name comes from |

A file is one object like this, or a list of them (several types in one file). The file name is `names-` and anything you like (`names-molex.json`, `names-my-board.json`).

**A plain word is refused.** A name that is a single bare word (`HDMI`, `Ethernet`, `SMA`, `PJ-*`) also names chips, diodes and modules (`TB6612`, an `SMA` diode package), so it is refused as a name; put it under `weak`, or give a real part number or footprint name. Names shorter than four characters, bare short numbers, and any name that would also match one of the parts known to be no connector (`tests/connector-names.tsv`, rows marked `-`) are refused too. Names the library already recognises are warned about (not needed), and the same name for two types is an error.

## A new type

For a connector no type fits: an id, a size, its plug, how it is wired, and a look.

```json
{
  "id": "jack635",
  "label": "6.35 mm (1/4 in) audio jack",
  "plugName": "6.35 mm plug",
  "entry": "edge",
  "body": { "w": 14, "l": 20, "h": 12 },
  "plug": { "w": 16, "h": 16, "len": 30, "cable": 6 },
  "tht": true,
  "role": "audio",
  "offRack": "to an amplifier or an instrument",
  "look": [
    { "box": "black", "from": [0, 0, 0], "to": [1, 1, 1] },
    { "mouth": "round", "at": [0.5, 0.5], "size": [0.62, 0.62], "depth": 0.8 },
    { "barrel": "metal", "at": [0.5, 0.5], "d": 0.7, "y": [0.85, 1], "bore": 0.87 },
    { "pins": "gold", "n": 1, "pitch": 1, "d": 1.4, "at": [0.5, 0.2, 0.5], "len": 0.45, "axis": "y" }
  ],
  "names": ["ACME-J635-*"],
  "weak": ["6.35 mm jack"]
}
```

The file is `type-<id>.json` (`type-jack635.json`). Both examples are in [`examples/`](examples/) and are checked by the tests; they are not part of the app.

| Key | Meaning |
|---|---|
| `id` | lower case letters, digits and `_`, not one the library has |
| `label` | its name in the toolbox and in lists |
| `plugName` | its mating plug in a few words (default: the label) |
| `entry` | `edge`: the plug goes in through the board edge (the toolbox puts it on the nearest edge, facing out); `top`: the plug goes in from above |
| `body` | the receptacle in mm: `w` across the mouth, `l` along the way the plug goes in, `h` above the board. The toolbox and the 3D model are this size |
| `plug` | the mating plug in mm: `w` across, `h` up, `len` along the way in, `cable` its lead's thickness. The holder is made to clear it |
| `zc`, `overhang` | optional: the height of the plug's axis above the board (default half the body's height), and how far the body hangs over the board edge |
| `tht` | through-hole (default false) |
| `role` | how it is wired: `net` like an RJ45, `usb` like USB-C, `power` like a DC jack, `audio`, `video`, `mains-in`, `wire` like a terminal block, or `other` |
| `offRack` | where its lead goes when it leaves the rack ("to an amplifier"); a default per role |
| `cradle`, `note` | optional: a holder cradle for the plug (default off), a sentence shown with it |
| `names`, `weak` | optional: the names that identify it, as above |
| `look` | how it is drawn: 1 to 12 shapes (below). Leave it out and it is drawn as a plain connector: a metal housing with a dark mouth |

**A look** is built from four shapes. Every position is a **fraction of the body**: x across the mouth (0 left, 1 right), y along the way the plug goes in (0 the back, 1 the mouth end), z up (0 the board, 1 the top). Later shapes are drawn over earlier ones.

| Shape | Keys |
|---|---|
| `box` | `{ "box": "<material>", "from": [x, y, z], "to": [x, y, z] }` |
| `mouth` | `{ "mouth": "rect" or "round", "at": [x, z], "size": [w, h], "depth": d }`: an opening in the front face (y = 1), cut into every shape before it; `size` as fractions of the width and height, `depth` a fraction of the length |
| `barrel` | `{ "barrel": "<material>", "at": [x, z], "d": d, "y": [from, to], "bore": b }`: a round barrel along y; `d` a fraction of the smaller of width and height, `bore` (optional) the hollow's diameter as a fraction of it |
| `pins` | `{ "pins": "<material>", "n": n, "pitch": mm, "d": mm, "at": [x, y, z], "len": l, "axis": "y" or "z" }`: a row of `n` square pins `d` mm wide, `pitch` mm apart across the width, centred on x, each starting at [y, z] and running `len` (a fraction) along its axis (`z`: standing up, the default) |

Materials: `metal`, `black`, `gold`, `white`, `blue`, `red`, `yellow`, `tin`, `chip`.

The shapes together must **fill the body** (the toolbox says it is w x l x h): the check tells you when they reach only 12 of its 14 mm across, or stick out of it. Start with a `box` from `[0, 0, 0]` to `[1, 1, 1]`, cut the mouth, add what is inside or on it.

## Turn the files into data

```bash
npm ci                          # once
npm run parts                   # check every file in parts/, print the report, write src/model/parts.json
npm run parts -- --types        # the connector ids, wiring roles and materials you may use
```

The report says what each file does, with `WARNING` and `ERROR` lines, each saying what to write instead:

```
parts/examples/type-jack635.json
  jack635    6.35 mm (1/4 in) audio jack: on an edge, 14 x 20 x 12 mm, wired as audio, look of 4 shapes
    name  ACME-J635-*
    weak  6.35 mm jack
```

An error stops it (nothing is written). `--dry` only reports, `--strict` also fails on warnings, `--check` fails when `src/model/parts.json` is out of date.

Then `npx vitest run tests/parts.test.ts tests/connector-names.test.ts`, commit `parts/` and `src/model/parts.json`, and open a pull request. Two pull requests adding files can conflict in `src/model/parts.json`: take either side and run `npm run parts` again.

To see it: `npm run dev`, then in the board editor open the toolbox: a new type is under **Contributed**, and a name shows up when you import a board (or run `npm run boards`: the connector is no longer `NOT IDENTIFIED`).

## Don't want to run anything?

Open the pull request with just the file. CI (`.github/workflows/boards.yml`) runs the check on it and shows the report. If the repository has an `ANTHROPIC_API_KEY` secret, a maintainer adds the **`parts`** label and an AI job follows [`AGENTS.md`](AGENTS.md) on the PR branch: it fixes the file, regenerates `src/model/parts.json` and commits. It only runs for branches of this repository, only when the label is added, and does nothing in forks without the secret.

## Pictures

A contributed type needs no picture: until one is rendered the toolbox shows a plain drawing made from its look. Maintainers render 3D ones together with the built-in parts (`node scripts/render-tiles.mjs`, see the top of that file), which also picks up contributed types.

## How it fits together

`parts/*.json` (source of truth) -> `npm run parts` (`scripts/parts.mjs` and `scripts/parts-lib.ts`, using the app's own library, so a warning about a name the library already knows is true) -> `src/model/parts.json` (one line per group of names and per type) -> `src/model/contributed.ts`, which `guessPackage` (names), the connector library and the toolbox (types), wiring (`role`, `offRack`) and the 3D drawing (`look`, `src/cad/lookdraw.ts`) read. It is compact rather than lazily loaded because footprint recognition runs everywhere (import, the workers, this command): if the data ever grows past a few tens of kilobytes, that is the time to make it lazy.
