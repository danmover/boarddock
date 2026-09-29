# To do

(Working note: keep usage low: few agents, few browser runs.)

What still needs doing on BoardDock, in the order it's being worked through. New requests go on this list first.

Nothing BoardDock makes has been printed and tried yet, so anything below about fit, strength or clips is from the model and its checks, not from a real print.

## 0. Most important (from the user, 29 Sep, on v0.2.0)

- **Connectors on imported boards come in as "Custom connector"** (the user's Allegro board, through KiCad). Named by the user: SHF-110-01-L-D-TH (a J-Link plug: Samtec 1.27 mm 2 x 10, the 20-pin Cortex debug connector), 5745781 and 5745781-4 (TE D-sub, 9-way, right angle), TSW-110-07-L-S (Samtec 2.54 mm pin header, 1 x 10), 3020-10-0200-00 (CNC Tech 10-pin shrouded header), MC000046 and A829-1A1T-91B (not yet known what they are), "and a bunch of others". Also: **the DC barrel jack's behaviour is broken** (how, still to find out). (Done: connectors known by their pins when their names say nothing; SHF-110 as the 20-pin Cortex debug connector a J-Link plugs into, TSW-110 as a 1 x 10 pin header, 5745781 as a D-sub, which is a new connector type, as is the 20-pin 1.27 mm Cortex one; D-subs known by their staggered pins. Then: a much longer list of connectors by name and part number (A829-1A1T-91B is a Bel RJ45 MagJack, 3020-10-0200-00 a right-angle box header, 502352-0200 a Molex DuraClik side-entry socket, PPTC122LFBN-RC a Sullins 2 x 12 socket, PBC03SAAN and PEC02SAAN Sullins headers, PJ-102AH a CUI DC jack, and micro-USB by Molex, Amphenol, Hirose… part numbers), 18 new types each with its own 3D model and plug (DisplayPort, RJ11, RCA, SD, BNC, u.FL, XT30/XT60, FFC/FPC, box headers upright and right-angle, JST-GH/ZH, PicoBlade, KK/fan, Micro-Fit, Mini-Fit, side-entry wire-to-board), sized for their pins; the barrel jack's bore now lines up with its plug (it was drawn 1 mm low). Wiring for them: DisplayPort cables to HDMI or DisplayPort (video), RCA to audio, a box header to another (drawn as a flat ribbon) or to pins, a JTAG-named box header takes a J-Link; leads off the rack say where they go (a BNC "to a scope or instrument", XT60 "to its battery", not "to its power supply" as any unknown plug did); a JST or other small socket whose nets are TX/RX is a UART port; a header with GND and TX by net and one other signal ("FDX") takes an adapter, that pin as its RX (flagged to check). Left: MC000046 (not known what it is), the barrel jack's behaviour (still to find out how it is broken), and whatever the user's board still shows as custom. The user says UART adapters show female sockets where they should have male pins: the adapter's own model has male pins, so this is probably the jumper wires' female ends drawn over them in the rack (right for real jumpers); confirm with the user where they see it, and settle it in the adapters-as-boards work below.)
- **USB-serial adapters and J-Links as ordinary boards, in stacks.** Agreed 29 Sep:
  - A J-Link and a USB-serial adapter are ordinary boards with their connectors (USB, the 20-pin debug header, the adapter's 6 right-angle pins), docked and cabled like any other board: no longer boxes that go in the back slot of their board's dock (`probeSlots` / `extraCompanions` in `src/cad/dockplan.ts`, `isProbe` / `isAdapter` in `src/model/probes.ts`). Old projects' probes and adapters are turned into boards when they load (`migrate` in `src/model/library.ts`).
  - Small boards (up to about a J-Link's size) stack in a column: each lies on its long edge (longest side along the rail, middle side upright, thickness out from the wall), the next one on top, like bricks.
  - Auto-arrange stacks a board's J-Links and adapters in one column next to it; by hand, "Stack on…" puts any small board on another's stack and "Take off the stack" lifts it off.
  - Each holder sits on the one below on pegs and lifts straight off; the release rod runs down through every holder, so pressing it on the top one frees the whole stack from the rail.
  - Needs: tests (placement, stacking and unstacking, rod through every level, migration), the collision matrix and its baseline, README, and saying plainly that none of it has been printed.
- **Wires bend unnaturally, all of a sudden.** Seen in v0.2.0; where and on which cables still to find out.

## 1. From the second round of test users

Done: switches' and powered hubs' DC inputs (the To do list asks for a supply; Add its supply puts the one it came with in a free outlet), What's new listing built docks as new, built docks sliding past the rail end (a new board gets its own dock; Slide and Cut steps; Check fails), the mains bar and boxes' own supplies, the idle charger (the advice says why) and the switch's uplink to your router, and where a plug pack goes in What's new and the steps. The start code check and the brim are done too (by an agent). The USB-serial adapter's jumper wires reach the UART header now (a board's holder was cached without them; the adapter's right-angle pins were drawn upright; wires doubled back over their housings or went through a board facing along the rail; tag rings went through the outer wires). Also done from the smaller things: Forget (Undo for My boards, a question on a built rack), Measure (choose which end moves), round boards' corner holes (Add corner holes put none on a round board) and Next from Plugs connecting a rack with no cables, the printer asked up front (on Start, kept for new racks), and off-rack labels no longer pile up on a big rack (the nearest show; the rest come as you zoom in). 

Still to do, most serious first:
- The page freezes for 8 to 30 s on import, step changes, adding a hub, the first 3D view and Mark built. (An agent is measuring and fixing it.)
- (Decided, 29 Sep: slicing for an A1 mini stays with pasting your own slicer's start code, no start code of BoardDock's own. Probes among loose holders stay next to their board in the row (done), no mixing of docks and loose holders. Mirrored silkscreen: not reproduced, dropped.)
- Smaller things left (agents are on these now, one each): toast wording, the Wiring view at 16 boards (fits at 22 %, unreadable: the boxes and supplies make one long row; its Connect all button's icon was stretched, fixed), Auto-arrange putting cabled boards on opposite rails, the headline print time estimate, the L-shape spacing defaults, bulk tools for identical boards, locking a dock or rail, per-plate control, and more wording fixes. (Done: Forget, Measure, round boards' corner holes, Next connecting the rack; and the auto-connected cable through a Pi 4 holder is gone: on that rack of a Pi 4, Uno, Pico, ESP32 and the 4-port hub, with or without stands, Auto-connect's cables no longer run into anything.)

## 2. Started before, not finished

- Collisions left after the collision test (`npm run collisions`; baseline 384.7 mm³ over 140 racks, from 8272; 1 layout problem):
  - Cables where they cross under a rail or at its edge (cables into rails 154 mm³, 110 in the Pi cluster, up to 1.2 mm; cable into cable 47 mm³, up to 3.6 mm): a street is 8 mm under a rail's underside, so a 6 mm Ethernet cable has 2 mm to spare and one can't lie over another there; cables going up to a plug also pass through a rail's lip overhang. Decided (29 Sep): router changes, keeping crossings and rises out from under the rails (not taller stands); and cable management to neaten it all: cables that run together zip-tied into bundles, and anything else that tidies them. Also here: cables that run beside a stand's comb instead of in it (from the second round's smaller things). Tried and taken out, as each made the matrix worse: cables back to the side they were laid on, crossing beads kept further apart, and no brushing a rail's box.
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
- 3 · The start and end G-code for printers other than Bambu's (the Export step's own start code box, "paste your own if you trust it more") is used unchecked: no bed, temperature or other-printer check as pasted Bambu code now has. `StartCode` in `src/ui/GcodeSection.tsx`. Seen by the slicing agent reading the code.
- 2 · The default plate spacing (6 mm) is less than two brims (3.15 mm each), and the spacing box allows 2 mm, so neighbouring brims can run together. `printer.spacing` against `BRIM_OUT` in `src/cad/export.ts`. Worked out by the slicing agent, not seen in G-code.
- 2 · Changing printer in Export clears the start and end code but not loaded Bambu code; code loaded from now on is caught (it records which printer it was for), older projects' isn't. The printer `Pick` in `src/ui/panels.tsx`. Seen by the slicing agent reading the code.
- 1 · `public/kiri/kiri-engine.js` needs `document` when it loads, so it can't run under plain Node without stubs (for measuring slices in tests). Seen by the slicing agent building a measuring harness.
- 1 · A header's pin names run together on the silkscreen in 3D ("GNDCTS3V3RXITXODTR" under the Dual-MCU board's J_UART): four letters at 0.95 mm are wider than the 2.54 mm pitch. Printing them turned 90°, as boards do, would fix it (the toolbox and Start pictures would need rendering again). `src/cad/boardviz.ts`, the pin names under a header. Seen in a picture of the board from above.
- 1 · The board's name on its silkscreen can sit across a part's label ("DUAL-MCU CONTROLLER" over J1 on the Dual-MCU board): the free spot for the name is kept clear of the edge plugs' labels but not of the part labels. `src/cad/boardviz.ts` findFree. Seen in the same picture.
- 2 · With a J-Link and a USB-serial adapter lying flat, a jumper wire goes 1.12 mm (1.94 mm³) into the adapter's own holder at its far end. Cable settling, `src/cad/panelgen.ts` / `cablesim.ts`. Measured by the UART agent on `example_jtag` + J-Link + adapter; the same before its change.
- 2 · Four boards lying flat: one jumper wire goes 0.67 mm (0.53 mm³) into the adapter's own mini-USB plug. Jumper route and settling. Measured by the UART agent.
- 1 · A Pi 4's GPIO marked as UART, standing: a wire goes 0.4 mm (0.13 mm³) into the J_PWR plug cap as it crosses the board. Jumper route. Measured by the UART agent.
- 2 · A pin socket (a female header, e.g. the Mega's J_IO) marked as UART gets female Dupont housings drawn on it, and every jumper is bought as "female–female" whatever the header; a socket needs male ends. `src/model/cablelist.ts:40` and the housings in `src/cad/generate.ts`. Seen by the UART agent in the code and on the Mega's J_IO.
