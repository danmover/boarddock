# To do

What still needs doing on BoardDock, in the order it's being worked through. New requests go on this list first.

Nothing BoardDock makes has been printed and tried yet, so anything below about fit, strength or clips is from the model and its checks, not from a real print.

## 1. From the second round of test users

Done: switches' and powered hubs' DC inputs (the To do list asks for a supply; Add its supply puts the one it came with in a free outlet), What's new listing built docks as new, built docks sliding past the rail end (a new board gets its own dock; Slide and Cut steps; Check fails), the mains bar and boxes' own supplies, the idle charger (the advice says why) and the switch's uplink to your router, and where a plug pack goes in What's new and the steps. Agents are working on the start code check and the brim, and on the USB-serial jumper wires (they are drawn, but not where the header's pins are).

Still to do, most serious first:
- Pasted printer start code is trusted as the A1 mini's without checking it.
- The plate brim can land just off the bed; keep it inside the margin.
- No way to slice for an A1 mini without Bambu's files.
- The page freezes for 8 to 30 s on import, step changes, adding a hub, the first 3D view and Mark built.
- USB-serial adapter jumpers never reach the UART header.
- Loose holders drop probes into the row; docks and loose holders can't be mixed. (Partly done: a probe or adapter added from the library and cabled later now sits next to its board in a side-by-side row, as Add J-Links already did. Still to decide: where a probe should go instead of the row, say on its board's holder, and how docks and loose holders would mix.)
- Smaller things: cables beside a stand comb, an auto-connected cable through a Pi 4 holder (still there: on a rack of a Pi 4, Uno, Pico, ESP32 and the 4-port hub, Auto-connect's hub UP to Pi 4 USB2 cable "runs into the Raspberry Pi 4B holder", with or without table stands), off-rack labels crowding a big rack, toast wording, the Wiring view at 16 boards, Auto-arrange putting cabled boards on opposite rails, Forget with no confirm, the headline print time estimate, the L-shape spacing defaults, the printer not asked up front, Next not auto-connecting, Measure moving one side only, round boards' corner holes, mirrored silkscreen, bulk tools for identical boards, locking a dock or rail, per-plate control, and more wording fixes.

## 2. Started before, not finished

- Collisions left after the collision test (`npm run collisions`; baseline 339 mm³ over 140 racks, from 8272; 1 layout problem):
  - Cables where they cross under a rail or at its edge (cables into rails 154 mm³, 110 in the Pi cluster, up to 1.2 mm; cable into cable 47 mm³, up to 3.6 mm): a street is 8 mm under a rail's underside, so a 6 mm Ethernet cable has 2 mm to spare and one can't lie over another there; cables going up to a plug also pass through a rail's lip overhang. Needs a choice: taller table stands (more headroom, more plastic, a taller rack), or keeping crossings and rises out from under the rails in the router. Tried and taken out, as each made the matrix worse: cables back to the side they were laid on, crossing beads kept further apart, and no brushing a rail's box.
  - The switch's uplink to your router (its lead leaving the rack) moved cables on two racks: the boxes rack +52.6 mm³ (a Pi 4's power and Ethernet cables crossing under rail 1, 3.2 mm deep) and the busy rack +3.3 mm³. Baseline updated with it; the crossing is the one above.
  - Cable tags where no spot along a crowded cable is clear (80 mm³ in 6 racks, most in the probes and back-to-back racks).
  - The one real route clash: on the columns rack the Mega's cable goes into the Nano's USB plug.
  - Small: a cable into a plug (16 mm³, 2 racks), into a dock's release lever (3.6), a stacked board's standoffs into the board parts under them (4.2). The stacking pegs' crush ribs press 0.3 mm³ each, by design, and are still counted.
- Tight cable bends where neighbouring plugs' cables bend the same way.
- The spring clips flexing in the assembly animation.
- The DIN plate slots on rack and inline mounts: a plate printed on its face.

## 3. From the first round of test users

- Jumper and debug ribbons routed straight over the dock.
- A 12 V pack auto-connecting to boards with a known DC input range (Uno, Mega).
- Explain why there's no wall mount (BoardDock uses no screws).
- The 4-pin UART pin names are a guess: say to check yours.

Ideas: a cluster preset, isolate or X-ray the selection in 3D, a command palette, a debug bench sheet, a live buy/print/tools checklist, What's new highlighted in 3D, mains and low-voltage zones, a layout lock with change receipts.

## 4. Plug protection

Check each cradle and cap prints well in every orientation, and fit a cap only where the pull comes out of the cradle's open side.

## Also from the test users

### From the second round, not listed above

1. Cable tag rings float in mid-air in the assembly animation before their cable is drawn. Show each one only once its cable reaches it.
2. Loose-holder view: after "Side by side" the camera doesn't frame the row (nor do the Top/Front/Side presets), and stub labels pile into a band that blocks clicks. Refit the camera, combine labels per holder ("→ hub ×4"), fade them when zoomed out, and let clicks pass through labels.
3. Off-rack stub labels are hidden behind boards, and show "to a computer" although nothing is wired. Draw them on top, keep them apart, and show a label only for a real cable. (Done: the empty socket of a stacked pair, a Pi's USB-A, no longer gets a plug and a lead "to a computer" when its mate is cabled. Left: labels drawn on top and kept apart.)
4. Auto-arrange leaves hubs and a Pi Zero on long cables from their host: weight host-to-device links so they dock beside it. Show Auto-connect's reason ("USB gadget networking: the Zero has no Ethernet") in the Cables list.
5. Leads from plug packs on the rack's own powerboard are drawn "off the rack": route them from the outlet, and check the fixed 1.2 m lead against the route.
6. Pairing back to back only works by HTML5 drag (fails on touch). Add "Share a dock with… / Put behind…" to the 3D mounting row and the Rails list's empty back slot, and use pointer events for the list drag.
7. "Add a USB hub" picks a 7-port hub for 9 plugs and quietly sends 2 "to a computer". Size the offer to the need and say where the overflow went.
8. After boards are added, a "Complete this rack" card: a supply for each Pi, outlets needed vs the powerboard's size, a switch when there are 2 or more Ethernet boards, and an uplink. All in one undo step.
9. Check's "to look at" items: give each a verdict ("OK to print" / "worth a look") and a fix button where one exists, and group repeated Tongue root lines with a count. Prefer spring clips where "Hold: Auto" picks snap pins that end up in this list. Drop the standoff notice for library templates (or fix the Uno template).
10. On Start, the multi-pick "+" only shows on hover (nothing to tap on a phone): show it at rest or as a quantity stepper, and let the count be typed.
11. Draw your own: add debug and UART header options with a pinout. Offer a J-Link for a drawn board's debug header, list headers without a probe on Plugs, and make "Add J-Links" cover every board.
12. (Done, not seen in a real browser: Measure popup checkbox, focus and place.)
13. (Done: whole titles toggle the DIN rail clip and stand socket.)
14. The Rails canvas and list mislabel docks: say "lies flat, tab on its bottom edge" and "standing, parts face front", and show "mixed" when docks differ.
15. On a phone, a selected mains cable's panel is cut off. Wrap it, and add the length, plug types, outlet name and a "switch off before plugging in" note.
16. After importing several files, stay on Start with a "Check the boards" button.
17. (Done: the Board step opens on the first board.)
18. What's new says to seat a plug-pack supply "in its holder … into its dock": say to plug it into outlet ACn, switched off, and run its lead to the board. Have "Also print" say what each part is for.
19. After adding to a built rack, the message should say where each new board went.
20. Steps: an "only what's new" mode that plays just the since-built checklist on the existing rack.
21. (Done: the shopping list counts straps only for boxes in a holder on the rack.)
22. Print settings say "Brim: none" but the in-app slice lays a brim: make them agree.
23. Once the start code is known, the main Export button should be "Slice and download all G-code" (in the background, zipped), and the G-code should go in "Download everything".
24. Layout toggles and Check are slow on a 16-board rack (switching back to Stand up took 39 s): cache each layout choice's result, and show progress while it works.
25. Ideas: a typed rotation with 15/45/90° snaps; "Copy to… [boards]"; a Debug panel on Plugs listing each probe's header, ribbon length and slot; a PoE switch and "powered over PoE"; one length for all RJ45 leads; a colour per cable kind.

### Left over from the first round of fixes

1. A "pack new boards only" Auto-arrange option: lay out only boards not yet placed, and leave the rest where they are.
2. KiCad "New version": a 0.8 mm connector move on the example board caused an overlap. The warning now shows, but why the imported bodies overlap was never found.
3. At 375 px wide, a label pill wider than its board is clipped at the edge of the Rails view.
4. (Done: the perfboard reminder ticks itself off when a hole is edited.)
5. Wiring view: move length badges out from under cards, and put a dropped card in a free spot.
6. On phones, hint text still talks about clicking and hovering: use touch wording.
7. Links can end at the virtual "@pc" (your computer): check that everything looking up a link's board uses findModule, not p.modules.find (boardviz, assembly and the exporters in particular).
8. Make sure Plugs › "Cables to buy" uses the same wording and lengths as the shopping list (buyText).
9. (Done: the Add a board window keeps focus inside and gives it back.)

## Found along the way

Each: how bad (1 to 5), what's wrong, where, and how it was seen.

- 2 · The route check says "The USB-serial adapter USB to Powered USB hub P5 cable runs into the USB charger holder" on a rack of 2 × Pi 4, Pi 5, Uno, Mega, Pico, Nano, ESP32, 7-port hub, 4-port charger, J-Link and USB-serial adapter with Auto-connect and Longest rail 300 mm (standing or lying flat). Cable routing, `src/cad/panelgen.ts`. Seen in a scratch test of that rack.
- 1 · `npm test` takes about 160 s, most of it building holders and racks (the collision test's quick racks add about 30 s).
- 2 · Top-entry plugs (a debug header) got their zip-tie anchor on the nearest wall with no other check; one sat in the Dual-MCU board's dock socket. Fixed in the collision work (`src/cad/generate.ts` tieAnchor). Seen with the collision test.
- 1 · A picked anti-rattle spring was named "spring clip" in the 3D view's panel. Fixed (`src/ui/pickOps.ts`). Seen while tagging the springs for the collision test.
- 3 · Loose layout builds a holder with strap loops for a plug pack (elsewhere a plug pack never gets a holder), so the 3D model and the shopping list disagree. `generateLoose` in `src/cad/assembly.ts` has no `isPlugPack` check. Seen by the small-fixes agent on a loose Pi 5 rack with a 27 W supply.
- 2 · The loose assembly steps say to strap a plug pack down (same cause, `src/cad/assembly.ts` around line 197).
- 2 · The relay board template's relays are drawn as a metal can on a green slab, not the blue relay the toolbox gives (they are tagged as modules, and the module look is checked first). `src/model/templates.ts` relay4, `src/cad/boardviz.ts` partDetail. Seen by the toolbox agent in the relay board's Start tile and Parts pictures.
- 2 · The SMA edge connector is drawn as a square metal box with a square opening, not a round threaded barrel, and the figure-8 mains socket as a plain rectangle. `src/cad/boardviz.ts` partDetail, generic connector branch. Seen by the toolbox agent in the toolbox tiles and the 3D view.
- 1 · Female pin sockets (the Uno's J_DIG and J_ANA) are solid black bars in 3D with barely visible holes, while the board editor draws rows of gold pins. `src/cad/boardviz.ts` header branch against `src/ui/BoardEditor.tsx`. Seen by the toolbox agent in the Uno's Parts list and the editor.
- 2 · The bill of materials gave each same-named printed part its own line ("Release rod + button" twice, 1 each; two Pi 5 holders on two lines). Fixed (`src/model/bom.ts`: one line a name, weights as a range when they differ). Seen in the printed build guide.
- 1 · The printed guide's pictures have no cable numbers: the numbers are drawn over the 3D view, not in it. `src/ui/Viewer3D.tsx` stepPictures. Seen in the printed guide of a rack with cables.
- 3 · The Tag-Connect footprint's 3D model was an inside-out box, and on any board with one it emptied every black part from the 3D view (jack bodies, JST housings, debug header shrouds). Fixed by the toolbox agent (`src/cad/boardviz.ts`: a shape that fails is left out on its own). Seen comparing the toolbox pictures with the 3D view.
- 1 · Two boards of the same kind give the same advice line twice, word for word ("Raspberry Pi 4B: its GPIO is for wires you connect yourself"). `src/model/links.ts` portBudget's unwired list and wiringAdvice. Seen in the advice for a rack of two Pi 4s.
- 2 · The Wiring view's To do list gave a port too weak to power a board as its "best" (a Pi 4's power from the other Pi's USB-A port). Fixed (`src/ui/WiringView.tsx`: it says no free port gives enough). Seen trying the switch's supply in the browser.
- 2 · A barrel jack's best match was a Pi's GPIO header (a DC input could be cabled to any header's pins). Fixed (`src/model/links.ts` refusal: a barrel jack takes a supply's plug or a pigtail to screw terminals, never header pins). Seen in the same To do list.
- 3 · A holder rattles in its socket: 0.32 mm of lift before the latch catches, ±0.16 and ±0.22 mm across, and nothing preloads it. `src/cad/dock.ts` tongue and socket. Measured by the DIN clip review (sliding the tongue until it met the socket); see `docs/din-clip-review.md`.
- 3 · The narrow-slot check ignores gaps whose sliver per layer is under 0.15 mm², so a 0.09 mm print-in-place gap went unseen. `src/cad/printcheck.ts` (`gaps`, `ga < 0.15`). The shoe's old lever passed the check while its gap to the neck measured 0.09 mm.
- 2 · The shoe's pull-off FEA holds the whole shoe body and only analyses the jaw side: the fixed hook's floor and the 1 mm wall beside the socket's hook slit are never checked. `src/fea/dockfea.ts` (the fixity `x < 14.6 && y > 7.0`). Read by the DIN clip review.
- 2 · Dock FEA peaks move about 7 % when the pixel grid's origin shifts (adding geometry below the hook moved the pull-off limit from 121 to 113 N). `src/fea/fea2d.ts` `meshPolygons`. Seen when the rail grip went into the shoe's FEA mesh.
- 2 · The shoe's release lever can lift 13.5° from rest (its pad rises about 3 mm) before its hub meets the neck, so a nudge may bring it against a holder above it. `src/cad/dock.ts` `SHOE_LEVER.open`. Seen in the DIN clip review's lever sweep.
