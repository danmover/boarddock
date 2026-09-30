# How the printed parts work

What BoardDock prints, why it is shaped that way, and how it is checked. For using the app, see [guide.md](guide.md); for printing, [printing.md](printing.md); for what is untested, [limits.md](limits.md). Back to the [README](../README.md).

Contents:
- [The dock](#the-dock)
- [The holder](#the-holder)
- [How the board is held](#how-the-board-is-held)
- [Plug cradles and caps](#plug-cradles-and-caps)
- [Stacks and columns](#stacks-and-columns)
- [Table stands](#table-stands)
- [Cable routing](#cable-routing)
- [Loose-holder joints](#loose-holder-joints)
- [Checks, FEA and printability](#checks-fea-and-printability)

Every figure here is from the model: exact geometry, hand sums, and a 2D FEA with a textbook modulus. One rack was printed from 3.0.0; nothing from 3.1.0 has been printed yet.

## The dock

Every board sits in a holder that plugs into a dock on the rail. This is the screwless "DIN hub" design, built into the generator:

| Part | What it does | Prints |
|---|---|---|
| **Rail shoe** (graphite, red lever) | Clips onto a TS35 rail. Its jaw wraps round the rail flange and hangs from a hinge leaf directly **above** the lip, so pulling the dock straight up can't pry it open. A sprung **rail grip** in the rail's channel presses the rail's wall and holds the shoe against its fixed hook, so a dock stays where you put it: about 6 N pushes one along the rail. The release lever is printed in place on a pin, with a bead round the pin's middle so it can't slide off; a built-in stop protects the hinge. The lever goes on whichever side of the rail has more room; you can flip it per dock. | on its end face, lever and all |
| **Socket** (blue) | Snaps into the shoe in any of four 90° turns and takes two holders back to back. It has two print-in-place latches: long tapered springs whose hooks are undercut 15°, so pulling on a holder draws the hook in rather than out. | on its end face |
| **Holder** | The frame (or tray) round your board, with a tongue on its dock edge and a spine that carries the release rod. | flat on its back |
| **Release rod** (red) | Its head is the **button on the holder's top edge**: a keycap with a thumb dish and chevrons that point the way it moves. Press it and the rod's 45° foot wedges the latch open; the latch spring returns it. The grip bar under your fingers has a matching finger scoop. | flat |

**The tongue** is 14 × 4.5 mm at the socket mouth and a slip fit: 0.2 mm a side, 0.14 to 0.2 mm front and back, and 0.65 mm of lift on purpose, for the undercut hook. Two **crush ribs** on its front corner faces stand 0.4 mm proud and are pressed 0.12 mm. They are meant to deform once, on the first push in (about 24 N, once; the crush stress is assumed, not measured), so the holder is then snug and centred. They replace 3.0.0's tongue stoppers, which snapped.

**The latch** reaches 1.4 mm into a groove across the tongue's front face, and its holding face slopes 15°. A pull on the holder tips the beam, and the undercut draws the nose back in: a 20 N pull moves it 0.4 mm of its 1.4 mm, and it slips only at about 69 N (friction not counted). It takes about 3.9 N to push a holder in and 2.5 N on the button, at 0.85% strain. There is no stop post: the button's stroke bounds the arm.

**The rod's tunnel** has 0.8 mm of play round the rod (0.4 mm each side), a 45° lead-in funnel and chamfers, and the rod's neck under the button is solid and filleted, so it slides in without forcing (3.0.0's tunnel was tight and the button broke). Push the rod in until it clicks: two barbed fingers spring out under a gate at the top of the tunnel (0.3 mm each side), once, so it can't slide back out.

**Using it:**
1. Hook the shoe under the rail and press it down until it clicks. To move it along the rail, push it firmly.
2. Press the socket in, in whichever turn you want.
3. Push the holder straight down into the socket until the latch clicks.
4. **To take a board out:** put your thumb on the red button and two fingers under the grip bar, squeeze, and lift.
5. **To take a dock off the rail:** lift the boards out, press the ridged red pad beside the socket down about 5 mm, and lift the dock off.

Where the button goes (**Centred**, **Beside the board** or **Automatic**) is set in the Holder step; see [guide.md](guide.md#the-holder-step).

![A Raspberry Pi 4 docked](images/holder-pi4.png)

*(This picture predates 3.1.0: its holder still has pins in the mounting holes.)*

### Lying flat

A board can also lie flat on its dock, top face up (out of the wall), on the same shoe and socket:
- Its holder has a tab, the **ear**, on one edge, flush with its underside, so the holder prints base-down like any other. The ear goes on an edge where it keeps clear of the plugs, as near the middle as it can.
- The tongue that plugs into the socket is a small **dock key** of its own, with a dovetail on top. It prints on its side, slides into a dovetail groove under the ear from the ear's tip, and the release rod locks it in: the rod goes in from the top, through the ear and the key, down to the latch, and clicks in under a ledge at the top of the ear, so neither can slide out.
- The release button sits on top of the ear, clear of the board. Put your thumb on the button and your fingers under the ear, then squeeze and lift.
- Two boards can lie back to back in one socket, ears together. A J-Link or serial adapter can stand in the other half of a flat board's socket. The shoe's lever goes on the side away from a flat board where it can.

Check lists the tongue's stress under a 20 N press on the far side of a flat holder (the same load case as a push on a standing holder's far edge). No flat holder has been printed yet.

## The holder

![Frame and tray holders](images/holders.png)

*(This picture predates 3.1.0: it shows split snap pins, which are gone, and no spring clips.)*

**Frame** (the default) combines the lean spine-and-rib carrier of the original DIN hub with the tray's protection:
- a rim runs round the board, under its edge and out to the holder's outline;
- short corner guards locate the board, and **edge seats** carry it wherever no pin is close;
- ribs, laid out as a minimum spanning tree, tie every pin to the rim or to the dock's spine;
- plug cradles, caps, guards, tie anchors, spring clips and the label each bring only the bit of wall they need.

**Tray** is the full base with a hex pattern and a wall all round: stiffer, and more plastic. A frame is open underneath (push the board out from below); a tray has finger notches.

Plastic in a loose holder with its clips, but no cradles, caps, guards, anchors or label (PETG, default settings):

| Board | Frame | Tray |
|---|---|---|
| Raspberry Pi 4 | 4.5 cm³ | 7.6 cm³ |
| Arduino Uno | 4.3 cm³ | 6.9 cm³ |
| Perfboard 50 × 70 | 3.8 cm³ | 6.4 cm³ |
| 60 × 40 blank | 4.3 cm³ | 5.5 cm³ |

So a frame takes about 20 to 40% less plastic than a tray. Cradles, caps and the dock tongue come on top and are the same for both styles.

## How the board is held

![A spring clip seen from the board: the tapered leaf, its lip, the pull ear, and the anchor it grows from](images/clips.png)

*(A straight tapered leaf beside a plain locating pin. Hairpins and fixed ledges are not in this picture.)*

Every board is held by **spring clips** on its edges. Each clip is a leaf standing straight up from the print bed at the board's edge, as tall as the holder there. It grows from a short block of wall (its anchor) along its whole height, with a rounded root, and is cut free of everything else by 0.6 mm slits, so it bends sideways, within the print layers: the strong way for a printed part.

- **Straight leaves taper** (a Pi 4's from 1.1 mm at the root to 0.7 mm at the tip, on Firm), so the bending strain spreads along the leaf instead of piling up at the root.
- **Hairpins.** Where a stretch of edge is short, the leaf folds back on itself, so its springy length is twice the stretch. For each stretch the generator takes a straight leaf when that reaches the push wanted inside the strain limit, and otherwise a hairpin. The tests hold 14 and 16 mm clips as straight leaves and 8 and 10 mm ones as hairpins, and a hairpin's peak strain under 0.85 times a straight leaf's at the same push.
- **Fixed ledges.** Where plugs take most of the edges, a fixed ledge goes on one side: the board slides under it, then the clips opposite click over it.
- **The lip** at a clip's tip has a 35° entry ramp, so the board's edge pushes the clip aside; a flat ledge over the board's edge that holds it down; and a small ear on top to hook with a fingernail.
- **Nothing loads a clip once the board is in.** The ledge sits on the first layer line above the board (0.15 to 0.35 mm clear of it), and the leaf stands 0.1 mm further out than the guards, so the board never leans on it. A clip strains only while the board goes past, so it can't creep or take a set.
- **Taking a board out:** pull one clip's ear back with a fingernail and lift that side; the other side then slides out from under its clip or ledge.
- **Printing:** every leaf stands on the bed, so the only overhang in a clip is its ledge, printed flat, 0.9 to 1.3 mm out from the leaf and deeper with the catch (Pico 0.9 mm, Pi Zero and Uno 0.95 mm, Pi 4 1.0 mm, a 250 mm board 1.3 mm). The Check line **Clips print** measures it.

**Sized for the board.** Leaf length follows the board's size: 10 mm for a small board up to 16 mm for the biggest, and down to 8 mm where a stretch of free edge is short. The catch is 0.5 to 1.0 mm deep, deeper for a heavier board. The push wanted from each clip is:
- **Firm:** 2.6 N plus 0.02 N for each gram the board weighs, up to 4.2 N;
- **Gentle:** about 46% of that (the ratio of 1.6 N to 3.5 N);
- never under 1.2 N, and never more than 30 N shared among all the clips, so a big board gets more, softer clips.

Each clip is then the stiffest leaf that gives that push while keeping its strain at full deflection (the catch plus the board's play) inside half the material's strain limit: 1.0% in PETG, against its 2%. That leaves a fatigue margin for many presses. If even the thinnest leaf would be over, the catch gets shallower. The library's boards measure 0.71 to 1.00% going in (a Pi 4 on Firm: 1.00%). A taller holder (a docked board stands higher) gets a thinner leaf for the same feel.

**Where they go.** A board resting on its seats can only tip about a line along their edge, so every such way needs a clip well back from it: two clips on opposite edges do that, or three round the board. More go along the outline so no stretch longer than about 130 mm is without one, and together they hold 1.5 times what a 9 g shake asks (4 N at least). A clip takes a clear stretch of edge, away from plugs, the dock, the label and parts at the edge. Round and L-shaped boards get them too. If clips can't hold a board, Check says **Nothing clips this board in** and what to change.

What some boards get (loose holder, PETG, Firm unless stated; from the Check lines **Spring clips (n)** and **Press-in force**):

| Board | Clips | Force to press the board in |
|---|---|---|
| Pico, Nano, Uno | two 10 mm hairpins | 3 to 4 N |
| Pi Zero | two 10 mm hairpins and a 6 mm fixed ledge | 3 to 4 N |
| Pi 4 | two 12 mm tapered leaves (1.1 to 0.7 mm on Firm, 0.8 to 0.7 mm on Gentle) | about 7 N (9 N docked) |
| 250 × 150 mm board | ten 16 mm leaves | about 32 N on Firm, 21 N on Gentle |

**Anti-rattle springs** are thinner leaves, 0.8 mm tapering to 0.6 mm, 14 or 16 mm long, whose lip has a 45° face resting on the board's top edge. Pushed 0.2 mm aside once the board is in, they press it across against the guards opposite and down onto its seats with 0.11 to 0.18 N each, at 0.08 to 0.11% strain at rest (up to 0.19% with the board 0.15 mm bigger; the Check line **Grip at rest**). That is under the 0.2% resting rule, so creep only slowly eases the push. One goes across the clips and one along them, where the edges have room. Some boards get none: the Nano has no free edge for one.

**No snap pins.** Earlier versions could also hold a board with split, barbed pins through its mounting holes. On the first real print they broke straight away, so they are gone. A mounting hole gets at most a plain locating pin that grips nothing (Board step › Hole wizard › **Pins in the mounting holes**: **Locating pins** or **Ignore**), and projects that asked for pins get clips.

The Check step lists, for each board, the clips' strain going in and its margin under the material's limit, the strain at rest, the force to press the board in, and that the clips print with no supports. The clip forces are beam sums with a textbook modulus, checked against 2D FEA in the test suite: a print will tell the real feel and the click.

## Plug cradles and caps

Only ports in use get a cradle, cap, guard or zip-tie anchor; every other port keeps just its opening in the wall (see [guide.md](guide.md#plugs-ports-and-protection) for when a port counts as in use).

- A **cradle** carries the mating plug's body outside the wall, so a knocked cable loads the holder, not the solder joints. Neighbouring cradles on one edge merge.
- A snap-on **cap** locks the plug into its cradle. It stands on tapered legs with rounded roots: at most 0.9% strain (0.70% in a Pi 4's run), down from 1.2% before 3.1.0. Check lists them as **Cap legs**.
- A **guard** collar surrounds an opening, and a **zip-tie anchor** sits on the side the cable is pulled to.

## Stacks and columns

How to stack boards is in [guide.md](guide.md#stacks-and-columns). How the stacks are built:

- **Bolted on standoffs.** The top board is lined up on the holes the two boards share (the Pi's 58 × 49 mm pattern, for example). BoardDock picks the shortest standard standoff (11, 12, 15, 16, 18, 20, 25, 30, 35 or 40 mm) that clears the tallest part under the top board, plus the parts and leads on its underside and 1 mm. A HAT's 11 mm is the least; a whole Pi 4 on a Pi 4 gets 20 mm, over its 16 mm USB jacks. The shared holes of the bottom board become stacking standoffs in the hole wizard: no pins there, and room underneath.
- **Printed layer.** A separate board gets its own light holder that presses onto four corner towers on the holder below, with press-fit pegs. The towers on a docked holder stay back from the dock face.
- **Columns.** Small boards, up to about 105 × 60 mm, stand on their long edges, the longest side along the rail. Each holder stands on two pegs on the holder below and rests on a landing on that holder's far wall. A peg has a 45° flare at its root and a lead-in tip; its hole has a matching 45° countersink, a gabled roof, and two crush ribs at its sides that centre the peg. They print lying on their side with no supports. The clips between two holders sit in the gap beside the landing, with room to flex (5.2 mm of room against 0.85 mm of travel).
- **One rod for the column.** The bottom holder plugs into the dock. The top one's release rod is longer and runs down through every holder to the dock's latch, so one press at the top frees the whole column from the rail. Check fails a rod longer than your printer's bed.
- **The tongue's limit.** The rack holds a column to what the dock's tongue can bear: in PETG, a J-Link and an adapter (about 85 mm) fit in one column, and two J-Links do not.
- **Plugs to the side.** Every board in a column, the bottom one too, stands on the long edge that keeps its plugs to the side. Below the top, a plug pointing up the column would put its plug and cradle where the holder above stands; a board that can't avoid it gets a **Plug up the column** line in Check.
- **A board nothing can clip in.** A small board whose ends are taken by its plugs, in a column where the dock and landing take its long edges, slides into its holder from the open end under two lips instead, and the holder above keeps it in.

## Table stands

![Table stands under two rails](images/stands.png)

There is no wall mount: BoardDock prints no screw holes and uses no screws. The rails are ordinary TS35 DIN rails, which come with slots for screws, so to hang a rack on a wall or in a cabinet, screw the rails up yourself and clip the docks on as you would on the stands.

The rails stand on printed sleepers (Rails step, **Table stands**, on by default):
- A sleeper crosses the rails at each end, and at least every 200 mm between.
- Each **rail end pushes 7 mm into an end block** with a TS35-shaped pocket. It caps the rail's lips and is a 0.3 mm slip fit (crush ribs there would flatten the first time and leave it loose).
- **Saddles** carry the rails in between. Their low cheeks stay under the dock shoes' jaws, so a saddle can sit under a dock.
- **Spacer bars** join the blocks. They slide in along the rail through dovetails, and set the rail spacing.
- The rails stand 10 mm off the table, so cables can run under them.

The pieces scale with the rack: more rails give more blocks and spacers, and longer rails give more sleepers. In the automatic layout every rail is cut to the same length, so the sleepers run straight across. Every piece is a profile printed on its end: no supports, and every load lies in the plane of the layers. An end block takes 3.6 cm³, a saddle 2.2 cm³ and a 150 mm spacer 2.5 cm³.

The Check step reports two hand calculations:
- the rail's sag between sleepers under a 20 N press, treating the rail as a steel beam;
- the stress in an end block's lip caps when you lift a rail end with 20 N: about 6 MPa, against PETG's yield of 45 MPa.

A lone rail gets short feet on each end block, for a wider footprint. **Tipping**: when the holders and boards reach more than 1.5 times as high above the table as the stands are wide at their narrowest, Check says so. That is a rule of thumb, not a calculation: a lone Pi on a short rail gets a note to hold the rack while plugging in; a big board standing on a short rail gets a warning, with ways to steady it (lay it flat, add a rail, space the rails wider).

## Cable routing

The panel routes every cable:
1. Out of its plug and clear of its own board. A plug pointing up out of a board standing on edge steps sideways off the board before going down; a plug pointing sideways drops, reaches further out first, or slopes straight into a lane it faces. A drop that would land on a sleeper steps along the rail first.
2. Down to a **street** between the rails (or beside the outer ones), where each cable gets its own lane. Lanes are ordered so as few cables cross as possible.
3. Along the street and back up to the other plug the same way.

Every combination of these is checked against the bounding boxes of every holder, board, plug, dock, rail and stand piece, and the shortest route that hits nothing wins. If every route touches something, the cable is marked red in the 3D view and Check says what it runs into.

**Settling.** Then all the cables settle together, the way real ones do once they are plugged in. Each is a chain of beads:
- where two cross, one lies over the other; where they run together, they lie side by side;
- nothing goes through a holder, dock, plug or ribbon;
- each cable keeps its length, with a few per cent of slack in its free stretch;
- it has weight: a free span sags, never below the streets, and lies in the stands' combs where its street crosses them;
- it has stiffness, more the thicker it is: it runs straight out of each plug for about a bend's length, and bends nowhere tighter than about three of its own diameters;
- pushed out of anything, it goes back out on the side it was laid, so it never pops through a board;
- last, the ripples are smoothed out wherever that touches nothing.

Ribbons stay where they were laid and the rest settle round them. Check says how many places the planned routes met, warns about any pair still pressing on each other, and names any cable squeezed into a tighter bend than a cable likes.

Cables that cross under the rails are spread a cable width apart, each pinned to its own line; lanes stay between rails and stand blocks; a cable routed later keeps off the ways of earlier ones. A debug ribbon or jumper never blocks taking a holder off: over another board's dock it rises clear of that holder's lift-off and its release lever, or goes round the end of the dock. On the 144 test racks the collision check went from 458 to about 35 mm³ in all.

**Combs.** On table stands the streets run under the rails' level. Wherever a street crosses a sleeper, the spacer there carries a cable comb: one round-bottomed slot per cable, sized for it, with snap lips at the mouth.

**Lengths.** Every cable's length is measured along its route and rounded up to a standard length to buy (10% slack). Auto-arrange keeps cabled boards next to each other and puts each hub or charger in the middle of the boards it feeds (on a rack of six Pis and two chargers that took the longest cable from 66 to 51 cm, and the cable to buy from 4.3 to 3.5 m).

### Cable tags

Each cable gets two numbered tags. A tag is an open half-ring saddle that drops onto the cable, with a flag carrying the number raised so a second colour or a marker picks it out. A 2.5 mm zip tie goes round the cable and a groove in the saddle, so nothing on the tag flexes. (A ring that snaps round a stiff cable would have to stretch 8 to 30%.) Tags are printed flat and sized for typical cables (USB 4 mm, Ethernet 6 mm, HDMI 7 mm). In 3D they sit a hand-width from each plug.

## Loose-holder joints

How to use loose holders is in [guide.md](guide.md#loose-holders). The joints:

- **Side by side:** printed link bars join neighbouring holders.
- **Back to back:** a rivet. A rigid pin goes through both bases, with a head on one side and a neck beyond the other, and a U clip with two tapered arms 11 mm long slides onto the neck from the side. It bends within its layers (it prints flat), at 0.84% strain. The old split rivet reached 15%.
- **Stacked:** corner towers with press-fit pegs, as in a printed layer.
- **The pull-tab DIN clip** holds a holder flat on a rail. It has a long shallow jaw ramp, an even 0.8 mm leaf 17 mm long and a gusseted stop, and the holder's hooks on the plate are tapered beams. A rail grip like the shoe's presses the rail's top wall and holds the clip down on the top flange: a 6.4 N preload on a 14 mm clip, about 4 N to push it along. A box on the clip stands 2.3 mm up in its holder, clear of the clip's hooks. A plate standing off a holder's edge prints standing, so the tops of its two slots are 14.4 mm bridges (see [limits.md](limits.md)).
- **The stand socket** takes a round, square, hex or D-shaped post, or is a 1/4"-20 tripod nut trap.

## Checks, FEA and printability

The Check step lists every test, failing ones first (**Failing**, then **To look at**), each with **Show in 3D**. Tap the passing, to-look-at and failing tiles to see only those. An item to look at gets a verdict: **OK to print** when it is about using the rack (holding a holder while you plug in, cables touching, PLA's brittleness) and printing now wastes nothing, or **worth a look** when it may change what you print or how the rack is laid out. Where a fix is one click, the item has a button. Repeated lines fold into one row with a count. The boards' template reminders ("measure yours") are folded away at the bottom: tick each off with **Done** once you have.

What is checked, and how:
- **2D FEA in the app:** the dock's springs (the socket latch, the rail shoe's hinge and its rail grip) and the flat DIN clip, for your material. Press **Run dock FEA**.
- **Beam sums, checked against FEA in the test suite:** the spring clips, the plug caps and the rivets.
- **Hand calculations:** the stands, the tongue's stress, and tipping.
- **Mains near low-voltage** warns when a mains outlet, inlet, lead or plug pack comes within 10 mm of a low-voltage board or cable, on a rack on rails. The 3D view shades the same zones. It is a layout check: BoardDock can't check your powerboard, its lead, earth or the wall socket.

### Printability, layer by layer

![Printability, sliced](images/printcheck.png)

*(This picture predates 3.1.0: its 15.2 mm bridge came from wall snap fingers that are gone.)*

The Check step slices every distinct part into 0.2 mm layers in the pose it prints in and compares each layer with the one under it, the way a slicer sees it (in a background worker, once per part shape). Measured from each part's own bottom:
- **In mid-air:** anything with nothing under it would need support: the part says **needs support**. A fleck thinner than one line (or a single layer under 0.5 mm²) is only a *speck*, which slicers leave out, and is noted, not failed.
- **Overhangs and bridges:** how far each layer reaches past the one below, measured inside the layer from the wall that holds it. Held from opposite sides it is a bridge; from one side, an overhang. Overhangs: fine to 2 mm, a warning to 3 mm (or to 2 mm over more than 20 mm²), then **needs support**. Bridges: fine to 12 mm, a warning to 25 mm, then failed.
- **Sloped roofs:** a roof flatter than 45° is followed layer after layer: a warning once it runs out more than 3 mm, a failure past 10 mm.
- **A tiny foot:** a part taller than 5 mm whose first layer is under a tenth of its biggest one is failed (it would be knocked over).
- **Thin walls:** anything under 0.4 mm wide. In BoardDock parts they are only details of the engraved label and the button's chevrons.
- **Narrow gaps:** a slot under 0.3 mm prints closed. That matters only where something moves, and the check finds it by the gap's width, so a 0.09 mm print-in-place gap is flagged. The shoe's lever has 0.35 mm round its pin, and the socket's latch nose 0.45 mm round it in its window.

As measured before 3.1.0, across the library (209 distinct parts: every template in each pose, the stacks and pairs, the rack parts and the test-fit kit), nothing was in mid-air, the longest one-sided overhang was 1.6 mm and the longest bridge 9 mm, except the DIN plate's slot tops (14.4 mm bridges, a warning). That survey has not been redone since 3.1.0's hairpins, fixed ledges, undercut latch, crush ribs and rod gate; the clip ledges now reach 1.3 mm.

An audit of the first parts with this check found and fixed: wall snap fingers that were 8 to 14 mm one-sided overhangs (now the spring clips); flat roofs over plug openings and stand sockets (now 45° gables, so no flat roof is over 6 mm); a 14.8 mm bridge in a tray's wall; probe and adapter slot lips that were 1.9 mm flat ledges (now 0.8 mm, then 45°); rivets that printed 1.3 mm below the bed; and thin slivers under overhanging plugs.

### Dock FEA

![Dock FEA](images/fea.png)

*(This picture predates 3.1.0 and shows the old latch figures; the table below is current.)*

The FEA is 2D plane stress:
- **Elements:** incompatible-mode quads, validated against beam theory in the test suite.
- **Mesh:** square pixels, 0.1 mm (or 0.06 mm with the fine option).
- **Scaling:** each case is solved for a unit load and scaled to the travel it has to reach.

PETG results (E = 2100 MPa, strain limit 2%), as the test suite holds them:

| Case | Force | Peak strain | 99% of the part below |
|---|---|---|---|
| Latch: holder pushed in (nose moves out 1.4 mm) | about 3.9 N | 0.74% | – |
| Latch: button pressed right home | 2.5 N | 0.85% | 0.74% |
| Latch: a 20 N pull on the holder | holds: the nose moves 0.4 mm of its 1.4 mm, and slips only at about 69 N (friction not counted) | 1.1% | – |
| Rail shoe: lever pad pressed down (jaw opens 1.7 mm for about 5 mm of pad travel) | 2.4 N | 1.7% | 0.55% |
| Rail shoe: pressed onto the rail | 4.3 N | 1.7 to 1.9% | 0.5% |
| Rail shoe: pulled straight up off the rail | holds to about 130 N pulled centred, 87 N on one hook | 1.7 to 2.3% at 100 N | 0.4% |
| Rail shoe: rail grip, its pad pressed 0.35 mm by the rail's wall | 9.6 N preload (5.5 to 14 N over tolerance), about 6 N to slide a dock along | 1.1% | 0.6% |

### What the analysis changed

Compared with the original DIN hub (the details are in [din-clip-review.md](din-clip-review.md)):
- **Pull-off.** The original jaw hung from a hinge outboard of its lip, so pulling the dock off the rail pried it open, and in the model only friction held it (without friction it let go at about 14 N). The jaw now wraps the flange edge with its hinge leaf directly above the lip, so a pull runs straight down the leaf. The leaf is a uniform 0.9 mm (two 0.45 mm lines).
- **Press-down lever.** A lever printed in place on a pin releases the jaw: about 2.4 N over 5 mm of pad travel. Its hub is 0.35 mm clear of the body at the least, a bead on the pin runs in a groove so it can't slide off, and the neck is tapered and filleted, so it reaches its strain limit only at about 28 N on the pad.
- **Rail grip.** The shoe only located on the rail. A sprung pad now presses the rail's wall from inside its channel with 9.6 N and holds the shoe on its fixed hook: about 6 N to slide it (friction 0.3). A tooth stops a knock across the rail. The pull-tab clip has the same grip.
- **Socket latch.** After the first print, the flat catch became a 15° undercut hook on a long tapered beam, and the stop post went.
- **Release rod.** It clicks into its tunnel and stays, which also holds a flat holder's dock key in its dovetail. The shoe is about 10.5 cm³.

### Rules the test suite holds

Two rules came in with 3.1.0. The test suite checks them (`tests/flexures.test.ts`, `tests/joints.test.ts`); they are not lines in the Check step.
- **Every printed spring** (`src/fea/flexures.ts`): at most 1% strain at full deflection and 0.2% at rest, so it neither wears out nor creeps. A feature that deforms once, such as a crush rib or a barb, may reach 1.5%, and a spring may reach 1.25% under a design overload such as a 20 N pull.
- **Every stop and catch** (`src/cad/joints.ts`) joins its part at least 1.2 mm wide, inside its own print layer. The tongue stoppers that snapped in the first print did not.
