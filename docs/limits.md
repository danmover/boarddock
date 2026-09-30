# Honest limits

What BoardDock has not proved, and where its numbers are approximate. Back to the [README](../README.md).

Contents:
- [Printed and tested](#printed-and-tested)
- [The models](#the-models)
- [Holding boards](#holding-boards)
- [The dock, rails and stands](#the-dock-rails-and-stands)
- [Boards, files and connectors](#boards-files-and-connectors)
- [Layout, cables and power](#layout-cables-and-power)
- [Printing and G-code](#printing-and-g-code)

## Printed and tested

- **One rack has been printed so far, from 3.0.0.** The DIN rail clip worked. The release button's tunnel was too tight and the button broke, the snap pins broke, the socket latch let a holder out too easily, and the tongue stoppers snapped. 3.1.0 redesigns all four (see the [DIN clip review](din-clip-review.md#after-the-first-print-petg-fdm)), but nothing from 3.1.0 has been reprinted.
- Fits, snap forces, creep and fatigue all depend on your printer and filament. Print the test-fit kit first.
- Least tested: the spring clips, hairpins and fixed ledges, the undercut latch, the rod's gate, the crush ribs, the column pegs' fit, the long release rod through a column, the slot for a board nothing clips in, the tongue under a tall column, boards lying flat, and the box holders.

## The models

- The FEA is linear, 2D and idealised. It has no contact, friction or print anisotropy, and its peaks sit at pixel-mesh corners. Treat it as a comparison between designs, not a guarantee.
- Only the dock's springs (the latch, the shoe's hinge and its rail grip) and the flat DIN clip get 2D FEA in the app. The spring clips, caps and rivets are beam sums with a textbook modulus, checked against FEA in the test suite. The stands, the tongue and tipping are hand calculations.
- The flexure rule (1% at full deflection, 0.2% at rest) and the 1.2 mm joint rule are held by the test suite, not by the Check step.

## Holding boards

- The feel of a clip's click, how firmly a board is held, whether a lip's 0.9 to 1.3 mm ledge droops, and how the anti-rattle springs' push creeps over years in a warm cabinet are for a print to tell.
- Every board is held by its edges, so it needs clear edge for its clips (and, where plugs take most of the edges, for a ledge). Where there isn't enough (a USB-serial adapter, docked or flat; a round board of about 20 mm lying flat; a board docked on an edge crowded with plugs), the Check step says **Nothing clips this board in**.
- The Nano's 8 mm hairpin is over the limit in PLA; print it in PETG.
- The frame holder's stiffness is from geometry, not tested: the board itself stiffens the frame once it is clipped in.
- **Columns:** a board whose plugs are all on one long edge (a Pi Zero) must be the top of its column. Below the top, a plug pointing up the column sits where the holder above stands, and Check says **Plug up the column**.

## The dock, rails and stands

- **The shoe's rail grip rests under a permanent preload** of about 1% strain, more than the 0.2% resting rule allows. It is what holds the shoe on the rail, and the rail clip worked in the first print; how much creep eases it over the years is for a print to tell.
- The rail grips (on the shoe and on the pull-tab clip) come from a 2D FEA with a textbook modulus and a guessed friction (0.3, PETG on zinc-plated steel). How firmly a dock really holds its place is untested. Each grip hangs 1.7 mm into the rail's channel, from 4.5 mm out from the rail's middle, so a screw head in the rail that reaches under it must be under 4.8 mm tall: pan, cheese, button and countersunk heads and M5 socket caps pass, M6 socket caps don't.
- The tongue's crush ribs flatten to fit the first time a holder goes in (about 24 N, once). The crush stress is assumed, not measured, so they may need more or less on your printer.
- A large board docked by one tongue feels a sizeable lever when you plug in a stiff cable at the far end. The tongue is 14 × 4.5 mm at the socket mouth (a Raspberry Pi 4 holder: about 25 MPa for a 20 N push on its far edge, against PETG's 45 MPa yield), and the Check step lists it for every board. Hold the holder while you plug in.
- The rail release is reached with the holders out (they cover the lever). Taking a single board out is the button on the holder, which is always reachable.
- A DIN plate standing off a holder's edge (rack or inline) prints standing, so the tops of its two slots are 14.4 mm flat bridges. If the clip goes on stiffly, trim the sag off with a knife or file.
- The table stands' fit, the dovetails and the cable combs' snap lips are sized from typical FDM tolerances, not from test prints. The sag and cap-stress numbers are hand calculations.

## Boards, files and connectors

- Template boards come from the makers' drawings; check yours. Imported part heights are only as good as the source (IDF and STEP are best).
- Some connector sizes are still typical ones, with no public datasheet drawing to check them against: M.2 sockets, PCIe slot depth, full-size DIMM, M12, RCA, DisplayPort, mini HDMI and Qwiic, and every connector's plug.
- Two boards that mate on a board-to-board connector aren't treated as one stack: put them in a stack by hand.
- Allegro `.brd` import was tested with a stand-in for KiCad's tool, not yet with a real Allegro board.
- Old binary Eagle boards are read from a format that was never published: check the outline, holes and parts.

## Layout, cables and power

- Plug roles for Auto-connect are guessed from connector types and names, except on boxes, where you set them; check the Wiring view.
- Cable routes are checked against bounding boxes: one marked clear is clear, one marked as touching may still fit, and real cables are floppier and stiffer in places than the drawn tubes. Cable tags are sized from typical cable diameters (USB 4 mm, Ethernet 6 mm, HDMI 7 mm).
- A second J-Link for one board needs a ribbon of about 250 mm (a 30 cm ribbon; the **Debug and serial** panel says so).
- The power budget uses estimates: the makers' recommended supplies and typical draws under load. BoardDock can't check voltages or polarity, your powerboard, its lead, earth or the wall socket.
- Big racks are slow to build the first time (one you have built before comes back instantly).
- "Only what's new" recognises parts by their geometry. If you change a holder setting after marking the rack as built, that holder counts as new even if you would not reprint it. A board that carries a stack is never put into another dock's empty slot automatically; place it by hand in the Rails step.

## Printing and G-code

- The printability check works on the parts' shapes, not on a real slicer's toolpaths. Its survey of the whole library was made before 3.1.0.
- Kiri:Moto has no bridge detection, so the longest bridges sag a little more there than in OrcaSlicer or PrusaSlicer.
- The in-app G-code has not been run on a printer. The start code comes from Kiri:Moto's community profiles (the X1 Carbon uses the P1S's) or BoardDock's plain templates, not from the printer makers, and the check of code you bring can't tell that it is right for a printer. Check the start of the first print, or use your own slicer. Slicing a full plate in the app takes much longer than a desktop slicer (seconds to a minute or more).
- The desktop app's **Open plate** looks for slicers in their usual install folders and has not been tried with every slicer and operating system. If nothing opens, download the plate's 3MF and open it by hand.
