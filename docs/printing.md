# Printing and export

Everything in the Export step: what to print first, the material, your printer and its settings, G-code, and what to buy. Back to the [README](../README.md).

Contents:
- [The test-fit kit](#the-test-fit-kit)
- [Material and printer](#material-and-printer)
- [Print settings](#print-settings)
- [What to print](#what-to-print)
- [G-code in the app](#g-code-in-the-app)
- [G-code in your own slicer](#g-code-in-your-own-slicer)
- [Supports: none](#supports-none)
- [What the slicers do with it](#what-the-slicers-do-with-it)
- [What to buy, and building it](#what-to-buy-and-building-it)

## The test-fit kit

Print this before anything else. **Test-fit kit · print this first** in Export gives one rail shoe, one socket and a small tongue key with its release rod: about 30 to 40 minutes of printing, with no supports.

1. Clip the shoe on your rail and press the socket into it.
2. Push the release rod into the key until it clicks, then push the key into the socket until the latch clicks.
3. Press the key's button and lift it out.

If the key is tight, raise **Tongue fit (looser +)** under Rails › **Fit and spacing** by 0.05 to 0.1 mm and print the kit again. The first time the key goes in, the two crush ribs on its tongue flatten to fit, so that push is firmer than the ones after.

## Material and printer

- **Material: PETG.** Every dock part is a spring. PLA is stiffer and more brittle, so strains that are fine in PETG are marginal in PLA (the Nano's short hairpins are over the limit in PLA). The Check step judges each part against your material's limit.
- **Printer:** pick yours in Export (or under **Your printer** on Start). The list has 18: Bambu Lab X1 Carbon, P1S, A1 and A1 mini; Prusa CORE One, MK4S, MK3S+, MINI+ and XL; Creality K1C, Ender-3 V3 SE and Ender-3 S1; Voron 2.4 and Trident; Elegoo Neptune 4 Pro; Anycubic Kobra 3; Sovol SV06; and Qidi Q1 Pro. Bed size and build height come from the machine profiles in [OrcaSlicer's open profile library](https://github.com/OrcaSlicer/OrcaSlicer/tree/main/resources/profiles). Parts are packed onto that bed, and any part taller than the build height is flagged.

## Print settings

Export lists what to set in your slicer for your printer and material. Each setting shows where to find it in OrcaSlicer, Bambu Studio or PrusaSlicer, and is marked by where it comes from:
- **design:** the parts need it. For example 0.45 mm wall lines (the rail shoe's hinge is exactly two of them), 0.2 mm layers, no supports.
- **profile:** OrcaSlicer's generic filament profile (for PETG: 255 °C nozzle, 80 °C bed, 20 to 100% fan, 10 mm³/s), or your printer's machine profile (retraction).
- **convention:** common practice, not a tested requirement. For example 3 walls, detect thin walls off, aligned seam, and a brim only for parts more than three times taller than they are wide.

The list also says what brim and skirt the slicer lays. **Copy** puts it on the clipboard, and the download's README has it too.

## What to print

Everything, only what's new since you built the rack, or just the boards you tick (with or without their docks and the table stands). The plates, the estimate (grams and print time per part), the download and the plates view all follow the choice. Each plate downloads as binary STL or 3MF.

## G-code in the app

Once your printer's start code is known, the main button, **Slice and download all G-code (.zip)**, slices every plate and downloads the lot, and **Download everything** can include the G-code. **Slice** next to a plate does just that plate. [Kiri:Moto](https://grid.space/kiri/) (MIT, by Stewart Allen) slices it inside BoardDock with the settings above and your filament's temperatures, and shows the print time, the grams and each layer. You get a `.gcode` file, or a `.gcode.3mf` for Bambu Lab printers.

- **Start and end code** comes from Kiri:Moto's own profile where it has one: Bambu Lab P1S and A1, Prusa MK3S+ and MINI, and Creality K1. Two printers use a close one, marked as such: the Creality K1C uses the K1's, and the Bambu Lab X1 Carbon the P1S's (Kiri:Moto has no X1 Carbon profile; watch the start of the first print). BoardDock swaps the A1 and K1 profiles' fixed PLA temperatures for your filament's. Other printers get a plain start (heat, home, purge line) for Marlin or Klipper, marked as such. You can paste your own for any printer under **Start and end G-code**. The Prusa XL is left to PrusaSlicer.
- **Start code you bring is checked** before it is kept: not empty, heating the bed and the nozzle, homing, no end code or slicer layers in it, temperatures within the printer's limits, moves that stay on the bed and under the printer's height, and not another printer's. Code that can't be used isn't kept, and the page says why. Code that only looks odd is kept once you read why and choose **Use it anyway**. The check can't tell that code is right for a printer, only that it isn't obviously wrong.
- **Bambu Lab printers, the A1 mini among them, can use their own start code.** BoardDock doesn't ship it (it is Bambu's), so bring it from your own copy of Bambu Studio or OrcaSlicer: the desktop app reads it from the slicer's install folder, or open the printer's `… template machine_start_gcode.json`, `… machine_end_gcode.json` and `… layer_change_gcode.json` from the slicer's `profiles/BBL/machine` folder, or paste them from the printer's settings in the slicer. BoardDock fills it in for each plate in Bambu's own template language and writes a `.gcode.3mf` for the SD card. If the code uses a setting BoardDock doesn't know yet, it says which and doesn't slice. Checked against the A1 mini's code; not yet run on a printer.
- **Brims and the bed's edge:** parts on a plate are always far enough apart for two brims, and plates keep 4 mm clear round the bed's edge for the skirt or brim. A part too big for that margin but small enough for the bed gets a plate to itself; a plate with no room for a skirt or brim is sliced without one and says so.
- Kiri:Moto is not the slicer the settings were written for. It has no first-layer (elephant-foot) compensation, and its speeds are set conservatively.

## G-code in your own slicer

Every plate is also a 3MF with all its parts placed. Open it in OrcaSlicer, PrusaSlicer, Bambu Studio or Cura with the settings above. In the desktop app, **Open plate** hands it to whichever of them is installed. Your printer maker's slicer knows its quirks best.

## Supports: none

Overhangs are 45° chamfers, gables or short bridges; round and square holes on their side have 45° tops; the spring clips stand on the bed (their lip's ledge is 0.9 to 1.3 mm); and all springs flex within their print layers. The Check step shows it layer by layer (see [design.md](design.md#printability-layer-by-layer)), and **Overhangs** on the print plates paints faces that would need support in red and bridges in amber. Leave supports off in any slicer.

## What the slicers do with it

- **The tongue hole.** The socket prints standing on its end, so the tongue's pocket lies on its side. Its roof is chamfered at 45° and the centre divider halves it, so the longest bridge in the socket is about 2.3 mm. The pocket leaves 0.2 mm round the 14 × 4.5 mm tongue. If yours prints tight, raise **Tongue fit** in the Rails step.
- **Print-in-place parts.** The rail shoe's lever prints round its pin, 0.35 mm clear, and every slicer keeps the ring and the pin as separate loops. The socket's latch nose has 0.45 mm round it in its window. Don't lower the line width or raise the flow for these parts.
- **Bridges.** OrcaSlicer and PrusaSlicer spot bridges, slow down, and lay the lines across the gap with the fan up. Kiri:Moto prints them as ordinary solid layers, so expect a little more sag on the longest bridges (9 mm on a flat-lying holder, 14.4 mm in a DIN plate's slots; see [limits.md](limits.md)).
- **Thin walls.** With thin-wall detection off (so the 0.9 mm hinge stays two full lines), walls under about 0.4 mm are left out: in BoardDock parts, only fine label detail.

## What to buy, and building it

- **The shopping list** has the rail lengths, the cables (length and plug types; jumper wires by the wire; what comes with a part, like a probe's ribbon or a plug pack's lead, is not to buy), the zip ties for the cable tags, straps and standoffs. The Plugs step's **Cables to buy** is the same list.
- **The Bill of materials** lists everything the rack is made of, with how many: printed parts (and what one weighs), boards, boxes and probes, rails, cables, hardware, filament and tools. **CSV** saves it (`BOM.csv` in the download).
- **The Checklist** (on Start and beside the shopping list) lists what to buy, print and have to hand, to tick off as you go. It follows the rack as it is now; the ticks are saved in the project, and a tick whose line has gone goes too.
- **The download's README** has the assembly steps and the print settings. The 3D view's play button and **Guide** show the same steps (see [guide.md](guide.md#the-3d-view)).
- When the rack is built, press **Mark the rack as built** in Export, so a board added later brings only its new parts (see [guide.md](guide.md#coming-back-to-add-a-board)).
