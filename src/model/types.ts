// Domain model. Units: millimetres and degrees. Board frame: X right, Y up, looking at the component (top) side.
// Holder frame = board frame with Z up; the holder's base sits on the print bed at z = 0.

export type V2 = [number, number];
export type Loop = V2[];
export type Side = 'top' | 'bottom';
export type HoleUse = 'auto' | 'snap' | 'pin' | 'none'; // auto: locating pin, or snap pin when the wall fingers can't hold the board
/**
 * What a hole is for (hole wizard). Only mounting holes get holder pins; the others are kept clear underneath:
 * plug = a connector's pegs or shell tabs, lead = a part's pins, standoff = hardware for a board stacked on top.
 */
export type HoleRole = 'mount' | 'standoff' | 'plug' | 'lead' | 'free';

export interface Hole {
  id: string;
  x: number;
  y: number;
  d: number;
  plated: boolean;
  use: HoleUse;
  role?: HoleRole; // undefined = mount (older projects)
  why?: string; // why the wizard picked the role
}

export type CompKind = 'connector' | 'header' | 'switch' | 'led' | 'module' | 'hot' | 'antenna' | 'generic';

/** Size of the mating plug body (overmold / housing) that the holder must clear and support. */
export interface PlugSpec {
  w: number; // across, parallel to the board
  h: number; // across, perpendicular to the board
  len: number; // body length along the insertion axis (not counting the metal tip)
  cable: number; // cable diameter
}

export interface ConnSetup {
  type: string; // id in CONNECTORS
  entry: 'edge' | 'top'; // plug enters through the board edge, or from above
  angle: number; // edge entry: direction the plug comes FROM (outward), degrees in the board frame
  zc: number; // edge entry: plug axis height above the board surface it is mounted on
  plug: PlugSpec;
  cradle: boolean; // U-cradle outside the wall that carries the plug body
  cap: boolean; // snap-on cap that locks the plug into the cradle (separate small part)
  guard: boolean; // collar around the opening that shields the receptacle
  tie: boolean; // zip-tie anchor for the cable
}

export interface Comp {
  id: string;
  ref: string;
  pkg: string;
  value?: string;
  side: Side;
  x: number; // body centre
  y: number;
  rot: number; // degrees
  w: number; // body size along its local x
  l: number; // body size along its local y
  h: number; // height above the board surface it sits on
  kind: CompKind;
  tht: boolean; // has through-hole leads that stick out of the other side
  conn?: ConnSetup;
  hidden?: boolean;
  role?: string; // plug role, when it is known (the ports of a box): host, device, hub-up, hub-down, power-in, power-out...
  pins?: Pin[]; // a header's pins, where the file gives them (KiCad pads, with their nets)
  uart?: { gnd: string; rx: string; tx: string }; // a UART header's pins, set by hand (pin numbers; rx / tx are the board's own)
}

/** One pin of a header: its number, where it is on the board, and its net when the file names one. */
export interface Pin { n: string; x: number; y: number; net?: string }

/** Where a box's ports sit: its long faces (front: y = 0, back: y = width), its ends (left: x = 0, right: x = length), or its top. */
export type BoxFace = 'front' | 'back' | 'left' | 'right' | 'top';
/** A row of identical ports on one face of a box. */
export interface BoxPortGroup { id: string; type: string; count: number; face: BoxFace; role: string; refs?: string[]; near?: 'front' | 'back'; pins?: string[]; rot?: number; switched?: boolean } // refs: the group's port names, kept as ports are added or removed; near: a top row's place by that long edge (else across the middle); pins: a pin header's pin names, pin 1 first; rot: a top row's ports turned (angled outlets); switched: a switch by each outlet
export interface BoxSpec {
  l: number; w: number; h: number; groups: BoxPortGroup[];
  supply?: number; // A at 5 V the whole box can give (charger, powered hub); unset: a typical figure
  ribbon?: number; // a debug probe (J-Link): length of the ribbon it comes with, mm
}

export interface Board {
  name: string;
  outline: Loop; // counter-clockwise
  cutouts: Loop[];
  thickness: number;
  holes: Hole[];
  comps: Comp[];
  source: string;
  notes: string[];
  kind?: 'pcb' | 'box'; // box: a closed device (USB hub, charger) held by low guards and strap loops; thickness = its height
  box?: BoxSpec; // box: its size and ports, from which outline, thickness and port parts are generated
  color?: string; // box colour in the 3D view
  draw?: number; // A at 5 V it may take from its supply (unset: estimated from what it is)
  role?: 'probe' | 'adapter'; // a board drawn or imported that serves another one: a debug probe, a USB-serial adapter (slides into a slot behind it)
  dims?: Dim[]; // dimensions put on it in the board editor (measured on the real board with calipers)
  photo?: { url: string; x: number; y: number; w: number; h: number; opacity?: number }; // a photo of the real board under it in the editor, to trace over (board mm)
  traces?: { a: V2; b: V2; w: number; side: Side }[]; // copper tracks (read from KiCad), for the 3D view
  vias?: { x: number; y: number; d: number }[];
}

/** A point or line on a board a dimension runs from: a hole's centre, a part's centre or one side of it, or an edge of the board. */
export interface Feat { k: 'hole' | 'comp' | 'edge'; id?: string; at: 'c' | 'x0' | 'x1' | 'y0' | 'y1' }
/** A dimension between two features along x or y: typing its value moves the second (or the first, if the second is the board's edge). */
export interface Dim { id: string; a: Feat; b: Feat; axis: 'x' | 'y'; off?: number; t?: number } // off: where its line is, mm past what it measures (dragged; else laid out by itself); t: its label along the line, 0…1

export type Material = 'PLA' | 'PETG' | 'ABS' | 'ASA' | 'PA' | 'PC';
export type EdgeName = 'bottom' | 'top' | 'left' | 'right';

export interface HolderSettings {
  wall: number; // wall thickness
  base: number; // base plate thickness
  gap: number; // board edge to wall clearance
  wallAbove: number; // wall top above the board's top surface (negative = lower)
  standoff: number | null; // board bottom above the base top; null = automatic
  minStandoff: number;
  leadLen: number; // through-hole lead protrusion under the board
  pattern: 'hex' | 'slots' | 'circles' | 'none';
  cell: number; // pattern pitch
  rib: number; // pattern rib width
  tabs: 'auto' | 'on' | 'off'; // snap tabs in the wall that hold the board edge
  tabLip: number;
  notches: boolean; // finger notches to lift the board out
  label: string;
  chamfer: boolean;
  pinClear: number; // radial clearance of pins in board holes
  material: Material;
  color?: string; // preview colour of the printed holder
  feat?: HolderFeatures; // global switches over the per-connector options
  style?: 'frame' | 'tray'; // frame: rim, corner guards and ribs (fast to print); tray: full base and wall
  release?: 'centre' | 'side' | 'auto'; // docked holders: release button in the middle of the far edge (default), beside the board, or whichever fits best
}

/** Whole-holder switches: turn a kind of feature off for every connector at once (per-connector choices are kept). */
export interface HolderFeatures {
  cradles: boolean;
  caps: boolean;
  ties: boolean;
  guards: boolean;
}

export interface MountSettings {
  kind: 'none' | 'din';
  mode: 'flat' | 'rack' | 'inline'; // flat: board parallel to the panel; rack: board across the rail; inline: board along the rail, standing out
  rotation: 0 | 90 | 180 | 270; // flat mode: rail direction relative to the board's x axis
  edge: EdgeName; // rack / inline: holder edge that faces the rail
  clipWidth: number;
  tabSide: 'down' | 'up'; // where the release tab points on the rail
  railT: number; // rail flange thickness (1.0 for TS35x7.5 steel)
  at: V2 | null; // flat mode: clip centre on the board; null = automatic
}

export interface StandSettings {
  enabled: boolean;
  shape: 'round' | 'square' | 'hex' | 'd' | 'tripod';
  size: number; // diameter, side, or across-flats of the stand post
  depth: number;
  fit: 'slip' | 'press';
  clearance: number; // diametral clearance added to the post size
  axis: 'edge' | 'down'; // socket axis: out of a holder edge, or down out of the base
  edge: EdgeName;
  offset: number; // position along the edge from its centre
  wall: number;
}

export interface PrinterSettings {
  name: string;
  bed: V2;
  spacing: number;
  maxZ?: number; // build height
  gcodeStart?: string; // start/end G-code typed in for in-app slicing; empty uses the printer's profile
  gcodeEnd?: string;
}

/** One board and the holder built around it. */
export interface Module {
  id: string;
  board: Board;
  holder: HolderSettings;
  original?: Board; // the board as imported, for "revert to import"
  on?: string | null; // stacked on top of this module
  onMode?: 'bolted' | 'towers'; // bolted: screwed to the board below on standoffs (HAT, shield); towers: its own printed layer
  onGap?: number; // bolted: gap between the boards (standoff length), mm
  revision?: { at: string; from: string; to: string; changes: string[] }; // the last new version swapped in: files and what changed
}

/** How several holders combine into one assembly. */
export interface ArrangeSettings {
  mode: 'stack' | 'side' | 'back'; // stacked on corner towers / side by side with link bars / back to back with snap rivets
  stackGap: number; // clearance above the tallest part before the next layer
  sideGap: number; // side by side: gap between the walls (the link bosses fill it)
  sideAxis: 'x' | 'y'; // side by side along board X or Y
  links: boolean; // side by side: print link bars that lock neighbours together
}

export type Turn = 0 | 90 | 180 | 270;

/** A DIN rail on the panel (table stands, or any flat base). Panel frame: X right, Y away from you, Z up. */
export interface Rail {
  id: string;
  x: number; // start of the centre line: left end (horizontal) or bottom end (vertical)
  y: number;
  dir: 'h' | 'v';
  length: number | null; // null = cut to fit what is on it
}

/** A board seat in a rail mount. Dock slots: 0 = front, 1 = back (turned 180 degrees). */
export interface Slot {
  module: string | null;
  edge: EdgeName | 'auto'; // board edge that plugs into the dock
  lie?: 'flat'; // the holder lies flat, top face out, docked by a tab (ear) on that edge; unset: it stands up
}

/** Something clipped onto a rail: a dock (shoe + turnable socket, two back-to-back slots) or a flat clip (board lies on the panel). */
export interface RailMount {
  id: string;
  rail: string;
  at: number | null; // centre, mm along the rail from its start; null = packed after the previous mount
  place?: 'free'; // at is null: put it in the first gap that fits on any rail, leaving every other mount where it is
  kind: 'dock' | 'flat';
  turn: Turn; // dock: socket turn about the panel normal; flat: board rotation on the panel
  slots: Slot[];
  lever?: 'auto' | 'pos' | 'neg'; // dock: side of the rail the shoe's release lever is on (auto = the more open side)
}

export interface PanelSettings {
  auto: boolean; // lay everything out automatically (orientation for plug access, pairing, packing, new rows)
  rowDir: 'h' | 'v'; // auto: rail direction
  pairs: boolean; // auto: two boards back to back in one dock when their plugs allow it
  lie?: 'up' | 'flat' | 'auto'; // auto: boards stand up in their docks (default), lie flat on them, or whichever keeps the plugs easier to reach
  gap: number; // free space between neighbours along a rail
  maxRail: number; // auto: longest rail before a new row starts
  rowGap: number; // auto: space between rows of rails
  fit?: number; // tongue made this much smaller on every face (mm): raise it if holders are hard to plug in
  stands?: boolean; // printed table stands under the rails, with cable combs (default on)
  cableTags?: boolean; // numbered clip-on tags for every cable, two each (default on)
  rails: Rail[]; // manual layout
  mounts: RailMount[];
}

/** A cable between two plugs (connectors on two boards, or a board and a box such as a hub). */
export interface PlugRef { module: string; ref: string }
export interface Link { id: string; a: PlugRef; b: PlugRef; kind?: 'usb' | 'power' | 'video' | 'net' | 'audio' | 'wire' | 'debug' | 'uart' | 'jumper' | 'mains'; no?: number; wires?: Wire[]; auto?: boolean; why?: string } // no: the cable's number, kept for good; wires: jumper wires, pin to pin; auto: made by Auto-connect (Rewire may change it); why: what Auto-connect chose it for
/** One jumper wire between two pin headers: pin a on the link's a end to pin b on its b end. */
export interface Wire { a: string; b: string; colour?: string }

/** What was printed, cut and bought when the rack was built: what Export compares against to list only what's new. */
export interface Built {
  at: string; // ISO date
  parts: Record<string, number>; // part signature -> how many were printed
  places?: Record<string, number[][]>; // part signature -> where each of them sits in the rack
  cables: string[]; // cable signatures
  rails: { id: string; length: number }[];
  boards: string[]; // module ids on the rack then
  names?: Record<string, string>; // module id -> board name then (to say what was taken off)
  seats?: Record<string, string>; // module id -> where it sat ("dock 1.3 back")
  cableInfo?: { sig: string; no?: number; a: string; b: string; buy: number }[]; // the cables as bought
}

export interface Project {
  version: 3;
  name?: string; // what the user calls this rack (file names, the header); unset: made from the boards
  built?: Built;
  links?: Link[]; // cables between boards
  wiring?: { pos?: Record<string, [number, number]> }; // the Wiring view: where each board's card was put (module id -> x, y)
  modules: Module[];
  active: number; // module being edited
  layout: 'panel' | 'loose'; // boards on DIN rail docks (default), or loose holders (stack / side by side / back to back)
  panel: PanelSettings;
  arrange: ArrangeSettings;
  mount: MountSettings;
  stand: StandSettings;
  printer: PrinterSettings;
}

// ---- generator output ----
export interface MeshData {
  pos: Float32Array; // xyz triplets
  idx: Uint32Array;
}

/** What a part or ghost belongs to, for picking in the 3D view. */
export interface PickTag {
  kind: 'holder' | 'cap' | 'rod' | 'clip' | 'shoe' | 'socket' | 'link' | 'rivet' | 'board' | 'parts' | 'plug' | 'rail' | 'stand' | 'cable' | 'railstand' | 'cabletag';
  module?: string;
  mount?: string;
  rail?: string;
  refs?: string[];
}

/** Assembly animation: the part flies in from `dir` (assembly frame, unit) at step `seq`. */
/** One straight move of the assembly animation: the part slides in from `dir` (unit, assembly frame), `dist` mm
 * away (scaled to the scene when unset), during step `seq`. */
/**
 * One move of the assembly animation, ending where the part sits. `style`: how it moves, 'slide' (eases in), 'snap' (a
 * snap-fit: pushed a little past its seat, then springs back: the click), 'plug' (quick, then the last few mm slowly),
 * 'press' (straight on, firmly). `rot`: it also turns that many degrees about the axis through `at`, back to square as
 * it arrives (a board tipped in under its fingers, a rail shoe hooked on and swung down).
 */
export interface Motion { seq: number; dir: [number, number, number]; dist?: number; style?: 'slide' | 'snap' | 'plug' | 'press'; rot?: { axis: [number, number, number]; at: [number, number, number]; deg: number } }
/**
 * Assembly animation: the part's last move, earlier moves it makes first (`pre`: a board drops into its holder,
 * then the holder with it goes into the dock), the step it appears at (`show`, default its first move), and `grow`
 * for cables, which are drawn along their route instead of moved.
 */
export interface Anim extends Motion { pre?: Motion[]; show?: number; grow?: boolean }

export interface PartOut {
  id: string;
  name: string;
  qty: number;
  mesh: MeshData; // in print orientation, resting on z = 0
  toAssembly: number[]; // 4x4 column-major matrix from print pose to the assembly frame
  volume: number; // mm^3
  size: [number, number, number];
  color: string;
  instances?: number[][]; // further assembly placements of the same part (qty > 1)
  tag?: PickTag; // first placement
  tags?: PickTag[]; // one per further placement (instances)
  anim?: Anim;
  anims?: Anim[]; // one per further placement
  displayMesh?: MeshData; // what the 3D view shows instead of `mesh` (same frame), e.g. without a print-in-place lever
}

export interface Ghost {
  name: string;
  mesh: MeshData;
  color: string;
  opacity: number;
  tag?: PickTag;
  anim?: Anim;
  mat?: 'mask' | 'gold' | 'metal' | 'black' | 'chip' | 'white' | 'silk' | 'led' | 'passive' | 'blue' | 'plug' | 'cable' | 'copper' | 'trace' | 'tin' | 'box' | 'red';
  smooth?: boolean; // round things (plugs, cables): smooth shading, no outline edges
}

/** A pickable feature fused into a holder (cradle, pin, finger...), as a box in the holder frame. */
export interface Feature {
  kind: 'cradle' | 'cap' | 'guard' | 'tie' | 'finger' | 'label' | 'pin' | 'seat' | 'dock' | 'tower' | 'stand' | 'notch' | 'rim';
  module: string;
  refs?: string[]; // connector refs or hole ids
  box: [number, number, number, number, number, number];
}

export interface Check {
  group: string;
  name: string;
  value: string;
  status: 'ok' | 'warn' | 'bad' | 'info';
  detail?: string;
  module?: string; // the board it is about, when it is about one
}

export interface GenReport {
  warnings: string[];
  checks: Check[];
  levels: { base: number; boardBottom: number; boardTop: number; wallTop: number }; // active module
  clipAt: V2 | null; // active module, board frame
  timeMs: number;
  /** clip frame -> assembly, for the "as installed" view */
  clipFrame: number[] | null;
  panel?: PanelReport | null;
  features?: Feature[];
  frames?: Record<string, number[]>; // module id -> holder frame to assembly
  cables?: { id: string; a: string; b: string; ends?: string; kind: NonNullable<Link['kind']>; length: number; buy: number; clash?: string; no?: number; label?: string; mid?: number[]; ribbon?: number; wires?: string }[]; // ends: "module/ref|module/ref"; no: cable number; label: what it is for; mid: where its number shows (assembly frame); ribbon: a probe's own ribbon (mm), nothing to buy; wires: a serial cable's loose ends, which pin each goes on
}

export type AccessDir = 'front' | 'up' | 'down' | 'left' | 'right' | 'wall';
export interface Access { ref: string; type: string; dir: AccessDir; ok: 'good' | 'side' | 'blocked' }

/** Resolved panel layout (panel frame, mm). */
export interface PanelReport {
  rails: (Rail & { length: number })[];
  mounts: (RailMount & { at: number; x: number; y: number; foot: [number, number, number, number]; leverSide: 1 | -1 })[];
  modules: { id: string; mount: string; slot: number; edge: EdgeName; lie?: 'flat'; turn: Turn; foot: [number, number, number, number]; z1: number; access: Access[]; stack?: string[] }[];
  unplaced: string[];
  depth: number; // tallest point above the rail base
  height?: number; // tallest point above the table (on stands) or the rail base
  collisions: string[][]; // pairs of module / mount ids that overlap
  stands?: { station: number; foot: [number, number, number, number]; pieces: number; combs: number }[]; // table sleepers, panel-frame footprints
  plugs?: Record<string, [number, number, number]>; // where each plug's cable leaves it ("module/ref"), panel frame: Auto-connect measures cables with it
}

export interface GenResult {
  parts: PartOut[];
  ghosts: Ghost[];
  report: GenReport;
  display?: PartOut[]; // shown in the 3D view only (printed as part of another part)
  steps?: { seq: number; text: string }[]; // assembly instructions, one per animation step
}
