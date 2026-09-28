# To do

What still needs doing on BoardDock, in the order it's being worked through. New requests go on this list first.

Nothing BoardDock makes has been printed and tried yet, so anything below about fit, strength or clips is from the model and its checks, not from a real print.

## 1. A collision test for whole racks (the test is in; fixing what it finds)

Done: `tests/collide/` builds 140 racks through `generate()` (every template alone standing, lying flat, loose and on a DIN flat clip; back to back; stacks; probes and adapters; boxes; stands off; rails along, rows, lying flat, whichever suits each, an L of rails, an L-shaped board; the Pi cluster and the busy mixed rack with Auto-connect; a rack changed by hand; a built rack with boards added), with seeded ids, and intersects every printed part, board, plug, rail, stand and cable exactly (manifold), by category, with volume and depth. Allowed: a plug in its own jack (a box's port reaches into the box along the plug), a cable in its own plugs, a board on its own holder's pins, a DIN clip's hooks in its own holder. Automatic layouts are also checked for failing Check lines (a failing tongue root says which ways of docking would pass), overlap and "runs into" warnings, rails over Longest rail (unless one dock is longer than the limit) and blocked plugs in use. Baseline: `tests/collide/baseline.json`; `npm test` runs 7 quick racks (about 30 s), `npm run collisions` all 140 (about 90 s, in CI too), `npm run collisions:update` rewrites the baseline.

Baseline now: 596 mm³ over the 140 racks (8272 at first; bolted stacks got standoffs that clear what is under them, 4604; boxes on a flat DIN clip stand clear of its hooks, 2247; the release rod's tunnel, a flat dock's key groove and stacking pegs kept clear, tie anchors for plugs from above kept off the dock, 1520; no lead from the empty socket of a stacked pair, 1054; cable tags checked whole, 748; off-rack leads only as long as they are clear, 596), and 9 layout problems. The measure also showed that the item-1 settling change (cables back to the side they were laid on, crossing beads kept further apart) made cables worse over the whole matrix (cable categories 1360 → 2363 mm³), so it was taken back out.

Left, biggest first (from the baseline):
- Cable into cable, 105 mm³ in 11 racks, up to 3.8 mm deep (most in the Pi cluster); among them a pair pressing where they cross beside a stand's comb or under a rail edge (the item-1 fix for it made things worse and was taken out).
- Cables into stands and rails, 163 mm³, up to 1.65 mm (most in the Pi cluster): a street runs 8 mm under a rail's underside, so a 6 mm Ethernet cable has 2 mm to spare and one crossing over another there pushes into the rail. Cross them between rails, or give the streets more room under the rails. Cable tags into cables, 70 mm³ where no spot along the cable is clear (probes, back to back).
- A cap or cradle into its plug, 98 mm³ in one rack; holders into plugs, 67 mm³ (a Pi 4's holder 0.4 mm into its USB plugs); a rail's end about 1 mm into its end block (in 71 racks, 77 mm³ all told).
- Layout: the library's own USB-C hub fails Check ("Right end: a RJ45 / Ethernet is taller than the box": the box is 14 mm tall); five cables "run into" something on the rows, columns, boxes and no-stands racks.

## 2. Toolbox pictures to match the 3D models

The board editor's toolbox pictures (each plug, header, part) no longer look like the 3D model of the same thing: redraw them from the models, or check each against its model.

## 3. DIN rail clip review

Go through the clip in depth, measuring rather than guessing:
- the release lever: how it frees the clip from the rail, and what keeps the lever on;
- how the tongue insert stays in its slot;
- that the clip is tight on the rail and can't slide once it's done up;
- that every piece is printable;
- (done: a box on a flat clip now stands 2.3 mm up, clear of the snap hooks that reach 1.9 mm above the base; they went 0.7 mm into it.)

## 4. Bill of materials and a build guide

A proper bill of materials at the end (printed parts, boards, cables, rails, supplies, with quantities) and a step-by-step build view: each step's text with its 3D view, next and back, usable on a phone at the bench, and printable. Start from what's already there (the shopping list in Export and the assembly Steps).

## 5. From the second round of test users

Most serious first:
- A switch's or powered hub's DC input is never given a supply, yet the To do list says done.
- "What's new" lists docks that were already built as new.
- Adding to a built rack slides built docks past the rail end with no Move or Cut step (prefer a free gap, add the step, and fail the check on a built rack).
- A full powerboard: the mains bar ignores boxes' own supplies and sends them off the rack while outlets are free.
- One charger left idle; no uplink from the switch to a router.
- A plug-pack supply's mains plug-in and lead are missing from What's new and the mains step.
- Pasted printer start code is trusted as the A1 mini's without checking it.
- The plate brim can land just off the bed; keep it inside the margin.
- No way to slice for an A1 mini without Bambu's files.
- The page freezes for 8 to 30 s on import, step changes, adding a hub, the first 3D view and Mark built.
- USB-serial adapter jumpers never reach the UART header.
- Loose holders drop probes into the row; docks and loose holders can't be mixed.
- Smaller things: cables beside a stand comb, an auto-connected cable through a Pi 4 holder (still there: on a rack of a Pi 4, Uno, Pico, ESP32 and the 4-port hub, Auto-connect's hub UP to Pi 4 USB2 cable "runs into the Raspberry Pi 4B holder", with or without table stands), off-rack labels crowding a big rack, toast wording, the Wiring view at 16 boards, Auto-arrange putting cabled boards on opposite rails, Forget with no confirm, the headline print time estimate, the L-shape spacing defaults, the printer not asked up front, Next not auto-connecting, Measure moving one side only, round boards' corner holes, mirrored silkscreen, bulk tools for identical boards, locking a dock or rail, per-plate control, and more wording fixes.

## 6. Started before, not finished

- Tight cable bends where neighbouring plugs' cables bend the same way.
- The spring clips flexing in the assembly animation.
- The DIN plate slots on rack and inline mounts: a plate printed on its face.

## 7. From the first round of test users

- Jumper and debug ribbons routed straight over the dock.
- A 12 V pack auto-connecting to boards with a known DC input range (Uno, Mega).
- Explain why there's no wall mount (BoardDock uses no screws).
- The 4-pin UART pin names are a guess: say to check yours.

Ideas: a cluster preset, isolate or X-ray the selection in 3D, a command palette, a debug bench sheet, a live buy/print/tools checklist, What's new highlighted in 3D, mains and low-voltage zones, a layout lock with change receipts.

## 8. Plug protection

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
12. Measure popup: size its checkbox normally, focus and select the number when it opens, and put the popup beside the dimension line.
13. The "DIN rail clip" and stand socket checkboxes only toggle on the tiny box: make the whole title a label.
14. The Rails canvas and list mislabel docks: say "lies flat, tab on its bottom edge" and "standing, parts face front", and show "mixed" when docks differ.
15. On a phone, a selected mains cable's panel is cut off. Wrap it, and add the length, plug types, outlet name and a "switch off before plugging in" note.
16. After importing several files, stay on Start with a "Check the boards" button.
17. After "Add 16 boards", the Board step opens on #2: open on the first.
18. What's new says to seat a plug-pack supply "in its holder … into its dock": say to plug it into outlet ACn, switched off, and run its lead to the board. Have "Also print" say what each part is for.
19. After adding to a built rack, the message should say where each new board went.
20. Steps: an "only what's new" mode that plays just the since-built checklist on the existing rack.
21. The shopping list counts straps for plug packs: count only boxes that get a rail holder.
22. Print settings say "Brim: none" but the in-app slice lays a brim: make them agree.
23. Once the start code is known, the main Export button should be "Slice and download all G-code" (in the background, zipped), and the G-code should go in "Download everything".
24. Layout toggles and Check are slow on a 16-board rack (switching back to Stand up took 39 s): cache each layout choice's result, and show progress while it works.
25. Ideas: a typed rotation with 15/45/90° snaps; "Copy to… [boards]"; a Debug panel on Plugs listing each probe's header, ribbon length and slot; a PoE switch and "powered over PoE"; one length for all RJ45 leads; a colour per cable kind.

### Left over from the first round of fixes

1. A "pack new boards only" Auto-arrange option: lay out only boards not yet placed, and leave the rest where they are.
2. KiCad "New version": a 0.8 mm connector move on the example board caused an overlap. The warning now shows, but why the imported bodies overlap was never found.
3. At 375 px wide, a label pill wider than its board is clipped at the edge of the Rails view.
4. Tick the perfboard reminder off when a hole is edited.
5. Wiring view: move length badges out from under cards, and put a dropped card in a free spot.
6. On phones, hint text still talks about clicking and hovering: use touch wording.
7. Links can end at the virtual "@pc" (your computer): check that everything looking up a link's board uses findModule, not p.modules.find (boardviz, assembly and the exporters in particular).
8. Make sure Plugs › "Cables to buy" uses the same wording and lengths as the shopping list (buyText).
9. The "Add a board" window should keep keyboard focus inside it while open, and give it back when it closes.

## Found along the way

Each: how bad (1 to 5), what's wrong, where, and how it was seen.

- 2 · The route check says "The USB-serial adapter USB to Powered USB hub P5 cable runs into the USB charger holder" on a rack of 2 × Pi 4, Pi 5, Uno, Mega, Pico, Nano, ESP32, 7-port hub, 4-port charger, J-Link and USB-serial adapter with Auto-connect and Longest rail 300 mm (standing or lying flat). Cable routing, `src/cad/panelgen.ts`. Seen in a scratch test of that rack.
- 1 · `npm test` takes about 160 s, most of it building holders and racks (the collision test's quick racks add about 30 s).
