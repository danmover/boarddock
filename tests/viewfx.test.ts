// The 3D view's extra looks, without a renderer: Isolate and X-ray on a made-up scene, the cables' hot and dim looks, the
// cable sheath's shader states, and the pulses along a cable (liveFx): where they run, which way, and when they don't.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Ghost, PickTag } from '../src/model/types';
import { applyView, hoverCable, keeps, pickCables, refreshCables, zoneVisible } from '../src/ui/viewFx';
import { sheathMaterial, sheathOpacity, SHEATH_OPACITY } from '../src/ui/cableLook';
import { liveFx } from '../src/ui/liveFx';

const mat = () => new THREE.MeshStandardMaterial({ color: 'red' });
function piece(tag: PickTag | undefined, base?: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), base ?? mat());
  mesh.add(new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial())); // (the outline edges)
  if (tag?.kind === 'cable') Object.assign(mesh.userData, { cableId: tag.refs![0], cableBase: mesh.material });
  return { mesh, tag, base: new THREE.Matrix4() };
}
const ctx = (objs: ReturnType<typeof piece>[]) => ({ objs, invalidate() {}, zones: new THREE.Group() }) as any;

describe('Isolate and X-ray', () => {
  const scene = () => {
    const a = piece({ kind: 'holder', module: 'm1' }), b = piece({ kind: 'board', module: 'm1' }), other = piece({ kind: 'holder', module: 'm2' });
    const cable = piece({ kind: 'cable', refs: ['l1'] }, sheathMaterial('#0072b2', 0.5)), rail = piece({ kind: 'rail', rail: 'r1' });
    return { a, b, other, cable, rail, c: ctx([a, b, other, cable, rail]) };
  };

  it('picks the pieces a board, a dock, a rail or a cable is made of (a board keeps its parts, not its cables)', () => {
    expect(keeps({ kind: 'holder', module: 'm1' }, { kind: 'module', id: 'm1' })).toBe(true);
    expect(keeps({ kind: 'cable', refs: ['l1'] }, { kind: 'module', id: 'm1' })).toBe(false);
    expect(keeps({ kind: 'shoe', mount: 'd1' }, { kind: 'mount', id: 'd1' })).toBe(true);
    expect(keeps({ kind: 'rail', rail: 'r1' }, { kind: 'rail', id: 'r1' })).toBe(true);
    expect(keeps({ kind: 'cable', refs: ['l1'] }, { kind: 'link', id: 'l1' })).toBe(true);
    expect(keeps({ kind: 'cable', refs: ['l2'] }, { kind: 'link', id: 'l1' })).toBe(false);
    expect(keeps(undefined, { kind: 'module', id: 'm1' })).toBe(false);
  });

  it('Isolate hides what is not picked, and leaving it shows everything again', () => {
    const { a, b, other, cable, rail, c } = scene();
    expect(applyView(c, { focus: { mode: 'isolate', items: [{ kind: 'module', id: 'm1' }] }, news: null })).toBe(true);
    expect([a, b, other, cable, rail].map((x) => x.mesh.visible)).toEqual([true, true, false, false, false]);
    applyView(c, { focus: null, news: null });
    expect([a, b, other, cable, rail].every((x) => x.mesh.visible)).toBe(true);
  });

  it('X-ray makes the rest see-through with no outline lines or shadow, and gives the plain look back', () => {
    const { a, other, c } = scene();
    const plain = other.mesh.material as THREE.Material;
    a.mesh.castShadow = other.mesh.castShadow = true;
    applyView(c, { focus: { mode: 'xray', items: [{ kind: 'module', id: 'm1' }] }, news: null });
    const m = other.mesh.material as THREE.MeshStandardMaterial;
    expect([m.transparent, m.depthWrite, m.opacity <= 0.12, other.mesh.userData.xray, other.mesh.castShadow, other.mesh.children[0].visible]).toEqual([true, false, true, true, false, false]);
    expect([a.mesh.userData.xray, a.mesh.castShadow, a.mesh.children[0].visible]).toEqual([false, true, true]);
    applyView(c, { focus: null, news: null });
    expect([other.mesh.material, other.mesh.castShadow, other.mesh.children[0].visible, other.mesh.userData.xray]).toEqual([plain, true, true, false]);
  });

  it("leaves a piece's other children alone (a cable's pulses, the rounded tip of one being drawn)", () => {
    const { other, c } = scene();
    const streak = new THREE.Mesh(new THREE.SphereGeometry(1), mat());
    streak.visible = false;
    other.mesh.add(streak);
    applyView(c, { focus: { mode: 'xray', items: [{ kind: 'module', id: 'm1' }] }, news: null });
    applyView(c, { focus: null, news: null });
    expect(streak.visible).toBe(false);
  });

  it('says so when nothing in the scene is what was asked for, and shows everything', () => {
    const { a, c } = scene();
    expect(applyView(c, { focus: { mode: 'isolate', items: [{ kind: 'module', id: 'gone' }] }, news: null })).toBe(false);
    expect(a.mesh.visible).toBe(true);
  });

  it('keeps see-through pieces and the translucent cables out of the ambient-occlusion pass, and puts them back', () => {
    const { other, cable, a, c } = scene();
    applyView(c, { focus: { mode: 'xray', items: [{ kind: 'module', id: 'm1' }] }, news: null });
    c.aoHide(true);
    expect([other.mesh.visible, cable.mesh.visible, a.mesh.visible]).toEqual([false, false, true]);
    c.aoHide(false);
    expect([other.mesh.visible, cable.mesh.visible, a.mesh.visible]).toEqual([true, true, true]);
  });

  it('the mains zones sit out the focus modes, and out of the assembly animation', () => {
    const c: any = { showZones: true, anim: { t: Infinity, explode: 0 } };
    expect(zoneVisible(c)).toBe(true);
    expect(zoneVisible({ ...c, zonesOff: true })).toBe(false);
    expect(zoneVisible({ ...c, anim: { t: 2, explode: 0 } })).toBe(false);
    expect(zoneVisible({ ...c, anim: { t: Infinity, explode: 0.4 } })).toBe(false);
    expect(zoneVisible({ ...c, showZones: false })).toBe(false);
    const s = scene();
    applyView(s.c, { focus: { mode: 'isolate', items: [{ kind: 'module', id: 'm1' }] }, news: null });
    expect(s.c.zonesOff).toBe(true);
    applyView(s.c, { focus: null, news: null });
    expect(s.c.zonesOff).toBe(false);
  });
});

describe('the cables\' looks', () => {
  const rack = () => {
    const x = piece({ kind: 'cable', refs: ['l1'] }, sheathMaterial('#0072b2', 0.5)), y = piece({ kind: 'cable', refs: ['l2'] }, sheathMaterial('#7a4a2b', 0.5)), z = piece({ kind: 'cable', refs: ['l1'] }, sheathMaterial('#0072b2', 0.85));
    return { x, y, z, c: ctx([x, y, z]) };
  };
  it('a picked cable is more solid and brighter, the others dim; nothing dims when none is picked', () => {
    const { x, y, z, c } = rack();
    const base = [x, y, z].map((p) => p.mesh.material);
    pickCables(c, ['l1']);
    expect(x.mesh.material).not.toBe(base[0]);
    expect(z.mesh.material).not.toBe(base[2]);
    expect(x.mesh.material).not.toBe(y.mesh.material);
    pickCables(c, []);
    expect([x, y, z].map((p) => p.mesh.material)).toEqual(base);
  });
  it('a hovered cable does the same (all the wires of one cable together), and again undoes it', () => {
    const { x, y, z, c } = rack();
    const base = y.mesh.material;
    hoverCable(c, x.mesh);
    expect(y.mesh.material).not.toBe(base);
    expect(z.mesh.material).not.toBe(z.mesh.userData.cableBase);
    hoverCable(c, null);
    expect(y.mesh.material).toBe(base);
  });
  it('leaves a see-through or tinted cable as it is, and moves the rounded tip of one being drawn along', () => {
    const { x, y, c } = rack();
    x.mesh.userData.xray = true;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(1), y.mesh.material);
    y.mesh.userData.tip = tip;
    const was = x.mesh.material;
    pickCables(c, ['l2']);
    expect(x.mesh.material).toBe(was);
    expect(tip.material).toBe(y.mesh.material);
    refreshCables(c);
  });
});

describe('the cable sheath', () => {
  it('is translucent, does not write depth and is seen from outside only, so crossing cables blend', () => {
    const m = sheathMaterial('#0072b2', 0.5);
    expect([m.transparent, m.depthWrite, m.side, m.opacity]).toEqual([true, false, THREE.FrontSide, 0.5]);
  });
  it('rounds go through 50%, a ribbon 72% and a loose wire 85%', () => {
    expect([sheathOpacity('cable l1', false), sheathOpacity('cable l1', true), sheathOpacity('cable l1 wire 3', false)]).toEqual([SHEATH_OPACITY.round, SHEATH_OPACITY.ribbon, SHEATH_OPACITY.wire]);
    expect(SHEATH_OPACITY.round).toBeLessThan(SHEATH_OPACITY.ribbon);
    expect(SHEATH_OPACITY.ribbon).toBeLessThan(SHEATH_OPACITY.wire);
  });
  it('is one program in three states (normal, hot, dim): they differ only by their uniforms', () => {
    const shade = (state: 'normal' | 'hot' | 'dim') => {
      const m = sheathMaterial('#0072b2', 0.5, state), sh: any = { uniforms: {}, fragmentShader: '#include <common>\n#include <opaque_fragment>' };
      m.onBeforeCompile(sh, null as any);
      return { m, sh };
    };
    const [n, h, d] = [shade('normal'), shade('hot'), shade('dim')];
    expect([n.sh.uniforms.uBoost.value, h.sh.uniforms.uBoost.value, d.sh.uniforms.uBoost.value]).toEqual([0, 1, 0]);
    expect([n.sh.uniforms.uDim.value, h.sh.uniforms.uDim.value, d.sh.uniforms.uDim.value]).toEqual([0, 0, 1]);
    expect(n.m.customProgramCacheKey()).toBe(h.m.customProgramCacheKey());
    expect(n.sh.fragmentShader).toContain('#include <opaque_fragment>'); // (three fills the include in after)
    expect(n.sh.fragmentShader).toMatch(/rim/);
  });
});

describe('pulses along a cable', () => {
  const flowOf = (pts: number[][], o: { on?: boolean; r?: number } = {}): { gh: Ghost; mesh: THREE.Mesh } => ({
    gh: { name: 'cable l1', mesh: { pos: new Float32Array(), idx: new Uint32Array() }, color: '#000', opacity: 1, fx: { flow: { pts, r: o.r ?? 2, colour: '#66b8ff', on: o.on ?? true } } },
    mesh: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat()),
  });
  const beads = (mesh: THREE.Mesh) => mesh.children.filter((o) => (o as THREE.Mesh).material && ((o as THREE.Mesh).material as THREE.Material).type === 'ShaderMaterial') as THREE.Mesh[];
  const heading = (b: THREE.Mesh) => new THREE.Vector3(0, 0, 1).applyQuaternion(b.quaternion);

  it('run head first in the way the cable points: from the giving end to the taking end', () => {
    const fwd = flowOf([[0, 0, 0], [100, 0, 0]]), back = flowOf([[100, 0, 0], [0, 0, 0]]);
    const f1 = liveFx([fwd], true), f2 = liveFx([back], true);
    expect(f1.tick(1000)).toBe(true);
    f2.tick(1000);
    const [a, b] = [beads(fwd.mesh), beads(back.mesh)];
    expect(a.length).toBeGreaterThanOrEqual(1);
    for (const x of a) { expect(x.visible).toBe(true); expect(x.position.x).toBeGreaterThanOrEqual(0); expect(x.position.x).toBeLessThanOrEqual(100); expect(heading(x).x).toBeCloseTo(1, 5); }
    for (const x of b) expect(heading(x).x).toBeCloseTo(-1, 5);
    // and they move on (110 mm/s for data): a second later each is 110 mm further along, wrapped
    const x0 = a[0].position.x;
    f1.tick(1500);
    expect((a[0].position.x - x0 + 100) % 100).toBeCloseTo((0.5 * 110) % 100, 3);
  });

  it('are streaks: about a third of the cable radius wide and four radii long', () => {
    const it = flowOf([[0, 0, 0], [100, 0, 0]], { r: 4.2 });
    liveFx([it], true);
    const b = beads(it.mesh)[0];
    expect(b.scale.x).toBeCloseTo(4.2 * 0.32);
    expect(b.scale.z / b.scale.x).toBeGreaterThan(4);
  });

  it('are not there when live is off, when the source has no power, on a cable too short, or on one still being drawn out', () => {
    const it = flowOf([[0, 0, 0], [100, 0, 0]]);
    const fx = liveFx([it], true);
    fx.tick(1000);
    expect(beads(it.mesh).every((b) => b.visible)).toBe(true);
    fx.setLive(false);
    fx.tick(2000);
    expect(beads(it.mesh).some((b) => b.visible)).toBe(false);
    fx.setLive(true);
    it.mesh.geometry.setDrawRange(0, 6); // (drawn out only part of the way)
    fx.tick(3000);
    expect(beads(it.mesh).some((b) => b.visible)).toBe(false);
    it.mesh.geometry.setDrawRange(0, Infinity);
    fx.setLive(true);
    fx.tick(4000);
    expect(beads(it.mesh).every((b) => b.visible)).toBe(true);
    const off = flowOf([[0, 0, 0], [100, 0, 0]], { on: false });
    liveFx([off], true).tick(1000);
    expect(beads(off.mesh).some((b) => b.visible)).toBe(false);
    const stub = flowOf([[0, 0, 0], [5, 0, 0]]);
    liveFx([stub], true);
    expect(beads(stub.mesh)).toHaveLength(0);
  });

  it('keep clear of the ambient-occlusion pass, and go when the scene does', () => {
    const it = flowOf([[0, 0, 0], [100, 0, 0]]);
    const fx = liveFx([it], true);
    fx.tick(1000);
    fx.hide(true);
    expect(beads(it.mesh).some((b) => b.visible)).toBe(false);
    fx.hide(false);
    expect(beads(it.mesh).every((b) => b.visible)).toBe(true);
    fx.dispose();
    expect(beads(it.mesh)).toHaveLength(0);
  });
});
