# To do

What still needs doing on BoardDock, in the order it's being worked through. New requests go on this list first.

Nothing BoardDock makes has been printed and tried yet, so anything below about fit, strength or clips is from the model and its checks, not from a real print.

## 1. Collisions in 3D (mostly done)

Done: cables no longer pass through table stands, rails or each other (cables side by side, combs only where a cable runs straight, bends kept out of rails); zip-tie anchors stay on the board and clear of the dock lever; port guards wrap round jacks that stick out past the wall; the dock pedestal is notched round low boards (Uno, Zero, relay board); plug caps clear the cradle ledges; cable number tags find a clear spot. Measured overlap on three test racks fell from about 1650 to about 720 mm³.

Left:
- The USB-C hub's strap loops sit under its front plugs (its short ends have ports too): lower the loop under a port.
- A pair of cables still presses together where they cross under a rail edge.
- A board laid flat can reach across into the next rail's boards: Check warns, but only docks on its own rail slide along to make room.

## 2. DIN rail clip review

Go through the clip in depth, measuring rather than guessing:
- the release lever: how it frees the clip from the rail, and what keeps the lever on;
- how the tongue insert stays in its slot;
- that the clip is tight on the rail and can't slide once it's done up;
- that every piece is printable;
- the clip's snap hooks reach 0.7 mm up into a box resting on the holder.

## 3. Bill of materials and a build guide

A proper bill of materials at the end (printed parts, boards, cables, rails, supplies, with quantities) and a step-by-step build view: each step's text with its 3D view, next and back, usable on a phone at the bench, and printable. Start from what's already there (the shopping list in Export and the assembly Steps).

## 4. From the second round of test users

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
- Smaller things: cables beside a stand comb, an auto-connected cable through a Pi 4 holder, off-rack labels crowding a big rack, toast wording, the Wiring view at 16 boards, Auto-arrange putting cabled boards on opposite rails, Forget with no confirm, the headline print time estimate, the L-shape spacing defaults, the printer not asked up front, Next not auto-connecting, Measure moving one side only, round boards' corner holes, mirrored silkscreen, bulk tools for identical boards, locking a dock or rail, per-plate control, and more wording fixes.

## 5. Started before, not finished

- Tight cable bends where neighbouring plugs' cables bend the same way.
- The spring clips flexing in the assembly animation.
- The DIN plate slots on rack and inline mounts: a plate printed on its face.

## 6. From the first round of test users

- Jumper and debug ribbons routed straight over the dock.
- A 12 V pack auto-connecting to boards with a known DC input range (Uno, Mega).
- Explain why there's no wall mount (BoardDock uses no screws).
- The 4-pin UART pin names are a guess: say to check yours.

Ideas: a cluster preset, isolate or X-ray the selection in 3D, a command palette, a debug bench sheet, a live buy/print/tools checklist, What's new highlighted in 3D, mains and low-voltage zones, a layout lock with change receipts.

## 7. Plug protection

Check each cradle and cap prints well in every orientation, and fit a cap only where the pull comes out of the cradle's open side.
