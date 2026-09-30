# BoardDock

**Dock any PCB. No screws. No supports.**

BoardDock turns a PCB design, or a few measurements, into 3D-printable holders:
- It fits a light frame holder around each board's parts, holes and plugs.
- It docks every holder onto DIN rails, horizontal or vertical, and turns each board so every plug stays reachable.
- Boards stack: a HAT or shield bolted on its standoffs, or a separate board on a printed layer. Small boards (a J-Link, a USB-serial adapter, anything about that size) stand on their long edges in a column, each holder on pegs on the one below and lifting off on its own.
- A button on top of each holder releases the board; a press-down lever releases the dock from the rail.
- Printed table stands hold the rails. Cables between the boards are routed clear of everything, sized and combed automatically.
- The 3D view walks you through the assembly one step at a time, in the order you would really do it.
- Come back later to add a board: the rest of the rack stays where it is, and Export gives you only the new parts, cables and rails.

Everything is checked with FEA and packed onto as few print plates as possible. **None of it has been printed and tried yet:** print the test-fit kit first (30 to 40 minutes), and read [Honest limits](#honest-limits).

![A panel of boards on a DIN rail](docs/images/hero.png)

- **Imports:** KiCad, Altium (via STEP or Gerber), Eagle (new XML and old binary boards), Cadence Allegro `.brd` (desktop app, through KiCad 10), board-viewer files, IDF, DXF, Gerber + drill + pick-and-place, and the neutral formats Allegro, OrCAD, PADS and Xpedition export: IPC-2581, ODB++ and GenCAD. Or draw a board by hand, start from a template, or pick one from the library, community boards included.
- **Hole wizard:** sorts every hole into mounting holes (they get pins), connector pegs, part leads and stacking standoffs. You can change any of them.
- **Fits holders automatically:** a **frame** (default: a rim, corner guards, edge seats, and ribs to every pin, using 25–50% less plastic than a full **tray**) held on by **spring clips** (and a fixed ledge where plugs take most of the edges), with clearance for the board's underside and an opening for every plug. Each connector gets a **cradle** that carries the mating plug's body, so a knocked cable loads the holder, not the solder joints, and a snap-on **cap** locks the plug in.
- **Builds panels:** any number of rails, docks that turn four ways and take two boards back to back, stacks of boards on one dock, and boxes such as USB hubs, chargers, network and PoE switches and power boards. It lays them out automatically, keeping boards that are cabled together side by side. Then drag things about, or **lock** what you have placed so automatic changes leave it alone. A **cluster** preset and **Complete this rack** add a Pi cluster's switch, powerboard and supplies for you. Printed **table stands** hold the rails.
- **Cables:** Auto-connect works out which plug goes where (power, PoE, USB hub and device ports, Ethernet, J-Links and serial adapters), says why it chose each cable, and says when you are short of hub or charger ports. You can connect plugs by hand in the Wiring view. Every cable is routed clear of the holders, boards, docks, rails and stands, and sized to a standard length you can buy.
- **3D view:** boards show copper traces (real for KiCad files, decorative for the rest), vias, silkscreen, parts and plugs. Cables are translucent, coloured by kind, with power running through them. Click anything to see it and edit it; Shift-click to pick several, then Delete removes them in one undoable step. **Isolate** or **X-ray** the selection, tint **What's new**, shade the **mains zones**, play the assembly step by step or pull it apart with the explode slider. **Ctrl/Cmd+K** opens a command palette.
- **Checks:** hand calculations for every snap, plus 2D FEA of the dock's springs (the socket latch, the rail shoe hinge and its rail grip) for your material. A printability check finds every overhang, bridge and thin gap, and the print view can paint them. Mains sitting close to a low-voltage board is flagged.
- **Easy to correct:** switch cradles, caps, tie anchors, guards or labels off for a whole holder, set the clip strength, remove single features in 3D, hide small parts, ignore holes, or revert to the import, for one board or all of them. **Copy to…** puts one board's settings on the others.
- **Efficient:** only changed holders are rebuilt, and a layout you have built before comes back instantly. Sturdy, balanced and lean presets; duplicate a board; a tongue-fit tolerance and a 30–40 minute test-fit kit to print before the real thing.
- **Exports** binary STL or 3MF, one file per print plate, packed onto your printer's bed, or G-code sliced in the app.
- **Open source** (MIT). It runs in the browser or as a desktop app for Windows, macOS and Linux. Anyone can add a board or a connector by pull request ([below](#adding-boards-and-parts)).

## Download

| | |
|---|---|
| **Desktop app** | [Releases](https://github.com/danmover/boarddock/releases): Windows `BoardDock-3.0.0-win-x64-setup.exe` (installer) or `…-portable.exe` (no install), macOS `BoardDock-3.0.0-mac-….dmg`, Linux `BoardDock-3.0.0-linux-x86_64.AppImage` or `.deb` |
| **Web app** | [danmover.github.io/boarddock](https://danmover.github.io/boarddock) (nothing is uploaded; all processing runs in your browser) |
| **From source** | `npm install` then `npm run dev` (see [Development](#development)) |

Installing the desktop app:
- **Windows:** run the `…-setup.exe` (it lets you pick the folder), or the `…-portable.exe` with no install.
- **macOS:** open the `.dmg` and drag BoardDock into Applications.
- **Linux:** `chmod +x` the `.AppImage` and run it, or install the `.deb` with `sudo apt install ./BoardDock-3.0.0-linux-….deb`.

The desktop builds are not code-signed yet:
- On **macOS**, right-click the app and choose **Open** the first time.
- On **Windows**, choose **More info → Run anyway**.

The desktop app does two things the browser can't: it opens Cadence Allegro `.brd` boards (with KiCad 10 or newer installed, free from kicad.org), and **Open plate** hands a plate to a slicer you have installed.

## Quick start

1. **Start:** three ways in: **drop your board's files** (several at once is fine: each becomes a board, and you stay on Start with a **Check the boards** button), **draw your own** (shape, size, holes, and a photo of it if you like), or **open a saved rack**. Above them, **Your printer** (kept in this browser for new racks): the plates, oversize parts and print times are for it from the start. Below them is the library, every board and accessory with a 3D picture, on shelves (Raspberry Pi, Arduino and ESP32, hubs and chargers, powerboards, probes and adapters, community boards, My boards…), with a search. Click a tile to add it, or **+** on several and **Add N boards** adds them as one undo step. **+ Board** in the top bar (or the **A** key) opens the library from any step. A second Pi 4B is named "Raspberry Pi 4B #2", so every list, label and cable says which one. **Remove** on a board's card in the Board step takes it out; Undo brings it back. With a rack open, Start says how far along it is, and the sidebar is a checklist of steps you can click through. On a phone, Redo, Save, New rack and the theme are under **⋯** in the top bar.
   - **Building a Pi cluster?** The **cluster** preset above the library takes a number of Pi 4s or Pi 5s (up to seven), with or without PoE. It adds them with a switch, a powerboard and their supplies (or a PoE switch and no supplies), and connects it all, in one undo step.
   - **Complete this rack** (on Start, and at the top of the Plugs step's To do list) adds what a rack still lacks: a supply for each Pi, outlets, a switch and its uplink. One undo step.
   - **Ctrl/Cmd+K** opens the command palette: type to find a step or an action, then Enter (on a phone, the search button in the top bar).
2. **Board:** check the outline, parts and the hole wizard; fix anything in the board editor.
3. **Plugs:** pick the plug type and size for each connector, and what each one is cabled to (or press **Auto-connect**).
4. **Holder:** frame or tray, a preset, where the release button goes, and the features you want.
5. **Rails:** BoardDock has already placed every board on a rail. Pick one rail, rows or columns; drag, turn, pair or stack boards if you like, and lock what you want to keep.
6. **Check:** failing checks come first (each with **Show in 3D**); tap the passing / to look at / failing tiles to see only those. Each item to look at says **OK to print** or **worth a look**, with a fix button where there is one. The boards' template reminders ("measure yours") are folded away at the bottom: tick each off with **Done** once you've done it. Run the dock FEA for your material.
7. **Export:** download the plates and print them in PETG, or slice them here for G-code. The shopping list has the rail lengths, the cables (length and plug types; jumper wires by the wire; what comes with a part, like a probe's ribbon or a plug pack's lead, is not to buy), straps and standoffs; the Plugs step's **Cables to buy** is the same list. The **Bill of materials** under it lists everything the rack is made of, with how many: printed parts (and what one weighs), boards, boxes and probes, rails, cables, hardware, filament and tools. **CSV** saves it (BOM.csv in the download). The **Checklist** button lists what to buy, print and have to hand, to tick off. The download's README has the assembly steps; the 3D view's **Guide** prints them with a picture of each.
8. **Build it**, following the play button in the 3D view. Then press **Mark the rack as built** in Export.

Every step has **Back** and **Next** at the bottom of the sidebar.

![Start screen](docs/images/start.png)

![Adding a board from any step](docs/images/addboard.png)

## The dock

Every board sits in a holder that plugs into a dock on the rail. This is the screwless "DIN hub" design, built into the generator:

| Part | What it does | Prints |
|---|---|---|
| **Rail shoe** (graphite, red lever) | Clips onto a TS35 rail. Its jaw wraps round the rail flange and hangs from a hinge leaf directly **above** the lip, so pulling the dock straight up can't pry it open. A sprung **rail grip** in the rail's channel presses the rail's wall and holds the shoe against its fixed hook, so a dock stays where you put it: it takes about 6 N to push one along the rail. **To remove it:** lift the boards out, press the ridged red pad beside the socket down about 5 mm, and lift the dock off. The lever is printed in place on a pin, with a bead round the pin's middle so it can't slide off; its hook pushes the jaw off the flange and the jaw spring lifts it back. A built-in stop protects the hinge. The lever goes on whichever side of the rail has more room; you can flip it per dock. | on its end face, lever and all |
| **Socket** (blue) | Snaps into the shoe in any of four 90° turns and takes two holders back to back. It has two print-in-place latches: long tapered springs whose hooks are undercut 15°, so pulling on a holder draws the hook in rather than out. | on its end face |
| **Holder** | The frame (or tray) around your board, with a tongue on its dock edge and a spine that carries the release rod. | flat on its back |
| **Release rod** (red) | Its head is the **button on the holder's top edge**: a keycap with a shallow thumb dish, rounded corners and chevrons that point the way it moves. Press it and the rod's 45° foot wedges the latch open. The latch spring returns it. Push the rod into its tunnel until it clicks: two barbed fingers spring out under a gate at the top of the tunnel, so it can't slide back out. The tunnel has 0.8 mm of play round the rod and a lead-in funnel, and the rod's neck under the button is solid and filleted, so it slides in without forcing (v3.0.0's tunnel was tight and the button broke). The grip bar under your fingers has a matching finger scoop. | flat |

**Using it:**
1. Hook the shoe under the rail and press it down until it clicks. Its grip holds it where it is; to move it along the rail, push it firmly.
2. Press the socket in, in whichever turn you want.
3. Push the holder straight down into the socket until the latch clicks.
4. **To take a board out:** put your thumb on the red button and two fingers under the grip bar, squeeze, and lift.

**Where the release button goes** (Holder step, per board):
- **Centred** (the default): the button sits in the middle of the holder's far edge, and the spine that carries its rod runs under the board, which sits about 10 mm up.
- **Beside the board:** the spine, grip bar and button run beside the board, so the board sits low and the far edge stays free for plugs.
- **Automatic:** whichever keeps the plugs clear with the least plastic.

Plugs always win: if the button would block one, it moves.

![A Raspberry Pi 4 docked](docs/images/holder-pi4.png)

### Lying flat

A board can also **lie flat on its dock**, top face up (out of the wall), on the same shoe and socket:
- Its holder has a tab, the **ear**, on one edge, flush with its underside, so the holder prints base-down like any other. The ear goes on an edge where it keeps clear of the plugs, as near the middle as it can.
- The tongue that plugs into the socket is a small **dock key** of its own, with a dovetail on top. It prints lying on its side, slides into a dovetail groove under the ear from the ear's tip, and the release rod locks it in: the rod goes in from the top, through the ear and the key, down to the socket's latch, and clicks in under a ledge at the top of the ear, so neither can slide out. The rod prints lying down.
- The release button sits on top of the ear, clear of the board. To take the board off, put your thumb on the button and your fingers under the ear, then squeeze and lift.
- Two boards can lie **back to back** in one socket, ears together, reaching opposite ways. A J-Link or serial adapter can **stand** in the other half of a flat board's socket. The shoe's release lever goes on the side away from a flat board where it can.

**Rails › Boards in their docks** sets it for the whole rack:
- **Stand up** (the default) takes the least rail.
- **Lie flat** stands far less out of the wall (a Pi, Uno, Pico and ESP32 rack: about 72 mm instead of 163 mm), and headers point straight out at you, but each board takes its width of rail.
- **Whichever suits each** lays a board flat only where that keeps its plugs clearly easier to reach.

Each slot also has its own **stands / lies flat** toggle in the Rails list and in the dock's inspector. Check lists the tongue's stress under a 20 N press on the far side of a flat holder (the same load case as a push on a standing holder's far edge). None of this has been printed yet.

## The holder

![Frame and tray holders](docs/images/holders.png)

**Frame** (the default) combines the lean spine-and-rib carrier of the original DIN hub with the tray's protection:
- a rim runs round the board, under its edge and out to the holder's outline;
- short corner guards locate the board, and **edge seats** carry it wherever no pin is close;
- ribs, laid out as a minimum spanning tree, tie every pin to the rim or to the dock's spine;
- plug cradles, caps, guards, tie anchors, spring clips and the label each bring only the bit of wall they need.

**Tray** is the full base with a hex pattern and a wall all round: stiffer, and more plastic. The style cards show your own board's holder in each style, in 3D.

![Holder features, each with what it did](docs/images/features.png)

**Features** has one row per feature with what this holder actually got, so a switch never just silently does nothing:
- plug cradles, caps, receptacle guards and cable-tie anchors, with how many (caps clip onto cradles, so they need them);
- **Clip strength** (Firm or Gentle); see *How the board is held* below. It says what the board got ("2 spring clips", "2 spring clips and 1 fixed ledge") and, when clips don't fit, why;
- **engraved label**: the board's name by default. If it doesn't fit a free wall it is shortened to a form that still says which board it is ("Raspberry Pi 4B" becomes "Pi 4B", "Raspberry Pi Zero 2 W" becomes "Pi Zero", never just "2 W"). Your own words are never cut. It only gives way to the spring clips if that actually gives them room, and never on a board held by pins;
- finger notches on trays (a frame is open underneath: pull a clip back and push the board out from below).

The **release button** section says where the button went: when a plug would be in the way of the place you asked for, it names the plug.

### How the board is held

![A spring clip seen from the board: the tapered leaf, its lip (ramp, ledge, 45° ends), the pull ear, and the anchor it grows from](docs/images/clips.png)

**Spring clips** (the default wherever they fit). Each clip is a leaf standing straight up from the print bed at the board's edge, as tall as the holder there. It is joined to a short block of wall (its anchor) along its whole height, with a generous rounded root, and cut free of everything else by 0.6 mm slits, so it bends sideways, within the print layers, the strong way for a printed part.
- **The leaf tapers** from about 1 mm at the root to 0.7 mm at the tip, so the bending strain is spread along it instead of piling up at the root: about 40% less peak strain than a straight leaf pushed as far.
- **The lip** at its tip has a 35° entry ramp, so the board's edge pushes the clip aside easily; a flat ledge over the board's edge that holds it down; and a small ear on top to hook with a fingernail.
- **Nothing loads it once the board is in.** The ledge sits on the first layer line above the board (0.15 to 0.35 mm clear of it), and the leaf stands 0.1 mm further out than the guards, so the board never leans on it. A clip only strains while the board goes past, so it can't creep or take a set.
- **Sized for a feel, inside the limit.** Each clip is as thick as gives about 3.5 N of push-back (**Firm**) or 1.6 N (**Gentle**), but never more than 55% of the material's strain limit in the worst case. For PETG that is about 1.1% strain at most against a 2% limit. A taller holder (a docked board stands higher) gets a thinner leaf for the same feel.
- **Anti-rattle springs:** thinner leaves (0.8 to 0.6 mm, 14 to 16 mm long) whose lip has a 45° face resting on the board's top edge. Pushed 0.3 mm aside, they press the board across against the guards opposite and down onto its seats with about 0.2 N each, at 0.12 to 0.17% strain: low enough that creep only slowly eases the push. One goes across the clips and one along them, where the edges have room.
- **Where they go:** every board is held by clips on its edges. Where plugs take most of the edges, a **fixed ledge** goes on one side: the board slides under it, then the clips opposite click over it. A board resting on its seats can only tip about a line along their edge, so every such way needs a clip well back from it: two clips on opposite edges do that, or three round the board. More go along the outline so no stretch longer than about 130 mm is without one, and together they hold 1.5 times what a 9 g shake asks. A clip takes a clear stretch of edge, away from plugs, the dock, the label and parts at the edge. Round and L-shaped boards get them too. If clips can't hold a board, the Check step says **"Nothing clips this board in"** and what to change.
- **Sized for the board:** leaf length (10 to 16 mm), catch depth (0.5 to 1.0 mm) and push follow the board's size and weight, and the total press-in force is kept under about 30 N, so a big board gets more, softer clips. A Pico or Nano gets two 10 mm clips of about 2 N each, a Pi 4 two 12 mm ones of about 3.6 N, a 250 × 150 mm board ten 16 mm ones.
- **Hairpin clips** where the stretch is short (10 mm or less): the leaf folds back on itself, so its springy length is twice the stretch. At the same catch and push that is 36 to 39 % less peak strain than a straight leaf (a 10 mm one: 0.95 % against 1.48 %). From 12 mm up a straight leaf is used.
- **Taking it out:** pull one clip's ear back with a fingernail and lift that side; the other side then slides out from under its clip.
- **Printing:** every leaf stands on the bed, so the only overhang in a clip is its ledge, about 0.9 mm out from the leaf, printed flat (the Check step measures it). Nothing else in a clip leans or bridges.

**No snap pins.** Earlier versions could also hold a board with split, barbed pins through its mounting holes. On the first real print they broke straight away, so they are gone: a mounting hole gets at most a plain **locating pin** that grips nothing (Holder › Holes: locating pin, or left clear), and projects that asked for pins get clips. Every board in the library is held by clips; the Pi Zero, whose edges are nearly all plugs, gets two hairpins and a ledge.
- **Clip strength**: Firm (about 3.5 N a clip) or Gentle (about 1.6 N).

The Check step lists, for each board, the clips' strain going in and its margin under the material's limit, the strain at rest, a rough force to press the board in (a 60 × 40 board with two clips and a spring: about 8 N), and that they print with no supports. The forces are beam sums with a textbook modulus: a print will tell the real feel and the click.

Plastic in a holder with no cradles or clip:

| Board | Frame | Tray |
|---|---|---|
| Raspberry Pi 4 | 4.0 cm³ | 7.8 cm³ |
| Arduino Uno | 4.3 cm³ | 7.2 cm³ |
| Perfboard 50 × 70 | 4.7 cm³ | 6.8 cm³ |
| 60 × 40 blank | 4.4 cm³ | 5.8 cm³ |

Cradles, caps and the dock tongue come on top of these and are the same for both styles.

## Drawing a board

The Board step is a 2D editor for any board: one read from a file, one from the library, or one you draw from nothing. It draws the board the way it looks: the solder mask in the board's own colour, copper tracks a shade lighter under it (its own, from a KiCad file; otherwise plausible ones drawn in for looks, and nothing is made from them: **Tracks** hides them), part shadows as long as the parts are tall, chip legs, tinned ends on resistors and capacitors, header pins with pin 1 square, what each pin is for (GND, TX, RX…) beside it, references in the silkscreen, and the board's name in a free corner.

- **The toolbox** is docked on the left (**T** shows or hides it): every plug, header, debug connector, hole and tall part as a picture of its own 3D model, in groups (USB and power; video, network and audio; headers and wires; debug and serial; holes; parts that stand tall), with a search. Click one and it follows the pointer, snapping to the nearest edge if it is a plug, then click where it goes (Shift keeps placing); or drag it onto the board.
- **Snapping:** dragging parts or holes snaps them to the board's edges and middle and to the other parts' sides and centres, with a guide line, and shows how far they are from the nearest edges. Alt drags freely; the arrow keys nudge.
- **The board check** under the board's card says what, as drawn, would spoil its holder, each with a fix: a hole off the board, so near an edge the pin under it would hang off, under a part, or there twice; a plug whose mouth sits back from the edge (**Move it to the edge**) or faces into the board (**Turn it round**); a part off the board, or two on top of each other; a thickness no board has. **Fix all** does the safe ones in one undo step. A real board's holes are never moved: one in the wrong place is left out. A board with no holes is held by its clips; for one you are making, **Add corner holes** puts M3 holes 3.5 mm in from the edges (on a round board, at 45° round the rim).
- **Plug labels** (J_PWR, USB-C, HDMI0…) are printed just inside each plug on an edge, in 2D and 3D, turned along the edge and clear of each other.
- **Click any dimension** to type what you measured: the board's **width** and **height** (the board stretches), and every dimension you put in.
- **Measure** (**M**) puts a dimension between two features: an edge of the board, a corner of its outline, a hole's centre, or a part's centre or one of its sides. Type what your calipers read on the real board and the part (or hole) moves to it; a hole takes the holes in line with it along (untick to move just the one), and between two edges it sets the board's width or height. Where either end could move, the box asks which. Dimensions follow what they measure and lay themselves out so none lie on top of each other; **drag a label** to place it yourself, and **Put back** and **Tidy all** hand the placing back to BoardDock.
- **Photo:** put a photo of the real board under the drawing, scale it from two points and the distance between them, line it up by a point on it, and trace the parts over it.
- Hover anything for what it is: its size, height, side, position, which way its plug goes in, what a hole is for, and how far it is from the left and bottom edges.
- The sidebar has the board as a card (its 3D picture, size, thickness, holes and plugs; **In 3D**, **Save to My boards**, **New version…**) and tabs: **Parts** (by what matters: plugs, tall parts, parts underneath, each with a picture), **Holes** (and **Add four holes** by spacing), **Headers**, **Board** (what it is: a board, or a debug probe or USB-serial adapter you drew yourself, docked like the built-in J-Link and FT232RL) and **Box** for a box.
- **Draw your own** (on Start, or in **+ Board**): a rectangle, a rounded one or a round board, with its size, corners and thickness; holes at the corners or by their spacing (a Pi's are 58 × 49 mm apart), checked to fit; and a photo to trace over. **More shapes** has L-shaped, a notch in an edge, a corner cut off, a polygon (3 to 16 sides) and a round board with a flat. **Your own** opens the Shape tool's Line mode to draw the outline corner by corner. Each opens in the editor for its plugs and parts.
- **Save to My boards** keeps the board (or box) in this browser; the library's **My boards** shelf lists them for any rack. Its **×** takes one off, and the toast's **Undo** puts it back.
- **On a box**, what you do in the editor sticks: drag a port (or nudge it, or type a dimension to it) and it stays exactly there; drag a side port to another side and it moves onto it; delete one and it leaves its row; put a plug on it from the toolbox and it becomes a port of the box.
- **Shape** (**S**) changes the board's outline and its cut-outs, for boards that are not a plain rectangle. Three ways to work:
  - **Edit:** drag any corner, or drag an edge to slide it straight out or in. Click the **+** in the middle of an edge to add a corner. Select a corner to type its X and Y, round it (a fillet) or cut it off (a chamfer), or press Delete; select an edge to type its length or bend it into an arc. With nothing selected, **Round** or **Cut** does every corner at once.
  - **Line:** click corners one after another and click the first to close the shape (or press Enter). Shift keeps each edge to 15° steps. Type a length (and an angle) and press Enter for an exact edge, as in a CAD program. **Arc** (or A) makes the next edge a three-point arc. The closed shape is **added** to the board, **cut out** of it, or becomes a **new outline**.
  - **Shapes:** a rectangle, circle or slot of the size you type, clicked in or dragged out, added to the board or cut out of it.
  - Everything snaps, with the same guide lines parts get (Alt snaps nothing). A board stays one piece with no edges crossing: an edit that would make one cross another, cut the board in two, or add a shape that does not touch it is refused, and says why. Holes and parts a new shape leaves off the board are ringed in red until you move them. Each edit is one ⌘Z.

## Hole wizard

Not every hole is for mounting. The wizard sorts them when a board comes in, and you can change any hole or group:

| Kind | Found by | The holder |
|---|---|---|
| **Mounting hole** | no part on it, near a corner or edge, 2.2–4.5 mm | puts a locating pin through it (it grips nothing: the clips hold the board) |
| **Connector peg** | inside a connector's body (RJ45 pegs, USB shell tabs, jack pins) | leaves it free, with a pocket underneath |
| **Part lead** | inside a part, or in a row at header pitch | leaves it free, with clearance for the leads |
| **Stacking standoff** | lines up with a hole of a board bolted on top | leaves it free, with room for the screw head or nut |
| **Ignored** | set by hand | does nothing |

The board editor colours every hole by its kind.

## Stacks

A board can sit on top of another; the bottom one carries the dock. In the **Rails** step, drag a board onto another board, or pick **on top of…** in Stacks. There are two kinds:
- **Bolted on standoffs:** a HAT on a Pi, a shield on an Arduino. The top board is lined up on the holes the two boards share (for example the Pi's 58 × 49 pattern), and shown on standoffs. BoardDock picks the shortest standard length that clears the tallest part under the top board, plus the parts and leads on its underside and 1 mm (11 mm, a HAT's, at the least: a whole Pi 4 on a Pi 4 gets 20 mm, over its 16 mm USB jacks). You can type your own length; if it is too short, Check fails and says what length it needs. The shared holes of the bottom board become stacking standoffs in the hole wizard: no pins there, and room underneath.
- **Printed layer:** a separate board gets its own light holder that presses onto four corner towers on the holder below, with press-fit pegs. The towers on a docked holder stay back from the dock face.

- **On its edge (a column):** small boards, up to about 105 × 60 mm (a J-Link, a USB-serial adapter, a Pico, a Nano…), stand on their long edges, the longest side along the rail, the next one on top of it like bricks. Each holder stands on two pegs on the holder below, with two press-fit ribs in the holes on top, and rests on a landing on that holder's far wall. Any of them lifts straight off on its own. The bottom holder plugs into the dock; the **release rod** is longer on the top one and runs down through every holder to the dock's latch, so one press at the top frees the whole column from the rail. The rack holds a column to what the dock's tongue can bear: in PETG, a J-Link and an adapter (about 85 mm) fit in one column, two J-Links do not (the second gets a column of its own). A small board that can't be clipped in (its ends taken by its plugs) slides into its holder from the open end under two lips instead, and the holder above keeps it in. The pegs and holes print without supports.

Bolted is chosen automatically when at least two holes line up; you can switch it. Only sensible targets are offered: boards about as big or bigger, the ones it bolts onto first, and never a hub, charger or powerboard. A small board can go on another small board in a column; a J-Link or an adapter only ever goes in a column.

## The panel

![Rails step](docs/images/panel.png)

The **Rails** step shows the whole rack as a tree: rails, docks, the front and back slot of each dock, and stacked boards under the board they sit on. Chips show where the plugs point, and each dock's label says how its boards sit (standing, lying flat, or a mix). Drag a board onto:
- a slot, to seat it there;
- a rail, for a new dock at its end;
- another board, to stack it (**Stack on…** in Stacks does the same, and **Take off the stack** puts a stacked board back on a dock of its own);
- **+ Rail**, for a new rail with it;
- the tray, to take it off the rails.

Quick layouts are **one rail**, **rows** (a new rail when one gets longer than your limit) and **columns** (vertical rails).

You don't have to drag (and on a touch screen a board drags by its grip): **Share a dock with…** puts a board in another board's free slot, back to back, and **Put behind…** fills an empty back slot, in the Rails list and in the 3D view's mounting row.

**Lock and changes** locks the whole layout, or one dock or rail. Auto-arrange, Tidy up, docks sliding to make room and Auto-connect leave what is locked where it is, and new boards go elsewhere. Each automatic change writes a receipt (**Changes made for you**), and ⌘Z takes back the change and its line together.

**Copy to…** copies a board's holder options (Holder step) or plug options and marked ports (Plugs step) to other boards: the ones of its own kind are ticked, or pick others. One undo step.

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
- Orders, turns and rows the docks for their cables: a planner tries layouts and scores each on cable length, crossings, cables under rails, plugs blocked by a neighbour, ribbon length and rail used, then checks the best one or two with the real cable router and keeps the one with least trouble. On 13 test racks it cut cable by 23 %, the longest cable by 24 % and crossings from 87 to 18, against rails about a third longer (the **Compact** goal turns that round). It takes under a second for 16 boards; the first build of a big rack takes longer while it checks, and the pick is remembered.
- Settings: rail direction, longest rail, gap between docks, space between rails, and pairing on or off.

**Options**, beside the button: probes (J-Links, USB-serial adapters) beside their board and stacked in one column, a goal (balanced, compact, short cables, easy to reach), like boards grouped and turned alike, mains kept at one end, hosts near their devices, room to grow on each rail, back-to-back pairing, cables that fit stock lengths, hot boards spread out, and fewest printed parts. Each is a weight on the same score, not a separate rule. **Pack new boards only** places boards you have just added and leaves every other dock and rail where it is.

Under **Boards in their docks**, a small table compares the choices you have tried on this rack: rails and their length, how far it stands out from the wall, and cable to buy. **Whichever suits each** says which boards it laid flat.

Auto-arrange also keeps each holder's tongue (the part that plugs into the dock) under the limit Check holds it to: a long board is docked by an edge that gives a shorter lever, and a board that can't stand on any edge without failing it lies flat instead (even with the rack set to stand boards up). Where a board still fails a check, the Rails tree shows it under the board, and for a tongue over its limit a button docks it by another edge (or lays it flat) when that fixes it. Changing how a board docks (that button, another edge, standing or lying flat) slides the docks after it along the rail to make room, since a board lying flat reaches further. Where it now reaches over the next rail's docks, that rail and the ones beyond it slide across, keeping their gaps to each other; the first rail stays where it is.

With Auto-arrange on, every change lays the rack out again, a new cable too. When a new cable adds a rail, moves a board to another rail or adds 30 cm or more of cable to buy, a toast says so and offers **Keep the old layout**.

On a built rack, **Auto-arrange** asks first, as it moves built boards.


**Editing by hand.** The first edit keeps everything where it is and switches to manual. A dock dropped on top of another slides to the nearest gap beside it, and a dock a board leaves empty goes. **Tidy up** takes out empty docks and slides overlapping docks apart along their rail, leaving everything else where it is.

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

A box is a size and rows of ports (Board step, **Box**). Pick a preset (USB hub, powered 7-port hub, USB-C hub with Ethernet, USB charger, USB charger with USB-C, network switch, PoE network switch, plug-pack supplies) or set your own:
- length, width and height; its **corners** seen from above (square, rounded by a radius up to fully round ends, or cut off straight); its **colour** in the 3D view;
- any number of rows of ports, each on its own card: how many, which type (USB-A, USB-C, micro-USB, USB-B, DC barrel, mains, RJ45, HDMI, audio, screw terminals), on which face (front, back, either end or the top), and what they are for (hub port, upstream, power out, DC out, power in, and so on);
- for ports that give power, what each one gives (a 27 W USB-C PD port gives 5 A, most USB-C charger ports 3 A), and a DC port's voltage;
- a plug pack's own lead length, and a powerboard's rating (A, from its label).

**Plug packs** (Start › Hubs and chargers: the Raspberry Pi 27 W (5 A) and 15 W (3 A) USB-C supplies, a 12 V DC plug pack) plug straight into a powerboard's outlet, so they stay off the rails; their own lead goes to the board. Auto-connect plugs them in; the shopping list says their lead comes with them and counts no strap for them, since a plug pack never gets a holder. A DC pack only goes to a DC input on its own when both say the same voltage: BoardDock can't check polarity, so check both labels.

![Box editor with a 7-port powered hub](docs/images/box.png)

By default a row's ports are spaced evenly and centred on their face. Under **Where they are** on each card you can make it match your box exactly:
- **Along the face:** centred with the other rows, measured **from the left or right end** (to the near side of the nearest port, what your calipers read), or **each port where you put it** (for a hub with uneven spacing: type each port's centre, or drag it in the editor). Switching between these never moves the ports.
- **Spacing:** from one port's centre to the next.
- **Height up the side:** where the middle of the ports is, from the bottom of the box (halfway up unless you set it).
- **Which way up:** flat, upside down, or on its side (upright) turned either way, named by what you can see in the socket (a USB-A's tongue, an RJ45's latch, a micro-USB's or HDMI's wide side). The holder's opening, the plug drawn in it, its cable and the box's 3D picture all turn with it. Round sockets (DC barrel, audio) have nothing to turn.
- **On top:** across the middle, by the front or back edge, or so many mm from the front; and turned by any angle (0: along the box, 90: across it; 45 lets plug packs sit side by side).

A live sketch above the cards shows the box from above, each port with an arrow the way its plug goes in (a dot for one on top), and each side with ports as you see it, every socket drawn the way up it is. Hover a card to light its ports up. Every port knows its role, so Auto-connect never has to guess whether a USB-A socket on a box takes a device or gives power. A box is held down by a 12 mm hook-and-loop strap over it, through four loops on its holder: on the long sides a quarter in from each end, or wherever the strap misses every plug (round the short sides if the long ones are too busy). Where no gap between the plugs is wide enough for the strap, the loops go where a zip tie fits instead, and the holder says so. The editor says when ports don't fit their face, run past its end, overlap, or sit higher or lower than the box. Fewer ports keep the first ports' names, so cables to them stay; cables to ports you remove go.

### Build your own box

On Start, **Draw your own › A box** builds one from scratch: pick what it is (a USB hub, a USB charger or a power supply), its name, size and colour, with the sketch updating as you type. It starts with a typical port or two for its kind (a hub: four USB-A and a USB-C upstream); change them and add rows under **Box**, then drag each port in the editor to where it is on yours (a photo of it under the drawing helps). **Save to My boards** keeps it for any rack. None of the holders for these has been printed yet: check the fit of a test print against your box.

The Plugs step counts what still needs a port: USB devices against free hub and computer ports, and boards that need power against free ports strong enough for them. A board on a port too weak for it counts as still needing power, so the offer to add a charger (or, for Pi 5s, their own 27 W supplies) stays until every board has enough; adding one connects it and moves the boards on weak ports onto it. It names the boards still without power and what the free ports give ("the free ones give 2.4 A at most, they need 3 A or more"). A USB device with no port on the rack can go to **your computer** instead of a hub. A stacked pair of USB-A sockets counts as two ports. Boards with screw terminals or jumper headers and nothing connected (a relay board, a power distribution board) are listed too: Auto-connect leaves wiring to you.

![Power budget in the Plugs step](docs/images/power.png)

**Power budget.** Every charger, powered hub, bus-powered hub and Raspberry Pi USB port gets a bar: what the boards on it take at full load against what it gives, at 5 V. It warns when a charger is asked for more than it gives, when a Pi's four USB ports (1.2 A between them) or a hub with no supply of its own carry too much, and when a board needs more than its port gives (a Pi 4 wants a 3 A supply; a USB-A charger port gives about 2.4 A). A Pi 5 wants 5 A, which only a 5 A USB-C PD supply gives (a USB-A to C cable never can): on a 3 A port it runs, but holds its USB ports to 0.6 A between them, and the budget says so. **Move boards to stronger ports** takes boards off ports too weak for them and onto stronger free ones, in one undo step. Under the sources, each powerboard gets a **mains** bar: what the supplies plugged into it draw from the wall at full load (an estimate, at about 85% efficiency) against its rating (typical figures: AU 10 A, UK 13 A, US 15 A, EU 16 A; set yours under **Box**). The figures are estimates: the makers' recommended supplies and typical draws under load. Set a board's own under **Board › Power** and a charger's total (the watts on its label, divided by 5) under **Box**. A PoE switch gets a bar of its own: what its PoE ports give in all against what the boards on them take, with a warning when a board wants more than one PoE port gives. Check lists the same.

### Powerboards

Powerboards (power strips) are boxes too, under Start's accessories: 4 or 6 outlets, with a switch by each, with outlets turned 45° so plug packs fit side by side, or with two USB ports. Set the outlets (AU/NZ, UK, US or EU), how many, their angle and the size under **Box**; the outlets spread evenly along the top. Auto-connect plugs each charger's mains lead into a free outlet, and buys the lead only if it is longer than the one most chargers come with. The shopping list names hook-up wire by size (red and black, 0.5 to 0.75 mm², ferrules for screw terminals) and a barrel-to-wire lead as a pigtail. A powerboard's own lead goes to the wall: BoardDock never plugs one powerboard into another, refuses to in the Wiring view and **Cable to**, and fails Check if an older rack has one. It won't put a mains outlet onto screw terminals either: mains through relays belongs in a proper enclosure, wired by someone qualified to. BoardDock checks which plug goes into which outlet and adds up the load it knows about; it can't check your powerboard, its lead, earth or the wall socket.

A box longer than your printer's bed (a powerboard usually is) gets its holder in two halves that meet end to end, each clipped to the rail on its own.

## Table stands

![Table stands under two rails](docs/images/stands.png)

There is no wall mount: BoardDock prints no screw holes and uses no screws. The rails are ordinary TS35 DIN rails, which come with slots for screws, so to hang a rack on a wall or in a cabinet, screw the rails up yourself and clip the docks on as you would on the stands.

The rails stand on printed sleepers (Rails step, **Table stands**, on by default):
- A sleeper crosses the rails at each end, and at least every 200 mm between.
- Each **rail end pushes 7 mm into an end block** with a TS35-shaped pocket. It caps the rail's lips and is a 0.3 mm slip fit (crush ribs there would flatten the first time and leave it loose).
- **Saddles** carry the rails in between. Their low cheeks stay under the dock shoes' jaws, so a saddle can sit under a dock.
- **Spacer bars** join the blocks. They slide in along the rail through dovetails, and set the rail spacing.
- The rails stand 10 mm off the table, so cables can run under them.

The pieces scale with the rack: more rails give more blocks and spacers, and longer rails give more sleepers. In the automatic layout every rail is cut to the same length, so the sleepers run straight across. Every piece is a profile printed on its end: no supports, and every load lies in the plane of the layers.

Plastic: an end block takes 3.6 cm³, a saddle 2.2 cm³ and a 150 mm spacer 2.5 cm³.

The Check step also reports two hand calculations:
- the rail's sag between sleepers under a 20 N press, treating the rail as a steel beam;
- the stress in an end block's lip caps when you lift a rail end with 20 N: about 6 MPa, against PETG's yield of about 50 MPa.

A lone rail gets short feet on each end block, so it stands on a wider footprint. **Tipping**: when the holders and boards reach more than 1.5 times as high above the table as the stands are wide at their narrowest, Check says so. That's a rule of thumb, not a calculation: a lone Pi on a short rail gets a note to hold the rack while plugging in; a big board standing on a short rail gets a warning, with ways to steady it (lay it flat, add a rail, space the rails wider).

## Cables

![Wiring view](docs/images/wiring.png)

Each plug gets a role from its type, its name and its board:
- a Raspberry Pi's USB-A ports are hosts, and its USB-C is its power input (or its Ethernet, with **PoE HAT fitted** under Board › Power);
- an Arduino's USB-B is a device, and its barrel jack is an optional input that takes only a supply of 7 to 12 V. A DC supply's lead in that range can be cabled to it by hand (BoardDock can't check polarity), which counts as powering the board and gives the jack its cradle and cap. Nothing is printed for a port with no plug in it, so ticking a cradle, cap, guard or tie anchor on an empty port in the Plugs step marks it as one you'll plug in;
- a hub's ports feed devices;
- a charger's ports give power, and a PoE switch's PoE ports give it over Ethernet.

**Auto-connect** pairs the free plugs the way you would lay them out yourself, and says why it chose each one (hover a cable, or see the Cables list):
1. hubs to the nearest computer or board that hosts them (a hub with Ethernet or USB 3 ports on a USB 3 port where there is one); with nothing on the rack to host it, to **your computer**;
2. power: a board with a PoE HAT fitted is powered by its Ethernet cable, from a free PoE port of a switch with budget left (it needs no supply, and its USB-C stays free). Every other board that takes power over USB gets it only from a port that gives it enough (a Pi 5 on a 5 A supply where there is one, a Pi 4 on a USB-C port), with no charger loaded past what it gives and the load spread over the chargers. A board no free port can power is left free, and the Plugs step offers a charger or supply. With no charger port left, a powered hub's port will do for a small board, never a Pi, and never the hub that hangs off that same board;
3. devices (an Arduino's USB, a probe's or an adapter's USB) to the nearest hub port, else a board's own USB port while their shared limit allows (a Pi 4's give 1.2 A between them), else **your computer** (off the rack; its 2 m cable is on the shopping list);
4. each board's Ethernet to a **network switch** in the rack (Start › Hubs and chargers has 5- and 8-port ones, and a PoE one), and each switch with boards on it to **your router**, off the rack, on its last free port (the shopping list asks you to measure that cable);
5. a DC plug pack's lead to a DC input of the same voltage (an Arduino's jack takes only 7 to 12 V: Auto-connect picks the pack nearest 9 V, and the advice offers a 9 V pack when none fits). A network switch or powered hub has a DC input for the supply it came with: until something is on it, the To do list says so, and **Add its supply** puts that plug pack on the rack (listed as coming with the box, not to buy), in a free outlet with its lead to the box. Set the input's voltage under **Box** to match the label on yours;
6. mains leads and plug packs to the nearest free outlet of a powerboard (never one powerboard into another);
7. J-Links and serial adapters to the headers they serve.

Each kind is paired all at once (the cheapest pairing in all, not first come, first served), by how long each cable would be on the rack as it is laid out. Leaving the Plugs step with **Next** on a rack with no cables at all runs Auto-connect first (⌘Z undoes it); once you have connected any yourself, Next leaves them as they are. **Rewire** chooses Auto-connect's cables again after you move boards, and leaves the ones you connected yourself.

The Plugs step's **Cables to buy** and the shopping list use the same wording and lengths. Under Plugs › Cables, **Buy every Ethernet lead at one length** rounds them all up to the longest route's stock length, so you buy one kind of lead.

In the **Wiring** view:
- **Drag** from a plug to the plug it goes to, or just onto the board (it takes that board's best free plug that fits). Plugs that fit light up green as you drag.
- **Click** a plug for its **best matches**: the free plugs it fits, best first, each with how long the cable would be and what the port gives. Or click the plug it goes to.
- **Drag a plug that already has a cable** to move that end of the cable to another plug (it keeps its number).
- After you connect one by hand, **Connect N more like this** does the same for the other boards like it.
- The **List** panel's **To do** says what still needs a cable (a board without power, a device without a port, a header without a probe) with the best match and a **Connect** button for each. It also says what the rack is short of: not enough charger ports, hub ports, or no switch. **Add a USB charger** (or a hub, or a switch) puts one in and connects it. An added hub is sized to what needs plugging in, and the toast says what goes to your computer instead. **Cables** lists every cable with its number, its two ends, what it is and its length.

In the Plugs step, pick **Cable to** for any plug.

The panel routes every cable:
1. Out of its plug and clear of its own board. A plug pointing up out of a board standing on edge steps sideways off the board before going down; a plug pointing sideways drops, reaches further out first, or slopes straight into a lane it faces. A drop that would land on a sleeper steps along the rail first.
2. Down to a **street** between the rails (or beside the outer ones), where each cable gets its own lane. Lanes are ordered so as few cables cross as possible.
3. Along the street and back up to the other plug the same way.
4. Then all the cables **settle together**, the way real ones do once they are plugged in. Each is a chain of beads:
   - where two cross, one lies over the other; where they run together, they lie side by side;
   - nothing goes through a holder, dock, plug or ribbon;
   - each cable keeps its length (it can't stretch), with a few per cent of slack in its free stretch (a cable lies, it isn't pulled taut);
   - it has weight: a free span sags, never below the streets, and it lies in the stands' combs where its street crosses them;
   - it has stiffness, more the thicker it is: it runs straight out of each plug for about a bend's length, keeps that stretch close to how it was laid, and bends nowhere tighter than about three of its own diameters;
   - pushed out of anything, it goes back out on the side it was laid, so it never pops through a board to the far side;
   - two cables laid on top of each other (out of neighbouring plugs the same way) are eased apart side by side first;
   - last, the ripples are smoothed out wherever that touches nothing.

   Ribbons stay where they were laid and the rest settle round them. Check says how many places the planned routes met, warns about any pair still pressing on each other, and names any cable still squeezed into a tighter bend than a cable likes (it happens between plugs very close together).

Every combination of these is checked against the bounding boxes of every holder, board, plug, dock, rail and stand piece, and the shortest route that hits nothing wins. If every route touches something, the cable is marked in red in the 3D view and the Check step says what it runs into.

On table stands the streets run under the rails' level. Wherever a street crosses a sleeper, the spacer there carries a **cable comb**: one round-bottomed slot per cable, sized for it, with snap lips at the mouth.

Every cable's length is measured along its route and rounded up to a standard length to buy (10% slack). Auto-arrange keeps cabled boards next to each other and puts each hub or charger in the middle of the boards it feeds, on the same rail when it fits, so the farthest cable is short too (on a rack of six Pis and two chargers that took the longest cable from 66 to 51 cm, and the cable to buy from 4.3 to 3.5 m).

Routing keeps cables out of each other's way and off the rack: cables that cross under the rails are spread a cable width apart, each pinned to its own line; lanes stay between rails and stand blocks; a cable routed later keeps off the ways of earlier ones; and a cable settles beside a rail, stand or plug, never into it. Stands carry a comb for every street they cross. A debug ribbon or jumper never blocks taking a holder off: over another board's dock it rises clear of that holder's lift-off and its release lever, and a narrow one goes round the end of the dock when that costs little. A plug pack in the rack's own powerboard has its lead drawn from the outlet to its board, checked against its 1.2 m. On the 144 test racks the collision check went from 458 to about 35 mm³ in all.

**Cables: off** (on the Plugs step, or the command palette) is for when you only want the holders: no cables, combs, tags, cable steps or cable shopping. Plugs becomes a list of each board's ports, each "plug in it" or "stays empty" with its cradle, cap, guard and tie anchor, and those print as you mark them. Your cables are kept: switch back on and they return.

The Wiring view is a canvas: pinch (or ⌘ + scroll) zooms where the pointer is, scrolling or dragging the background pans, and the percentage button fits everything in. It opens with the cards as the boards stand on the rails, shaped to fit the window: a long rail wraps onto more lines, short rails share a line, and a plug pack, your computer or your router sits beside the rail it is cabled to. Drag a card by its title to move it; it stays where you put it, and cards stay put while you connect cables. **Arrange…** lays every card out again, shaped to the window, either as the cables flow (chargers and hosts on the left, then hubs, then probes and adapters, then the boards they serve, each column ordered so cables cross least) or as the boards stand on the rails. Hover a card, a plug or a pin for details. Type in **Find a board**, or click a board's title, to show just its cables and the boards at their other ends (and zoom to fit them). Cable numbers and lengths sit on their cables, clear of the cards where there is room.

A pin header (▸) opens into its pins, with their net names from your KiCad file. Click a pin, then a pin on another header, to add a jumper wire (a ground pin gets a black wire, a supply pin a red one). A wire onto pins ends in a female housing; into a female header (a pin socket) it ends in a male pin, drawn and bought that way. Each wire is labelled with its two pins (TXD→RX), and a white or yellow one gets a dark edge so it shows on the light theme. Click a wire and press Delete to take just that one off.

![Cable numbers and tags](docs/images/cables.png)

**Every cable has a number**, and it keeps it: adding or removing other cables never renumbers it. The number and what the cable is for ("Power: USB charger → Pi 4B", "Hub uplink: Pi 4B → USB hub", "USB: USB hub → Uno R3") show:
- on a badge on the cable in the 3D view (on a busy rack just the number; hover for the rest; **Layers › Cable numbers** hides them);
- in the Wiring view, next to the length to buy;
- in the Plugs step's cable list, the shopping list and the assembly steps.

**Numbered cable tags** print with the rack, two per cable: an open saddle held on the cable by a 2.5 mm zip tie (the ties are in the shopping list), with a flag carrying the number, raised so a second colour or a marker picks it out. In 3D they sit a hand-width from each plug, where they go. Switch them off in the Plugs step.

## The 3D view

![The 3D view](docs/images/rack.png)

| Action | How |
|---|---|
| See what something is | hover over it |
| Select a board, dock, rail, cable, table stand, or one holder feature (cradle, cap, pin, spring clip, guard, tie anchor, label, stand socket) | click it |
| Select several | Shift-click |
| Remove the selection (a cradle or cap is switched off, a pin becomes an ignored hole, a dock, rail or cable is removed, a board leaves the project, table stands are switched off) | Delete, or **Remove** in the bar below the view; one ⌘Z brings it all back |
| Jump to the settings of the selected thing | **Edit** in the bar |
| Change how a board is mounted, right there | pick the board (or its dock): on a rack, **Stands up** or **Lies flat**, which edge goes in the dock (or carries the tab), turn the dock, swap its front and back boards; with loose holders, the DIN clip on or off, flat on the rail, across it or along it, and which way its release tab points |
| Fly to a part | double-click it |
| Watch it go together | the play button. It goes step by step, the way you would build it, with an instruction for each: stands, rails, shoes and sockets; then for each board, its release rod, the board into its holder, anything stacked on it, and the holder into its dock; then the cables (power first, mains last), the caps, and a last step: check every screw terminal, switch the powerboards off, plug them into the wall, then switch on. **‹ ›** step back and forward; **✕** shows it assembled. On a built rack, **Only what's new** plays just the new parts, cables and boards. |
| Build it at the bench, one step at a time | **Guide**: each step on a big card, with **Back**, **Again**, **Next** (or ← → and Esc) and **Print** |
| Pull it apart | the **Explode** slider |
| Show or hide holders, docks, caps, boards, plugs, cables, cable numbers or rails | **Layers** |
| Look at one thing | **Isolate** (in the view's toolbar) hides everything else; **X-ray** keeps the selection solid and makes the rest see-through. **Esc** leaves |
| See what changed since the build | **What's new** tints the parts, cables and boards that are new |
| See where the mains is | **Mains zones** shades a 10 mm margin round each mains board |
| Turn a part, a selection, a box port or a dock | the **rotation box**: type an angle, or turn by 15°, 45° or 90° (or free; docks turn by 90°) |
| Find any action or step | **Ctrl/Cmd+K** opens the command palette (on a phone, the search button in the top bar) |
| See every keyboard shortcut (the board editor's V, H, M, T and arrows too) | **?** |
| Go to a step | **1** to **7** |

**Cables** are translucent tubes with a bright rim and a core line, coloured by kind (a colour-blind safe set; a key under the view's tabs names the kinds on this rack). The one you pick or hover stands out.

Plugs are drawn after their type: a USB-C's slim oval overmould, a USB-A's metal shell and grip ridges, an HDMI's flat shell, an RJ45's clear plug and boot, a barrel plug's sleeve, wires with ferrules in a screw terminal. A port shows a plug only where a cable goes: a cable to another board on the rack, a cradle the board has for one (a screen or a supply off the rack), or a box's own supply (mains, DC in); a free port stays empty. A lead that leaves the rack (to a screen, a supply, the wall) is drawn as a short stretch out of its plug that fades away, then a dotted line on the way it goes and where to ("to a screen", "to the wall"). Those labels group per holder ("→ hub ×4"), draw over the boards, fade as you zoom out, and show only for a real lead. The camera's presets and fit button frame the whole row. Running your Pis headless, **Go headless** in the Plugs step drops their HDMI and audio cradles (and their caps) on every board. A cable's number badge reads what it is and where it goes ("Power → Pi 5"); hover it for the whole label. Cables bend in arcs of about four diameters, as real ones do.

**Live** (in the bar under the view, on by default) switches the rack on: every LED glows in its colour and does what it does (a power LED stays on, a Pi's ACT flickers or beats, an Arduino's L blinks once a second, a network jack's link light is on and its activity light flickers while a cable is in it, a relay board clicks through its relays, an RGB pixel runs through the rainbow), and a board with no power cable stays dark (one on PoE or a plug pack is lit). Pulses run along the cables the way power or data goes: power as glowing streaks from each supply to its board, on PoE, mains and leads that leave the rack too. Boards read in from files light their own LED parts (colour and job from their names: PWR, ACT, TX, a colour in the part name); template boards light the LEDs the real board has, drawn in (nothing is printed round them). It is only for the look: whether each board gets enough power is the Power check's job. It redraws a few times a second at most, and holds still if your system asks for reduced motion.

![Stepping through the assembly](docs/images/steps.png)

It uses studio lighting with ambient occlusion. Boards get a solder mask with copper traces and vias (the real ones from KiCad files, a decorative pattern on every other board), silkscreen, gold pads and pins, chips with their part numbers, passives with tinned ends, LEDs with their lenses, tactile switches and crystals. Rails are slotted metal DIN rail, and printed parts show the fine lines of their layers (they fade out when too small to see). Plugs show their shells, tongues and pins. The view draws a frame only when something changes.

**Steps** plays the assembly the way you would do it, each part moving the way it goes in: a rail shoe hooked under the rail and swung down, a board tipped in under the spring clips and pressed down, snap-fits going a little past their seat and springing back (the click), plugs going in quickly and then slowly for their last few millimetres, and cables drawn along their route as they are plugged in, with their numbers.

**Guide** is the same steps for the bench: a big card over the view says which step you are on and what to do, and plays that step so you see the parts go in; **Back**, **Again** and **Next** are big enough for a thumb on a phone, and the rack is drawn in the space above the card. **Print** takes a picture of the rack after each step, all from where you are looking at it, with that step's new parts outlined in blue, and prints them with the step's words and the bill of materials at the end (or save it as a PDF from the print window). Cable numbers aren't in the pictures.

## A new version of a board

When a new revision of one of your boards comes out, select it (in 3D, or its chip in the Board step) and press **New version…**, or drop its files on that button. The new version takes the old one's place:
- it keeps its name, dock, stack, holder settings and every cable to a plug it still has;
- the choices made on the old one carry over where the part is still there: plug cradles, caps, guards and tie anchors, hidden parts, and holes set by hand;
- what changed is listed (the Board step keeps the list): "Connectors: J2 moved 2 mm; J4 new (USB-C)", "Holes: 1 moved (up to 0.8 mm)", "Tallest part underneath: 2 → 3.5 mm", or "No mechanical changes: the holder comes out the same".

If the new version makes something fail in Check that did not before (a bigger holder now overlapping its neighbour, say), the toast and the board's list of changes say so.

To put a **different** board in a board's place (an Arduino Mega for an Uno), press **Replace with…** on its card in the Board step and pick one from the library, or drop its files. It keeps the old one's dock, stack, holder settings and the cables to plugs it also has; What's new calls it a swap.

**Print its holder** goes straight to Export with just that board (its dock on the rack stays, so it is left out); on a rack marked as built, **What's new** lists exactly its new parts, and the old holder is listed as spare. Slice it there for the G-code. One ⌘Z goes back to the old version.

## J-Links and serial cables

A board's debug headers are found on import:
- by shape: a 2 × 5 header at 1.27 mm (the Cortex debug connector, whatever its footprint is called), Tag-Connect pads;
- by name: a 10 or 20-pin header whose reference, value or footprint says SWD, JTAG or debug.

UART headers are found by name (UART, serial, console, FTDI, TX/RX). To mark any other part, select it and choose **Debug / UART…**. A board you measure by hand can be given debug and UART headers when you create it.

**J-Links and adapters are ordinary boards**, docked and cabled like any board. Being small, each stands on its long edge in a column, with one release rod down the whole column (see Stacks). Auto-arrange puts each board's first J-Link and adapter in the back slot of its dock, right behind it, and further ones in docks of their own beside it, on the side their header is on. The column can slide along the dock, as far as the board's holder reaches, so ribbons and wires stay short and the rail stays as it is.

**One press adds what's missing.** On the Plugs step, **Debug and serial** lists every header on the rack with its probe, its ribbon length (one click sets a short ribbon to the next standard length), its dock slot and where pin 1 is. Its **Add 3 J-Links + 2 adapters** button (the numbers are your rack's) gives each free debug header a J-Link with the right connector (10-pin, 20-pin Cortex or JTAG box) and each free UART header a USB-serial adapter, docked beside their board, cabled and named after their header ("J-Link → J_SWD1"), in one undo step. The **+ J-Link** and **Adapter** buttons on a header's row do just that one, and so do the ones in the Board step, which lists one board's headers. **Bench sheet** prints it all on one page: each probe, the header's pinout, the ribbon and the port notes.

**A J-Link** is a board (65 × 40 × 1.6 mm, red) with its own connector, the 20-pin 1.27 mm Cortex one, and a USB-B at the other end. Draw your own as a board and set **It is** to a debug probe (Board step). Its ribbon leaves the socket flat, lies along the J-Link, loops over the top and comes down the board to its header, clear of the plugs; a second one loops over the first. It is drawn grey with a red pin-1 edge, checked against its length (200 mm unless you set yours) and never on the shopping list. A 20-pin 1.27 mm header takes a straight ribbon; for a 10-pin 1.27 mm, 20-pin 2.54 mm JTAG, Tag-Connect or plain pin header the list has the adapter to buy. **Auto-connect** plugs the J-Links' USB into a hub and pairs any loose J-Link with a free debug header.

**A USB-serial adapter** is the red FT232RL board (36 × 18 mm: mini-USB at one end, six right-angle pins at the other with GND, CTS, VCC, TXD, RXD and DTR printed beside them). It stands on its long edge on top of its board's J-Links in the column, when the column is not too tall for the dock's tongue. Jumper wires go from its pins to the UART header, crossed over: GND to GND, its TXD to the board's RX, its RXD to the board's TX. They are drawn one by one, a housing on each pin, bundled round the dock, and bought by the wire (10, 15, 20 or 30 cm). A female header used for UART gets male-ended wires, drawn and bought that way. Pin names guessed from a header's size say to check yours. Its USB goes to a hub with Auto-connect. If its plugs take both ends and the dock and landing take the long edges, nothing is left to clip it in: its holder then holds it in a slot open at one end, under two lips, and the holder above keeps it in.

**Or a serial cable** runs a USB to TTL serial cable (3.3 V, the kind with loose jumper ends) from the nearest free hub port, or a computer's, to each free UART header. Its black end goes on GND, green (its TX) on the board's RX, white (its RX) on the board's TX, and red (power) stays off. The pins come from the nets in a KiCad file (GND, RX, TX); otherwise they are a guess from the header's size, which you can change under the header. It is routed, numbered and bought like any cable, and never counted as powering the board.

On a rack laid out by hand or already built, a new J-Link or adapter goes into the free back slot of its board's dock (else the nearest free slot on that rail, else a new dock at the end), and the toast says which, and how much longer the rail got (a J-Link added from the library goes the same way once it is cabled to a header). In the Rails step **Stack on…** puts one on another small board's column and **Take off the stack** gives it a dock of its own again. Check warns about jumper wires longer than 30 cm and a ribbon longer than its length (it says how long it has to be, or to move the column closer). A second J-Link for one board needs a ribbon of about 250 mm (a 30 cm one), and the Debug and serial panel says so. Export lists just its own slot holder and what comes with it: nothing you have printed changes.

The examples to try it on are under **Start › Example: dual-MCU board…** and **Example: sensor board…**, and as KiCad files in `examples/`. None of this has been printed yet.

## Coming back to add a board

Once the rack is built, press **Mark the rack as built** in Export. BoardDock remembers what you printed, the rail lengths you cut and the cables you bought, and freezes the layout: every dock keeps its place, turn, lever side and board edges.

Later, open BoardDock. A saved rack opens on **Your rack**, with its boards, whether it is built, and buttons for the rails, the cables and what's new to print. Drop the new board's files in. It goes:
1. into the empty slot of a dock already on the rack, if it fits there with all its plugs reachable and without touching anything (then only its holder is new);
2. otherwise into the first gap on the rails that is clear in 3D, preferably on the rail of a board it is cabled to;
3. otherwise on the end of a rail, and Export tells you that rail has to be longer.

Nothing else moves. Where a board in a free slot of a built dock would make that dock reach over the next one, the board goes into a dock of its own instead (a free gap, else the end of a rail), so no built dock has to slide; the toast says where it went. If built docks do end up past the end of the rail you cut, Check fails and What's new says to cut a longer rail and where to slide each dock. Connect its cables (Auto-connect only fills plugs that are still free). Export then lists what to do since the build:

![What changed since the rack was built](docs/images/whatsnew.png)

It is a numbered checklist in the order you would work at the rack, each step with the parts to print for it; tick steps off as you go:
- **Take off** the boards you removed, from their dock ("dock 1.3 front");
- **Swap** a board for its new version, or for the board that took its place, in the same dock;
- **Cut** any rail that has to be longer, and **move the end block** out to the new end;
- **Slide** a built dock along its rail to its new place, in mm from the rail's start, the one furthest along first;
- **Move** boards that now sit somewhere else ("Arduino Uno R3 from dock 1.3 front to dock 1.2 front"; docks are numbered by rail and place);
- **Clip on** each new dock, at its distance in mm from the rail's start;
- **Seat** each new board in its holder and plug it into its dock (or onto the board it stacks on); a new plug pack goes into its outlet, its lead to its board;
- **Plug in** the new cables, and say when a cable you have is now too short ("#4 is now 1 m, yours is 0.5 m");
- what is **spare** now: parts and cables (by number) the rack no longer uses.

Plates, the estimate and the download (with the same list in its README) follow it. Press **I've built these too** when you have. **Forget**, by the Built heading, asks first, then forgets the build: Export lists everything again, and new boards no longer keep to the free spots (⌘Z undoes it).

## Supported files

| Source | What to export | What BoardDock reads |
|---|---|---|
| **KiCad** 6–9 | the `.kicad_pcb` file | outline (lines and arcs), holes, footprints with courtyard sizes, top and bottom parts, copper traces and vias |
| **Altium Designer** | *File → Export → STEP 3D*, or Gerber + NC drill + pick-and-place | STEP: board outline, holes and part bodies. Fab files: outline, holes, parts. |
| **Fusion 360 / Eagle** 6 and later | the `.brd` file, or STEP | outline, holes, packages |
| **Old Eagle** (3 to 5, binary) | the `.brd` file as it is: no Eagle needed | outline (lines, arcs and circles), cut-outs, holes, parts with their sizes and sides, pin header pins, copper tracks and vias |
| **Board viewers** (the files OpenBoardView opens) | the `.brd`, `.bdv`, `.bv` or `.bvr` file | outline, each part as the spread of its pins, top or bottom, pin nets. No holes or heights. |
| **EasyEDA / JLCPCB** | Gerber zip + CPL (pick and place) | outline, holes, parts |
| **Any EDA tool** | IDF 3.0 (`.emn` + `.emp`) | outline, cut-outs, holes, part outlines and heights |
| **Allegro, OrCAD, PADS, Xpedition, Altium, Zuken and others** | IPC-2581 (`.xml` or `.cvg`) | outline and cut-outs, board thickness, holes (plated or not; vias left out), parts with their place, side, turn, package size and height, header pins with their nets |
| | ODB++ (a `.tgz` or `.zip`, or the job folder dropped as it is) | outline and cut-outs, holes from the drill layers, parts from the top and bottom component layers with package sizes from `eda/data`, header pins with their nets; inch or mm |
| | GenCAD 1.4 (`.cad`) | outline and cut-outs, board thickness, mounting holes (mounting-hole parts and `$MECH`), parts from their shapes, heights, header pins with their nets |
| **Mechanical drawing** | DXF | outline and round holes |
| **No files** | draw it, or start from a template (Raspberry Pi 4 / Zero / Pico, Arduino Uno / Nano, perfboard) | |

**Connectors** are recognised by footprint name, by the usual makers' part numbers in a footprint or value, and failing both, by their pins. Checked against KiCad's whole connector library, 94% of its footprints are identified (98% leaving out bare solder pads), and none of its 5,600 other parts is taken for a connector. Each is sized for the pins its name says (a 2 × 8 box header, a 6-pin JST) and drawn as itself in 3D, its plug too: round SMA, XLR, M12 and mini-DIN barrels, a figure-8 mains socket, pin sockets with visible holes. Every one is in the board editor's toolbox, with a picture of its own. The families:
- **Computer and network:** USB-C, micro and mini USB (Molex 105017 and 47346, Hirose ZX62…), USB-A and B, HDMI, DisplayPort, RJ45 (Bel MagJacks such as A829-1A1T, HanRun, Würth, Pulse…), RJ11, SATA, SFP cages, mini-DIN and PS/2, microSD and SD, SIM slots.
- **Audio, coax, mains and industrial:** 3.5 mm audio, RCA, XLR, TOSLINK, banana jacks, BNC, SMA, MMCX, MCX and SMB, u.FL, D-sub (TE 5745781, Amphenol, Norcomp…), DC barrel jacks (CUI PJ-002A, PJ-102AH, Kycon…), IEC C14 mains inlets, M12 and M8, XT30 and XT60.
- **Wires and headers:** terminal blocks (Multicomp, Phoenix, Weidmüller, Degson, Würth…), box headers for a ribbon (CNC Tech 3020, 3M 2500; upright or right-angle), flat-cable (FFC/FPC) sockets, Qwiic, wire-to-board sockets (JST PH, XH, EH, VH, GH and ZH; Hirose DF3, DF11, DF13 and DF14; Molex PicoBlade, KK, Micro-Fit, Nano-Fit, Mini-Fit Jr, Mega-Fit and Ultra-Fit; side-entry ones such as JST's S2B-PH), and pin headers and sockets (Samtec TSW, FTSH, SHF and their kin, Sullins PBC, PEC and PPTC, Würth 613, Harwin M20, CNC Tech 3220).
- **Board-to-board and cards:** Samtec QSH, QTE, SEAM and ERM8, Hirose DF12 and DF40, Molex SlimStack, M.2 and mini PCIe, PCIe slots by their lanes, DIMM and SO-DIMM sockets, and spring-pin pads. Nothing is cabled to these. A holder keeps clear of the socket, and of the card in an M.2, mini PCIe, PCIe or DIMM socket; the card or board that goes on them is not drawn. Two boards that mate on one aren't treated as a stack: put them in a stack by hand.

The sizes come from KiCad's library, drawn from the makers' datasheets, for SATA, XLR, banana, BNC, SMA, TOSLINK, SIM, SFP, SO-DIMM, mini PCIe, the mezzanine bodies, the 3.5 mm jack and the right-angle box header. A few are still typical sizes, listed under Honest limits.

Names come as Allegro libraries and their exporters write them: IPC-7251 header names (`HDRV10W64P254_1X10_…`, `HDRRA…`), a maker's name in front (`SAMTEC_TSW-110-07-L-S`, `TE_5745781-4`), upper case, `_10P` pin counts, and part numbers with the dashes taken out (`TSW11007LS`, `SHF11001LDTH`, `A8291A1T91B`), as SamacSys and Ultra Librarian write them. A bare word such as HDMI, SMA or TRS names a connector only on a connector's reference (J, P, CN, TB, ANT, HDMI1…): a diode package called SMA, a TRS3232 or a USB4640 stays a chip.

Each is wired as what it is: an SFP cage is a network port (the shopping list says a DAC, or a copper module and an Ethernet cable; Auto-connect uses a board's RJ45 before its SFP cage), a C14 inlet takes a kettle-type lead from a powerboard's outlet, TOSLINK goes only to another TOSLINK (not to an analog jack), XLR takes RCA and 3.5 mm cables, and a banana jack is wires you connect (banana-plug leads on the list).

Where the name says nothing BoardDock knows (an Allegro board read through KiCad keeps Allegro's names, such as `CON10` or `HDR1X6`), a connector (J, P, CN…) is recognised by its pins: one or two rows at 2.54, 2.0 or 1.27 mm make a pin header; a 2 × 5 at 1.27 mm is the 10-pin debug connector, a 2 × 10 at 1.27 mm with debug nets the 20-pin Cortex one, and a 2 × 10 at 2.54 mm with JTAG nets the 20-pin JTAG one, so a J-Link plugs in; two staggered rows at 2.77 mm are a D-sub; and a header whose nets are SWD or JTAG, or TX and RX, is a debug or UART header (a JST or other small socket too, by its TX and RX nets; with only GND and TX named, the one other signal is taken as RX, and flagged for you to check). Each one gets a plug size you can change.

A `.brd` can be many things, so BoardDock looks inside to tell them apart: an Eagle XML board, an old binary Eagle board, or a board-viewer file (Test_Link `.brd`, BRD2, `.bdv`, BVR). A zip holding one works too.

- **Old binary Eagle boards** (Eagle 5 and older) are read directly, so you don't need Eagle, which Autodesk no longer sells. Their format was never published: BoardDock follows the layout worked out by the open-source readers pyeagle and pcb-rnd, and says so on the board. Check the outline, holes and parts against your board before you print.
- **Board-viewer files** are the repair-shop kind: they hold part names and pin positions but no package names, holes or heights. A part's size is the spread of its pins, and connectors are found by their names (J1, USB1, CN2), so check each connector's type and add the mounting holes yourself.
- **Cadence Allegro** `.brd` files: in the desktop app, through your own KiCad 10 (see below).

Altium `.PcbDoc` files use a proprietary binary format. Export STEP or fabrication files instead; BoardDock explains this if you drop one in.

**Cadence Allegro / OrCAD PCB Editor `.brd` files** are binary and their format is not published. KiCad 10 reads them (releases 16 to 23) with a reader its developers reverse-engineered from hundreds of real boards, and BoardDock uses that rather than guess at a format it has no boards to check against (a wrong outline or hole and the holder would not fit). **In the desktop app, with KiCad 10 or newer installed (free, kicad.org), drop the `.brd`, on its own or in a zip, and it comes straight in**: BoardDock runs KiCad's `kicad-cli pcb import` on it and reads the KiCad board that makes. It finds KiCad in its usual install folders or on your PATH. The web app can't run KiCad: open the file in the desktop app instead. Without KiCad, BoardDock recognises the board and says how to get a file it reads: KiCad's *File → Import → Non-KiCad Board File*, then drop the saved `.kicad_pcb`; or IPC-2581, ODB++, GenCAD, IDF, STEP or Gerbers with drill and pick-and-place from the designer or board maker. Tested with a stand-in for `kicad-cli`, not yet with a real Allegro board.

**Zips, tgz and folders.** Archives can hold folders, and archives inside archives (a zip with the ODB++ `.tgz` in it). When one archive or folder holds the same board in several formats, BoardDock reads the one that tells it most, in this order: KiCad, STEP, IPC-2581, ODB++, IDF, Eagle, binary `.brd`, GenCAD, Gerber + drill + pick-and-place, DXF. If that file cannot be read it tries the next, and the board's notes say which file was used, which ones failed and why, and which were not needed. An archive with several board files of the same kind (three `.kicad_pcb` files) still comes in as several boards.

## Adding boards and parts

Two folders take contributions, each checked by one command.

- **`boards/`** adds a board to the library, under **Community boards**. Put its files in `boards/<slug>/`: one is enough (a KiCad `.kicad_pcb` is best; or IPC-2581, ODB++, GenCAD, IDF, an Eagle `.brd`, Gerbers with drill and pick-and-place, or a DXF outline), with a small `board.json` saying who made it and on what terms. Only upload what you may share. Then run `npm run boards -- <slug>`: it prints what it read (outline, holes, and which connectors it could not identify) and updates `public/boards/`. Guide: [boards/README.md](boards/README.md).
- **`parts/`** teaches BoardDock a connector with one small JSON file. `names-….json` maps part numbers or footprint names to a connector type it already has, which fixes a `NOT IDENTIFIED`. `type-<id>.json` adds a new connector type (size, plug, what it connects to, and a look made of simple shapes), which shows in the toolbox under **Contributed**. Then run `npm run parts`: it checks the file and writes `src/model/parts.json`. Guide: [parts/README.md](parts/README.md).

Run the tests the guide names, commit, and open a pull request ([CONTRIBUTING.md](CONTRIBUTING.md) has the rest). Or open it with just the files: CI runs the same check and shows the report.

**The optional AI job:** a maintainer adds the `boards` or `parts` label to the pull request, and a Claude job follows `boards/AGENTS.md` or `parts/AGENTS.md` on its branch: it writes the hints or names, regenerates the data and commits. It needs the repository's `ANTHROPIC_API_KEY` secret, runs only for branches of this repository and only when the label is added, and does nothing in forks.

## Loose holders

Choose **Loose holders** in the Panel step for holders without a rail dock:
- **stacked** on corner towers with press-fit pegs;
- **side by side** with printed link bars;
- **back to back** with rivets: a pin through both bases, and a U clip that slides onto its neck.

Each holder can also have a flat pull-tab DIN clip or a **stand socket** (round, square, hex or D-shaped post, or a 1/4"-20 tripod nut trap). A box on the clip stands 2.3 mm up in its holder, clear of the clip's snap hooks, which come up through the base. The clip has a rail grip too: a sprung pad in the rail's channel presses the rail's top wall and holds the clip down on the top flange (about 6 N for a 14 mm clip), so it doesn't slide along the rail on its own. Loose holders start without the DIN clip (tick **DIN rail clip** if you have a rail), and the shopping list and assembly notes only mention a rail when there is one.

- A stack never covers a box: hubs, chargers and powerboards stand beside it on the table, so their ports and outlets stay free. Plug packs get no holder: they push into their outlets.
- A board bolted onto another (a HAT on a Pi, a shield on an Arduino) gets a standoff on each hole the two share and a screw in each end, sized from those holes (M2.5 for a Pi, M3 for an Arduino); the Rails step says how many next to the board.
- Cables between loose holders aren't routed or sized (there are no rails to run them along): each plug gets a short cut-off tail in 3D, Check says so, and the shopping list asks you to measure them on your bench. A box's own supply lead still runs off along the table.

| Stacked | Side by side |
|---|---|
| ![Stacked](docs/images/stack.png) | ![Side by side](docs/images/side-by-side.png) |

## Checks and FEA

The Check step lists every test, failing ones first. An item that is only "to look at" gets a verdict: **OK to print** when it is about using the rack (holding a holder while you plug in, cables touching, PLA's brittleness) and printing now wastes nothing, or **worth a look** when it may change what you print or how the rack is laid out. Where a fix is one click, the item has a button. Repeated lines (a tongue-root line for each of ten boards) fold into one row with a count.

**Mains near low-voltage** warns when a mains outlet, inlet, lead or plug pack comes within 10 mm of a low-voltage board or cable, on a rack laid out on rails. The 3D view shades the same zones. It is a layout check: BoardDock can't check your powerboard, its lead, earth or the wall socket.

### Printability, layer by layer

![Printability, sliced](docs/images/printcheck.png)

The Check step slices every distinct part into 0.2 mm layers in the pose it prints in and compares each layer with the one under it, the way a slicer sees it (in a background worker, once per part shape). Measured from each part's own bottom:
- **In mid-air:** anything with nothing under it would need support: the part says **needs support**. A fleck thinner than one line (or a single layer under 0.5 mm²) is only a *speck*, which slicers leave out, and is noted, not failed.
- **Overhangs and bridges:** how far each layer reaches past the one below, measured *inside the layer* from the wall that holds it (round a slot, never straight across air, and with no upper cap) and given as the real opening. Held from opposite sides it is a bridge; held from one side, an overhang. Overhangs: fine to 2 mm, a warning to 3 mm (or to 2 mm over more than 20 mm²), then **needs support**. Bridges: fine to 12 mm, a warning to 25 mm, then failed.
- **Sloped roofs:** a roof flatter than 45° steps out only a little each layer, so it is followed layer after layer: a warning once it runs out more than 3 mm, a failure past 10 mm.
- **A tiny foot:** a part taller than 5 mm whose first layer is under a tenth of its biggest one is failed (it would be knocked over).
- **Thin walls:** anything under 0.4 mm wide. A slicer without thin-wall detection leaves those out; in BoardDock parts they are only details of the engraved label and the button's chevrons.
- **Narrow gaps:** a slot under 0.3 mm prints closed. That matters only where something moves, and the check finds it by the gap's width, not by how much of it shows in each layer, so a 0.09 mm print-in-place gap is flagged. The rail shoe's lever has 0.35 mm round its pin and past the neck that carries it, and the socket's latch nose has 0.45 mm round it in its window.

Across the library (209 distinct parts: every template in each pose, the stacks and pairs, the rack parts and the test-fit kit) nothing is in mid-air, the longest one-sided overhang is 1.6 mm, and the longest bridge is 9 mm, except one: a holder on a DIN clip standing off its edge (rack or inline) has two slots across its plate whose tops are 14.4 mm bridges (a warning; see Honest limits).

An audit of the first parts with this check found and fixed: wall snap fingers that were 8 to 14 mm one-sided overhangs (now the spring clips, with a 0.9 mm ledge); flat roofs over plug openings and stand sockets (now 45° gables, so no flat roof is over 6 mm); a 14.8 mm bridge in a tray's wall over a part hanging past the board's edge; probe and adapter slot lips that were 1.9 mm flat ledges (now 0.8 mm, then 45°); snap rivets that printed 1.3 mm below the bed; and thin slivers by the fingers and under overhanging plugs.

![Dock FEA](docs/images/fea.png)

The FEA is 2D plane stress:
- **Elements:** incompatible-mode quads, validated against beam theory in the test suite.
- **Mesh:** square pixels, 0.1 mm (or 0.06 mm with the fine option).
- **Scaling:** each case is solved for a unit load and scaled to the travel it has to reach.

PETG results (E = 2100 MPa, strain limit 2%):

| Case | Force | Peak strain | 99% of the part below |
|---|---|---|---|
| Latch: holder pushed in (nose moves out 1.4 mm) | about 3.9 N push | 0.74% | – |
| Latch: button pressed right home (nose clears the groove after 2.1 of 3.1 mm) | 2.5 N | 0.85% | 0.74% |
| Latch: a 20 N pull on the holder (15° undercut hook) | holds: the nose moves 0.4 of its 1.4 mm out, and slips only at about 69 N (friction not counted) | 1.1% | – |
| Rail shoe: lever pad pressed down (jaw opens 1.7 mm for about 5 mm of pad travel; the stop engages at 2.2 mm of jaw travel) | 2.4 N | 1.7% | 0.55% |
| Rail shoe: pressed onto the rail | 4.3 N | 1.7–1.9% | 0.5% |
| Rail shoe: pulled straight up off the rail | holds to about 130 N pulled centred, 87 N on one hook (PETG's 2% limit, at the hook slits' rounded roots and the fixed hook's finger), friction or not | 1.7–2.3% at 100 N | 0.4% |
| Rail shoe: rail grip, its pad pressed 0.35 mm by the rail's wall | 9.6 N preload (5.5–14 N over tolerance), about 6 N to slide a dock along | 1.1% | 0.6% |

**What the analysis changed**, compared with the original DIN hub (the details are in [docs/din-clip-review.md](docs/din-clip-review.md)):
- **Pull-off.** The original jaw hung from a hinge outboard of its lip, so pulling the dock off the rail pried it open, and in the model only friction held it (without friction it let go at about 14 N). The jaw now wraps the flange edge with its hinge leaf directly above the lip, so a pull runs straight down the leaf and no longer depends on friction. The leaf is a uniform 0.9 mm (two 0.45 mm lines).
- **Press-down lever.** A lever printed in place on a pin releases the jaw: about 2.4 N over 5 mm of pad travel. Its hub is 0.46 mm clear of the neck that carries the pin (0.35 mm at the least anywhere round it), a bead round the pin's middle runs in a groove so it can't slide off, and the neck tapers and is filleted into a wider tower, so it reaches its strain limit only at about 28 N on the pad.
- **Rail grip.** The shoe only located on the rail. A sprung pad now presses the rail's wall from inside its channel with 9.6 N and holds the shoe on its fixed hook, so a dock stays where you put it: about 6 N to slide it (friction 0.3). A tooth stops a knock across the rail. The pull-tab clip has the same grip.
- **Release rod.** It clicks into its tunnel and stays, which also holds a flat holder's dock key in its dovetail. The shoe is 10.45 cm³.

## Printing

- **Material: PETG.** Every dock part is a spring. PLA is stiffer and more brittle, so strains that are fine in PETG are marginal in PLA. The Check step judges each part against your material's limit.
- **Printer:** pick yours in Export. The list has 18 printers: Bambu Lab X1 Carbon, P1S, A1 and A1 mini; Prusa CORE One, MK4S, MK3S+, MINI+ and XL; Creality K1C, Ender-3 V3 SE and Ender-3 S1; Voron 2.4 and Trident; Elegoo Neptune 4 Pro; Anycubic Kobra 3; Sovol SV06; and Qidi Q1 Pro. Bed size and build height come from the machine profiles in [OrcaSlicer's open profile library](https://github.com/OrcaSlicer/OrcaSlicer/tree/main/resources/profiles). Parts are packed onto that bed, and any part taller than the build height is flagged.
- **Print settings:** Export lists what to set in your slicer for your printer and material. Each setting shows where to find it in OrcaSlicer, Bambu Studio or PrusaSlicer, and is marked by where it comes from:
  - **design:** the parts need it. For example, 0.45 mm wall lines (the rail shoe hinge is exactly two of them), 0.2 mm layers, no supports.
  - **profile:** OrcaSlicer's generic filament profile (for example PETG: 255 °C nozzle, 80 °C bed, 20–100 % fan, 10 mm³/s), or your printer's machine profile (retraction).
  - **convention:** common practice, not a tested requirement. For example 3 walls, detect thin walls off, aligned seam, and a brim only for parts more than three times taller than they are wide.

  The list also says what brim and skirt the slicer lays. **Copy** puts it on the clipboard, and the download's README has it too.
- **What to print:** everything, only what's new since you built the rack, or just the boards you tick (with or without their docks and the table stands). The plates, the estimate (grams and print time per part), the download and the plates view all follow the choice.
- **G-code, in the app:** once your printer's start code is known, the main button, **Slice and download all G-code (.zip)**, slices every plate and downloads the lot, and **Download everything** can include the G-code. **Slice** next to a plate does just that plate. [Kiri:Moto](https://grid.space/kiri/) (MIT, by Stewart Allen) slices it inside BoardDock with the settings above and your filament's temperatures, and shows the print time, the grams and each layer. You get a `.gcode` file, or a `.gcode.3mf` for Bambu Lab printers.
  - **Start and end code** comes from Kiri:Moto's own profile where it has one (Bambu Lab P1S and A1, Prusa MK3S+ and MINI, Creality K1, which the K1C uses too). BoardDock swaps the A1 and K1 profiles' fixed PLA temperatures for your filament's. Other printers get a plain start (heat, home, purge line) for Marlin or Klipper, marked as such. You can paste your own for any printer under **Start and end G-code**. The Prusa XL is left to PrusaSlicer.
  - **Start code you bring is checked** before it is kept, with the code filled in as it will be printed. It has to look like start code for that printer: not empty, heating the bed and the nozzle, homing, without end code or slicer layers in it, temperatures within the printer's limits, moves that stay on the bed (or go only a little way past it, to a wipe spot) and never above the printer's height, and not another printer's (by the file it came from, its comments, or the printer it was loaded for). Code that can't be used isn't kept, and the page says what is wrong. Code that only looks odd (a move off the bed, a nozzle temperature outside the filament's range) is kept once you read why and choose **Use it anyway**. The check reads G-code moves and heater commands; it can't tell that code is right for a printer, only that it isn't obviously wrong.
  - **Bambu Lab printers, the A1 mini among them, can use their own start code:** the code Bambu Studio and OrcaSlicer use heats, levels the area you print on, wipes and primes the nozzle, and knows where the printer's purge and wipe spots are. BoardDock doesn't ship it (it is Bambu's), so bring it from your own copy of either slicer (both are free): read it from the slicer's install folder (desktop app); open the printer's `… template machine_start_gcode.json`, `… machine_end_gcode.json` and `… layer_change_gcode.json` from the slicer's `profiles/BBL/machine` folder; or paste the printer's **Machine start G-code**, **Machine end G-code** and **Layer change G-code** from its settings in the slicer. BoardDock keeps it in the project and fills it in for each plate, in Bambu's own template language (your filament's temperatures and type, the **build plate** you pick, the first layer's area, the height, the layer number and progress), and writes a `.gcode.3mf` for the SD card. If the code uses a setting BoardDock doesn't know yet, it says which and doesn't slice rather than guess. Checked against the A1 mini's code from Bambu Studio; not yet run on a printer.
  - **Brims and the bed's edge:** parts on a plate are always far enough apart for two brims, and plates keep 4 mm clear round the edge of the bed, where the skirt or brim goes (3.45 mm and 3.15 mm out, as measured in Kiri:Moto's G-code, with 0.5 mm to spare). A part too big for that margin but small enough for the bed gets a plate to itself, centred on the bed; a plate with no room for a skirt or brim is sliced without one and says so.
  - Kiri:Moto is not the slicer the settings were written for. It has no first-layer (elephant-foot) compensation, and its speeds are set conservatively.
- **G-code, in your own slicer:** every plate is also a 3MF with all its parts placed. In the desktop app, **Open plate** hands it to OrcaSlicer, PrusaSlicer, Bambu Studio or Cura if one is installed. Your printer maker's slicer knows its quirks best.
- **Supports: none.** Overhangs are 45° chamfers, gables or short bridges, round and square holes on their side have 45° tops, the spring clips stand on the bed (their lip ledge is about 0.9 mm), and all springs flex within their print layers. The Check step proves it layer by layer (see Printability, layer by layer). Leave supports off in any slicer.
- **What the slicers do with it:**
  - *The tongue hole.* The socket prints standing on its end, so the tongue's pocket lies on its side. Its roof is chamfered at 45° and the centre divider halves it, so the longest bridge in the socket is about 2.3 mm. The pocket leaves 0.2 mm all round the 14 × 4.5 mm tongue. If yours prints tight (a sagging roof, or elephant's foot), raise **Tongue fit** in the Rails step.
  - *Print-in-place parts.* The rail shoe's lever prints round its pin, 0.35 mm clear, and every slicer keeps the ring and the pin as separate loops. The socket's latch nose has 0.45 mm round it in its window. Don't lower the line width or raise the flow for these parts.
  - *Bridges.* OrcaSlicer and PrusaSlicer spot bridges, slow down, and lay the lines across the gap with the fan up. Kiri:Moto (in the app) prints them as ordinary solid layers, so expect a little more sag on the longest bridges (9 mm on a flat-lying holder, 14.4 mm in a DIN plate's slots; see Honest limits).
  - *Thin walls.* With thin-wall detection off (the setting BoardDock asks for, so the 0.9 mm hinge stays two full lines), walls under about 0.4 mm are left out: in BoardDock parts, only fine label detail.
- **Checklist:** what to buy, print and have to hand, as one list you tick off as you go (the **Checklist** button is on Start and beside the shopping list). It is worked out from the rack as it is now, so it follows the rack; the ticks are saved in the project, and a tick whose line has gone (a board taken off, a cable that is now another length) goes too.
- **First print:** the **test-fit kit** in Export: a shoe, a socket and a small tongue key with its release rod, about 21 g. Clip it on your rail, plug the key in, press its button. If the key is tight, raise **Tongue fit** in the Rails step by 0.05–0.1 mm.
- **Check:** the Check step lists every part's overhangs and longest bridge. **Overhangs** on the print plates paints faces that would need support in red and bridges in amber.

## Honest limits

- **Nothing BoardDock makes has been printed and tried yet.** Fits, snap forces, creep and fatigue all depend on your printer and filament. Least tested: the peg fit, the crush ribs, the long release rod through a column, the slot for a board nothing clips in, and the tongue under a tall column.
- The FEA is linear, 2D and idealised. It has no contact, friction or print anisotropy, and its peaks sit at pixel-mesh corners. Treat it as a comparison between designs, not a guarantee. The spring clips' numbers are beam sums with a textbook modulus: the feel of the click, how firmly a board is held, whether a lip's 0.9 mm ledge droops, and how the anti-rattle springs' push creeps over years in a warm cabinet are for a print to tell.
- Template boards come from the manufacturers' drawings; check yours. Imported part heights are only as good as the source (IDF and STEP are best).
- Some connector sizes are still typical ones, with no public datasheet drawing to check them against: M.2 sockets, PCIe slot depth, full-size DIMM, M12, RCA, DisplayPort, mini HDMI and Qwiic, and every connector's plug.
- Two boards that mate on a board-to-board connector aren't treated as one stack: put them in a stack by hand.
- Allegro `.brd` import was tested with a stand-in for KiCad's tool, not yet with a real Allegro board.
- A second J-Link for one board needs a ribbon of about 250 mm (a 30 cm ribbon; the Debug and serial panel says so).
- Big racks are slow to build the first time (one you have built before comes back instantly).
- A large board docked by one tongue feels a sizeable lever when you plug in a stiff cable at the far end. The tongue is 14 × 4.5 mm at the socket mouth (a Raspberry Pi 4 holder: about 25 MPa for a 20 N push on its far edge, against PETG's ~45 MPa yield), and the Check step lists it for every board. Hold the holder while you plug in.
- The frame holder's stiffness is from geometry, not tested: the board itself stiffens the frame once it is clipped in. A holder no longer rattles in its socket: two crush ribs on the tongue's front corners flatten to fit the first time it is pushed in (about 24 N, once; the crush stress is assumed, not measured). They replace v3.0.0's small spring leaves, which rested at 0.4 to 0.7% strain and would have crept.
- The rail release is reached with the holders out (they cover the lever). Taking a single board out is the button on the holder, which is always reachable.
- The rail grips (on the shoe and on the pull-tab clip) come from a 2D FEA with a textbook modulus and a guessed friction (0.3, PETG on zinc-plated steel). How firmly a dock really holds its place, and how much creep eases the 0.35 mm preload over the years, are for a print to tell. Each grip hangs 1.7 mm into the rail's channel, from 4.5 mm out from the rail's middle, so a screw head in the rail that reaches under it must be under 4.8 mm tall: pan, cheese, button and countersunk heads and M5 socket caps pass, M6 socket caps don't.
- The table stands' press fit, the dovetails and the cable combs' snap lips are sized from typical FDM tolerances, not from test prints. The sag and cap-stress numbers are hand calculations.
- Plug roles for Auto-connect are guessed from connector types and names, except on boxes, where you set them; check the Wiring view. Cable routes are checked against bounding boxes: one marked clear is clear, one marked as touching may still fit, and real cables are floppier and stiffer in places than the drawn tubes. Cable tags are sized from typical cable diameters (USB 4 mm, Ethernet 6 mm, HDMI 7 mm).
- "Only what's new" recognises parts by their geometry. If you change a holder setting after marking the rack as built, that holder counts as new even if you would not reprint it. A board that carries a stack is never put into another dock's empty slot automatically; place it by hand in the Rails step.
- Every board is held by its edges, so it needs clear edge for its clips (and, where plugs take most of the edges, for a ledge). Where there isn't enough (a USB-serial adapter, a round board of about 20 mm lying flat, a dock on an edge crowded with plugs) the Check step says **Nothing clips this board in**. The Nano's short hairpins are over the limit in PLA; print them in PETG.
- A DIN plate standing off a holder's edge (rack or inline) prints standing, so the tops of its two slots across it are 14.4 mm flat bridges. Along the rail, one clip hook catches on the edge beside a bridged top; if the clip goes on stiffly, trim the sag off with a knife or file. A plate printed on its face would avoid it, but would need a joint of its own.
- The printability check works on the parts' shapes, not on a real slicer's toolpaths. Kiri:Moto has no bridge detection, so the longest bridges sag a little more there than in OrcaSlicer or PrusaSlicer.
- The in-app G-code has not been run on a printer. The start code comes from Kiri:Moto's community profiles or BoardDock's plain templates, not from the printer makers, and the check of code you bring can't tell that it is right for a printer. Check the start of the first print, or use your own slicer. Slicing a full plate in the app takes much longer than a desktop slicer (seconds to a minute or more).
- The desktop app's **Open plate** looks for slicers in their usual install folders and has not been tried with every slicer and operating system. If nothing opens, download the plate's 3MF and open it by hand.

## Development

```bash
npm install
npm run dev          # web app at http://localhost:5173
npm test             # vitest: importers, holders, panels, dock FEA, and a quick collision check
npm run collisions   # the whole collision matrix (about 140 racks, a minute or two)
npm run typecheck
npm run boards       # community boards: read boards/<slug>/, update public/boards/
npm run parts        # contributed parts: check parts/*.json, write src/model/parts.json
npm run build        # production web build in dist/
npm run desktop      # Electron app from the build
npm run dist         # installers for the current OS in release/
```

What's still to do, in order, is in [TODO.md](TODO.md).

**The collision test** (`tests/collide/`) builds racks through the real generator (every template alone in each pose; boards back to back and stacked; probes; boxes; stands on and off; rails at every angle; a Pi cluster and a busy mixed rack with Auto-connect; a rack changed by hand; a built rack with boards added) and intersects every printed part, board, plug, rail, stand and cable exactly with manifold. A plug in its own jack, a cable in its own plug, a board on its own holder's pins and a DIN clip's hooks in its own holder are allowed. For automatic layouts it also looks for failing Check lines, overlap and clash warnings, rails over Longest rail and blocked plugs in use. Each rack's figures are held against `tests/collide/baseline.json`: the test fails when one grows past it, and prints the worst overlaps with part names and coordinates. `npm test` runs a few quick racks, `npm run collisions` all of them (CI runs both). When a fix lowers the figures, `npm run collisions:update` writes the new baseline; only do that on purpose.

The board tiles on Start and in **Add a board**, and the toolbox's pictures, are shipped in `public/tiles/`, each rendered from the thing's own 3D model with a fingerprint of that model in `src/ui/tiles.json`. `npm test` (`tests/toolbox.test.ts`) fails as soon as a model no longer matches its picture (a changed part, template or toolbox entry): render the ones that changed with the dev server running (`PLAYWRIGHT=/path/to/playwright/index.mjs node scripts/render-tiles.mjs http://localhost:5173/`; `all` as a second argument renders every one) and commit the pictures with `tiles.json`.

**Project layout:**

- `src/import/`: the importers (KiCad, Gerber, Excellon, pick-and-place, IDF, Eagle XML in `other.ts` and binary in `eaglebin.ts`, board-viewer in `boardview.ts`, DXF, STEP, IPC-2581, ODB++, GenCAD), Allegro detection, and archives (zip, tar, gzip, Unix compress).
- `src/cad/`: geometry. `generate.ts` is the holder around one board; `dock.ts` the rail shoe, socket, tongue, spine and rod; `dockplan.ts` plug access, orientation and auto-assignment (no geometry kernel); `panelgen.ts` the panel (placement, rows, placing added boards, collisions, parts, assembly steps); `cableroute.ts` cable routes and their collision checks (no geometry kernel); `railstand.ts` table stands; `boardviz.ts` board, part and plug detail for the 3D view; `assembly.ts` loose layouts; `export.ts` STL and 3MF output and plate packing.
- `src/fea/`: 2D solver (`fea2d.ts`), the flat clip (`clipfea.ts`), the dock (`dockfea.ts`), and a 3D beam solver for the holder's support ribs (`frame3d.ts`).
- `src/model/`: `holes.ts` (the hole wizard and stacks), `links.ts` (plug roles, Auto-connect, the port budget and cable sizes), `power.ts` and `powerdata.ts` (the power budget and its estimates), `poe.ts`, `zones.ts` (mains zones), `built.ts` (what was built, and what changed since), `boxes.ts` (boxes from a size and rows of ports, and what the editor writes back into them), `printers.ts` (printers from OrcaSlicer's machine profiles, filament settings from its generic filament profiles, and the print settings list).
- `src/ui/`: React UI. `Viewer3D.tsx` is the 3D view (picking, animation, explode); `pickOps.ts` what a selection is and how it is removed; `RackBuilder.tsx` the Rails step; `BoardEditor.tsx`, `PanelEditor.tsx` and `WiringView.tsx` the 2D board editor, the Rails view and the Wiring view; `BoxEditor.tsx` the Box tab, the box sketch and Build your own box.
- `src/worker/`: geometry and FEA run in web workers.
- `src/slice/`: in-app slicing with Kiri:Moto: printer start code and settings (`profiles.ts`), running the engine, reading the G-code back and the Bambu `.gcode.3mf` (`kiri.ts`), Bambu's template language (`bambutpl.ts`) and the check of a printer's own start code (`startcheck.ts`).
- `vendor/kiri/`: how `public/kiri/` (the Kiri:Moto engine, its workers and printer profiles) is built from the grid-apps source.
- `boards/`, `parts/`: community boards and contributed connectors, each with a guide for people (`README.md`) and steps for an AI job (`AGENTS.md`); `scripts/boards.mjs` and `scripts/parts.mjs` turn them into `public/boards/` and `src/model/parts.json`.
- `electron/`: desktop shell; `preload.cjs` exposes finding installed slicers and opening a plate in one.
- `.github/workflows/`: CI, and a release job that builds installers for all three platforms and publishes the web app.

Geometry uses [manifold](https://github.com/elalish/manifold) (WebAssembly), which always produces watertight, printable meshes.

## Licence

MIT for BoardDock itself; see [LICENSE](LICENSE). Third-party components and their licences are listed in [NOTICE](NOTICE).
