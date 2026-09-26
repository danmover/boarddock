// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { importKicad, parseSexpr } from '../src/import/kicad';
import { parseGerber, parseExcellon, parsePnP } from '../src/import/fab';
import { importDxf, importEagle, importIdf } from '../src/import/other';
import { groupFiles, importFiles, importMany } from '../src/import';
import { bbox } from '../src/geom/poly';

const KICAD = `(kicad_pcb (version 20240108) (generator "pcbnew")
  (general (thickness 1.2))
  (title_block (title "Sensor node"))
  (gr_line (start 100 100) (end 150 100) (stroke (width 0.1) (type default)) (layer "Edge.Cuts"))
  (gr_line (start 150 100) (end 150 130) (layer "Edge.Cuts"))
  (gr_arc (start 150 130) (mid 148.536 133.536) (end 145 135) (layer "Edge.Cuts"))
  (gr_line (start 145 135) (end 100 135) (layer "Edge.Cuts"))
  (gr_line (start 100 135) (end 100 100) (layer "Edge.Cuts"))
  (footprint "MountingHole:MountingHole_3.2mm_M3" (layer "F.Cu") (at 104 104)
    (property "Reference" "H1")
    (pad "" np_thru_hole circle (at 0 0) (size 3.2 3.2) (drill 3.2) (layers "*.Cu" "*.Mask")))
  (footprint "Connector_USB:USB_C_Receptacle_GCT_USB4085" (layer "F.Cu") (at 125 131.5)
    (property "Reference" "J1")
    (fp_rect (start -4.72 -3.9) (end 4.72 3.9) (layer "F.CrtYd") (stroke (width 0.05)))
    (pad "A1" smd rect (at -3 -2) (size 0.3 1) (layers "F.Cu"))
    (pad "S1" thru_hole oval (at -4.3 0) (size 1 2) (drill oval 0.6 1.4) (layers "*.Cu")))
  (footprint "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical" (layer "F.Cu") (at 140 105 90)
    (property "Reference" "J2")
    (fp_line (start -1.8 -1.8) (end 1.8 -1.8) (layer "F.CrtYd"))
    (fp_line (start 1.8 -1.8) (end 1.8 9.4) (layer "F.CrtYd"))
    (fp_line (start 1.8 9.4) (end -1.8 9.4) (layer "F.CrtYd"))
    (fp_line (start -1.8 9.4) (end -1.8 -1.8) (layer "F.CrtYd"))
    (pad "1" thru_hole rect (at 0 0) (size 1.7 1.7) (drill 1) (layers "*.Cu"))
    (pad "2" thru_hole oval (at 0 2.54) (size 1.7 1.7) (drill 1) (layers "*.Cu")))
  (footprint "Capacitor_SMD:C_1206_3216Metric" (layer "B.Cu") (at 120 115)
    (property "Reference" "C9")
    (fp_rect (start -2.3 -1.15) (end 2.3 1.15) (layer "B.CrtYd")))
)`;

describe('KiCad', () => {
  it('parses S-expressions', () => {
    const t = parseSexpr('(a (b "x y") c)');
    expect(t[0]).toEqual(['a', ['b', 'x y'], 'c']);
  });
  it('reads outline, thickness, holes and parts', () => {
    const b = importKicad(KICAD, 'node.kicad_pcb');
    const bb = bbox(b.outline);
    expect(b.name).toBe('Sensor node');
    expect(b.thickness).toBe(1.2);
    expect(bb.x1 - bb.x0).toBeCloseTo(50, 1);
    expect(bb.y1 - bb.y0).toBeCloseTo(35, 1);
    expect(b.holes.length).toBe(1);
    expect(b.holes[0].d).toBeCloseTo(3.2);
    // KiCad y points down: hole at y=104 is 4 mm below the top edge (y=100), i.e. 31 mm up from the bottom
    expect(b.holes[0].x).toBeCloseTo(4, 1);
    expect(b.holes[0].y).toBeCloseTo(31, 1);
    const j1 = b.comps.find((c) => c.ref === 'J1')!;
    expect(j1.conn?.type).toBe('usb_c');
    expect(j1.conn?.entry).toBe('edge');
    expect(Math.round(j1.conn!.angle)).toBe(-90); // on the bottom edge (KiCad y=135)
    const j2 = b.comps.find((c) => c.ref === 'J2')!;
    expect(j2.tht).toBe(true);
    expect(j2.kind).toBe('header');
    expect(b.comps.find((c) => c.ref === 'C9')!.side).toBe('bottom');
  });
});

const GKO = `%FSLAX36Y36*%
%MOMM*%
%ADD10C,0.100000*%
D10*
G01*
X0Y0D02*
X60000000Y0D01*
X60000000Y35000000D01*
G75*
G03X55000000Y40000000I-5000000J0D01*
G01*
X0Y40000000D01*
X0Y0D01*
M02*`;

const DRL = `M48
; DRILL file {KiCad} date
METRIC,TZ
T1C3.200
T2C1.000
%
G90
T1
X3.5Y3.5
X56.5Y3.5
T2
X20.0Y20.0
X22.54Y20.0
M30`;

const DRL_LZ = `M48
;FILE_FORMAT=2:5
INCH,LZ
T01C0.12598
%
T01
X0013780Y0013780
M30`;

const CPL = `Designator,Mid X,Mid Y,Layer,Rotation,Footprint
J1,30mm,1.5mm,Top,0,USB-C-SMD_TYPE-C-6PIN
U1,30mm,20mm,Top,0,SOIC-8
C3,10mm,30mm,Bottom,90,0603`;

describe('Gerber / Excellon / pick & place', () => {
  it('parses a Gerber outline with an arc', () => {
    const g = parseGerber(GKO);
    const pts = g.paths.flat();
    const bb = bbox(pts);
    expect(bb.x1).toBeCloseTo(60, 3);
    expect(bb.y1).toBeCloseTo(40, 3);
  });
  it('parses Excellon in decimal and implied-decimal formats', () => {
    const h = parseExcellon(DRL);
    expect(h.length).toBe(4);
    expect(h[0]).toMatchObject({ x: 3.5, y: 3.5, d: 3.2 });
    const h2 = parseExcellon(DRL_LZ);
    expect(h2[0].x).toBeCloseTo(3.5, 2);
    expect(h2[0].d).toBeCloseTo(3.2, 2);
  });
  it('parses JLC-style CPL', () => {
    const p = parsePnP(CPL);
    expect(p.length).toBe(3);
    expect(p[2]).toMatchObject({ ref: 'C3', side: 'bottom', x: 10, y: 30 });
  });
  it('builds a board from a zipped fab set', async () => {
    const zip = zipSync({ 'board-Edge_Cuts.gbr': strToU8(GKO), 'board.drl': strToU8(DRL), 'board-CPL.csv': strToU8(CPL) });
    const b = await importFiles([{ name: 'board-gerbers.zip', bytes: zip }]);
    expect(b.holes.filter((h) => h.d > 3).length).toBe(2);
    expect(b.comps.find((c) => c.ref === 'J1')?.conn?.type).toBe('usb_c');
    expect(b.comps.some((c) => c.tht)).toBe(true); // the 1 mm plated holes mark through-hole leads
  });
});

const EMN = `.HEADER
BOARD_FILE 3.0 "test" 2024/01/01.00:00:00 1
"demo" MM
.END_HEADER
.BOARD_OUTLINE ECAD
1.6
0 0 0 0
0 80 0 0
0 80 50 0
0 0 50 0
0 0 0 0
1 10 10 0
1 13 10 360
.END_BOARD_OUTLINE
.DRILLED_HOLES
3.2 5 5 NPTH BOARD MTG ECAD
1.0 40 25 PTH J1 PIN ECAD
.END_DRILLED_HOLES
.PLACEMENT
"USB_C" "GCT" J1
40 1 0 0 TOP PLACED
.END_PLACEMENT`;

const EMP = `.HEADER
LIBRARY_FILE 3.0 "test" 2024/01/01.00:00:00 1
.END_HEADER
.ELECTRICAL
"USB_C" "GCT" MM 3.3
0 -4.5 -3.7 0
0 4.5 -3.7 0
0 4.5 3.7 0
0 -4.5 3.7 0
0 -4.5 -3.7 0
.END_ELECTRICAL`;

describe('IDF, Eagle, DXF', () => {
  it('reads IDF board, holes, cutout and part heights', () => {
    const b = importIdf(EMN, EMP, 'demo.emn');
    expect(bbox(b.outline).x1).toBeCloseTo(80);
    expect(b.cutouts.length).toBe(1);
    expect(b.holes.length).toBe(1);
    const j1 = b.comps.find((c) => c.ref === 'J1')!;
    expect(j1.h).toBeCloseTo(3.3);
    expect(j1.w).toBeCloseTo(9);
  });
  it('reads an Eagle board', () => {
    const xml = `<?xml version="1.0"?><eagle version="9.6"><drawing><board>
      <plain>
        <wire x1="0" y1="0" x2="50" y2="0" width="0" layer="20"/>
        <wire x1="50" y1="0" x2="50" y2="30" width="0" layer="20"/>
        <wire x1="50" y1="30" x2="0" y2="30" width="0" layer="20" curve="0"/>
        <wire x1="0" y1="30" x2="0" y2="0" width="0" layer="20"/>
        <hole x="4" y="4" drill="3.2"/>
      </plain>
      <libraries><library name="con"><packages><package name="USB-MICRO-B">
        <wire x1="-3.75" y1="-2.5" x2="3.75" y2="-2.5" width="0.1" layer="21"/>
        <wire x1="3.75" y1="-2.5" x2="3.75" y2="2.5" width="0.1" layer="21"/>
        <smd name="1" x="0" y="2" dx="0.4" dy="1.3" layer="1"/>
      </package></packages></library></libraries>
      <elements><element name="J1" library="con" package="USB-MICRO-B" value="" x="25" y="2" rot="R0"/></elements>
    </board></drawing></eagle>`;
    const b = importEagle(xml, 'demo.brd');
    expect(bbox(b.outline).x1).toBeCloseTo(50);
    expect(b.holes[0].d).toBeCloseTo(3.2);
    expect(b.comps.find((c) => c.ref === 'J1')?.conn?.type).toBe('usb_micro_b');
  });
  it('reads a DXF outline with a round hole', () => {
    const dxf = ['0', 'SECTION', '2', 'ENTITIES', '0', 'LWPOLYLINE', '90', '4', '70', '1', '10', '0', '20', '0', '10', '40', '20', '0', '10', '40', '20', '25', '10', '0', '20', '25', '0', 'CIRCLE', '10', '5', '20', '5', '40', '1.6', '0', 'ENDSEC', '0', 'EOF'].join('\n');
    const b = importDxf(dxf, 'outline.dxf');
    expect(bbox(b.outline).x1).toBeCloseTo(40);
    expect(b.holes.length).toBe(1);
    expect(b.holes[0].d).toBeCloseTo(3.2);
  });
});

describe('several boards in one drop', () => {
  const f = (name: string, text = 'x') => ({ name, bytes: strToU8(text) });
  it('splits a drop into one group per board', () => {
    const zip = { name: 'node-gerbers.zip', bytes: zipSync({ 'node.gko': strToU8('G04*'), 'node.drl': strToU8('M48') }) };
    const g = groupFiles([f('a.kicad_pcb'), f('b.kicad_pcb'), f('c.step'), zip, f('d.emn'), f('d.emp'), f('top.gtl'), f('board.gko'), f('board.drl')]);
    const names = g.map((x) => x.map((y) => y.name).sort().join('+'));
    expect(names).toEqual(['node.drl+node.gko', 'a.kicad_pcb', 'b.kicad_pcb', 'c.step', 'd.emn+d.emp', 'board.drl+board.gko+top.gtl']);
  });
  it('imports every KiCad file as its own board and reports the ones that fail', async () => {
    const r = await importMany([f('one.kicad_pcb', KICAD), f('two.kicad_pcb', KICAD.replace('Sensor node', 'Relay node')), f('broken.dxf', 'nonsense')]);
    expect(r.boards.map((b) => b.name)).toEqual(['Sensor node', 'Relay node']);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]).toMatch(/broken\.dxf/);
  });
});
