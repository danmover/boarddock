# DIN rail clip review

From TODO.md: go through the clip in depth, measuring rather than guessing. There are two parts that grip a TS35 rail, and this review covers both:

1. **The dock's rail shoe** (`src/cad/dock.ts`), with its print-in-place press-down release lever. The socket snaps into it and the holder's tongue plugs into the socket. A board lying flat instead has a separate dock key in a dovetail under the holder's ear.
2. **The pull-tab DIN clip** (`src/cad/dinclip.ts`) for loose holders and for flat mounts in a panel.

**Written before the first print; see [After the first print](#after-the-first-print-petg-fdm) at the end.** Every number here comes from the model: exact geometry, a 2D FEA with a textbook modulus, and hand sums. Fit, strength, grip and the feel of the clips were untested when it was written. The last sections list what only a print can tell.

## How it was measured

- **Geometry.** Exact intersections and offsets with manifold-3d, in the 2D profiles (`shoeProfile`, `leverProfile`, `clipProfile`) and in 3D (`shoe`, `socket`, `holderDock`, `flatHolderDock`, `rod`).
  - Clearances: grow one region by *d* until it touches the other.
  - Play: slide a part in steps of 0.02 to 0.05 mm until it meets something.
  - Engagements: read off the profiles.
- **Lever kinematics.** Turn the lever about its pin in 0.5° steps. At each step, open the jaw just far enough to clear the hook (bisection).
  - The jaw is taken as rigid, swinging about (16.75, 13.76), the middle of its hinge leaf. That point is fitted to the FEA, where the lip moves 1.7 mm while the post moves 4.06 mm. It is an approximation, good to about 10%.
- **FEA.** The app's 2D plane-stress solver (`src/fea/fea2d.ts`) on 0.05 to 0.1 mm pixel meshes, PETG (E 2100 MPa) unless stated.
  - Peaks sit on pixel corners and read high: on a curved edge up to twice the true value. The 99% figure is the steadier one, and both are given.
- **Printability.** The Check step's own layer slicer (`layerCheck` and `verdict` in `src/cad/printcheck.ts`), on each piece in the pose it prints in.
- **Tests.** Every finding and fix below is held by `tests/dinclip-review.test.ts`, plus new assertions in `tests/dockfea.test.ts` and `tests/clip.test.ts`. `npm test` passes, and so do all 140 collision racks (`npm run collisions`), at the committed baseline.

## Summary

| Bullet | Finding (before) | Change | After |
|---|---|---|---|
| Lever: frees the jaw | Correct, but the numbers were wrong: said 1.4 N and 8 mm of pad travel | FEA corrected to where the hook really bears | 2.4 N, about 5 mm |
| Lever: stays on | Its hub's open edge was **0.09 mm** from the neck (prints as one piece). **Nothing held it along the pin**: it could slide 21 mm off the end | Hub opening moved, neck reshaped; a bead on the pin in a groove in the hub | 0.35 mm clear everywhere; at most 0.5 mm of play along the pin |
| Lever: overload | Past the jaw's stop, about **13 N** on the pad brought the 1.0 mm neck, with its 0.05 mm notch, to the strain limit | Neck tapered from 1.8 mm and filleted; tower wider | About **28 N** |
| Tongue in the socket | Latch nose 1.05 mm into the groove, flat catch: "holds". 0.3 mm of rattle | none in this review | **Wrong**: the first print showed it popping out, and the model agrees (about 10 N). Redone in the last section |
| Dock key in its dovetail | Held only by the release rod, and **the rod slid straight out** | The rod clicks into its tunnel (barb under a ledge) | Rod meets the ledge after 0.25 mm; key stopped after 0.25 mm |
| Shoe tight on the rail | **Only located**: 0.8 mm of play across, 0.3 mm out of the wall, nothing pressing. It slid freely, and would slide down a vertical rail | A sprung rail grip presses the rail's wall; a tooth stops knocks | 9.6 N preload, **about 6 N to push a dock along** |
| Clip tight on the rail | Only located: 0.2 mm out of the wall, 0.65 mm up and down, nothing pressing | The same rail grip under the top wall | 6.4 N (14 mm clip), about 4 N to push along |
| Printable | All pieces print without support. Worst bridge 9 mm (flat holder), 8.7 mm in the shoe (its hinge) | new features checked | still no supports; new bridges 4.1 mm at most |
| Box on a clip (done before) | Snap hooks reached 0.7 mm into a box | (already fixed) | box stands 2.3 mm up |

## 1. The release lever

### How it frees the shoe from the rail

The shoe's jaw wraps round the rail flange on the lever's side. Its lip reaches **1.7 mm** under the flange (the flange edge is at y 17.5, the lip's tip at 15.8), with 0.3 mm of play under the flange. The jaw hangs from a 0.9 mm hinge leaf directly above the lip. Pressing the lever's pad turns the lever on its pin, and the hook under the lever pushes the jaw's post toward the socket. The jaw swings about its leaf and the lip slides out from under the flange.

The kinematic sweep, with the rigid jaw:
- **0 to 3°:** the lever takes up the 0.4 mm gap between the hook and the post.
- **21.5°:** the lip is 1.7 mm out, clear of the flange. The pad has gone down **5.0 mm** (13.6 mm from the pin).
- **23.5°:** the jaw meets its stop (the post on the body's shelf) at about 2.0 mm of lip travel. The FEA puts the stop at 2.16 mm.
- **37.5°:** the lever's own travel would end here (the hub's opening meets the neck), so it never limits the release.
- Upwards, the lever could lift 13.5° from rest before its hub met the neck (6.5° now: see the end).

With the grip (section 3) the shoe sits on its fixed hook, 0.4 mm toward that side. The lip then engages only 1.3 mm, so it is clear a little sooner.

**Force.** The hook bears on the post with its lower end: 8.3 mm under the pin at rest, 9.5 mm at 12°, 11.0 mm at 20°, and 11.3 mm at the stop. These are the contact points from the sweep. The FEA had assumed 6.9 mm, above the real contact, so it put the push on the post too high and the pad's lever arm too long.
- Corrected, the release case loads the post over z 28 to 31 and uses the contact 11.0 mm under the pin at the end of the stroke: about **2.4 N** on the pad for PETG (4.1 N for PLA), for about **4.7 mm** of pad travel.
- It had said 1.4 N and 8 mm, which the README repeated.
- The jaw's leaf root reaches 1.7% peak (1.6% before; the push now bears lower on the post), 0.55% for 99% as before. The stop protects it.

### What keeps the lever on

The lever is printed in place round a 3.4 mm pin at the top of a tower beside the socket. Its C-shaped hub wraps about 280°.

- **Across the pin:** the hub's opening is 2.41 mm across at the bore (2.61 mm now), less than the 3.4 mm pin, so it can't come off sideways. Good.
- **Round the pin, as printed:** the bore leaves 0.35 mm all round the pin. But growing the lever's outline by just 0.1 mm makes it touch the body: the edge of the hub's opening (at −111°) came within **0.09 mm** of the neck, over a 0.6 mm wedge the whole 21 mm length.
  - A 0.45 mm line on each side can't leave a 0.09 mm gap, so that edge would print fused to the neck, and the lever couldn't turn without being broken free.
  - The Check step's narrow-slot test missed it: each layer's sliver was under its 0.15 mm² threshold.
- **Along the pin: nothing.** The lever and the pin are both straight 21 mm extrusions with nothing between them. Sliding the lever along the pin in steps up to 21.5 mm met nothing at all. On a vertical rail, or with any knock along the rail, the lever could slide off the end of its pin.

**Changes** (`dock.ts`: `SHOE_LEVER.open`, `TOWER`, `NECK`, `pinBead`):
- **The hub's opening** now runs from −118° to −39°. Its edge is 0.46 mm off the neck, and the least gap anywhere between the lever and the body is 0.35 mm (measured 0.346 on the polygons).
- **A bead** round the middle of the pin, 0.6 mm proud with 45° flanks, runs in a groove inside the hub (the bead grown by the 0.35 mm print gap).
  - The lever slides freely for about 0.5 mm either way along the pin, then a flank meets the other (blocked by 0.6 mm).
  - To pull it off, the hub would have to open 0.25 mm all along its 21 mm length. It is captive.
  - The 45° flanks print without support with the shoe on its end face. The radial gap in each layer is 0.49 mm on the flanks.

### Strength past the stop

Once the jaw is on its stop, pressing harder no longer moves anything. The thumb's force goes through the lever into its pin, down the neck and the tower. A thumb pushing on something that has stopped easily gives 10 to 30 N.

At the stop the hook bears 11.3 mm under the pin and the pad is 12.4 mm out, so each newton on the pad pushes the pin 1.1 N outward and 1 N down.

A 2D FEA of the tower, neck and pin with the body held under the tower:
- **Before:** the 1.0 mm neck had a 0.05 mm notch where it met the tower's chamfer. The peak strain there was 0.154% per N, so **about 13 N reached the 2% limit**.
- **After:** the neck tapers from 1.8 mm at its root to 1.0 mm under the pin, its root is filleted (r 0.8), and the tower is 2.7 mm wide instead of 2.1. The peak moves to the tower's root at 0.071% per N (0.030% for 99%): **about 28 N**.
- The jaw's post would meet the widened tower only at 26.5°, 3° past its stop on the shelf, so the stop still acts first.

The hinge leaf's strain in the pull-off case is unchanged: it reaches its limit at about 121 N. The FEA's shoe mesh was kept the same by giving the grip a model of its own. Adding geometry lower down would have shifted the pixel grid, and the peak with it, by about 7%.

## 2. How the tongue stays in

### The tongue in the socket

> **Superseded** (see "After the first print", the last section): the flat catch here did not hold. It is now a tapered beam with an undercut hook 1.4 mm deep, the 0.3 mm of play is 0.65 mm on purpose, and the anti-rattle leaves are gone.

The holder's tongue (14 × 4.5 mm) goes down into the socket until its pedestal sits on the socket top. The latch nose springs into a groove across the tongue's front face:
- The nose's tip reaches **1.05 mm** into the groove (0.15 mm short of its back).
- Its lower face is flat, so a pull on the holder meets a square catch, not a ramp. It can't be pulled out without the button.
- Holding: pulling the holder out bears the groove's lower face on the nose's flat underside, across the nose's 9.6 mm width.

Play, measured by sliding the tongue (and the holder's whole dock end) until it meets the socket:
- **Up (out):** 0.32 mm before the nose catches.
- **Down:** none (the pedestal is on the socket top).
- **Across:** ±0.16 mm, the tongue between the socket's divider and its front wall.
- **Sideways:** ±0.22 mm.

Nothing preloads the tongue, so a holder can rattle by those amounts. This is **not changed**, and is listed at the end.

**Release.** The button's rod meets the latch's 45° ramp after 0.45 mm. The FEA has the nose clear of the groove after 1.94 mm of the 3.1 mm stroke, for 3.2 N on the button (PETG, friction included); the push-in is 9.2 N. Both are unchanged.

### The release rod

> **Superseded** (see the last section): the rod's tunnel had 0.2 mm each side and jammed in the first print; its barb is now two fingers under a gate, and the tunnel is 0.4 mm each side (0.3 at the gate) with lead-in chamfers.

The rod runs in a 3.6 × 2.6 mm tunnel (the rod is 3.2 × 2.2). **Nothing held it in:** pulled up, it slid straight out without touching anything. On a table rack gravity keeps it down; on a wall, a knock or a hand on the button could pull it out.
- For a standing holder that only loses the button, and the holder stays latched.
- For a board lying flat it matters more (next).

**Change** (`dock.ts`: `rod`, `rodTunnel`; `dockdims.ts`: `HD.catch`):
- **The finger:** a 6.2 mm finger is cut in the rod's side by a 0.5 mm slot, hanging from the button head, with a barb at its foot. The barb stands 0.5 mm proud and has a 45° lead-in.
- **The pocket:** the tunnel's top 2 mm keep their 1.8 mm half-width as a ledge, with a pocket under it.
- **Pushing it in:** the ledge bends the finger 0.3 mm aside, a one-time strain of about 1.05% (1.5 × 0.9 × 0.3 / 6.2²). The barb then clicks out under the ledge.
- **Holding:** pulled up, the rod meets the ledge after 0.25 mm (0.2 mm by design).
- **Pressing:** the barb rides the whole stroke in the pocket. The first thing the rod meets is still the latch ramp at 0.45 mm, and then the grip bar at 3.1 mm under the button head, as before.
- The Check step and the assembly steps now say to push the rod in until it clicks.

### The dock key in its dovetail (a board lying flat)

The key slides into a dovetail groove under the holder's ear, from the ear's tip. The groove is closed at its far end, so the key stops 0.25 mm past its place.
- The dovetail has 0.2 mm clearance a side: ±0.15 mm of play across, and the key can drop 0.35 mm before the flanks bear.
- Without the rod, the key slides back out of the groove's open end: 12 mm and more, touching nothing.
- The rod passes through both the ear and the key, so with the rod in, the key is stopped after 0.25 mm.

So **the key was held only by the rod, and the rod by nothing**. If the rod came out, the flat holder could slide off its key, and off its dock. With the rod now clicked in, the key can't leave the dovetail: the review test slides it 1 mm and finds it blocked. The rod isn't meant to come out again; to replace a key or a rod, print a new one.

## 3. Tight on the rail

### The rail shoe

Measured on the profile against a TS35 × 7.5 rail with 1.0 mm steel:
- **The fixed hook:** it goes under the other flange (2.1 mm under it) with 0.3 mm of play under the flange, and stands 0.4 mm off the flange edge.
- **The jaw:** its lip has 0.3 mm of play under the flange, and its pocket stands 0.5 mm off that flange's edge.
- **The body** rests on both flange tops.

Free travel before anything touches: **0.37 mm and 0.42 mm across the rail** (0.79 mm in all), **0.31 mm out of the wall**, and nothing pressing anywhere.

So the shoe only **located** on the rail; it didn't grip. Along the rail, the only resistance was friction from whatever load happened to be on it:
- A rough hand sum: a docked Pi 4 (about 75 g, its centre of mass about 40 mm out) on a vertical rail loads the flanges with about 0.85 N each. At friction 0.3 that holds back about 0.5 N, less than its 0.74 N weight, so **it would slide down the rail**.
- On a horizontal rail, any nudge along the rail moved it.

**Considered and not used:**
- **A preload through the jaw.** A wedge on the lip steep enough to give a useful preload (about 13°) would pry the jaw open under a pull whenever friction drops below tan 13° ≈ 0.23, undoing the v3 C-jaw's reason for being. The jaw's own spring (about 2.4 N/mm at the lip) is far too soft for a grip.
- **Crush ribs.** They would be crushed, not sprung, and worn by every clip-on.
- **A pad on the flange top.** Every good place for one needs a long leaf through the floor that ties the fixed hook to the rest of the shoe, the floor that carries the pull-off load.

**Change: a rail grip** (`dinclip.ts`: `railGrip`; `dockdims.ts`: `GRIP`, `SHOE_GRIP`). A fork hangs from the shoe's underside into the rail's channel, on the fixed hook's side. It is all in the profile, so it flexes within the print layers. It has:
- a root block, 4.5 mm or more from the rail's middle;
- a 0.9 mm arm along the channel just under the floor (0.8 mm slit);
- a rounded knee (r 1.5);
- a 0.9 mm leg down the wall, with a pad low on it.

As drawn, the pad reaches 0.75 mm into the rail's wall: the 0.4 mm play to the fixed hook plus 0.35 mm of preload. Clipped on, it pushes the shoe onto its fixed hook, so the rail's wall and flange are clamped between the pad (on the wall's inside) and the hook (on the flange's edge). The jaw isn't loaded, so the release and the pull-off are as before.

Clipping on, measured by turning the profile about the hook's finger: the pad first meets the wall's inside face at about 12° of tilt, from inside the channel, and presses in smoothly to 0.75 mm at 0°. It never has to pass over the wall's top edge.

FEA of the fork (its own model, the floor it hangs from held, 21 mm long, PETG):

| | |
|---|---|
| Stiffness at the pad | 27 N per mm |
| Preload at 0.35 mm | **9.6 N** (5.5 to 14 N for 0.2 to 0.5 mm of print and rail tolerance) |
| Strain at the preload | 1.1% peak (a pixel corner on the knee), **0.61% for 99%** |
| Force to slide a dock along the rail | 2 × 0.3 × 9.6 ≈ **5.7 N** (friction on the pad and on the hook); 3.8 N at friction 0.2 |
| A knock across the rail | the tooth meets the wall 0.45 mm past the preload (0.8 mm in all): 1.40% for 99%, 2.5% at the knee's pixel peak, briefly |

A rigid tooth over the knee meets the wall if the shoe is knocked back across the rail. Without it, a knock could take the shoe 0.9 mm back (to the jaw's pocket) and the pad to 1.25 mm: about 2.2% for 99% of the fork.

The shoe goes from 10.04 to 10.45 cm³, with the grip, the bead and the wider tower.

The fork stays 5.8 mm above the panel, and its root 4.5 mm or more from the rail's middle. A screw head in the rail reaching more than 4.5 mm from the middle must be under 4.8 mm tall where a dock sits:
- Pan, cheese, button and countersunk heads pass.
- M5 socket caps (8.5 mm across) stay inside 4.5 mm and pass too.
- M6 socket caps (10 mm across, 6 mm tall) don't. They already came within 0.5 mm of the shoe's floor.

**The collision test.** It counts the pad's designed overlap with its rail as contact, like a rail end in its end block (`tests/collide/measure.ts`).

**Cable routing.** The router keeps cables clear of every part's bounding box. The fork took the shoe's box 2.5 mm down beside the rail, which rerouted cables on two racks (cable into cable 8.5 → 166 mm³ on the boxes rack). Boxes are now taken from each part's `boxMesh`: the shoe and the clip without the grip that hangs inside the rail, which the rail's own box already covers. All 140 racks are back at the baseline.

### The pull-tab clip

Measured on the profile (14 mm clip, 1.0 mm rail):
- The flanges sit between the hooks' faces and the back plate: 0.2 mm of play out of the wall.
- The top wall stands 0.2 mm above the top flange's edge, and the jaw 0.45 mm below the bottom one: **0.65 mm up and down**.
- Nothing pressed. Like the shoe, it only located.

**Change:** the same rail grip, under the rail's top wall (the rigid side; the jaw's side is the release spring).
- Its pad presses the top wall's inner face and holds the clip down on the top flange's edge.
- The wall's inner face is taken as 13.5 mm minus the rail thickness from the middle, for the 0.8, 1.0 and 1.5 mm rails the clip offers. That the walls' outer faces are 27 mm apart on every rail is an assumption.
- FEA: **6.4 N** for a 14 mm clip on a 0.1 mm mesh (7.1 N on the clip FEA's default 0.2 mm mesh; about 0.46 N per mm of clip width), 1.10% peak and 0.63% for 99%. About 3.8 N (friction 0.3) to push it along.
- The clip now sits 0.2 mm lower, on its top hook, so the lower lip engages 1.05 mm instead of 1.25. Release needs only 1.5 mm of lip travel, and the stop is at 1.91 mm.
- The other clip cases are unchanged: tab pulled towards you 1.75 N, down and forward 3.1 N, straight down 4.6 N, snap-on 5.3 N, 1.4 to 1.9% peak.

The Check step has new lines for both: **Rail grip** under DIN clip, and **Rail shoe grip** under Panel.

## 4. Every piece printable

Each piece sliced in its print pose by the Check step's layer check. PETG, a Pi 4 standing and lying flat, an Uno loose on a clip:

| Piece | Prints | Supports | Longest bridge | Longest overhang | Notes |
|---|---|---|---|---|---|
| Rail shoe + lever | on its −X end face | none | 8.7 mm | none | The bridge is the hinge leaf's upper half, printed over the 7 mm gap between its two halves. Lever 0.35 mm clear all round; bead and groove flanks 45° |
| Socket | on its end face | none | 3.5 mm | none | latch nose 0.45 mm clear in its window |
| Holder, standing (Pi 4) | flat on its back | none | 4.1 mm (was 3.9) | 0.6 mm | the rod pocket's roof is the 4.1 mm bridge |
| Holder, lying flat (Pi 4) | base down | none | 9 mm | 0.7 mm | unchanged |
| Release rod | flat on its back | none | none | none | the finger's slots are 0.5 mm, in the layer plane |
| Dock key | on its side | none | 4.1 mm | none | pocket roof |
| Pull-tab clip | on its side | none | none | 0.4 mm | the grip is in the profile |
| Test-fit kit | as above | none | 8.7 mm | none | four pieces, no supports |

Nothing is in mid-air. The changes add nothing over 4.1 mm, so across the whole library the worst stays 9 mm (a flat holder) and 14.4 mm (a DIN plate's slot tops, a warning since before).

The rail shoe's hinge leaf, the one spring that carries the pull-off load, starts its upper half as an 8.7 mm bridge. It prints with a little sag on its first layers at x 3.5. That is cosmetic for a leaf loaded along its length, but worth looking at on the first print.

## 5. The clip's snap hooks under a box

Already done before this review: a box on a flat clip now stands 2.3 mm up, clear of the hooks that reach 1.9 mm above the base.

## What only a print can tell

- **The grip.** Whether 0.35 mm of preload gives a firm hold on a real rail with a real print. How much PETG creep eases it over months (at 0.6%, a little, but not measured). What friction PETG really has on zinc-plated steel or aluminium rail. How much the pad scuffs the rail's wall over many clip-ons.
- **Clip-on and release feel**, now with about 1 to 2 N more to press the shoe home (the pad's force, 3.8 mm under the hook's pivot) and a 2.4 N lever.
- **The lever.** Whether the 0.35 mm gaps and the bead's 45° flanks print free on your printer, first time. A 0.2 mm first-layer squish at the bed end (x −10.5) is the likeliest place for the lever to stick.
- **The rod's barb.** Whether 0.5 mm clicks in cleanly and holds. Holes print a little small, which makes the ledge tighter (about 1.4% one-time strain on the finger with a 1.7 mm half-width ledge).
- **The rail's walls.** Their inner faces are taken as 27 mm apart outside and as thick as the flange. The inside corner radius at the bottom of the channel must be under about 0.7 mm for the pad to sit on the flat.
- **The hinge leaf's bridged upper half** (8.7 mm): how much it sags.
- **The tongue's 0.3 mm rattle** in the socket, and whether it matters on a board you plug into.

## Seen along the way, and since dealt with

> The rattle leaves below (the first bullet) were replaced after the first print: see the last section. The lever's lift, the pull-off FEA and the pixel grid stand.

Four things the review left open, measured and changed afterwards (`tests/dockhold.test.ts`, `tests/dockfea.test.ts`, `tests/dinclip-review.test.ts`). Still none of it printed.

- **The rattle.** The rigid dock end, slid in the socket the review's way, has 0.30 mm of lift before the nose catches, 0.14 mm either way across and 0.20 mm sideways. Now two kinds of leaf, both flexing within the print layers (the holder prints on its back, so the tongue's x-z section is a layer):
  - *Under the pedestal*, a leaf each side (root 1.6 mm from the middle, 1.6 mm thick tapering to 0.9, a 0.5 mm slot over it to flex into) with a 0.4 mm bump on the socket top's side margin. The holder rests up on the nose's catch with the bumps still 0.10 mm pressed: about 1.4 N a leaf (14 N per mm), 3 N up in all. Pressed right home a leaf reaches 1.5% strain (the 3 x 3 pixel peak) and the two push back with 11 N; at the click they add about 4 N to the push (the latch's 9 N stays).
  - *At the tongue's two front corners*, a leaf 0.9 mm thick (1.1 at its root, 0.5 mm slot, hanging from 6 mm down to the tip) with a bump on the 45° corner face. The socket's matching face pushes the tongue back onto its divider and to the middle: 1.2 N a leaf at rest (5.4 N per mm), 0.7% strain; a knock that closes the slot reaches 1.6%.
  - So at rest the holder sits held up on the catch, back on the divider and centred, with the pedestal's bumps pressed 0.10 mm and each corner bump 0.16 mm along its face's normal (0.22 mm as the leaf sees it), and the rigid part touching nothing. Only the bumps overlap the socket (0.4 mm deep at most): the collision test allows a holder's bumps in its socket. `Tongue fit` (looser +) takes the bumps in with the faces.
  - Not done: the pedestal's leaves are cut out of the holder's own wall (a slot over each, a 45° roofed void beside it), so a thin-walled holder has 0.6 mm left over them.
- **The lever's lift.** Its hub meets the neck after 6.5° up (the pad 1.5 mm), not 13.5° (3 mm): the hub's neck-side edge is slanted, 0.35 mm off the neck at the pin and closer at the ring's rim (`SHOE_LEVER.open`, `SHOE_LEVER.stop`). A print gap of 0.35 mm at a 3.55 mm ring is 5.7° at the least.
- **The pull-off FEA** now holds the shoe only where the rail does (under the fixed hook's finger and the jaw's lip) and pulls on the socket's two hooks. Sharing: the fixed hook takes about 56% of a central pull. PETG reaches its 2% limit at about 120 N on both hooks and 80 N on one (a holder pulled off-centre), first in the hook beams' roots at their slits, then the fixed hook's finger; the hinge is not the weakest part (175 N with the jaw alone, before).
  - *Fillets at the slits' bottoms* (`HOOK_SLIT`): each slit is 0.6 mm wide, so its bottom is a full 0.6 mm round (a quarter round across the slit; it was 0.3) and the tab under each hook has a 0.3 mm round into the beam. They round in the shoe's (y, z) profile, which is the layer plane (the shoe prints on its end), so they print as drawn. Wider rounds leave a step in the wall that took more strain than they saved. The limits are now 130 N on both hooks (119 N before, measured the same way) and 87 N on one (80 N before), with the shoe's rail fit, lever and print check unchanged (`tests/hookfillet.test.ts`). Over four positions of the pixel grid (0 and half a pixel over, each way) the spread is 129 to 134 N now against 112 to 126 N before on both hooks, and 77 to 88 N against 73 to 81 N on one: the gain on both is real (about 10%), the gain on one hook (about 6% on average) is inside the grid's own scatter. The fixed hook's finger is now the first place on a central pull: its peak sits at the edge of the rigid support the model holds it by, and thickening it 0.6 mm did not move that reading, so it is left as it is.
- **The pixel grid.** It sits on multiples of the pixel now, a cut pixel keeps the share the outline covers as its stiffness, and the dock's peaks are 3 x 3 pixel averages: half a pixel of shift moves forces and peaks by under 5% and 12% (a third for forces before). The peaks read lower than the corner peaks the numbers above used (about a quarter), so the strains in this note before this section are the old kind. The solver has an incomplete Cholesky preconditioner (a free shoe took 16,000 Jacobi iterations).

Still open from the review: the Check step's narrow-slot test ignores slivers under 0.15 mm² a layer. That is how the lever's 0.09 mm gap at the neck went unseen. A check of the smallest gap between separate islands of a print-in-place part would catch it (the review test does this for the lever).

## After the first print (PETG, FDM)

The first print of a dock (its shoe, socket, a holder and rod) found four things.

- The shoe's rail grip works well; **nothing about it changed**.
- **(A)** The release rod would not go through the holder without a hard push, and pushing that hard broke the button off.
- **(B)** The socket's latch let the holder pop out too easily.
- **(C)** The stoppers of the tongue "snap really easy": the anti-rattle leaves (slots cut out of the holder's wall, sometimes 0.6 mm left over one) and the latch's stop post.

Numbers below are from the model (PETG, E 2100 MPa, the 2D FEA `src/fea/dockfea.ts` at 0.1 mm), as before. Nothing has been printed since. `tests/dockhold.test.ts`, `rodhole.test.ts`, `joints.test.ts`, `dockfea.test.ts` and `flexures.test.ts` hold them.

### A. The release rod's hole and neck

**Cause** (inferred from the geometry and how FDM prints, not measured). The tunnel was 3.6 x 2.6 mm round a 3.2 x 2.2 mm rod: 0.4 mm on the diameter, 0.2 each side. The holder prints on its back, so the tunnel runs across the layers: a hole prints small and its bridged roof sags, and the rod prints a touch big, so 0.4 mm closed up over the tunnel's 50 mm and the rod jammed. Pushed hard, the load ran into the neck: the head is a 16 x 3 mm plate on a 3.2 x 2.2 mm shaft with slots cut right up to it, and the plate is printed on edge, so a push off-centre bends the shaft in the layers' plane (along the layer lines: the strong way) or across them (the weak way).

**Changed** (`dockdims.ts`: `HD`; `dock.ts`: `rodTunnel`, `rodBore`, `rod`):

| | before | after |
|---|---|---|
| Rod | 3.2 x 2.2 | **3.6 x 2.2** (y stays: the socket's core is 0.2 mm off the rod's underside) |
| Tunnel bore | 3.6 x 2.6 (0.4 total each way) | 4.4 x 3.0: **0.8 across, 0.8 in y** (0.4 each side and 0.4 under and over the rod, the roof being the bridge that sags) |
| Tightest place (the gate the barbs pass) | 0.2 each side | 0.3 each side (0.3 measured to the 0.02 mm step) |
| Lead-ins | the rod's tip sloped in y only | 45 degree funnel at the top (1.2 mm on the sides, 1.0 under, 0.5 over), a 0.7 mm chamfer where the rod leaves, and the tip's corners chamfered 0.9 mm |
| Neck | slots to the head, no fillet | solid from the head to 1.7 mm under the tunnel's mouth; fillets in x (R0.9, in the print's layers) and over the shaft in y (R0.6) which the funnel takes when the button is pressed home |
| Head | y 6.4 to 14 | y 6.4 to 12.5: a thumb on its far edge is 1.5 mm nearer the shaft |
| Spine | 6 mm wide, walls of 1.2 mm round the tunnel | 6 mm wide (kept, so that every rack lays out as before), walls of 0.8 mm beside the bore, and under the grip bar a collar 7.7 mm wide, 3.8 mm tall over the barbs' pocket, so that the pocket has 1.2 mm walls |
| Retention | one barb on one finger hanging from the head, a 0.3 mm click | **two fingers standing from the shaft under the mouth**, each 0.75 mm wide with a barb 0.55 mm out; the gate (the top 2 mm of the tunnel, 0.3 each side) bends each 0.25 mm, once. Two, so one catches however the rod sits in its 0.4 mm each side |
| Barb's joint to its finger | 0.5 mm | 1.4 mm (a 1.0 mm lead-in and 0.4 mm of outer face) |
| Flat holder's dovetail | 6.8 mm at its root | 7.8 mm (the pocket is cut across it) |

Print orientation: kept (on its back, y up). The shaft's layers run along it and into the head, so a push along the layers' plane bends it along its lines; the plate's thickness is across them only for the y direction, where the head is nearer the shaft now. Standing the rod on its end would put the neck across the layers for every push.

**The push it takes** (FEA of the neck at the tunnel's mouth, peak strain per newton, the head's 3 x 3 pixel average):

| | before | after |
|---|---|---|
| 1 N pushed 4 mm off-centre, across the rod (along the layers) | 0.122% | 0.101% |
| 1 N on the head's far edge, along the rod (across the layers) | 0.124% | 0.086% |
| the click of a barb finger | 1.4% (0.3 mm on one finger) | 1.0% peak, 0.7% for 99% (0.25 mm, 0.9 N a finger), once |

The neck gain is modest (about 17% across the rod, 30% along it): the shaft's own section under the tunnel's mouth sets the strain, and the tunnel bounds it; the spine could not be widened for a stronger neck without moving every rack's layout. What changed most is what loads it: the push to seat the rod is the two fingers' click (about 2.5 N) and the wedge of the funnel, not a jammed 50 mm.

A rod down a column of three holders, each up to 0.25 mm off the one under it, passes every tunnel in either direction (it could not with 0.2 mm each side).

### B. The socket latch

**Cause.** The catch's face was flat, square to the pull (the review called it a "square catch, not a ramp": true, and not enough). But the nose sits 2.5 mm off the beam's axis, so a pull on the holder is an eccentric load: it tips the beam, and the tip, with the nose, slides **out** of the groove. The FEA had no pull case, so the review never saw it. With a case for it (a 20 N pull on the holding face, friction left out) the old latch's nose moves 2.0 mm out of a 1.05 mm catch: **it slips at about 10 N**.

**Changed** (`dockdims.ts`: `LATCH`, `latchGeom`; `dock.ts`: `latchProfile`, `noseProfile`, `noseSolid`, `latchGroove`; `dockfea.ts`: `latchFea`):

- **Undercut hook.** The holding face slopes 15 degrees, so it is highest at the mouth and the nose sits in a pocket: a pull now has a share that draws the nose in. The angle that cancels the eccentric tip is fixed by the geometry (about 3 x 2.5 / (2 x 14): 15 to 18 degrees) and does not depend on the beam's stiffness, so the beam can be soft and the catch still holds.
- **Deeper.** 1.4 mm into the groove (was 1.05). The groove is 0.65 mm over the nose at rest (was 0.3): the undercut needs it, for the nose to leave up and along the face (0.42 mm). The FEA has the nose rising 0.58 mm as it goes out (an eccentric nose rises as the beam tips), so it separates from the face; with no rise at all the play still covers the undercut with 0.23 mm to spare.
- **A long tapered beam.** 0.9 mm at its root, 0.6 at 7 mm up, 0.9 under the arm, 14.9 mm from the boss's top to the nose's underside (12.6 mm before), the nose 2.35 mm higher. It bends in the socket's print layers, with fillets of 1.0 mm at the root and 0.5 at the nose.
- **The arm** is 0.9 mm thick where it passes the shoe's lever hub (was 1.6), so it clears the hub by 0.3 mm at the release and 0.2 with the button pressed right home.
- **No stop post.** The old post (a 1.0 mm wall, 10 mm tall, cut off the anchor plate) is gone: the button's stroke bounds the arm at 1.9 mm of nose travel, where the beam is at 0.85%.

| Latch, PETG | before | after |
|---|---|---|
| Holding face | flat, 1.05 mm deep | undercut 15 degrees, 1.4 mm deep |
| A 20 N pull | nose 2.0 mm out: slips at about 10 N (friction not counted) | nose 0.4 mm out of 1.4: slips at about 69 N; strain 1.1% |
| Strain at full deflection (the button pressed right home) | 1.4% (over the 1% rule) | **0.85%** peak (0.74% for 99%) |
| Strain at rest | 0 | 0 |
| Push to insert (friction 0.3 included; the leaves added 3.7 N to the click) | 11.2 N | **3.9 N** |
| Button to release | 3.8 N | **2.5 N** (2.1 mm of the 3.1 mm stroke, with the 0.42 mm before the rod meets the ramp) |
| Beam stiffness at the nose | 4.65 N/mm | 1.55 N/mm |

The holder is looser in z (0.65 mm of lift) and its pull is held by the hook, not by the beam or by friction.

### C. The stoppers

Checked how each is joined (`src/cad/joints.ts`, `tests/joints.test.ts`): the joint's width, the thinnest neck between it and the tip, and in the print pose, layer by layer, whether each piece is joined to the body inside its own layer.

| Feature | what it was | now |
|---|---|---|
| Latch stop post | 1.0 mm wall, 10 mm tall, flagged | removed (the stroke bounds the arm) |
| Anti-rattle side leaves (tongue's front corners) | 0.9 mm leaf, 6 mm long, a slot behind it, 0.7% at rest | removed |
| Anti-rattle lift leaves (under the pedestal) | 0.9 mm leaf, 0.5 mm slot, sometimes 0.6 mm left over it, 0.4% at rest | removed |
| Latch nose | 2.7 mm on the arm, no fillet | 2.3 mm on the arm, 0.5 mm fillets, tapering tip: passes |
| Rod barb | 0.5 mm joint to its finger | 1.4 mm: passes |
| Tongue crush ribs | (new) | 1.8 mm where they grow out of the face: passes as a tooth |
| Divider between the tongues | 0.7 mm wall | **0.7 mm, kept**, flagged in the test with its reason: two tongues' back faces 0.15 mm off it leave that much; it is welded to the floor and both walls (29 mm²) |

**Why the leaves went, and what replaces them.** A spring that presses for good has to stay at 0.2% strain or less at rest, or it creeps and takes a set. The leaves sat at 0.7% and 0.4%. A leaf that takes up 0.2 mm at 0.2% has to be 13 mm long and carries 0.45 N: no use. So the anti-rattle is now **two crush ribs**, one on each front corner face of the tongue near its tip, 1.8 mm where they grow out of the face, a 0.3 mm crest standing 0.4 mm proud. The socket's corner faces are 0.28 mm off the tongue's, so a rib is pressed 0.12 mm. They are **meant to deform once**, on the first push in, to the socket's real size. A printed line crushes at about 15 MPa (an assumption, not measured): about 12 N a rib, so about 24 N once for the two, and the holder is snug and centred after. The tongue is otherwise a slip fit: 0.2 mm a side, 0.14 to 0.2 front and back, and 0.65 mm of lift. A holder can rattle by those amounts.

### The flexure table

`src/fea/flexures.ts` (rows from `dockflex.ts` and `boardflex.ts`) holds every printed spring to one rule: at most 1% strain at full deflection and 0.2% at rest (a feature that deforms once, like a barb or a crush rib, may reach 1.5%, and says so), and 1.25% under a design overload (a 20 N pull). `tests/flexures.test.ts` runs them all.

| Flexure | kind | rest | full | 99% | |
|---|---|---|---|---|---|
| Socket latch beam | spring | 0.00% | 0.85% | 0.74% | 1.11% under a 20 N pull |
| Release rod, barb fingers | once | 0.00% | 0.96% | 0.73% | 0.25 mm each, 0.9 N |
| Tongue crush ribs | once | 0.00% | 1.4% at the rib's base | 0.9% | the crest yields on the first push in |

### What only a print can tell (this round)

- **The latch.** Whether a 15 degree undercut with 0.65 mm of play releases cleanly (the model has the nose rising 0.58 mm as it goes out, 0.16 mm over the undercut's; with none, 0.23 mm to spare), and whether a pull of 20 N with real PETG friction holds as the model says. Whether the soft beam (1.55 N/mm) gives a click you can feel.
- **The rod.** Whether the 0.3 mm at the gate and 0.4 mm in the bore are enough on your printer for a hole across the layers, and the finger's click. Whether the funnel and the neck fillets print cleanly.
- **The crush ribs.** The 15 MPa is a guess: they may need more or less than 24 N once, and the fit may want a different height (`CRUSH.proud`) on your printer, or the test-fit kit's `Tongue fit` looser.
- **The divider,** at 0.7 mm, printed standing.
