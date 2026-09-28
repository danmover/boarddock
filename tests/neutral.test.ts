// Neutral fabrication formats (IPC-2581, ODB++, GenCAD), Allegro detection, archives, and zip fall-backs.
import { describe, it, expect } from 'vitest';
import { gzipSync, strToU8, strFromU8, zipSync } from 'fflate';
import { importIpc2581 } from '../src/import/ipc2581';
import { findOdb, importOdb } from '../src/import/odb';
import { importGencad } from '../src/import/gencad';
import { isAllegroBrd } from '../src/import/allegro';
import { expandAll, unlzw, untar } from '../src/import/archive';
import { parseXml, findAll } from '../src/import/xml';
import { groupFiles, importFiles, importMany } from '../src/import';
import { bbox } from '../src/geom/poly';

const near = (a: number, b: number, tol = 0.05) => Math.abs(a - b) <= tol;

// ---------------- IPC-2581 ----------------
const IPC = `<?xml version="1.0" encoding="UTF-8"?>
<IPC-2581 revision="B" xmlns="http://webstds.ipc.org/2581">
  <Content roleRef="Owner">
    <FunctionMode mode="ASSEMBLY"/>
    <StepRef name="pcb"/>
    <DictionaryStandard units="MILLIMETER">
      <EntryStandard id="PAD_SQ"><RectCenter width="1.7" height="1.7"/></EntryStandard>
      <EntryStandard id="PAD_0603"><RectCenter width="0.9" height="1.0"/></EntryStandard>
    </DictionaryStandard>
  </Content>
  <Bom name="bom">
    <BomItem OEMDesignNumberRef="C-100N" quantity="1" category="ELECTRICAL">
      <RefDes name="C1" packageRef="C_0603" populate="true" layerRef="BOTTOM"/>
      <Characteristics category="ELECTRICAL"><Textual definitionSource="x" textualCharacteristicName="Value" textualCharacteristicValue="100n"/></Characteristics>
    </BomItem>
  </Bom>
  <Ecad name="Sensor &amp; relay">
    <CadHeader units="MILLIMETER"/>
    <CadData>
      <Layer name="TOP" layerFunction="SIGNAL" side="TOP" polarity="POSITIVE"/>
      <Layer name="BOTTOM" layerFunction="SIGNAL" side="BOTTOM" polarity="POSITIVE"/>
      <Layer name="DRILL_1-2" layerFunction="DRILL" side="ALL" polarity="POSITIVE"/>
      <Stackup name="s" overallThickness="1.2" whereMeasured="METAL"/>
      <Step name="pcb">
        <Datum x="0" y="0"/>
        <Profile>
          <Polygon>
            <PolyBegin x="10" y="10"/>
            <PolyStepSegment x="70" y="10"/>
            <PolyStepSegment x="70" y="45"/>
            <PolyStepCurve x="65" y="50" centerX="65" centerY="45" clockwise="false"/>
            <PolyStepSegment x="10" y="50"/>
            <PolyStepSegment x="10" y="10"/>
          </Polygon>
          <Cutout>
            <PolyBegin x="30" y="20"/><PolyStepSegment x="40" y="20"/><PolyStepSegment x="40" y="25"/><PolyStepSegment x="30" y="25"/><PolyStepSegment x="30" y="20"/>
          </Cutout>
        </Profile>
        <Package name="USB_C_Receptacle_GCT_USB4085" type="OTHER" height="3.3">
          <Outline><Polygon>
            <PolyBegin x="-4.47" y="-3.675"/><PolyStepSegment x="4.47" y="-3.675"/><PolyStepSegment x="4.47" y="3.675"/><PolyStepSegment x="-4.47" y="3.675"/><PolyStepSegment x="-4.47" y="-3.675"/>
          </Polygon></Outline>
        </Package>
        <Package name="PinHeader_1x04_P2.54mm_Vertical" type="OTHER">
          <Pin number="1" type="THRU"><Location x="0" y="0"/><StandardPrimitiveRef id="PAD_SQ"/></Pin>
          <Pin number="2" type="THRU"><Location x="0" y="-2.54"/><StandardPrimitiveRef id="PAD_SQ"/></Pin>
          <Pin number="3" type="THRU"><Location x="0" y="-5.08"/><StandardPrimitiveRef id="PAD_SQ"/></Pin>
          <Pin number="4" type="THRU"><Location x="0" y="-7.62"/><StandardPrimitiveRef id="PAD_SQ"/></Pin>
        </Package>
        <Package name="C_0603" type="OTHER">
          <Pin number="1" type="SURFACE"><Location x="-0.8" y="0"/><StandardPrimitiveRef id="PAD_0603"/></Pin>
          <Pin number="2" type="SURFACE"><Location x="0.8" y="0"/><StandardPrimitiveRef id="PAD_0603"/></Pin>
        </Package>
        <Component refDes="J1" packageRef="USB_C_Receptacle_GCT_USB4085" layerRef="TOP" part="USB4085-GF-A" mountType="SMT">
          <Xform rotation="0"/><Location x="40" y="47"/>
        </Component>
        <Component refDes="J2" packageRef="PinHeader_1x04_P2.54mm_Vertical" layerRef="TOP" part="HDR4" mountType="THMT">
          <Xform rotation="90"/><Location x="60" y="30"/>
        </Component>
        <Component refDes="C1" packageRef="C_0603" layerRef="BOTTOM" part="C-100N" mountType="SMT">
          <Xform rotation="0" mirror="true"/><Location x="20" y="30"/>
        </Component>
        <Component refDes="U1" packageRef="SOIC-8" layerRef="TOP" part="LM358" mountType="SMT">
          <Location x="50" y="20"/>
        </Component>
        <LogicalNet name="GND"><PinRef componentRef="J2" pin="1"/></LogicalNet>
        <LayerFeature layerRef="DRILL_1-2">
          <Set><Hole name="H1" diameter="3.2" platingStatus="NONPLATED" plusTol="0" minusTol="0" x="14" y="14"/></Set>
          <Set><Hole name="H2" diameter="3.2" platingStatus="NONPLATED" plusTol="0" minusTol="0" x="66" y="14"/></Set>
          <Set geometry="VIA"><Hole name="V1" diameter="0.3" platingStatus="VIA" plusTol="0" minusTol="0" x="45" y="35"/></Set>
          <Set><Hole diameter="1.0" platingStatus="PLATED" x="60" y="30"/><Hole diameter="1.0" platingStatus="PLATED" x="62.54" y="30"/>
               <Hole diameter="1.0" platingStatus="PLATED" x="65.08" y="30"/><Hole diameter="1.0" platingStatus="PLATED" x="67.62" y="30"/></Set>
        </LayerFeature>
      </Step>
    </CadData>
  </Ecad>
</IPC-2581>`;

describe('XML reader', () => {
  it('reads elements, attributes, entities and self-closing tags, skipping comments', () => {
    const r = parseXml('<?xml version="1.0"?><!-- a > b --><a x="1 &amp; 2"><b y=\'q>r\'/><c:d z="3"></c:d></a>');
    const a = r.kids[0];
    expect(a.a.x).toBe('1 & 2');
    expect(a.kids.map((k) => k.name)).toEqual(['b', 'd']);
    expect(a.kids[0].a.y).toBe('q>r');
    expect(findAll(r, 'd')[0].a.z).toBe('3');
  });
});

describe('IPC-2581', () => {
  const b = importIpc2581(IPC, 'relay.xml');
  it('reads the profile with its arc and cut-out, and the stack-up thickness', () => {
    const bb = bbox(b.outline);
    expect(bb.x1 - bb.x0).toBeCloseTo(60, 2);
    expect(bb.y1 - bb.y0).toBeCloseTo(40, 2);
    expect(b.cutouts.length).toBe(1);
    expect(b.thickness).toBeCloseTo(1.2);
  });
  it('keeps the mounting holes and leaves out vias and header leads', () => {
    expect(b.holes.length).toBe(2);
    expect(b.holes.every((h) => near(h.d, 3.2) && !h.plated)).toBe(true);
    // the board is moved so its corner is at 0,0: (14, 14) becomes (4, 4)
    expect(b.holes.some((h) => near(h.x, 4) && near(h.y, 4))).toBe(true);
  });
  it('places parts with sizes, sides, turns, pins and nets', () => {
    expect(b.comps.length).toBe(4);
    const j1 = b.comps.find((c) => c.ref === 'J1')!;
    expect(j1.conn?.type).toBe('usb_c');
    expect(j1.conn?.entry).toBe('edge');
    expect(j1.w).toBeCloseTo(8.94, 2);
    expect(j1.h).toBeCloseTo(3.3);
    expect(near(j1.x, 30) && near(j1.y, 37)).toBe(true);
    const j2 = b.comps.find((c) => c.ref === 'J2')!;
    expect(j2.kind).toBe('header');
    expect(j2.tht).toBe(true);
    expect(j2.rot).toBe(90);
    expect(j2.pins?.length).toBe(4);
    expect(j2.pins?.[0].net).toBe('GND');
    // turned 90 degrees: pin 2 (0, -2.54 in the package) sits 2.54 mm to the right of pin 1
    expect(near(j2.pins![1].x - j2.pins![0].x, 2.54) && near(j2.pins![1].y, j2.pins![0].y)).toBe(true);
    const c1 = b.comps.find((c) => c.ref === 'C1')!;
    expect(c1.side).toBe('bottom');
    expect(c1.value).toBe('100n');
    expect(c1.w).toBeCloseTo(2.5, 2); // pads -1.25 … 1.25
    const u1 = b.comps.find((c) => c.ref === 'U1')!;
    expect(u1.w).toBeGreaterThan(3); // no package data: guessed from "SOIC-8"
    expect(b.notes.some((n) => /guessed/.test(n))).toBe(true);
  });
});

// ---------------- ODB++ ----------------
const ODB: Record<string, string> = {
  'demo/misc/info': 'JOB_NAME=demo\nUNITS=MM\n',
  'demo/matrix/matrix': `STEP {
   COL=1
   NAME=PCB
}
LAYER {
   ROW=1
   CONTEXT=BOARD
   TYPE=COMPONENT
   NAME=COMP_+_TOP
   POLARITY=POSITIVE
}
LAYER {
   ROW=2
   CONTEXT=BOARD
   TYPE=SIGNAL
   NAME=TOP
}
LAYER {
   ROW=3
   CONTEXT=BOARD
   TYPE=DRILL
   NAME=DRILL
}
LAYER {
   ROW=4
   CONTEXT=BOARD
   TYPE=COMPONENT
   NAME=COMP_+_BOT
}
`,
  // the profile in inches, to check per-file units: 3 x 2 inches with one rounded corner
  'demo/steps/pcb/profile': `UNITS=INCH
#
#Layer features
#
S P 0
OB 0 0 I
OS 3 0
OS 3 1.8
OC 2.8 2 2.8 1.8 N
OS 0 2
OS 0 0
OE
SE
`,
  'demo/steps/pcb/layers/drill/features': `UNITS=MM
#
#Feature symbol names
#
$0 r3200
$1 r1000
$2 r300
#
#Feature attribute names
#
@0 .drill
#
#Layer features
#
P 5 5 0 P 0 0;0=1
P 71.2 5 0 P 0 0;0=1
P 40 30 2 P 0 0;0=2
P 60 20 1 P 0 0;0=0
P 62.54 20 1 P 0 0;0=0
P 65.08 20 1 P 0 0;0=0
`,
  'demo/steps/pcb/eda/data': `HDR Test
UNITS=MM
LYR comp_+_top comp_+_bot
# NET 0
NET GND
# NET 1
NET TX
# PKG 0
PKG USB-C_GCT_USB4085 0.5 -4.6 -3.8 4.6 3.8;;ID=1
RC -4.47 -3.675 8.94 7.35
PIN A1 S -3 -2 0 U U ID=2
RC -3.15 -2.5 0.3 1
# PKG 1
PKG PINHEADER_1X03_P2.54MM 2.54 -0.85 -0.85 5.93 0.85;;ID=3
PIN 1 T 0 0 0 U U ID=4
SQ 0 0 0.85
PIN 2 T 2.54 0 0 U U ID=5
CR 2.54 0 0.85
PIN 3 T 5.08 0 0 U U ID=6
CR 5.08 0 0.85
# PKG 2
PKG 0402 1 -0.8 -0.4 0.8 0.4;;ID=7
PIN 1 S -0.5 0 0 U U ID=8
PIN 2 S 0.5 0 0 U U ID=9
`,
  'demo/steps/pcb/layers/comp_+_top/components': `UNITS=MM
@0 .comp_height
# CMP 0
CMP 0 38.1 48 0 N J1 USB4085;0=3.2;ID=10
PRP VALUE 'USB-C'
TOP 0 35.1 46 0 N 0 0 A1
# CMP 1
CMP 1 60 20 0 N J3 HDR3;;ID=11
TOP 0 60 20 0 N 0 0 1
TOP 1 62.54 20 0 N 1 0 2
TOP 2 65.08 20 0 N 1 0 3
`,
  'demo/steps/pcb/layers/comp_+_bot/components': `UNITS=MM
CMP 2 20 20 90 M R5 RES;;ID=12
`,
};

/** A minimal ustar archive of text files. */
function tar(files: Record<string, string>): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const [path, body] of Object.entries(files)) {
    const data = strToU8(body), h = new Uint8Array(512);
    const put = (s: string, at: number) => { for (let i = 0; i < s.length; i++) h[at + i] = s.charCodeAt(i); };
    put(path, 0); put('0000644\0', 100); put('0000000\0', 108); put('0000000\0', 116);
    put(data.length.toString(8).padStart(11, '0') + '\0', 124); put('00000000000\0', 136);
    put('        ', 148); h[156] = 48; put('ustar\0', 257); put('00', 263);
    let sum = 0; for (const v of h) sum += v;
    put(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    chunks.push(h, data, new Uint8Array((512 - (data.length % 512)) % 512));
  }
  chunks.push(new Uint8Array(1024));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
const tgz = (files: Record<string, string>) => gzipSync(tar(files));

describe('archives', () => {
  it('reads tar and nested tgz-in-zip with paths', () => {
    const t = untar(tar({ 'a/b.txt': 'hello' }));
    expect(t[0].path).toBe('a/b.txt');
    expect(strFromU8(t[0].bytes)).toBe('hello');
    const zip = zipSync({ 'out/odb/demo.tgz': tgz({ 'demo/misc/info': 'UNITS=MM' }) });
    const all = expandAll([{ name: 'fab.zip', bytes: zip }]);
    expect(all.map((f) => f.path)).toEqual(['out/odb/demo/misc/info']);
  });
  it('unpacks Unix compress (.Z) data made by the compress tool', () => {
    const z = Uint8Array.from(atob('H52QUEDAcAGjoECCBmGACKgQxg4YPWAoCBjDxY2ELmZcBBFjoUCBD3vEmAhihgsaGG+gBCHDY8OQMkjWcBHDYMUYNT8yBAlRYkAbLnDYPCmUo0ueIknicFFjKI6mLI86hBiT4kAZBmW4kIFV58epEUnidJEjK9OyRneCHUnRpA2zOd5GVQtT7MwZBk3OwOv1ZU+xNxAqNHlRYUe6ENlyXFoYBA2CG1si7lGV5UCUCh/TWKlwsk+WWmtmDprz8NeQimWYFKpwZoyikk9TJSljZtPWTKF2lh02oIzAWHHn6Grab1LfS8sqBCoDbWzjlfG6eLt8utzdxj/P0IpXYWAYfIsjVTzjcUHvJ7NKrRtwxszGgW9sxI5Ue2DMIJbGWCl+LckZOdBk0FI15PQcUpWhFNSAQRVFH1if0aDVbSAEWJth6yVG0mZbGRSgDV0dCFaCMylXIVloPRhShIFRx9FAM8jVH2obBtjdixbxJSJ7IBQoGEc3JZRhbz1q1dhYNGw0o4YB1aCZTRXhsNKOszUJlGgcaSVDTir+1WRgrGXJVFFLHtdjgBTGoFUOUFFJGUk2VBQcR3p11SWRIJJlk1tolamYDY+5uB9BcrlZmQ1A3TgoDXzd+ZkNS53H0WNh+glngEe6FtmQlVWEXwy2cTakdgIaVmJpQypGqU3MwcYpnEyxOp1uoyrVoWHfEZcqSQGaGENgACpkqFgVCRrfdbW2lZFN+oW3K0UzSfparMK+ShFQRy6Fw3zJLpaeYRby96xlpXL0oYHWshSlTb062K1q1JLrHoaTpTbTnFhZFGK6MgBl4pYEpfjuUi4CTIOM40p3I8A46Jjudj9ydWtf9f1HWFYTKpnwTPhJnMOUDweGJbwzcNntDNpm5RaZ4ypIoQzmtZmuhBPDfJKd3TKqp7CP3dBnyzMV7FqhMwOblW2N5hygpLXtnBZvijVlUVbMbTpZZTVo1TFQgDbUrZPl/kYQqvXKNFOYYqNc7dUyBfZyfLR6JpOFWemna9k/DfTvUjQ4l26eBWuLrNw/Pbawhc7iDQKiEX+oHts/xZdVr9wSvniA+CksruJBDjbQDehCztKCg1UEg7uWP0ZhySdBZelPE7OOw76iB2YixDEIbLnjg02IMOcV3QhxDg6LHoNJku61rNeWD9qY8jZozDlQmZsHsvH65aWZyc0HGGZ5FrGsOMCruyaz6PDO6R5TOFtu8+1n/zw+13kxRzT6SwnPddKWS5f8dzZJWEWeByyr8SY6JslcfETVP9fkRT9kg9p/gPI9vrlKdCiLVwafwjzeROgqebHQ3SQYEBpU5HZo8pvodOYiAJFlcB7c0F0MoqC90IuEjgFgZj73uANuiDE0NF3lYtikywTxJJvDYdbKZULSrM2HTVoNDUODOiL2yDZTzM0NjRM14GRxOE+EjkySQ0OTNKeD2YHTQFzEwt/hME834hB4woggOJmHhk9CY8V+8h48WkR6b7wPDV1zPShejom24Z4VBxImGpxNfDicEA2Zcz5DPmZOB5tO+6xYokmiaIvjIUmLaAis+xnSRqTMkR4hRKwf0SB7oPQPRYxEQ74ZUIwUyaNjtMVAK8bgSjS0UAS5CBjSOQZNFzRk7uLVN7LEzYoAmxOMRkhM36wJIzZQoSFtJihCrXJFtEnUUBgVSxoh50frouOIaIMps/zqm14qiafM4qRyMqkkJhkZWUJnSPB9bytVTGN7gLK6WdnTTBnEJEFo189e0TAjurNiE9loETdW0zF6MYhriudD'), (c) => c.charCodeAt(0));
    const txt = strFromU8(unlzw(z));
    expect(txt.length).toBe(4134);
    const lines = txt.trim().split('\n');
    expect(lines.length).toBe(150);
    expect(lines[99]).toBe('P 28.300 36.630 0 P 0 0;0=0');
    expect(lines[149]).toBe('P 43.300 5.130 2 P 0 0;0=2');
    // a features.Z inside an archive comes out as "features"
    const all = expandAll([{ name: 'j.tgz', bytes: gzipSync(tar({})) }, { name: 'features.Z', path: 'job/steps/pcb/layers/drill/features.Z', bytes: z }]);
    expect(all.find((f) => f.name === 'features')?.path).toBe('job/steps/pcb/layers/drill/features');
  });
});

describe('ODB++', () => {
  const files = Object.entries(ODB).map(([path, t]) => ({ name: path.split('/').pop()!, path, bytes: strToU8(t) }));
  it('finds the job and reads outline, holes and parts', () => {
    const jobs = findOdb(files);
    expect(jobs.length).toBe(1);
    expect(jobs[0].step).toBe('pcb');
    const b = importOdb(jobs[0], 'demo.tgz');
    expect(b.name).toBe('demo');
    const bb = bbox(b.outline);
    expect(bb.x1 - bb.x0).toBeCloseTo(76.2, 2);
    expect(bb.y1 - bb.y0).toBeCloseTo(50.8, 2);
    // two non-plated 3.2 mm holes; the via and the header's leads are not mounting holes
    expect(b.holes.length).toBe(2);
    expect(b.holes.every((h) => near(h.d, 3.2) && !h.plated)).toBe(true);
    expect(b.comps.length).toBe(3);
    const j1 = b.comps.find((c) => c.ref === 'J1')!;
    expect(j1.conn?.type).toBe('usb_c');
    expect(j1.h).toBeCloseTo(3.2);
    expect(j1.w).toBeCloseTo(8.94, 2);
    expect(near(j1.x, 38.1) && near(j1.y, 48)).toBe(true);
    const j3 = b.comps.find((c) => c.ref === 'J3')!;
    expect(j3.kind).toBe('header');
    expect(j3.tht).toBe(true);
    expect(j3.pins?.map((p) => p.net)).toEqual(['GND', 'TX', 'TX']);
    expect(near(j3.pins![2].x, 65.08)).toBe(true);
    const r5 = b.comps.find((c) => c.ref === 'R5')!;
    expect(r5.side).toBe('bottom');
    expect(r5.rot).toBe(-90); // ODB++ turns clockwise
  });
  it('comes in from a .tgz inside a zip, and is preferred to the Gerbers next to it', async () => {
    const zip = zipSync({ 'odb/demo.tgz': tgz(ODB), 'gerber/board-Edge_Cuts.gbr': strToU8('%FSLAX36Y36*%\n%MOMM*%\nD10*\nX0Y0D02*\nX10000000Y0D01*\nX10000000Y10000000D01*\nX0Y10000000D01*\nX0Y0D01*\nM02*') });
    const b = await importFiles([{ name: 'outputs.zip', bytes: zip }]);
    expect(b.source).toMatch(/ODB\+\+/);
    expect(b.notes.some((n) => /Read from .*ODB\+\+/.test(n))).toBe(true);
    expect(b.notes.some((n) => /not needed: .*Gerber/.test(n))).toBe(true);
  });
  it('comes in from a dropped folder', async () => {
    const r = await importMany(files);
    expect(r.errors).toEqual([]);
    expect(r.boards.length).toBe(1);
    expect(r.boards[0].comps.length).toBe(3);
  });
});

// ---------------- GenCAD ----------------
const GENCAD = `$HEADER
GENCAD 1.4
USER "test"
DRAWING "Motor driver"
REVISION "A"
UNITS INCH
ORIGIN 0 0
INTERTRACK 0
$ENDHEADER
$BOARD
THICKNESS 0.062
LINE 0 0 3 0
LINE 3 0 3 1.8
ARC 3 1.8 2.8 2 2.8 1.8
LINE 2.8 2 0 2
LINE 0 2 0 0
CUTOUT slot
RECTANGLE 1 0.8 0.4 0.2
MASK keepout TOP
RECTANGLE 0.1 0.1 2.8 1.8
$ENDBOARD
$PADS
PAD RND60 ROUND 0.04
CIRCLE 0 0 0.03
PAD MTG126 ROUND 0.126
CIRCLE 0 0 0.1
PAD SMD20 RECTANGULAR 0
RECTANGLE -0.01 -0.02 0.02 0.04
$ENDPADS
$PADSTACKS
PADSTACK PS60 0.04
PAD RND60 TOP 0 0
$ENDPADSTACKS
$SHAPES
SHAPE MTG_HOLE_3.2
PIN 1 MTG126 0 0 TOP 0 0
SHAPE PINHEADER_1X04_P2.54MM
INSERT TH
HEIGHT 0.335
PIN 1 PS60 0 0 TOP 0 0
PIN 2 PS60 0 -0.1 TOP 0 0
PIN 3 PS60 0 -0.2 TOP 0 0
PIN 4 PS60 0 -0.3 TOP 0 0
SHAPE USB_C_RECEPTACLE
INSERT SMD
RECTANGLE -0.176 -0.145 0.352 0.29
PIN A1 SMD20 -0.1 -0.1 TOP 0 0
SHAPE R0603
PIN 1 SMD20 -0.03 0 TOP 0 0
PIN 2 SMD20 0.03 0 TOP 0 0
$ENDSHAPES
$COMPONENTS
COMPONENT H1
DEVICE MTG
PLACE 0.2 0.2
LAYER TOP
ROTATION 0
SHAPE MTG_HOLE_3.2 0 0
COMPONENT J1
DEVICE USBC_DEV
PLACE 1.5 1.86
LAYER TOP
ROTATION 0
SHAPE USB_C_RECEPTACLE 0 0
COMPONENT J2
DEVICE HDR4
PLACE 2.5 1
LAYER TOP
ROTATION 90
SHAPE PINHEADER_1X04_P2.54MM 0 0
COMPONENT R1
DEVICE RES
PLACE 1 1.5
LAYER BOTTOM
ROTATION 0
SHAPE R0603 MIRRORX FLIP
$ENDCOMPONENTS
$DEVICES
DEVICE USBC_DEV
PART "USB4085"
PACKAGE "USB_C"
DEVICE RES
PACKAGE "0603"
$ENDDEVICES
$SIGNALS
SIGNAL GND
NODE J2 1
NODE H1 1
$ENDSIGNALS
$MECH
MECH M1
PLACE 2.8 0.2
LAYER TOP
HOLE 0 0 0.126
$ENDMECH
`;

describe('GenCAD', () => {
  const b = importGencad(GENCAD, 'driver.cad');
  it('reads the outline in inches, the cut-out and thickness', () => {
    expect(b.name).toBe('Motor driver');
    const bb = bbox(b.outline);
    expect(bb.x1 - bb.x0).toBeCloseTo(76.2, 2);
    expect(bb.y1 - bb.y0).toBeCloseTo(50.8, 2);
    expect(b.cutouts.length).toBe(1); // the keep-out mask is not a cut-out
    expect(b.thickness).toBeCloseTo(1.575, 2);
  });
  it('finds mounting holes from mounting parts and $MECH, not header leads', () => {
    expect(b.holes.length).toBe(2);
    expect(b.holes.every((h) => near(h.d, 3.2))).toBe(true);
    expect(b.holes.some((h) => near(h.x, 5.08) && near(h.y, 5.08))).toBe(true);
  });
  it('places parts from their shapes', () => {
    expect(b.comps.map((c) => c.ref).sort()).toEqual(['J1', 'J2', 'R1']);
    const j1 = b.comps.find((c) => c.ref === 'J1')!;
    expect(j1.conn?.type).toBe('usb_c');
    expect(j1.w).toBeCloseTo(8.94, 1);
    const j2 = b.comps.find((c) => c.ref === 'J2')!;
    expect(j2.kind).toBe('header');
    expect(j2.tht).toBe(true);
    expect(j2.h).toBeCloseTo(8.51, 1);
    expect(j2.pins?.length).toBe(4);
    expect(j2.pins?.[0].net).toBe('GND');
    expect(near(j2.pins![0].x, 63.5) && near(j2.pins![0].y, 25.4)).toBe(true);
    expect(near(j2.pins![1].x, 66.04) && near(j2.pins![1].y, 25.4)).toBe(true); // turned 90 degrees
    expect(b.comps.find((c) => c.ref === 'R1')!.side).toBe('bottom');
  });
});

// ---------------- Allegro, fall-backs, grouping ----------------
function allegroBytes(): Uint8Array {
  const b = new Uint8Array(0x2000);
  b.set([0x00, 0x04, 0x14, 0x00], 0); // release 17.2 magic, little-endian
  b.set(strToU8('allegro_17.2'), 0xf8);
  return b;
}

describe('Allegro .brd and falling back', () => {
  it('recognises an Allegro board and says what to do instead', async () => {
    expect(isAllegroBrd(allegroBytes())).toBe(true);
    expect(isAllegroBrd(strToU8('<?xml version="1.0"?><eagle>' + ' '.repeat(5000)))).toBe(false);
    await expect(importFiles([{ name: 'ctrl.brd', bytes: allegroBytes() }])).rejects.toThrow(/Allegro.*release 17[\s\S]*KiCad 10[\s\S]*IPC-2581/);
  });
  it('an Allegro board in a zip falls back to the GenCAD file beside it', async () => {
    const zip = zipSync({ 'cad/ctrl.brd': allegroBytes(), 'cad/ctrl.cad': strToU8(GENCAD) });
    const b = await importFiles([{ name: 'ctrl.zip', bytes: zip }]);
    expect(b.source).toMatch(/GenCAD/);
    expect(b.notes.some((n) => /ctrl\.brd.*could not be read: it is a Cadence Allegro board/.test(n))).toBe(true);
  });
  it('a damaged IPC-2581 falls back to the next format, and every failure is reported', async () => {
    const zip = zipSync({ 'a.xml': strToU8('<IPC-2581 revision="B"><Content/></IPC-2581>'), 'a.cad': strToU8(GENCAD) });
    const b = await importFiles([{ name: 'a.zip', bytes: zip }]);
    expect(b.source).toMatch(/GenCAD/);
    expect(b.notes.some((n) => /a\.xml \(IPC-2581\).*could not be read/.test(n))).toBe(true);
    const bad = zipSync({ 'a.xml': strToU8('<IPC-2581 revision="B"><Content/></IPC-2581>'), 'a.cad': strToU8('$HEADER\nGENCAD 1.4\n$ENDHEADER') });
    await expect(importFiles([{ name: 'bad.zip', bytes: bad }])).rejects.toThrow(/None of the files could be read.*IPC-2581.*GenCAD/);
  });
  it('an IPC-2581 in a zip is read before the GenCAD beside it; a zip of several formats stays one board', async () => {
    const zip = zipSync({ 'x/relay.xml': strToU8(IPC), 'x/relay.cad': strToU8(GENCAD) });
    const r = await importMany([{ name: 'relay.zip', bytes: zip }]);
    expect(r.boards.length).toBe(1);
    expect(r.boards[0].source).toMatch(/IPC-2581/);
    expect(r.boards[0].notes.some((n) => /not needed: .*GenCAD/.test(n))).toBe(true);
    const g = groupFiles([{ name: 'two.zip', bytes: zipSync({ 'a.kicad_pcb': strToU8('x'), 'b.kicad_pcb': strToU8('x'), 'a.step': strToU8('x') }) }]);
    expect(g.map((x) => x.map((y) => y.name).sort().join('+'))).toEqual(['a.kicad_pcb+a.step', 'b.kicad_pcb']);
  });
});
