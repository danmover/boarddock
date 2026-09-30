# Using BoardDock

The app, step by step. For how the printed parts work, see [design.md](design.md); for printing, [printing.md](printing.md). Back to the [README](../README.md).

Contents:
- [Start and the library](#start-and-the-library)
- [The board editor](#the-board-editor)
- [The hole wizard](#the-hole-wizard)
- [Plugs, ports and protection](#plugs-ports-and-protection)
- [The Holder step](#the-holder-step)
- [The Rails step](#the-rails-step)
- [Stacks and columns](#stacks-and-columns)
- [Boxes, power and powerboards](#boxes-power-and-powerboards)
- [Cables and the Wiring view](#cables-and-the-wiring-view)
- [J-Links and serial adapters](#j-links-and-serial-adapters)
- [The 3D view](#the-3d-view)
- [A new version of a board](#a-new-version-of-a-board)
- [Coming back to add a board](#coming-back-to-add-a-board)
- [Loose holders](#loose-holders)

The seven steps are **Start**, **Board**, **Plugs**, **Holder**, **Rails**, **Check** and **Export** (keys **1** to **7**). Every step has **Back** and **Next** at the foot of the sidebar.

## Start and the library

![Start screen](images/start.png)

*(This picture predates 3.1.0: today's Start has the three ways in, Your printer, the cluster preset and the library shelves.)*

There are three ways in:
- **Drop your board's files.** Several at once is fine: each becomes a board, and you stay on Start with a **Check the boards** button.
- **Draw your own:** a board's shape, size and holes, and a photo of it if you like (see [the board editor](#the-board-editor)), or a box (see [Build your own box](#build-your-own-box)).
- **Open a saved rack.**

Above them is **Your printer**, kept in this browser for new racks: the plates, oversize parts and print times are for it from the start.

Below them is the library: every board and accessory with a 3D picture, on shelves (Raspberry Pi, Arduino and ESP32, hubs and chargers, powerboards, probes and adapters, community boards, **My boards**…), with a search. Click a tile to add it, or **+** on several and **Add N boards** adds them as one undo step. **+ Board** in the top bar (or the **A** key) opens the library from any step.

![Adding a board from any step](images/addboard.png)

- A second Pi 4B is named "Raspberry Pi 4B #2", so every list, label and cable says which one.
- **Remove** on a board's card in the Board step takes it out; Undo brings it back.
- With a rack open, Start says how far along it is, and the sidebar is a checklist of steps you can click through.
- On a phone, Redo, Save, New rack and the theme are under **⋯** in the top bar.
- **Building a Pi cluster?** The **cluster** preset above the library takes a number of Pi 4s or Pi 5s (up to seven), with or without PoE. It adds them with a switch, a powerboard and their supplies (or a PoE switch and no supplies), and connects it all, in one undo step.
- **Complete this rack** (on Start under **Your rack**, and at the top of the Wiring view's **To do** tab) adds what a rack still lacks: a supply for each Pi, outlets, a switch and its uplink. One undo step.
- **Ctrl/Cmd+K** opens the command palette: type to find a step or an action, then Enter. On a phone, use the search button in the top bar.

## The board editor

The Board step is a 2D editor for any board: one read from a file, one from the library, or one you draw from nothing. It draws the board the way it looks: the solder mask in the board's own colour, copper tracks a shade lighter under it, part shadows as long as the parts are tall, chip legs, tinned ends on resistors and capacitors, header pins with pin 1 square, what each pin is for (GND, TX, RX…) beside it, references in the silkscreen, and the board's name in a free corner.

The copper is the board's own when it came with it: from a KiCad file, an old binary Eagle board, or an Allegro board read through KiCad. Every other board gets plausible tracks drawn in for looks, and nothing is made from them. **Tracks** hides them.

- **The toolbox** is docked on the left (**T** shows or hides it): every plug, header, debug connector, hole and tall part as a picture of its own 3D model, in groups, with a search. Click one and it follows the pointer, snapping to the nearest edge if it is a plug, then click where it goes (Shift keeps placing); or drag it onto the board.
- **Snapping.** Dragging parts or holes snaps them to the board's edges and middle and to the other parts' sides and centres, with a guide line, and shows how far they are from the nearest edges. Alt drags freely; the arrow keys nudge.
- **The board check** under the board's card says what, as drawn, would spoil its holder, each with a fix: a hole off the board, too near an edge, under a part, or there twice; a plug whose mouth sits back from the edge (**Move it to the edge**) or faces into the board (**Turn it round**); a part off the board, or two on top of each other; a thickness no board has. **Fix all** does the safe ones in one undo step. A real board's holes are never moved: one in the wrong place is left out. A board with no holes is held by its clips; for one you are making, **Add corner holes** puts M3 holes 3.5 mm in from the edges.
- **Plug labels** (J_PWR, USB-C, HDMI0…) are printed just inside each plug on an edge, in 2D and 3D.
- **Click any dimension** to type what you measured: the board's **width** and **height** (the board stretches), and every dimension you put in.
- **Measure** (**M**) puts a dimension between two features: an edge, a corner of the outline, a hole's centre, or a part's centre or side. Type what your calipers read and the part (or hole) moves to it; a hole takes the holes in line with it along (untick to move just the one), and between two edges it sets the board's width or height. Drag a label to place it yourself; **Put back** and **Tidy all** hand the placing back to BoardDock.
- **Photo.** Put a photo of the real board under the drawing, scale it from two points and the distance between them, line it up, and trace the parts over it.
- Hover anything for what it is: its size, height, side, position, which way its plug goes in, what a hole is for, and how far it is from the left and bottom edges.

The sidebar has the board as a card (its 3D picture, size, thickness, holes and plugs; **In 3D**, **Save to My boards**, **New version…**) and tabs: **Parts** (plugs, tall parts, parts underneath), **Holes** (and **Add four holes** by spacing), **Headers**, **Board** (what it is: a board, or a debug probe or USB-serial adapter you drew yourself) and **Box** for a box.

**Draw your own** (on Start, or in **+ Board**): a rectangle, a rounded one or a round board, with its size, corners and thickness; holes at the corners or by their spacing (a Pi's are 58 × 49 mm apart); and a photo to trace over. **More shapes** has L-shaped, a notch in an edge, a corner cut off, a polygon (3 to 16 sides) and a round board with a flat. **Your own** opens the Shape tool's Line mode to draw the outline corner by corner.

**Save to My boards** keeps the board (or box) in this browser; the library's **My boards** shelf lists them for any rack. Its **×** takes one off, and the toast's **Undo** puts it back.

**On a box**, what you do in the editor sticks: drag a port and it stays exactly there; drag a side port to another side and it moves onto it; delete one and it leaves its row; put a plug on it from the toolbox and it becomes a port of the box.

**Shape** (**S**) changes the board's outline and its cut-outs. Three ways to work:
- **Edit:** drag a corner, or drag an edge to slide it straight out or in. Click the **+** in the middle of an edge to add a corner. Select a corner to type its X and Y, round it or cut it off, or press Delete; select an edge to type its length or bend it into an arc. With nothing selected, **Round** or **Cut** does every corner at once.
- **Line:** click corners one after another and click the first to close the shape (or press Enter). Shift keeps each edge to 15° steps. Type a length (and an angle) and press Enter for an exact edge. **Arc** (or A) makes the next edge a three-point arc. The closed shape is **added** to the board, **cut out** of it, or becomes a **new outline**.
- **Shapes:** a rectangle, circle or slot of the size you type, added to the board or cut out of it.

Everything snaps (Alt snaps nothing). An edit that would make edges cross, cut the board in two, or add a shape that does not touch it is refused, and says why. Holes and parts a new shape leaves off the board are ringed in red until you move them. Each edit is one ⌘Z.

## The hole wizard

Not every hole is for mounting. The wizard sorts them when a board comes in, and you can change any hole or group (Shift-click several and change one to change them all):

| Kind | Found by | The holder |
|---|---|---|
| **Mounting hole** | no part on it, near a corner or edge, 2.2 to 4.5 mm | puts a locating pin through it (it grips nothing: the clips hold the board) |
| **Connector peg** | inside a connector's body (RJ45 pegs, USB shell tabs, jack pins) | leaves it free, with a pocket underneath |
| **Part lead** | inside a part, or in a row at header pitch | leaves it free, with clearance for the leads |
| **Stacking standoff** | lines up with a hole of a board bolted on top | leaves it free, with room for the screw head or nut |
| **Ignored** | set by hand | does nothing |

Under the list, **Pins in the mounting holes** sets every mounting hole at once: **Locating pins** or **Ignore**. A selected hole has the same choice (**Locating pin** / **Ignore**). The board editor colours every hole by its kind.

## Plugs, ports and protection

Every connector gets an opening in the holder's wall, sized for its plug. Only the ports in use also get a **cradle** that carries the plug's body (so a knocked cable loads the holder, not the solder joints), a snap-on **cap** that locks the plug in, a **guard** collar, and a **zip-tie anchor** on the side the cable is pulled to. Every other port is left bare: its opening is still there to plug into later.

A port is in use when:
- a cable to it is in the app;
- it is the board's power input, or, on a board with no cables in the app, its main USB port;
- it is a debug or UART header (so adding a probe later needs no new holder);
- on a box, it is the box's own supply (mains in, DC in);
- you said you'll plug something into it.

In the Plugs step each connector has a tag: *empty*, or why it is in use (*cable*, *power*, *supply*, *you plug in*). Tap it to say you'll plug something into it yourself (a screen, a keyboard, a supply off the rack), or that it stays empty; tap again for automatic. The same choice is under **Will a plug be in it?** for the selected ports: **Automatic**, **Yes, I plug it in** or **No, it stays empty**. So a headless Pi's HDMI and audio ports are bare without you doing anything.

For the selected ports:
- **Protection** has a tick each for the cradle, the snap-on cap, the guard collar and the zip-tie anchor. Ticking one on an empty port marks it as one you'll plug in. Neighbouring cradles on one edge merge and share one cap.
- **Mating plug size**: measure the plug's body (the moulded part you hold), not the metal tip. **Reset to type** puts back the type's size.
- The plug's type, direction and height above the board.

Tick several ports to set them together, or click a cradle in the 3D view. **Copy this board's plug settings to** puts them on other boards (the ones of its own kind are ticked).

**Cables** at the top of the step: **In the app**, or **Off: holders and plug covers only**. With cables off, nothing is routed, drawn, tagged, listed or bought as a cable, and Plugs becomes a list of each board's ports, each "plug in it" or empty: those you mark get a cradle and cap. Your cables are kept for when you switch back on. It is in the command palette too.

The rest of the Plugs step (Auto-connect, the cable list, **Debug and serial**) is under [Cables](#cables-and-the-wiring-view) and [J-Links](#j-links-and-serial-adapters).

## The Holder step

Per board:
- **Holder style**: **Frame** (the default) or **Tray**. The style cards show your own board's holder in each style, in 3D. See [design.md](design.md#the-holder) for what each is.
- **Preset**: **Sturdy** (full tray, thick walls), **Balanced** (frame, the default) or **Lean** (thin frame, fastest print).
- **Material**: PETG by default. The Check step judges every spring against your material's limit.
- **Release button**: **Centred** (the default: the button sits in the middle of the holder's far edge, and the spine that carries its rod runs under the board, which sits about 10 mm up), **Beside the board** (the spine, grip bar and button run beside the board, so it sits low and the far edge stays free for plugs), or **Automatic** (whichever keeps the plugs clear with the least plastic). Plugs always win: if the button would block one, it moves, and the section names the plug.

![Holder features, each with what it did](images/features.png)

*(This picture predates 3.1.0: today the clips row is **Spring clips hold the board**, and only ports in use have cradles.)*

**Features** has one row per feature with what this holder actually got, so a switch never silently does nothing:
- **Plug cradles**, **Snap-on plug caps**, **Receptacle guards** and **Cable-tie anchors**, each with how many (caps clip onto cradles, so they need them). Switching a kind off here keeps each plug's own choice for when you switch it back on.
- **Spring clips hold the board**, with a **Firm** / **Gentle** switch for how hard the board presses in. It says how many spring clips and fixed ledges the board got, and, when clips don't fit, why. See [how the board is held](design.md#how-the-board-is-held).
- **Engraved label**: the board's name by default. If it doesn't fit a free wall it is shortened to a form that still says which board it is ("Raspberry Pi 4B" becomes "Pi 4B", "Raspberry Pi Zero 2 W" becomes "Pi Zero", never just "2 W"). Your own words are never cut. It only gives way to the spring clips if that actually gives them room.
- **Finger notches** on a tray. A frame is open underneath: pull a clip back and push the board out from below.

A box sits in low guards and is strapped down, so it has no clips, notches or label.

**Copy these settings to** puts this holder's options (style, sizes, features, material, colour) on the other boards of its kind, on every board, or, with **Copy to…**, on the boards you tick. One undo step.

## The Rails step

![Rails step](images/panel.png)

At the top: **On DIN rails** or **Loose holders** (see [Loose holders](#loose-holders)).

The Rails step shows the whole rack as a tree: rails, docks, the front and back slot of each dock, and stacked boards under the board they sit on. Chips show where the plugs point, and each dock's label says how its boards sit (standing, lying flat, or a mix). Drag a board onto:
- a slot, to seat it there;
- a rail, for a new dock at its end;
- another board, to stack it (see [Stacks and columns](#stacks-and-columns));
- **+ Rail**, for a new rail with it;
- the tray, to take it off the rails.

Quick layouts are **one rail**, **rows** (a new rail when one gets longer than your limit) and **columns** (vertical rails). You don't have to drag (on a touch screen a board drags by its grip): **Share a dock with…** puts a board in another board's free slot, back to back, and **Put behind…** fills an empty back slot.

**Lock and changes** locks the whole layout, or one dock or rail. Auto-arrange, Tidy up, docks sliding to make room and Auto-connect leave what is locked where it is, and new boards go elsewhere. Each automatic change writes a receipt (**Changes made for you**), and ⌘Z takes back the change and its line together.

**Fit and spacing** has **Tongue fit (looser +)**: raise it by 0.05 to 0.1 mm if the test-fit kit's key is tight.

### Standing up or lying flat

**Boards in their docks** sets it for the whole rack:
- **Stand up** (the default) takes the least rail.
- **Lie flat** stands far less out of the wall (a Pi, Uno, Pico and ESP32 rack: about 72 mm instead of 163 mm), and headers point straight out at you, but each board takes its width of rail.
- **Whichever suits each** lays a board flat only where that keeps its plugs clearly easier to reach, and says which boards it laid flat.

A small table under it compares the choices you have tried on this rack: rails and their length, how far it stands out from the wall, and cable to buy. Each slot also has its own **stands / lies flat** toggle in the Rails list and in the dock's inspector. How a flat board docks is in [design.md](design.md#lying-flat).

### The Rails view

The **Rails** view shows the rack from above: rails, table stands, docks, and every board's footprint. Arrows show where each board's plugs point:

| Mark | Meaning |
|---|---|
| **◉** | faces you, easy to reach |
| **✓** | reachable from the side |
| **⚠** | points at the next dock |
| **✕** | points into the table or wall |

**Overlaps** between neighbours are hatched red. The Check step lists the rails to cut and how tall the rack stands.

### Auto-arrange

**Auto-arrange** is on by default:
- It tries every dock edge and all four turns for each board, and picks the one with the best plug access. It never lets a plug point into the table, keeps the release button clear of plugs, and prefers boards that stick out less.
- It pairs boards back to back in one dock when that costs nothing in plug access.
- It packs the docks along the rail by their real 3D size, including plugs, cradles and buttons, and starts a new rail when one gets longer than your limit. Boxes such as hubs and chargers get a rail of their own.
- It orders, turns and rows the docks for their cables: a planner scores layouts on cable length, crossings, cables under rails, plugs blocked by a neighbour, ribbon length and rail used, then checks the best one or two with the real cable router. On 13 test racks it cut cable by 23%, the longest cable by 24% and crossings from 87 to 18, against rails about a third longer (the **Compact** goal turns that round). It takes under a second for 16 boards; the first build of a big rack takes longer, and the pick is remembered.
- It keeps each holder's tongue under the limit Check holds it to: a long board is docked by an edge that gives a shorter lever, and a board that can't stand on any edge without failing lies flat instead. For a tongue over its limit, the Rails tree has a button to dock it by another edge (or lay it flat) when that fixes it.
- Settings: rail direction, longest rail, gap between docks, space between rails, and pairing on or off.

**Options**, beside the button: probes beside their board and stacked in one column, a goal (**Balanced**, **Compact**, **Short cables**, **Easy to reach**), like boards grouped and turned alike, mains kept at one end, hosts near their devices, room to grow on each rail, back-to-back pairing, cables that fit stock lengths, hot boards spread out, and fewest printed parts. Each is a weight on the same score, not a separate rule. **Pack new boards only** places boards you have just added and leaves every other dock and rail where it is.

Changing how a board docks slides the docks after it along the rail to make room; where it now reaches over the next rail's docks, that rail and the ones beyond slide across. With Auto-arrange on, every change lays the rack out again, a new cable too. When that adds a rail, moves a board to another rail or adds 30 cm or more of cable to buy, a toast says so and offers **Keep the old layout**. On a built rack, Auto-arrange asks first.

### Editing by hand

The first edit keeps everything where it is and switches to manual. A dock dropped on top of another slides to the nearest gap beside it, and a dock a board leaves empty goes. **Tidy up** takes out empty docks and slides overlapping docks apart along their rail.

| Action | How |
|---|---|
| Move a dock along its rail | drag it, or the arrow keys (Shift = 10 mm) |
| Move a dock to another rail | drag it onto that rail |
| Move a rail | drag the rail |
| Turn a dock 90° | **R** (Shift+R turns the other way) |
| Swap front and back boards | **F** |
| Select several docks | Shift-click, or drag a box; ⌘A selects all |
| Remove | Delete |
| Put a board on the panel | drag it from the board list onto a rail (new dock) or onto a dock (shares it back to back) |

The inspector sets: dock or flat clip; which side of the rail the release lever is on; the turn, with a picture of each; rail and position; the board in each slot; which board edge goes into the dock, or Auto; and the rail's direction, position and length (fixed, or cut to fit).

## Stacks and columns

A board can sit on top of another; the bottom one carries the dock. In the Rails step, drag a board onto another board, or use the **Stacks** section: pick the board in **Stack a board** and where it goes in **Stack on…**. A stacked board's row then says what it sits on, how (**Bolted on standoffs**, **Printed layer** or **On its edge**), and has **Take off the stack** to give it a dock of its own again.

- **Bolted on standoffs:** a HAT on a Pi, a shield on an Arduino. The top board is lined up on the holes the two share. BoardDock picks the shortest standard standoff that clears what is under the top board (11 mm, a HAT's, at the least); type your own length if you like, and Check says if it is too short. The row says how many standoffs and screws, and their size.
- **Printed layer:** a separate board on its own light holder, pressed onto four corner towers on the holder below.
- **On its edge (a column):** small boards, up to about 105 × 60 mm (a J-Link, a USB-serial adapter, a Pico, a Nano…), stand on their long edges, one on top of the other like bricks. Each lifts straight off on its own, and one press on the top button frees the whole column from the rail.

Bolted is chosen when at least two holes line up; you can switch it. Only sensible targets are offered: boards about as big or bigger, and never a hub, charger or powerboard. A small board can go on another small board in a column; a J-Link or an adapter only ever goes in a column.

**The column rule.** In a column, every board, the bottom one too, stands on the long edge that keeps its plugs to the side: below the top, a plug pointing up the column would sit where the holder above stands. A board that can't avoid it (a Pi Zero, with all its plugs on one long edge) gets a **Plug up the column** line in Check. To fix it, put that board at the top of its column (Rails › **Stacks**), or stand it on its other long edge in the Rails step.

The rack holds a column to what the dock's tongue can bear: in PETG, a J-Link and an adapter fit in one column, and two J-Links do not. How the stacks are built is in [design.md](design.md#stacks-and-columns).

## Boxes, power and powerboards

A box is a size and rows of ports (Board step, **Box**). Pick a preset (USB hub, powered 7-port hub, USB-C hub with Ethernet, USB charger, USB charger with USB-C, network switch, PoE network switch, plug-pack supplies) or set your own:
- length, width and height; its **corners** seen from above (square, rounded, or cut off); its **colour** in the 3D view;
- rows of ports, each on its own card: how many, which type (USB-A, USB-C, micro-USB, USB-B, DC barrel, mains, RJ45, HDMI, audio, screw terminals), on which face, and what they are for (hub port, upstream, power out, DC out, power in…);
- for ports that give power, what each one gives (a 27 W USB-C PD port gives 5 A, most USB-C charger ports 3 A), and a DC port's voltage;
- a plug pack's own lead length, and a powerboard's rating (A, from its label).

![Box editor with a 7-port powered hub](images/box.png)

By default a row's ports are spaced evenly and centred on their face. Under **Where they are** on each card you can match your box exactly: along the face (centred, from the left or right end, or each port where you put it), the spacing, the height up the side, which way up (named by what you see in the socket), and for ports on top, where and at what angle (45° lets plug packs sit side by side).

A live sketch above the cards shows the box from above and each side with ports as you see it. The editor says when ports don't fit their face, overlap, or sit higher or lower than the box. A box is held down by a 12 mm hook-and-loop strap through four loops on its holder, placed where the strap misses every plug (or zip-tie loops where no gap is wide enough). A box longer than your printer's bed (a powerboard usually is) gets its holder in two halves that meet end to end, each clipped to the rail on its own.

### Build your own box

On Start, **Draw your own › A box** builds one from scratch: a USB hub, a USB charger or a power supply, with its name, size and colour. It starts with a typical port or two for its kind; change them under **Box**, then drag each port in the editor to where it is on yours. **Save to My boards** keeps it for any rack. None of the box holders has been printed yet: check a test print against your box.

### Plug packs

The Raspberry Pi 27 W (5 A) and 15 W (3 A) USB-C supplies and a 12 V DC plug pack plug straight into a powerboard's outlet, so they stay off the rails and get no holder; their own lead goes to the board, drawn from the outlet and checked against its length (1.2 m on the 27 W supply, 1.5 m on the 15 W one and the 12 V pack). A DC pack only goes to a DC input on its own when both say the same voltage. BoardDock can't check polarity, so check both labels.

### Power

The Plugs step counts what still needs a port: USB devices against free hub and computer ports, and boards that need power against free ports strong enough for them. A board on a port too weak for it still counts as needing power, so the offer to add a charger (or, for Pi 5s, their own 27 W supplies) stays until every board has enough. A USB device with no port on the rack can go to **your computer**. Boards with screw terminals or jumper headers and nothing connected (a relay board, a power distribution board) are listed too: Auto-connect leaves wiring to you.

![Power budget in the Plugs step](images/power.png)

*(The budget bars are current; the sidebar in this picture predates 3.1.0.)*

**Power budget.** Every charger, powered hub, bus-powered hub and Raspberry Pi USB port gets a bar: what the boards on it take at full load against what it gives, at 5 V. It warns when a charger is asked for too much, when a Pi's four USB ports (1.2 A between them) or an unpowered hub carry too much, and when a board needs more than its port gives (a Pi 4 wants 3 A; a USB-A charger port gives about 2.4 A). A Pi 5 wants 5 A, which only a 5 A USB-C PD supply gives: on a 3 A port it runs, but holds its USB ports to 0.6 A between them. **Move boards to stronger ports** fixes what it can in one undo step.

Each powerboard gets a **mains** bar: what the supplies on it draw from the wall at full load (at about 85% efficiency) against its rating (typical: AU 10 A, UK 13 A, US 15 A, EU 16 A; set yours under **Box**). A PoE switch gets a bar for its PoE budget. The figures are estimates: set a board's own under **Board › Power** and a charger's total under **Box**. Check lists the same.

### Powerboards

Powerboards (power strips) are boxes too: 4 or 6 outlets, switched, angled 45° for plug packs, or with two USB ports. Set the outlets (AU/NZ, UK, US or EU), how many, their angle and the size under **Box**. Auto-connect plugs each charger's mains lead into a free outlet. A powerboard's own lead goes to the wall: BoardDock never plugs one powerboard into another, and won't put a mains outlet onto screw terminals (mains through relays belongs in a proper enclosure, wired by someone qualified). It checks which plug goes where and adds up the load it knows about; it can't check your powerboard, its lead, earth or the wall socket.

## Cables and the Wiring view

![Wiring view](images/wiring.png)

Each plug gets a role from its type, its name and its board:
- a Raspberry Pi's USB-A ports are hosts, and its USB-C is its power input (or its Ethernet, with **PoE HAT fitted** under Board › Power);
- an Arduino's USB-B is a device, and its barrel jack is an optional input that takes only 7 to 12 V;
- a hub's ports feed devices;
- a charger's ports give power, and a PoE switch's PoE ports give it over Ethernet.

**Auto-connect** pairs the free plugs the way you would, and says why it chose each one (hover a cable, or see the Cables list). In order:
1. hubs to the nearest computer or board that hosts them, else to **your computer**;
2. power: a board with a PoE HAT from a free PoE port with budget left; every other board only from a port that gives it enough, with no charger loaded past what it gives. A powered hub's port will do for a small board, never a Pi;
3. devices (an Arduino's USB, a probe's or adapter's USB) to the nearest hub port, else a board's own USB port while their shared limit allows, else **your computer** (its 2 m cable is on the shopping list);
4. each board's Ethernet to a **network switch**, and each switch to **your router**, off the rack (the shopping list asks you to measure that cable);
5. a DC plug pack to a DC input of the same voltage (for an Arduino's jack, the pack nearest 9 V). A switch or powered hub with nothing on its DC input gets a To do line, and **Add its supply** puts that plug pack on the rack;
6. mains leads and plug packs to the nearest free outlet of a powerboard;
7. J-Links and serial adapters to the headers they serve.

Each kind is paired all at once, the cheapest pairing in all, by how long each cable would be as the rack is laid out. Leaving Plugs with **Next** on a rack with no cables runs Auto-connect first (⌘Z undoes it). **Rewire** chooses Auto-connect's cables again after you move boards, and leaves the ones you connected yourself. In the Plugs step, pick **Cable to** for any plug.

The Plugs step's **Cables to buy** and the shopping list use the same wording and lengths. Under Plugs › Cables, **Buy every Ethernet lead at one length** rounds them all up to the longest one's stock length.

**In the Wiring view:**
- **Drag** from a plug to the plug it goes to, or onto a board (it takes that board's best free plug that fits). Plugs that fit light up green.
- **Click** a plug for its **best matches**, each with how long the cable would be and what the port gives.
- **Drag a plug that already has a cable** to move that end (it keeps its number).
- After you connect one by hand, **Connect N more like this** does the same for boards like it.
- The list's **To do** tab says what still needs a cable, with the best match and a **Connect** button for each, and what the rack is short of (charger ports, hub ports, a switch), with a button to add one. **Complete this rack** is at its top. **Cables** lists every cable with its number, its ends, what it is and its length.

The Wiring view is a canvas: pinch (or ⌘ + scroll) zooms, dragging the background pans, and the percentage button fits everything in. Drag a card by its title; it stays where you put it. **Arrange…** lays the cards out again, as the cables flow or as the boards stand on the rails. **Find a board** shows just one board's cables.

A pin header (▸) opens into its pins, with their net names from your KiCad file. Click a pin, then a pin on another header, to add a jumper wire (ground black, supply red). A wire onto pins ends in a female housing; into a pin socket it ends in a male pin, drawn and bought that way. Click a wire and press Delete to take just that one off.

![Cable numbers and tags](images/cables.png)

**Every cable has a number**, and keeps it: adding or removing others never renumbers it. The number and what the cable is for ("Power: USB charger → Pi 4B") show on a badge in the 3D view (**Layers › Cable numbers** hides them), in the Wiring view, in the cable list, the shopping list and the assembly steps. **Numbered cable tags** print with the rack, two per cable, each held on by a 2.5 mm zip tie (the ties are on the shopping list); switch them off in the Plugs step. How cables are routed and the tags are made is in [design.md](design.md#cable-routing).

## J-Links and serial adapters

A board's debug headers are found on import: by shape (a 2 × 5 header at 1.27 mm, Tag-Connect pads) or by name (a 10 or 20-pin header whose reference, value or footprint says SWD, JTAG or debug). UART headers are found by name (UART, serial, console, FTDI, TX/RX). To mark any other part, select it and choose **Debug / UART…**.

**J-Links and adapters are ordinary boards**, docked and cabled like any board. Each stands on its long edge in a column (see [Stacks and columns](#stacks-and-columns)). Auto-arrange puts a board's first J-Link and adapter in the back slot of its dock, right behind it, and further ones in docks of their own beside it.

**One press adds what's missing.** On the Plugs step, **Debug and serial** lists every header with its probe, ribbon length (one click sets a short ribbon to the next standard length), dock slot and where pin 1 is. **Add 3 J-Links + 2 adapters** (the numbers are your rack's) gives each free debug header a J-Link with the right connector and each free UART header a USB-serial adapter, docked beside their board and cabled, in one undo step. **+ J-Link** and **Adapter** on a header's row do just that one. **Bench sheet** prints it all on one page.

- **A J-Link** is a board (65 × 40 × 1.6 mm) with a 20-pin 1.27 mm Cortex connector and a USB-B. Its ribbon loops over the top and down to its header, checked against its length (200 mm unless you set yours) and never on the shopping list. For other headers the list has the adapter to buy. Draw your own as a board and set **It is** to a debug probe.
- **A USB-serial adapter** is the FT232RL board (36 × 18 mm, mini-USB, six pins). Jumper wires go from its pins to the UART header, crossed over (its TXD to the board's RX), bought by the wire. A female header gets male-ended wires. Pin names guessed from a header's size say to check yours.
- **Or a serial cable:** a USB to TTL serial cable (3.3 V, loose jumper ends) from a free hub or computer port to each free UART header: black on GND, green on the board's RX, white on its TX, red left off.

On a rack laid out by hand or built, a new J-Link or adapter goes into the free back slot of its board's dock (else the nearest free slot, else a new dock), and the toast says which. Check warns about jumper wires longer than 30 cm and a ribbon longer than its length. A second J-Link for one board needs a ribbon of about 250 mm. The examples to try are **Example: dual-MCU board…** and **Example: sensor board…** in the library, and as KiCad files in `examples/`. None of this has been printed yet.

## The 3D view

![The 3D view](images/rack.png)

| Action | How |
|---|---|
| See what something is | hover over it |
| Select a board, dock, rail, cable, table stand, or one holder feature (cradle, cap, pin, spring clip, guard, tie anchor, label, stand socket) | click it |
| Select several | Shift-click |
| Remove the selection (a cradle or cap is switched off, a pin becomes an ignored hole, a dock, rail or cable is removed, a board leaves the project, table stands are switched off) | Delete, or **Remove** in the bar below the view; one ⌘Z brings it all back |
| Jump to the settings of the selected thing | **Edit** in the bar |
| Change how a board is mounted | pick the board or its dock: **Stands up** or **Lies flat**, which edge goes in the dock, turn the dock, swap its boards; with loose holders, the DIN clip and how it sits |
| Fly to a part | double-click it |
| Watch it go together | the play button; **‹ ›** step back and forward, **✕** shows it assembled; on a built rack, **Only what's new** |
| Build it at the bench | **Guide** |
| Pull it apart | the **Explode** slider |
| Show or hide holders, docks, caps, boards, plugs, cables, cable numbers or rails | **Layers** |
| Look at one thing | **Isolate** hides everything else; **X-ray** makes the rest see-through; **Esc** leaves |
| See what changed since the build | **What's new** tints the new parts, cables and boards |
| See where the mains is | **Mains zones** shades a 10 mm margin round each mains board |
| Turn a part, a box port or a dock | the **rotation box**: type an angle, or turn by 15°, 45° or 90° |
| Find any action or step | **Ctrl/Cmd+K** (on a phone, the search button) |
| See every keyboard shortcut | **?** |
| Go to a step | **1** to **7** |

**Boards** show a solder mask with copper traces and vias (their own from KiCad files, old binary Eagle boards and Allegro boards read through KiCad; a decorative pattern on every other board), silkscreen, pads, chips with their part numbers, passives, LEDs and switches. Rails are slotted metal DIN rail, and printed parts show their layer lines.

**Plugs** are drawn after their type, and only where one goes: a cable to another board on the rack, a port in use off the rack (a screen, a supply), or a box's own supply. A free port stays empty, and unused ports get no cradle. A lead that leaves the rack is drawn as a short stretch that fades into a dotted line saying where it goes ("to a screen", "to the wall").

**Cables** are translucent tubes, coloured by kind (a colour-blind safe set, with a key under the view's tabs). The one you pick or hover stands out. They bend in arcs of about four diameters, as real ones do.

**Live** (in the bar, on by default) switches the rack on: LEDs glow and do what they do, a board with no power stays dark, and pulses run along the cables the way power or data goes. It is only for the look: whether each board gets enough power is the Power check's job. It holds still if your system asks for reduced motion.

![Stepping through the assembly](images/steps.png)

*(This picture predates 3.1.0: the step now says the board clicks under the spring clips.)*

**Steps** plays the assembly the way you would do it: stands, rails, shoes and sockets; then for each board its release rod, the board into its holder (tipped in under the spring clips and pressed down), anything stacked on it, and the holder into its dock; then the cables (power first, mains last), the caps, and a last step: check every screw terminal, switch the powerboards off, plug them into the wall, then switch on.

**Guide** is the same steps for the bench: a big card says which step you are on and plays it; **Back**, **Again** and **Next** (or ← → and Esc) are big enough for a thumb. **Print** takes a picture after each step, with its new parts outlined in blue, and prints them with the words and the bill of materials (or save it as a PDF).

## A new version of a board

When a new revision of one of your boards comes out, select it and press **New version…**, or drop its files on that button. The new version takes the old one's place:
- it keeps its name, dock, stack, holder settings and every cable to a plug it still has;
- the choices made on the old one carry over where the part is still there: plug cradles, caps, guards and tie anchors, hidden parts, and holes set by hand;
- what changed is listed ("Connectors: J2 moved 2 mm; J4 new (USB-C)", or "No mechanical changes: the holder comes out the same").

If the new version makes something fail in Check that did not before, the toast and the board's list of changes say so.

To put a **different** board in a board's place (an Arduino Mega for an Uno), press **Replace with…** on its card and pick one, or drop its files. It keeps the old one's dock, stack, holder settings and the cables to plugs it also has.

**Print its holder** goes straight to Export with just that board; on a built rack, **What's new** lists its new parts and the old holder as spare. One ⌘Z goes back to the old version.

## Coming back to add a board

Once the rack is built, press **Mark the rack as built** in Export. BoardDock remembers what you printed, the rail lengths you cut and the cables you bought, and freezes the layout.

Later, a saved rack opens on **Your rack**, with its boards and buttons for the rails, the cables and what's new to print. Drop the new board's files in. It goes:
1. into the empty slot of a dock already on the rack, if it fits there with all its plugs reachable and touches nothing (then only its holder is new);
2. otherwise into the first gap on the rails that is clear in 3D, preferably on the rail of a board it is cabled to;
3. otherwise on the end of a rail, and Export says that rail has to be longer.

Nothing else moves. Connect its cables (Auto-connect only fills plugs that are still free). Export then lists what to do since the build:

![What changed since the rack was built](images/whatsnew.png)

It is a numbered checklist in the order you would work, each step with the parts to print for it: **Take off** removed boards; **Swap** a board for its new version; **Cut** a rail that has to be longer and **move the end block**; **Slide** a built dock to its new place; **Move** boards that now sit elsewhere; **Clip on** each new dock; **Seat** each new board; **Plug in** the new cables (and say when one you have is now too short); and what is **spare** now.

Plates, the estimate and the download follow it. Press **I've built these too** when you have. **Forget**, by the Built heading, asks first, then forgets the build (⌘Z undoes it).

## Loose holders

Choose **Loose holders** at the top of the Rails step (**On DIN rails** / **Loose holders**) for holders without a rail dock:
- **stacked** on corner towers with press-fit pegs;
- **side by side** with printed link bars;
- **back to back**, joined by a pin through both bases and a U clip that slides onto its neck.

Each holder can also have a flat pull-tab **DIN rail clip** (off to start with: tick it if you have a rail) or a **stand socket** (a round, square, hex or D-shaped post, or a 1/4"-20 tripod nut trap). The joints are described in [design.md](design.md#loose-holder-joints).

- A stack never covers a box: hubs, chargers and powerboards stand beside it on the table. Plug packs get no holder.
- A board bolted onto another gets a standoff on each hole the two share and a screw in each end (M2.5 for a Pi, M3 for an Arduino); the Rails step says how many.
- Cables between loose holders aren't routed or sized: each plug gets a short cut-off tail in 3D, Check says so, and the shopping list asks you to measure them on your bench.

| Stacked | Side by side |
|---|---|
| ![Stacked](images/stack.png) | ![Side by side](images/side-by-side.png) |

*(These two pictures show an early version of the app and its holders.)*
