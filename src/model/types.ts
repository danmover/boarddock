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
}

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

/** A DIN rail on the panel (wall or enclosure back plate). Panel frame: X right, Y up, Z out of the wall. */
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
}

/** Something clipped onto a rail: a dock (shoe + turnable socket, two back-to-back slots) or a flat clip (board lies on the panel). */
export interface RailMount {
  id: string;
  rail: string;
  at: number | null; // centre, mm along the rail from its start; null = packed after the previous mount
  kind: 'dock' | 'flat';
  turn: Turn; // dock: socket turn about the panel normal; flat: board rotation on the panel
  slots: Slot[];
  lever?: 'auto' | 'pos' | 'neg'; // dock: side of the rail the shoe's release lever is on (auto = the more open side)
}

export interface PanelSettings {
  auto: boolean; // lay everything out automatically (orientation for plug access, pairing, packing, new rows)
  rowDir: 'h' | 'v'; // auto: rail direction
  pairs: boolean; // auto: two boards back to back in one dock when their plugs allow it
  gap: number; // free space between neighbours along a rail
  maxRail: number; // auto: longest rail before a new row starts
  rowGap: number; // auto: space between rows of rails
  fit?: number; // tongue made this much smaller on every face (mm): raise it if holders are hard to plug in
  rails: Rail[]; // manual layout
  mounts: RailMount[];
}

export interface Project {
  version: 3;
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
  kind: 'holder' | 'cap' | 'rod' | 'clip' | 'shoe' | 'socket' | 'link' | 'rivet' | 'board' | 'parts' | 'plug' | 'rail' | 'stand';
  module?: string;
  mount?: string;
  rail?: string;
  refs?: string[];
}

/** Assembly animation: the part flies in from `dir` (assembly frame, unit) at step `seq`. */
export interface Anim { seq: number; dir: [number, number, number] }

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
}

export interface Ghost {
  name: string;
  mesh: MeshData;
  color: string;
  opacity: number;
  tag?: PickTag;
  anim?: Anim;
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
}

export type AccessDir = 'front' | 'up' | 'down' | 'left' | 'right' | 'wall';
export interface Access { ref: string; type: string; dir: AccessDir; ok: 'good' | 'side' | 'blocked' }

/** Resolved panel layout (panel frame, mm). */
export interface PanelReport {
  rails: (Rail & { length: number })[];
  mounts: (RailMount & { at: number; x: number; y: number; foot: [number, number, number, number]; leverSide: 1 | -1 })[];
  modules: { id: string; mount: string; slot: number; edge: EdgeName; turn: Turn; foot: [number, number, number, number]; z1: number; access: Access[] }[];
  unplaced: string[];
  depth: number; // furthest point from the wall
  collisions: string[][]; // pairs of module / mount ids that overlap
}

export interface GenResult {
  parts: PartOut[];
  ghosts: Ghost[];
  report: GenReport;
}
