// Cadence Allegro / OrCAD PCB Editor boards (.brd, binary). The format is not published. KiCad 10 reads
// versions 16 to 23 with a reader reverse-engineered over months (thousands of lines, with record layouts
// that change between versions); OpenAllegroParser is another such effort. A small reader here could not be
// checked against real files, and a wrong outline or hole would make a holder that does not fit, so BoardDock
// does not read these files: it recognises them and says exactly what to do instead.

/**
 * Is this .brd an Allegro board? Its header holds a version magic number whose second-highest byte is 0x13
 * (release 16), 0x14 (17) or 0x15 / 0x16 (newer releases), little-endian at the start of the file, and older
 * files carry an "all..." version string at byte 0xF8. (KiCad's Allegro reader checks the same marks.)
 */
export function isAllegroBrd(b: Uint8Array): boolean {
  if (b.length < 0x200) return false;
  if (b[0] === 0x3c || (b[0] === 0x23 && b[1] === 0xe2)) return false; // XML (Eagle) or a scrambled board-viewer file
  const verString = b[0xf8] === 0x61 && b[0xf9] === 0x6c && b[0xfa] === 0x6c; // "all"
  const magic = b[3] === 0x00 && b[2] >= 0x13 && b[2] <= 0x16;
  return verString || (magic && b.length >= 0x1000);
}

/** The release family, from the magic number, in words. */
export function allegroVersion(b: Uint8Array): string {
  const m = b[2];
  return m === 0x13 ? 'release 16' : m === 0x14 ? 'release 17' : m >= 0x15 && m <= 0x16 ? 'a release newer than 17' : 'an unknown release';
}

/** What to tell someone who dropped an Allegro board: why it cannot be read, and free ways to a file that can. */
export function allegroMessage(fileName: string, b: Uint8Array): string {
  return [
    `${fileName} is a Cadence Allegro / OrCAD PCB Editor board (${allegroVersion(b)}). Its format is not published and BoardDock cannot read it. Any of these gets you a file it can:`,
    '(1) KiCad 10 or newer (free, kicad.org) imports Allegro boards from release 16 to 23. BoardDock in a web browser can’t use KiCad, but the BoardDock desktop app (from the Releases page) can: with KiCad 10 installed, open the file or the zip in the desktop app and it is converted by itself. Or in KiCad’s PCB Editor: File › Import › Non-KiCad Board File, choose this .brd, save it, and drop the .kicad_pcb here. Check the outline and holes once it is in.',
    '(2) Ask whoever designed the board for IPC-2581 (Allegro: File › Export › IPC 2581), ODB++, GenCAD, IDF (.emn + .emp), a STEP model, or Gerbers with the drill and pick-and-place files. Every one of those comes straight in.',
    '(3) If the board was made for you, the board maker or assembler usually has the Gerber, drill and pick-and-place files from the order.',
    "Cadence's free Allegro viewer opens the file to look at and measure, but we know of no format BoardDock reads that it can save.",
  ].join(' ');
}
