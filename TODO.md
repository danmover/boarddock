# To do

(Working note: keep usage low: few agents, few browser runs.)

What still needs doing on BoardDock, most serious first within each part. New requests go on this list first. What was on the list before v3.0.0 and got done is in `.github/release-notes/v3.0.0.md`.

One rack from v3.0.0 has been printed: the DIN rail clip worked; the release button's hole, the snap pins, the socket latch and the tongue stoppers didn't, and 3.1.0 changes them. Nothing from 3.1.0 has been reprinted, so anything below about fit, strength or clips is from the model and its checks, not from a real print.

## 1. Needs a print, a real board or a real screen

- Reprint with 3.1.0: the release button through its hole, the socket latch's hold (a 20 N pull), the tongue's crush ribs (they replace the anti-rattle leaves and the stop post), the spring clips, hairpins and ledge on a real board, the cable-tag saddles on their zip ties, the back-to-back rivet clip. Still untried from before: the peg fit and crush ribs of a J-Link + adapter column, the long release rod, the slot for an unclippable board, the tongue under a column.
- The user's own Allegro board through KiCad: which parts still come in as Custom connector, and what KiCad keeps as footprint name and value from an Allegro symbol (the names were checked only against KiCad's library and naming guides). The USB-serial adapter's male pins against the jumpers' female ends: confirm with the user where they saw female sockets.
- The 3D view on a real GPU: the translucent cables and the power streaks (headless software rendering showed them only as dots), Live off hiding the streaks straight away, and the page freezes (import, first 3D view, adding a hub with the 3D view open: measured 29 Sep on software rendering, not profiled on a GPU; builds are now cached).
- "Wires bend unnaturally, all of a sudden" (seen in v0.2.0): two likely causes found (bends clamped to half of each short leg at corners; settling used to cut corners across streets, now kept to the planned path). Needs a repro from the user.
- The optional Claude job for `boards/` and `parts/` pull requests has not been run (it needs the repository's `ANTHROPIC_API_KEY` secret and a `boards` or `parts` label).

## 2. Open, in code

- Severity 2: two boards that mate on a board-to-board connector aren't one stack; put them in one by hand (Rails › Stacks › Stack on…), with the mated height (Samtec QSH about 5 mm, Hirose DF40 about 1.5 mm).
- Severity 2: connector sizes still typical, with no public drawing found: M.2 socket, PCIe slot depth and height, full-size DIMM, pogo pads, M12, RCA, DisplayPort, mini HDMI, Qwiic, and every connector's plug (`{w,h,len,cable}`). The makers' sites are blocked by this environment's network policy; KiCad's library (a public GitHub clone) was the source for the rest.
- Severity 2: not recognised yet: DIN 41612 backplane connectors (no type), Switchcraft, Hirschmann, Lumberg and Keystone jacks, Deutsch DTF, JAE MM70, card-edge bus footprints. Each can go in as a line in `parts/`.
- Severity 2: cable bundles: cables that run together are laid parallel and spaced, but there is no zip-tie geometry or bundle in the shopping list.
- Severity 2: tight bends where short legs meet at corners (1 to 2 diameters). A bend penalty and slanted corners both made the Pi cluster much worse and were taken out.
- Severity 1: collisions left (`npm run collisions`, 144 racks): cable into cable where two cross in a street (Pi cluster 9 mm³), a debug ribbon brushing a jumper on the dual-MCU example (1.2 mm³), a stacked board's standoffs, the stacking pegs' crush ribs (by design).
- Severity 1: not reproduced, may be gone: the hub cable "runs into the USB charger holder" on the 12-board rack, jumpers 0.4 to 1.1 mm into their own adapter's holder or plugs.
- Severity 2: a second J-Link for one board needs a 250 mm ribbon (two J-Links stand 95 mm; the PETG tongue carries 84.5). The Debug panel says to buy 30 cm.
- Auto-arrange: rails about 14 % longer in the balanced goal (Compact reverses it); its quick cable model misses some clashes (the real-router check catches them); sharing a probe column between neighbouring boards; "easy to reach" for displays (no board data); the deep confirm (build both candidates) isn't reachable from the button; a board with a debug header may be turned so a probe column can't go behind it later.
- Dock: the spring clips don't flex in the assembly animation (they are part of the holder: flexing needs them as separate parts); the DIN plate's slots print as 14.4 mm bridges (printing the plate on its face needs a joint to the holder); fit a cap only where the pull comes out of the cradle's open side (needs the cable direction at holder time); the Pico's holder lying flat on its top edge has a 4.5 mm overhang.
- Layout lock: locked docks aren't marked in the Rails drawing.
- 3D: jumper wires and a USB-serial cable's loose ends have no flow (signal only).
- Community boards: the worked example shows next to the built-in "Example: sensor board", the same board; hide it once a real community board is in (the tests use it).
- Not checked since the second round (agents were on them before): the headline print time estimate, the L-shape spacing defaults, per-plate control, bulk tools for identical boards (Copy to… covers part of it), toast wording.

## 3. Found along the way

Each: how bad (1 to 5), what's wrong, where, and how it was seen.

- 2 · The DIN clip's shoe pull-off: with the slit roots rounded, PETG reaches 2 % strain at about 130 N centred and 87 N on one hook; the fixed hook's finger is now first, at the edge of the rigid support the model holds it by, so the reading may be the model's (`src/fea/dockfea.ts`, `docs/din-clip-review.md`).
- 1 · The Nano's 8 mm hairpin pair (docked, and lying flat) reads 0.85 fatigue margin in the FEA, a little under 1 (`src/fea/springfea.ts`).
- 2 · Nothing clips a USB-serial adapter (docked or flat), a round board of about 20 mm lying flat, or a board docked on an edge crowded with plugs: the Check step says so (`src/cad/grip.ts`, found by `tests/clipsauto.test.ts`).
- 2 · The rail grip (`railGrip`, `GRIP` in `src/cad/dockdims.ts`) is a pad under a permanent 0.35 mm preload, about 1.0 % at rest against the 0.2 % rule; it can't meet the rule and still hold the clip, so it isn't in the flexure table.
- 1 · Once-only press fits kept outside the flexure table: the stacking tower pegs' 0.15 mm crush ribs, and the stand socket's optional Press fit.
- 1 · The Nano's 8 mm hairpin is over the limit in PLA (fine in PETG).
- 2 · KiCad "New version": a 0.8 mm connector move on the example board caused an overlap; the warning shows, but why the imported bodies overlap was never found.
- 1 · `npm test` takes about 6 minutes, most of it building holders and racks.
- 1 · The printed guide's pictures have no cable numbers: the numbers are drawn over the 3D view, not in it (`src/ui/Viewer3D.tsx` stepPictures).
- 1 · `public/kiri/kiri-engine.js` needs `document` when it loads, so it can't run under plain Node without stubs.
- 1 · The clip FEA (`src/fea/clipfea.ts`) still reports raw corner peaks; the dock FEA averages 3 × 3 pixels.
