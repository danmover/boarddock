# Supported files

What BoardDock reads, how it recognises connectors, and how to add boards and connectors of your own. Back to the [README](../README.md).

Contents:
- [File types](#file-types)
- [How connectors are recognised](#how-connectors-are-recognised)
- [Telling .brd files apart](#telling-brd-files-apart)
- [Cadence Allegro](#cadence-allegro)
- [Altium .PcbDoc](#altium-pcbdoc)
- [Zips, tgz and folders](#zips-tgz-and-folders)
- [Adding boards and parts](#adding-boards-and-parts)

## File types

| Source | What to export | What BoardDock reads |
|---|---|---|
| **KiCad** 5 to 9 | the `.kicad_pcb` file | outline (lines and arcs), holes, footprints with courtyard sizes, top and bottom parts, copper traces and vias |
| **Altium Designer** | *File › Export › STEP 3D*, or Gerber + NC drill + pick-and-place | STEP: board outline, holes and part bodies. Fab files: outline, holes, parts. |
| **Fusion 360 / Eagle** 6 and later | the `.brd` file, or STEP | outline, holes, packages |
| **Old Eagle** (3 to 5, binary) | the `.brd` file as it is: no Eagle needed | outline (lines, arcs and circles), cut-outs, holes, parts with their sizes and sides, pin header pins, copper tracks and vias |
| **Board viewers** (the files OpenBoardView opens) | the `.brd`, `.bdv`, `.bv` or `.bvr` file | outline, each part as the spread of its pins, top or bottom, pin nets. No holes or heights. |
| **Cadence Allegro / OrCAD PCB Editor** | the `.brd` file, in the desktop app with KiCad 10 installed | what KiCad reads from it, as for a KiCad board, copper included |
| **EasyEDA / JLCPCB** | Gerber zip + CPL (pick and place) | outline, holes, parts |
| **Any EDA tool** | IDF 3.0 (`.emn` + `.emp`) | outline, cut-outs, holes, part outlines and heights |
| **Allegro, OrCAD, PADS, Xpedition, Altium, Zuken and others** | IPC-2581 (`.xml` or `.cvg`) | outline and cut-outs, board thickness, holes (plated or not; vias left out), parts with their place, side, turn, package size and height, header pins with their nets |
| | ODB++ (a `.tgz` or `.zip`, or the job folder dropped as it is) | outline and cut-outs, holes from the drill layers, parts from the top and bottom component layers with package sizes from `eda/data`, header pins with their nets; inch or mm |
| | GenCAD 1.4 (`.cad`) | outline and cut-outs, board thickness, mounting holes, parts from their shapes, heights, header pins with their nets |
| **Mechanical drawing** | DXF | outline and round holes |
| **No files** | draw it, or start from a template | see below |

**Templates** in the library: Raspberry Pi 4 / 3B+, Pi 5, Pi Zero / Zero 2 W and Pico; Arduino Uno R3, Mega 2560 and Nano; ESP32 DevKitC; perfboard 50 × 70; a blank 60 × 40 rectangle; a 4-channel relay board and a DC power distribution board; and two example boards with debug and UART headers. The accessories (hubs, chargers, switches, supplies, powerboards, a J-Link and a USB-serial adapter) and any community boards are there too. Template boards come from the makers' drawings: check yours.

## How connectors are recognised

Connectors are recognised by footprint name, by the usual makers' part numbers in a footprint or value, and failing both, by their pins. Checked against KiCad's whole connector library, 94% of its footprints are identified (98% leaving out bare solder pads), and none of its 5,600 other parts is taken for a connector. Each is sized for the pins its name says (a 2 × 8 box header, a 6-pin JST) and drawn as itself in 3D, its plug too. Every one is in the board editor's toolbox, with a picture of its own. The families:
- **Computer and network:** USB-C, micro and mini USB, USB-A and B, HDMI, DisplayPort, RJ45 (Bel MagJacks, HanRun, Würth, Pulse…), RJ11, SATA, SFP cages, mini-DIN and PS/2, microSD and SD, SIM slots.
- **Audio, coax, mains and industrial:** 3.5 mm audio, RCA, XLR, TOSLINK, banana jacks, BNC, SMA, MMCX, MCX and SMB, u.FL, D-sub, DC barrel jacks, IEC C14 mains inlets, M12 and M8, XT30 and XT60.
- **Wires and headers:** terminal blocks, box headers for a ribbon, flat-cable (FFC/FPC) sockets, Qwiic, wire-to-board sockets (JST, Hirose DF, Molex PicoBlade, KK, Micro-Fit and more), and pin headers and sockets (Samtec, Sullins, Würth, Harwin, CNC Tech…).
- **Board-to-board and cards:** Samtec QSH, QTE, SEAM and ERM8, Hirose DF12 and DF40, Molex SlimStack, M.2 and mini PCIe, PCIe slots by their lanes, DIMM and SO-DIMM sockets, and spring-pin pads. Nothing is cabled to these. A holder keeps clear of the socket, and of the card in an M.2, mini PCIe, PCIe or DIMM socket; the card or board that goes on them is not drawn.

The sizes come from KiCad's library, drawn from the makers' datasheets, for SATA, XLR, banana, BNC, SMA, TOSLINK, SIM, SFP, SO-DIMM, mini PCIe, the mezzanine bodies, the 3.5 mm jack and the right-angle box header. A few are still typical sizes; [limits.md](limits.md) lists them.

**Names** are read as Allegro libraries and their exporters write them: IPC-7251 header names (`HDRV10W64P254_1X10_…`, `HDRRA…`), a maker's name in front (`SAMTEC_TSW-110-07-L-S`, `TE_5745781-4`), upper case, `_10P` pin counts, and part numbers with the dashes taken out (`TSW11007LS`, `A8291A1T91B`). A bare word such as HDMI, SMA or TRS names a connector only on a connector's reference (J, P, CN, TB, ANT, HDMI1…): a diode package called SMA, a TRS3232 or a USB4640 stays a chip.

**Each is wired as what it is:** an SFP cage is a network port (Auto-connect uses a board's RJ45 before its SFP cage), a C14 inlet takes a kettle-type lead from a powerboard's outlet, TOSLINK goes only to another TOSLINK, XLR takes RCA and 3.5 mm cables, and a banana jack is wires you connect.

**By its pins**, where the name says nothing BoardDock knows (an Allegro board read through KiCad keeps Allegro's names, such as `CON10` or `HDR1X6`), a connector (J, P, CN…) is recognised by its pads: one or two rows at 2.54, 2.0 or 1.27 mm make a pin header; a 2 × 5 at 1.27 mm is the 10-pin debug connector, a 2 × 10 at 1.27 mm with debug nets the 20-pin Cortex one, and a 2 × 10 at 2.54 mm with JTAG nets the 20-pin JTAG one; two staggered rows at 2.77 mm are a D-sub; and a header whose nets are SWD or JTAG, or TX and RX, is a debug or UART header. Each one gets a plug size you can change.

## Telling .brd files apart

A `.brd` can be many things, so BoardDock looks inside: an Eagle XML board, an old binary Eagle board, a board-viewer file (Test_Link `.brd`, BRD2, `.bdv`, BVR) or a Cadence Allegro board. A zip holding one works too.

- **Old binary Eagle boards** (Eagle 5 and older) are read directly, copper included, so you don't need Eagle, which Autodesk no longer sells. Their format was never published: BoardDock follows the layout worked out by the open-source readers pyeagle and pcb-rnd, and says so on the board. Check the outline, holes and parts against your board before you print.
- **Board-viewer files** are the repair-shop kind: they hold part names and pin positions but no package names, holes or heights. A part's size is the spread of its pins, and connectors are found by their names (J1, USB1, CN2), so check each connector's type and add the mounting holes yourself.

## Cadence Allegro

Allegro and OrCAD PCB Editor `.brd` files are binary, and their format is not published. KiCad 10 reads them (releases 16 to 23) with a reader its developers built from hundreds of real boards, and BoardDock uses that rather than guess at a format it has no boards to check against.

**In the desktop app, with KiCad 10 or newer installed (free, kicad.org), drop the `.brd`, on its own or in a zip, and it comes straight in.** BoardDock runs KiCad's `kicad-cli pcb import` on it and reads the KiCad board that makes (KiCad 10 output). It finds KiCad in its usual install folders or on your PATH.

The web app can't run KiCad. Without KiCad, BoardDock recognises the board and says how to get a file it reads: KiCad's *File › Import › Non-KiCad Board File*, then drop the saved `.kicad_pcb`; or IPC-2581, ODB++, GenCAD, IDF, STEP or Gerbers with drill and pick-and-place from the designer or board maker. This was tested with a stand-in for `kicad-cli`, not yet with a real Allegro board.

## Altium .PcbDoc

Altium `.PcbDoc` files use a proprietary binary format. Export STEP or fabrication files instead; BoardDock explains this if you drop one in.

## Zips, tgz and folders

Archives can hold folders, and archives inside archives (a zip with the ODB++ `.tgz` in it). When one archive or folder holds the same board in several formats, BoardDock reads the one that tells it most, in this order: KiCad, STEP, IPC-2581, ODB++, IDF, Eagle, binary `.brd`, GenCAD, Gerber + drill + pick-and-place, DXF. If that file cannot be read it tries the next, and the board's notes say which file was used, which ones failed and why, and which were not needed. An archive with several board files of the same kind (three `.kicad_pcb` files) comes in as several boards.

## Adding boards and parts

The short version is in the README, under [Adding boards and parts](../README.md#adding-boards-and-parts).

- **`boards/`** adds a board to the library, under **Community boards**. Put its files in `boards/<slug>/`: one is enough (a KiCad `.kicad_pcb` is best; or IPC-2581, ODB++, GenCAD, IDF, an Eagle `.brd`, Gerbers with drill and pick-and-place, or a DXF outline), with a small `board.json` saying who made it and on what terms. Only upload what you may share. Then run `npm run boards -- <slug>`: it prints what it read (outline, holes, and which connectors it could not identify) and updates `public/boards/`. Guide: [boards/README.md](../boards/README.md).
- **`parts/`** teaches BoardDock a connector with one small JSON file. `names-….json` maps part numbers or footprint names to a connector type it already has, which fixes a `NOT IDENTIFIED`. `type-<id>.json` adds a new connector type (size, plug, what it connects to, and a look made of simple shapes), which shows in the toolbox under **Contributed**. Then run `npm run parts`: it checks the file and writes `src/model/parts.json`. Guide: [parts/README.md](../parts/README.md).

Run the tests the guide names, commit, and open a pull request ([CONTRIBUTING.md](../CONTRIBUTING.md) has the rest). Or open it with just the files: CI runs the same check and shows the report.

**The optional AI job.** A maintainer adds the `boards` or `parts` label to the pull request, and a Claude job follows `boards/AGENTS.md` or `parts/AGENTS.md` on its branch: it writes the hints or names, regenerates the data and commits. It needs the repository's `ANTHROPIC_API_KEY` secret, runs only for branches of this repository and only when the label is added, and does nothing in forks.
