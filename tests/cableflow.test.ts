// The live 3D view's pulses along cables: every powered cable (a supply lead, USB power, a PoE Ethernet lead, a mains
// lead from an outlet) gets its flow, running from the end that gives to the end that takes, in its kind's glow colour,
// on when its source has power; a PoE lead glows as power, not as Ethernet.
import { describe, it, expect, beforeAll } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { autoLinks, cableFlow, flowGlow, numberLinks } from '../src/model/links';
import { KIND_GLOW } from '../src/model/cablekinds';
import { poweredBoards } from '../src/model/lights';
import { generatePanel } from '../src/cad/panelgen';
import { initKernel } from '../src/cad/kernel';
import type { Project } from '../src/model/types';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();
function rack(ids: string[], hat: number[] = []): Project {
  const p = newProject(T(ids[0]));
  for (const id of ids.slice(1)) p.modules.push(newModule(T(id)));
  p.modules.forEach((m, i) => { const n = ids.slice(0, i + 1).filter((x) => x === ids[i]).length; if (n > 1) m.board.name += ` #${n}`; if (hat.includes(i)) m.board.poe = true; });
  p.links = numberLinks(autoLinks(p));
  return p;
}
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('which way a cable flows, and how it glows', () => {
  it('a PoE lead runs from the switch port to the board, and glows as slow power', () => {
    const p = rack(['rpi4', 'net_switch8poe'], [0]);
    const poe = p.links!.find((l) => l.kind === 'net' && [l.a.module, l.b.module].includes(p.modules[0].id))!;
    expect(poe).toBeTruthy();
    // (whichever end the link was made with: the flow starts at the switch)
    expect(cableFlow(p, poe).from.module).toBe(p.modules[1].id);
    expect(cableFlow(p, poe).to.module).toBe(p.modules[0].id);
    expect(flowGlow(p, poe)).toEqual({ colour: KIND_GLOW.power, slow: true });
    const flipped = { ...poe, a: poe.b, b: poe.a };
    expect(cableFlow(p, flipped).from.module).toBe(p.modules[1].id);
  });

  it('an ordinary Ethernet lead glows as Ethernet, a supply lead and a mains lead as slow power', () => {
    const p = rack(['rpi5', 'psu_pi5', 'pb4', 'net_switch8']);
    const by = (k: string) => p.links!.filter((l) => l.kind === k);
    const net = by('net')[0], power = by('power')[0], mains = by('mains')[0];
    expect([net, power, mains].every(Boolean)).toBe(true);
    expect(flowGlow(p, net)).toEqual({ colour: KIND_GLOW.net, slow: false });
    expect(flowGlow(p, power)).toEqual({ colour: KIND_GLOW.power, slow: true });
    expect(flowGlow(p, mains)).toEqual({ colour: KIND_GLOW.mains, slow: true });
    // the mains lead runs from the powerboard's outlet to the plug pack, the supply lead from the pack to the Pi
    expect(cableFlow(p, mains).from.module).toBe(p.modules[2].id);
    expect(cableFlow(p, power).from.module).toBe(p.modules[1].id);
    expect(cableFlow(p, power).to.module).toBe(p.modules[0].id);
  });

  it('a board fed over PoE, or from a plug pack, has power (so its lights and the pulses it feeds are on)', () => {
    const p = rack(['rpi4', 'net_switch8poe', 'rpi5', 'psu_pi5', 'pb4'], [0]);
    const on = poweredBoards(p);
    expect(on.has(p.modules[0].id)).toBe(true); // the Pi 4 on the PoE port: no cable of its own says so
    expect(on.has(p.modules[2].id)).toBe(true); // the Pi 5 on the plug pack's lead
    // with no PoE port and no supply lead a Pi has none
    const bare = rack(['rpi4', 'net_switch8'], [0]);
    expect(poweredBoards(bare).has(bare.modules[0].id)).toBe(false);
  });

  it('every kind has its own glow colour', () => {
    expect(new Set(Object.values(KIND_GLOW)).size).toBe(Object.keys(KIND_GLOW).length);
  });
});

describe('the flows on a built rack', () => {
  beforeAll(async () => { await initKernel(); });
  const rig = () => {
    const p = rack(['rpi4', 'net_switch8poe', 'rpi5', 'psu_pi5', 'pb4', 'usb_hub7'], [0]);
    const res = generatePanel(p), rep = res.report.panel!;
    return { p, res, plugs: rep.plugs!, placed: new Set(rep.modules.map((m) => m.id)) };
  };
  const key = (r: { module: string; ref: string }) => `${r.module}/${r.ref}`;

  it('every powered cable on the rails has one: from the end that gives to the end that takes, on, in its glow colour', () => {
    const { p, res, plugs, placed } = rig();
    const flowing = p.links!.filter((l) => placed.has(l.a.module) && placed.has(l.b.module) && !['jumper', 'debug', 'uart'].includes(l.kind ?? 'usb'));
    expect([...new Set(flowing.map((l) => l.kind))].sort()).toEqual(['net', 'usb']); // (a PoE lead among the net ones, USB power from the Pi to the hub)
    expect(flowing.length).toBeGreaterThanOrEqual(3);
    for (const l of flowing) {
      const gh = res.ghosts.filter((g) => g.name === `cable ${l.id}` && g.fx?.flow);
      expect(gh, `${l.kind} cable ${l.id} has a flow`).toHaveLength(1);
      const f = gh[0].fx!.flow!, { from, to } = cableFlow(p, l);
      expect(f.on, `${l.kind} cable ${l.id} is on`).toBe(true);
      expect(f.colour).toBe(flowGlow(p, l).colour);
      expect(f.slow).toBe(flowGlow(p, l).slow);
      // it starts at the giving end and finishes at the taking one
      const src = plugs[key(from)], dst = plugs[key(to)];
      expect(dist(f.pts[0], src), `${l.kind} ${l.id} starts at its source`).toBeLessThan(dist(f.pts[0], dst));
      expect(dist(f.pts[f.pts.length - 1], dst), `${l.kind} ${l.id} ends at its load`).toBeLessThan(dist(f.pts[f.pts.length - 1], src));
    }
    // the PoE lead glows as power
    const poe = flowing.find((l) => l.kind === 'net' && flowGlow(p, l).colour === KIND_GLOW.power)!;
    expect(poe).toBeTruthy();
    expect(res.ghosts.find((g) => g.name === `cable ${poe.id}`)!.fx!.flow!.colour).toBe(KIND_GLOW.power);
  }, 120000);

  it('a mains lead from an outlet to a charger has one, running from the outlet to the inlet', () => {
    const p = rack(['rpi4', 'usb_charger', 'pb4']);
    const res = generatePanel(p), plugs = res.report.panel!.plugs!;
    const l = p.links!.find((x) => x.kind === 'mains')!;
    const f = res.ghosts.find((g) => g.name === `cable ${l.id}`)!.fx!.flow!, { from, to } = cableFlow(p, l);
    expect([f.on, f.slow, f.colour]).toEqual([true, true, KIND_GLOW.mains]);
    expect(from.module).toBe(p.modules[2].id); // (the powerboard gives)
    expect(dist(f.pts[0], plugs[key(from)])).toBeLessThan(dist(f.pts[0], plugs[key(to)]));
    expect(dist(f.pts[f.pts.length - 1], plugs[key(to)])).toBeLessThan(dist(f.pts[f.pts.length - 1], plugs[key(from)]));
  }, 120000);

  it("a plug pack's lead runs from the outlet it stands in to the board it feeds, the pulses that way, and the powerboard's lead to the wall brings mains in along its stub", () => {
    const { p, res, plugs } = rig();
    const pi5 = p.modules[2], pack = p.modules[3], plug = plugs[`${pi5.id}/J_PWR`];
    const lead = p.links!.find((l) => l.kind === 'power' && [l.a.module, l.b.module].includes(pi5.id) && [l.a.module, l.b.module].includes(pack.id))!;
    const g = res.ghosts.find((x) => x.name === `cable ${lead.id}`);
    expect(g, 'the Pi 5 has its supply lead drawn, from the pack in the powerboard').toBeTruthy();
    const f = g!.fx!.flow!;
    expect(f, 'and it has a flow').toBeTruthy();
    expect([f.on, f.slow, f.colour]).toEqual([true, true, KIND_GLOW.power]);
    expect(dist(f.pts[f.pts.length - 1], plug)).toBeLessThan(1); // it ends in the plug...
    expect(dist(f.pts[0], plug)).toBeGreaterThan(5); // ...and starts at the pack
    // the powerboard's own lead to the wall brings mains in
    const pb = p.modules[4], wall = res.ghosts.find((x) => x.name.startsWith(`off-rack cable ${pb.id}/`) && x.fx?.flow);
    expect(wall, "the powerboard's lead to the wall has a flow").toBeTruthy();
    expect(wall!.fx!.flow!.colour).toBe(KIND_GLOW.mains);
  }, 120000);
});
