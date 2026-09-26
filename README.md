# BoardDock

**Dock any PCB. No screws. No supports.**

BoardDock turns a PCB design, or a few measurements, into 3D-printable holders:
- It fits a light frame holder around each board's parts, holes and plugs.
- It docks every holder onto DIN rails, horizontal or vertical, and turns each board so every plug stays reachable.
- Boards stack: a HAT or shield bolted on its standoffs, or a separate board on a printed layer.
- A button on top of each holder releases the board; a press-down lever releases the dock from the rail.
- Printed table stands hold the rails. Cables between the boards are routed clear of everything, sized and combed automatically.
- The 3D view walks you through the assembly one step at a time, in the order you would really do it.
- Come back later to add a board: the rest of the rack stays where it is, and Export gives you only the new parts, cables and rails.

Everything is checked with FEA and packed onto as few print plates as possible.

![A panel of boards on a DIN rail](docs/images/hero.png)

- **Imports:** KiCad, Altium (via STEP or Gerber), Eagle, IDF, DXF and Gerber + drill + pick-and-place.
  - You can also draw a board by hand or start from a template.
- **Hole wizard:** sorts every hole into mounting holes (they get pins), connector pegs, part leads and stacking standoffs (kept clear, with room underneath). You can change any of them.
- **Fits holders automatically:**
  - **Frame** style (default): a rim round the board, corner guards, edge seats, and ribs laid out as a minimum spanning tree to every pin. It uses 25–50% less plastic than a full tray. The **tray** style is still there.
  - Snap pins in the mounting holes, or snap fingers on the edges.
  - Clearance for the board's underside, openings for every plug.
- **Protects plugs:** each connector gets a cradle that carries the mating plug's body, so a knocked cable loads the holder, not the solder joints. A snap-on cap locks the plug in.
- **Builds panels:**
  - Any number of rails, each horizontal or vertical.
  - Docks that turn four ways and take two boards back to back.
  - Stacks of boards on one dock.
  - One rail, rows or columns, laid out automatically, with boards that are cabled together kept next to each other. Then drag boards between slots, rails and stacks in the rack tree, or in the Rails view.
  - Boxes such as USB hubs, USB chargers and power boards, on their own rail. You set how many ports they have, of what type, on which face (top included) and what each one is for.
  - **Table stands:** printed sleepers across the rails, with cable combs.
- **Cables:** Auto-connect works out which plug goes where (power, USB host, hub and device ports) and says when you are short of hub or charger ports. You can connect plugs by hand in the Wiring view. Every cable is routed clear of the holders, boards, docks, rails and stands, and sized to a standard length you can buy.
- **3D view:**
  - Boards show copper traces, vias, silkscreen, parts and plugs. The traces are real for KiCad files and decorative for other boards.
  - Click anything (a board, a dock, a rail, a cable, a table stand, or one feature of a holder such as a cradle, cap, pin or finger) to see it and edit it.
  - Shift-click to pick several, then Delete to remove them all in one undoable step.
  - Play the assembly step by step, or pull it apart with the explode slider.
- **Checks:** hand calculations for every snap, plus 2D FEA of the dock's springs (the socket latch and the rail shoe hinge) for your material. A printability check finds every overhang and bridge; the print view can paint them.
- **Easy to correct:**
  - Switch cradles, caps, tie anchors, guards, fingers or labels off for a whole holder, or remove single ones in 3D.
  - Hide small parts, ignore holes, strip plug protection, or revert to the import, for one board or all of them.
- **Efficient:**
  - Only changed holders are rebuilt: moving or turning docks takes milliseconds.
  - Sturdy, balanced and lean presets; duplicate a board.
  - A tongue-fit tolerance and a 30–40 minute test-fit kit to print before the real thing.
- **Exports** binary STL or 3MF, one file per print plate, packed onto your printer's bed.
- **Open source** (MIT). It runs in the browser or as a desktop app for Windows, macOS and Linux.

## Download

| | |
|---|---|
| **Desktop app** | [Releases](https://github.com/danmover/boarddock/releases): Windows installer or portable `.exe`, macOS `.dmg`, Linux `.AppImage` / `.deb` |
| **Web app** | [danmover.github.io/boarddock](https://danmover.github.io/boarddock) (nothing is uploaded; all processing runs in your browser) |
| **From source** | `npm install` then `npm run dev` (see [Development](#development)) |

The desktop builds are not code-signed yet:
- On **macOS**, right-click the app and choose **Open** the first time.
- On **Windows**, choose **More info → Run anyway**.

## Quick start

1. **Start:** drop your board files (several at once is fine: each becomes a board) anywhere in the window, or pick templates, hubs and chargers. Once you have a project, everything you drop or pick is added to it.
2. **Board:** check the outline, parts and the hole wizard; fix anything in the board editor.
3. **Plugs:** pick the plug type and size for each connector, and what each one is cabled to (or press **Auto-connect**).
4. **Holder:** frame or tray, a preset, where the release button goes, and the features you want.
5. **Rails:** BoardDock has already placed every board on a rail. Pick one rail, rows or columns; drag, turn, pair or stack boards if you like.
6. **Check:** read the notes and run the dock FEA for your material.
7. **Export:** download the plates and print them in PETG. The shopping list has the rail lengths, the cables (length and plug types), straps and standoffs. The download's README has the assembly steps.
8. **Build it**, following the play button in the 3D view. Then press **Mark the rack as built** in Export.

Every step has **Back** and **Next** at the bottom of the sidebar.

![Start screen](docs/images/start.png)

## The dock

Every board sits in a holder that plugs into a dock on the rail. This is the screwless "DIN hub" design, built into the generator:

| Part | What it does | Prints |
|---|---|---|
| **Rail shoe** (graphite, red lever) | Clips onto a TS35 rail. Its jaw wraps round the rail flange and hangs from a hinge leaf directly **above** the lip, so pulling the dock straight up can't pry it open. **To remove it:** lift the boards out, press the ridged red pad beside the socket down about 8 mm, and lift the dock off. The lever is printed in place on a pin; its hook pulls the jaw off the flange and the jaw spring lifts it back. A built-in stop protects the hinge. The lever goes on whichever side of the rail has more room; you can flip it per dock. | on its end face, lever and all |
| **Socket** (blue) | Snaps into the shoe in any of four 90° turns and takes two holders back to back. It has two print-in-place latches. | on its end face |
| **Holder** | The frame (or tray) around your board, with a tongue on its dock edge and a spine that carries the release rod. | flat on its back |
| **Release rod** (red) | Its head is the **button on the holder's top edge**: a keycap with a shallow thumb dish, rounded corners and chevrons that point the way it moves. It uses 11% less plastic than the old square button. Press it and the rod's 45° foot wedges the latch open. The latch spring returns it. The grip bar under your fingers has a matching finger scoop. | flat |

**Using it:**
1. Hook the shoe under the rail and press it down until it clicks.
2. Press the socket in, in whichever turn you want.
3. Push the holder straight down into the socket until the latch clicks.
4. **To take a board out:** put your thumb on the red button and two fingers under the grip bar, squeeze, and lift.

**Where the release button goes** (Holder step, per board):
- **Centred** (the default): the button sits in the middle of the holder's far edge, and the spine that carries its rod runs under the board, which sits about 10 mm up.
- **Beside the board:** the spine, grip bar and button run beside the board, so the board sits low and the far edge stays free for plugs.
- **Automatic:** whichever keeps the plugs clear with the least plastic.

Plugs always win: if the button would block one, it moves.

![A Raspberry Pi 4 docked](docs/images/holder-pi4.png)

## The holder

![Frame and tray holders](docs/images/holders.png)

**Frame** (the default) combines the lean spine-and-rib carrier of the original DIN hub with the tray's protection:
- a rim runs round the board, under its edge and out to the holder's outline;
- short corner guards locate the board, and **edge seats** carry it wherever no pin is close;
- ribs, laid out as a minimum spanning tree, tie every pin to the rim or to the dock's spine;
- plug cradles, caps, guards, tie anchors, snap fingers and the label each bring only the bit of wall they need.

**Tray** is the full base with a hex pattern and a wall all round: stiffer, and more plastic.

Plastic in a holder with no cradles or clip:

| Board | Frame | Tray |
|---|---|---|
| Raspberry Pi 4 | 4.0 cm³ | 7.8 cm³ |
| Arduino Uno | 4.3 cm³ | 7.2 cm³ |
| Perfboard 50 × 70 | 4.7 cm³ | 6.8 cm³ |
| 60 × 40 blank | 4.4 cm³ | 5.8 cm³ |

Cradles, caps and the dock tongue come on top of these and are the same for both styles.

## Hole wizard

Not every hole is for mounting. The wizard sorts them when a board comes in, and you can change any hole or group:

| Kind | Found by | The holder |
|---|---|---|
| **Mounting hole** | no part on it, near a corner or edge, 2.2–4.5 mm | puts a locating or snap pin through it |
| **Connector peg** | inside a connector's body (RJ45 pegs, USB shell tabs, jack pins) | leaves it free, with a pocket underneath |
| **Part lead** | inside a part, or in a row at header pitch | leaves it free, with clearance for the leads |
| **Stacking standoff** | lines up with a hole of a board bolted on top | leaves it free, with room for the screw head or nut |
| **Ignored** | set by hand | does nothing |

The board editor colours every hole by its kind.

## Stacks

A board can sit on top of another; the bottom one carries the dock. In the **Rails** step, drag a board onto another board, or pick **on top of…** in Stacks. There are two kinds:
- **Bolted on standoffs:** a HAT on a Pi, a shield on an Arduino. The top board is lined up on the holes the two boards share (for example the Pi's 58 × 49 pattern), and shown on standoffs of the length you set (11 mm by default). The shared holes of the bottom board become stacking standoffs in the hole wizard: no pins there, and room underneath.
- **Printed layer:** a separate board gets its own light holder that presses onto four corner towers on the holder below, with press-fit pegs. The towers on a docked holder stay back from the dock face.

Bolted is chosen automatically when at least two holes line up; you can switch it.

## The panel

![Rails step](docs/images/panel.png)

The **Rails** step shows the whole rack as a tree: rails, docks, the front and back slot of each dock, and stacked boards under the board they sit on. Chips show where the plugs point. Drag a board onto:
- a slot, to seat it there;
- a rail, for a new dock at its end;
- another board, to stack it;
- **+ Rail**, for a new rail with it;
- the tray, to take it off the rails.

Quick layouts are **one rail**, **rows** (a new rail when one gets longer than your limit) and **columns** (vertical rails).

The **Rails** view shows the rack from above: rails, table stands, docks, and every board's footprint. Arrows show where each board's plugs point:

| Mark | Meaning |
|---|---|
| **◉** | points up |
| **✓** | reachable from the side, where the cables run |
| **⚠** | points at the next dock on the rail |
| **✕** | points down into the table |

**Auto-arrange** (on by default):
- Tries every dock edge and all four turns for each board, and picks the one with the best plug access.
  - It never lets a plug point into the table.
  - It keeps the release button clear of plugs, and prefers boards that stick out less.
- Pairs boards back to back in one dock when that costs nothing in plug access.
- Packs the docks along the rail using their real 3D size, including plugs, cradles and buttons.
- Starts a new rail when one gets longer than your limit. Boxes such as hubs and chargers get a rail of their own.
- Keeps boards that are cabled together next to each other.
- Settings: rail direction, longest rail, gap between docks, space between rails, and pairing on or off.

**Editing by hand.** The first edit keeps everything where it is and switches to manual.

| Action | How |
|---|---|
| Move a dock along its rail | drag it, or use the arrow keys (Shift = 10 mm) |
| Move a dock to another rail | drag it onto that rail |
| Move a rail | drag the rail |
| Turn a dock 90° | **R** (Shift+R turns the other way) |
| Swap front and back boards | **F** |
| Select several docks | Shift-click, or drag a box; ⌘A selects all |
| Remove | Delete |
| Put a board on the panel | drag it from the board list onto a rail (new dock) or onto a dock (shares it back to back) |

The inspector sets:
- dock or flat clip;
- which side of the rail the release lever is on;
- turn, with a picture of each turn;
- rail and position;
- the board in each slot;
- which board edge goes into the dock, or Auto;
- rail direction, position and length (fixed, or cut to fit).

**Overlaps** between neighbours are hatched red. The Check step lists the rails to cut and how tall the rack stands.

## Hubs, chargers and other boxes

A box is a size and rows of ports (Board step, **Box**). Pick a preset (USB hub, powered 7-port hub, USB-C hub with Ethernet, USB charger, USB charger with USB-C) or set your own:
- length, width and height;
- any number of rows of ports: how many, which type (USB-A, USB-C, micro-USB, USB-B, DC barrel, mains, RJ45, HDMI, audio, screw terminals), on which face (front, back, either end or the top), and what they are for (hub port, upstream, power out, power in, and so on).

![Box editor with a 7-port powered hub](docs/images/box.png)

Ports are spaced evenly along their face, and a preview shows where they are. Every port knows its role, so Auto-connect never has to guess whether a USB-A socket on a box takes a device or gives power. Ports on the top get plugs standing in them, and the strap loops move to miss them. If ports don't fit their face, the editor says so. Fewer ports keep the first ports' names, so cables to them stay; cables to ports you remove go.

The Plugs step counts what still needs a port: USB devices against free hub and computer ports, and boards that need power against free charger ports. When you are short, it offers to add a hub or a charger. A stacked pair of USB-A sockets, like on a Raspberry Pi, counts as two ports.

## Table stands

![Table stands under two rails](docs/images/stands.png)

The rails stand on printed sleepers (Rails step, **Table stands**, on by default):
- A sleeper crosses the rails at each end, and at least every 200 mm between.
- Each **rail end pushes 7 mm into an end block** with a TS35-shaped pocket. It caps the rail's lips, and crush ribs make it a light press fit.
- **Saddles** carry the rails in between. Their low cheeks stay under the dock shoes' jaws, so a saddle can sit under a dock.
- **Spacer bars** join the blocks. They slide in along the rail through dovetails, and set the rail spacing.
- The rails stand 10 mm off the table, so cables can run under them.

The pieces scale with the rack: more rails give more blocks and spacers, and longer rails give more sleepers. In the automatic layout every rail is cut to the same length, so the sleepers run straight across. Every piece is a profile printed on its end: no supports, and every load lies in the plane of the layers.

| Piece | Plastic |
|---|---|
| End block | 3.6 cm³ |
| Saddle | 2.2 cm³ |
| Spacer, 150 mm | 2.5 cm³ |

The Check step also reports two hand calculations:
- the rail's sag between sleepers under a 20 N press, treating the rail as a steel beam;
- the stress in an end block's lip caps when you lift a rail end with 20 N: about 6 MPa, against PETG's yield of about 50 MPa.

## Cables

![Wiring view](docs/images/wiring.png)

Each plug gets a role from its type, its name and its board:
- a Raspberry Pi's USB-A ports are hosts, and its USB-C is its power input;
- an Arduino's USB-B is a device, and its barrel jack is an optional 7–12 V input;
- a hub's ports feed devices;
- a charger's ports give power.

**Auto-connect** pairs the free plugs, nearest boards first:
1. hubs to hosts;
2. power inputs to chargers (or to hub or host ports);
3. devices to hubs (or hosts).

You can also connect plugs by hand. In the **Wiring** view, click a plug, then the plug it goes to; plugs that fit light up green. In the Plugs step, pick **Cable to** for any plug.

The panel routes every cable:
1. Out of its plug and clear of its own board. A plug pointing up out of a board standing on edge steps sideways off the board before going down; a plug pointing sideways drops, reaches further out first, or slopes straight into a lane it faces. A drop that would land on a sleeper steps along the rail first.
2. Down to a **street** between the rails (or beside the outer ones), where each cable gets its own lane. Lanes are ordered so as few cables cross as possible.
3. Along the street and back up to the other plug the same way.

Every combination of these is checked against the bounding boxes of every holder, board, plug, dock, rail and stand piece, and the shortest route that hits nothing wins. If every route touches something, the cable is marked in red in the 3D view and the Check step says what it runs into.

On table stands the streets run under the rails' level. Wherever a street crosses a sleeper, the spacer there carries a **cable comb**: one round-bottomed slot per cable, sized for it, with snap lips at the mouth.

Every cable's length is measured along its route and rounded up to a standard length to buy (10% slack). Auto-arrange keeps cabled boards next to each other, so the cables stay short.

## The 3D view

![The 3D view](docs/images/rack.png)

| Action | How |
|---|---|
| See what something is | hover over it |
| Select a board, dock, rail, cable, table stand, or one holder feature (cradle, cap, pin, finger, guard, tie anchor, label, stand socket) | click it |
| Select several | Shift-click |
| Remove the selection (a cradle or cap is switched off, a pin becomes an ignored hole, a dock, rail or cable is removed, a board leaves the project, table stands are switched off) | Delete, or **Remove** in the bar below the view; one ⌘Z brings it all back |
| Jump to the settings of the selected thing | **Edit** in the bar |
| Fly to a part | double-click it |
| Watch it go together | the play button. It goes step by step, the way you would build it, with an instruction for each step: saddles on the table, rails in, end blocks on, spacers in, shoes clipped on, sockets in; then for each board, its release rod into the spine, the board into its holder, anything stacked on it, and the holder into its dock; then the cables (power first), and the caps. **‹ ›** step back and forward; **✕** shows it assembled. |
| Pull it apart | the **Explode** slider |
| Show or hide holders, docks, caps, boards, plugs, rails or cables | **Layers** |
| See every keyboard shortcut | **?** |

![Stepping through the assembly](docs/images/steps.png)

It uses studio lighting with ambient occlusion. Boards get:
- a solder mask with copper traces and vias: the real ones from KiCad files, and a decorative pattern, only for looks, on every other board;
- silkscreen;
- gold pads and pins;
- chips, passives and LEDs.

Plugs show their shells, tongues and pins. The view draws a frame only when something changes.

## Coming back to add a board

Once the rack is built, press **Mark the rack as built** in Export. BoardDock remembers what you printed, the rail lengths you cut and the cables you bought, and freezes the layout: every dock keeps its place, turn, lever side and board edges.

Later, open BoardDock. A saved rack opens on **Your rack**, with its boards, whether it is built, and buttons for the rails, the cables and what's new to print. Drop the new board's files in. It goes:
1. into the empty slot of a dock already on the rack, if it fits there with all its plugs reachable and without touching anything (then only its holder is new);
2. otherwise into the first gap on the rails that is clear in 3D, preferably on the rail of a board it is cabled to;
3. otherwise on the end of a rail, and Export tells you that rail has to be longer.

Nothing else moves. Connect its cables (Auto-connect only fills plugs that are still free). Export then lists only what's new since the build: the parts to print, the cables to buy and any rail to cut longer. Plates, the estimate and the download follow that list. Press **I've built these too** when you have.

## Supported files

| Source | What to export | What BoardDock reads |
|---|---|---|
| **KiCad** 6–9 | the `.kicad_pcb` file | outline (lines and arcs), holes, footprints with courtyard sizes, top and bottom parts, copper traces and vias |
| **Altium Designer** | *File → Export → STEP 3D*, or Gerber + NC drill + pick-and-place | STEP: board outline, holes and part bodies. Fab files: outline, holes, parts. |
| **Fusion 360 / Eagle** | the `.brd` file, or STEP | outline, holes, packages |
| **EasyEDA / JLCPCB** | Gerber zip + CPL (pick and place) | outline, holes, parts |
| **Any EDA tool** | IDF 3.0 (`.emn` + `.emp`) | outline, cut-outs, holes, part outlines and heights |
| **Mechanical drawing** | DXF | outline and round holes |
| **No files** | draw it, or start from a template (Raspberry Pi 4 / Zero / Pico, Arduino Uno / Nano, perfboard) | |

Connectors are recognised by footprint name: USB-C, micro and mini USB, USB-A and B, HDMI, RJ45, barrel jacks, 3.5 mm audio, microSD, SMA, Qwiic, terminal blocks, JST and pin headers. Each one gets a plug size you can change.

Altium `.PcbDoc` files use a proprietary binary format. Export STEP or fabrication files instead; BoardDock explains this if you drop one in.

## Loose holders

Choose **Loose holders** in the Panel step for holders without a rail dock:
- **stacked** on corner towers with press-fit pegs;
- **side by side** with printed link bars;
- **back to back** with snap rivets.

Each holder can also have a flat pull-tab DIN clip or a **stand socket** (round, square, hex or D-shaped post, or a 1/4"-20 tripod nut trap).

| Stacked | Side by side |
|---|---|
| ![Stacked](docs/images/stack.png) | ![Side by side](docs/images/side-by-side.png) |

## Checks and FEA

![Dock FEA](docs/images/fea.png)

The FEA is 2D plane stress:
- **Elements:** incompatible-mode quads, validated against beam theory in the test suite.
- **Mesh:** square pixels, 0.1 mm (or 0.06 mm with the fine option).
- **Scaling:** each case is solved for a unit load and scaled to the travel it has to reach.

PETG results (E = 2100 MPa, strain limit 2%):

| Case | Force | Peak strain | 99% of the part below |
|---|---|---|---|
| Latch: holder pushed in (nose moves out 1.3 mm) | about 10 N push | 1.6% | 1.0% |
| Latch: button pressed (nose clears the groove after 1.9 of 3.1 mm) | 3.2 N | 1.2% | 0.8% |
| Rail shoe: lever pad pressed down (jaw opens 1.7 mm for about 8 mm of pad travel; the stop engages at 2.2 mm of jaw travel) | 1.4 N | 1.6% | 0.55% |
| Rail shoe: pressed onto the rail | 4.3 N | 1.7–1.9% | 0.5% |
| Rail shoe: pulled straight up off the rail | holds to about 90–120 N (the hinge's strain limit), friction or not | 1.7–2.3% at 100 N | 0.4% |

**Design changes that came out of this analysis**, compared with the original DIN hub:
- **Pull-off.** The original jaw hung from a hinge outboard of its lip. Pulling the dock off the rail pried the jaw open, and in the model only friction held it: without friction it let go at about 14 N. The v3 "C-jaw" wraps round the flange edge with the hinge leaf directly above the lip, so a pull runs straight down the leaf. It no longer depends on friction; the jaw moves about 0.03 mm per 100 N. The shoe is also 5% lighter.
- **Hinge leaf.** The lever pushes from above the hinge, so its bending peaks at the leaf's lower end. A uniform 0.9 mm leaf (two 0.45 mm lines) replaces the old 0.84–1.14 mm taper.
- **Pinch ear (v4).** The short thumb pad sat 14 mm below the socket top and was hard to reach. The lever post now rises into a tall ridged ear whose top is 3 mm under the socket top. With the holders out, you pinch the ear and the socket together with one hand. The longer lever roughly halves the force. The ear's top lip also lets you pull it: the lip is 8 mm outboard of the hinge leaf, so a pull turns the jaw open before it can lift the dock. The shoe grows 8% (7.8 to 8.5 cm³).
- **Press-down lever (v5).** Pinching the ear worked, but it looked clumsy and needed two opposing fingers. The ear is gone. Instead, a lever is printed in place on a pin at the top of a slim tower beside the socket, inside a C-shaped hub that wraps 290° so it can't come off. Pressing its ridged pad down about 8 mm makes the hook underneath pull the jaw's post toward the socket, and the jaw swings open about its leaf. The existing stop still limits the travel, and the jaw spring lifts the lever back. The release force is about 1.4 N. The shoe is 10.0 cm³.

## Printing

- **Material: PETG.** Every dock part is a spring. PLA is stiffer and more brittle, so strains that are fine in PETG are marginal in PLA. The Check step judges each part against your material's limit.
- **Printer:** pick yours in Export. The list has 18 printers: Bambu Lab X1 Carbon, P1S, A1 and A1 mini; Prusa CORE One, MK4S, MK3S+, MINI+ and XL; Creality K1C, Ender-3 V3 SE and Ender-3 S1; Voron 2.4 and Trident; Elegoo Neptune 4 Pro; Anycubic Kobra 3; Sovol SV06; and Qidi Q1 Pro. Bed size and build height come from the machine profiles in [OrcaSlicer's open profile library](https://github.com/OrcaSlicer/OrcaSlicer/tree/main/resources/profiles). Parts are packed onto that bed, and any part taller than the build height is flagged.
- **Print settings:** Export lists what to set in your slicer for your printer and material. Each setting shows where to find it in OrcaSlicer, Bambu Studio or PrusaSlicer, and is marked by where it comes from:
  - **design:** the parts need it. For example, 0.45 mm wall lines (the rail shoe hinge is exactly two of them), 0.2 mm layers, no supports.
  - **profile:** OrcaSlicer's generic filament profile (for example PETG: 255 °C nozzle, 80 °C bed, 20–100 % fan, 10 mm³/s), or your printer's machine profile (retraction).
  - **convention:** common practice, not a tested requirement. For example 3 walls, detect thin walls off, aligned seam, and a brim only for parts more than three times taller than they are wide.

  **Copy** puts the list on the clipboard, and the download's README has it too.
- **What to print:** everything, only what's new since you built the rack, or just the boards you tick (with or without their docks and the table stands). The plates, the estimate, the download and the plates view all follow the choice.
- **G-code, in the app:** press **Slice** next to a plate. [Kiri:Moto](https://grid.space/kiri/) (MIT, by Stewart Allen) slices it inside BoardDock with the settings above and your filament's temperatures, and shows the print time, the grams and each layer. You get a `.gcode` file, or a `.gcode.3mf` for Bambu Lab printers.
  - **Start and end code** comes from Kiri:Moto's own profile where it has one (Bambu Lab P1S and A1, Prusa MK3S+ and MINI, Creality K1, which the K1C uses too). BoardDock swaps the A1 and K1 profiles' fixed PLA temperatures for your filament's. Other printers get a plain start (heat, home, purge line) for Marlin or Klipper, marked as such. You can paste your own under **Start and end G-code**. The A1 mini and the XL are left to their makers' slicers.
  - Kiri:Moto is not the slicer the settings were written for. It has no first-layer (elephant-foot) compensation, and its speeds are set conservatively.
- **G-code, in your own slicer:** every plate is also a 3MF with all its parts placed. In the desktop app, **Open plate** hands it to OrcaSlicer, PrusaSlicer, Bambu Studio or Cura if one is installed. Your printer maker's slicer knows its quirks best.
- **Supports: none.** Overhangs are 45° chamfers or short bridges, round holes on their side are teardrops, and all springs flex within their print layers.
- **Plates:** each plate becomes one STL or 3MF file with every part already placed. The estimate shows grams and print time per part.
- **First print:** the **test-fit kit** in Export: a shoe, a socket and a small tongue key with its release rod, about 21 g. Clip it on your rail, plug the key in, press its button. If the key is tight, raise **Tongue fit** in the Rails step by 0.05–0.1 mm.
- **Check:** the Check step lists every part's overhangs and longest bridge. **Overhangs** on the print plates paints faces that would need support in red and bridges in amber. The generated parts need no supports; bridges are 5.4 mm at most.

## Honest limits

- Nothing here has been physically printed and tested yet. Fits, snap forces, creep and fatigue all depend on your printer and filament.
- The FEA is linear, 2D and idealised. It has no contact, friction or print anisotropy, and its peaks sit at pixel-mesh corners. Treat it as a comparison between designs, not a guarantee.
- Template boards come from the manufacturers' drawings; check yours. Imported part heights are only as good as the source (IDF and STEP are best).
- A large board docked by one tongue feels a sizeable lever when you plug in a stiff cable at the far end. The tongue is 14 × 4.5 mm at the socket mouth (a Raspberry Pi 4 holder: about 25 MPa for a 20 N push on its far edge, against PETG's ~45 MPa yield), and the Check step lists it for every board. Hold the holder while you plug in.
- The frame holder's stiffness is from geometry, not tested: the board itself stiffens the frame once it is clipped in.
- The rail release is reached with the holders out (they cover the lever). Taking a single board out is the button on the holder, which is always reachable.
- The table stands' press fit, the dovetails and the cable combs' snap lips are sized from typical FDM tolerances, not from test prints. The sag and cap-stress numbers are hand calculations.
- Plug roles for Auto-connect are guessed from connector types and names, except on boxes, where you set them; check the Wiring view.
- Cable routes are checked against bounding boxes. A route marked clear is clear; one marked as touching may still fit, since a box is bigger than the part inside it. Real cables are floppier and stiffer in places than the drawn tubes.
- "Only what's new" recognises parts by their geometry. If you change a holder setting after marking the rack as built, that holder counts as new even if you would not reprint it.
- A board that carries a stack is never put into another dock's empty slot automatically; place it by hand in the Rails step.
- The desktop app's **Open plate** looks for slicers in their usual install folders. It has not been tried with every slicer and operating system. If nothing opens, download the plate's 3MF and open it by hand.
- The in-app G-code has not been run on a printer. The start code comes from Kiri:Moto's community profiles or BoardDock's plain templates, not from the printer makers. Check the start of the first print, or use your own slicer.
- Slicing a full plate in the app takes much longer than a desktop slicer: seconds to a minute or more, depending on the plate and the computer.
- A board whose holes all carry the standoffs of a HAT has no pins; it needs room on its edges for two snap fingers, and the Check step says so when there isn't any.

## Development

```bash
npm install
npm run dev          # web app at http://localhost:5173
npm test             # vitest: importers, holders, panels, dock FEA
npm run typecheck
npm run build        # production web build in dist/
npm run desktop      # Electron app from the build
npm run dist         # installers for the current OS in release/
```

**Project layout:**

- `src/import/`: KiCad, Gerber, Excellon, pick-and-place, IDF, Eagle, DXF and STEP importers.
- `src/cad/`: geometry.
  - `generate.ts`: the holder around one board.
  - `dock.ts`: rail shoe, socket, tongue, spine and rod.
  - `dockplan.ts`: plug access, orientation and auto-assignment (no geometry kernel).
  - `panelgen.ts`: the panel (placement, rows, placing added boards, collisions, parts, assembly steps).
  - `cableroute.ts`: cable routes and their collision checks (no geometry kernel).
  - `railstand.ts`: table stands (sleeper layout, end blocks, saddles, spacers, cable combs).
  - `boardviz.ts`: board, part and plug detail for the 3D view (traces, vias, silkscreen, cable tubes).
  - `assembly.ts`: loose layouts.
  - `export.ts`: STL and 3MF output, plate packing.
- `src/fea/`: 2D solver (`fea2d.ts`), the flat clip (`clipfea.ts`), the dock (`dockfea.ts`), and a 3D beam solver for the holder's support ribs (`frame3d.ts`).
- `src/model/holes.ts`: the hole wizard and stacks (alignment on shared holes, bolted and printed layers).
- `src/model/links.ts`: plug roles, Auto-connect, the port budget and cable sizes.
- `src/model/boxes.ts`: boxes (hubs, chargers) from a size and rows of ports.
- `src/model/built.ts`: what was built, and what is new since.
- `src/ui/`: React UI.
  - `Viewer3D.tsx`: the 3D view, with picking, animation and explode.
  - `pickOps.ts`: what a selection is and how it is removed.
  - `RackBuilder.tsx`: the rails step.
  - `BoardEditor.tsx`, `PanelEditor.tsx` and `WiringView.tsx`: the 2D board editor, the Rails view and the Wiring view.
- `src/worker/`: geometry and FEA run in web workers.
- `src/model/printers.ts`: printers (from OrcaSlicer's machine profiles), filament settings (from its generic filament profiles) and the print settings list.
- `src/slice/`: in-app slicing with Kiri:Moto: printer start code and settings (`profiles.ts`), running the engine, reading the G-code back and the Bambu `.gcode.3mf` (`kiri.ts`).
- `vendor/kiri/`: how `public/kiri/` (the Kiri:Moto engine, its workers and printer profiles) is built from the grid-apps source.
- `electron/`: desktop shell; `preload.cjs` exposes finding installed slicers and opening a plate in one.
- `.github/workflows/`: CI, and a release job that builds installers for all three platforms and publishes the web app.

Geometry uses [manifold](https://github.com/elalish/manifold) (WebAssembly), which always produces watertight, printable meshes.

## Licence

MIT for BoardDock itself; see [LICENSE](LICENSE). Third-party components and their licences are listed in [NOTICE](NOTICE).
