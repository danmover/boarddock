// The Wiring view's layouts: by flow (sources left, what they feed to the right) and as on the rails.
import { describe, it, expect } from 'vitest';
import { TEMPLATES } from '../src/model/templates';
import { newModule, newProject } from '../src/model/library';
import { autoLinks, numberLinks } from '../src/model/links';
import { addAdapters, addProbes, fillWires } from '../src/model/probes';
import { flowLayout, rackLayout } from '../src/model/wirelayout';

const T = (id: string) => TEMPLATES.find((t) => t.id === id)!.make();

describe('wiring layout', () => {
  const p = newProject(T('example_dual_swd'));
  p.modules.push(newModule(T('usb_hub7')));
  addProbes(p, p.modules[0].id);
  addAdapters(p, p.modules[0].id);
  p.links = numberLinks([...(p.links ?? []), ...autoLinks(p)]).map((l) => fillWires(p, l));
  const size = new Map(p.modules.map((m) => [m.id, { w: 200, h: 120 }]));
  const name = (id: string) => p.modules.find((m) => m.id === id)!.board.name.replace(/ \(.*$/, '');

  it('puts the hub first, then the probes and the adapter, then the board they serve, without overlaps', () => {
    const pos = flowLayout(p, size);
    const col = (n: string) => [...pos].filter(([id]) => name(id) === n).map(([, q]) => q[0]);
    const hub = col('Powered USB hub')[0], board = col('Dual-MCU controller')[0];
    expect(hub).toBeLessThan(Math.min(...col('J-Link'), ...col('USB-serial adapter')));
    expect(board).toBeGreaterThan(Math.max(...col('J-Link'), ...col('USB-serial adapter')));
    const boxes = [...pos.values()];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      expect(Math.abs(a[0] - b[0]) >= 200 || Math.abs(a[1] - b[1]) >= 120).toBe(true);
    }
  });

  it('as on the rack: a row per rail in order, the rest after', () => {
    const ids = p.modules.map((m) => m.id);
    const pos = rackLayout(p, [[ids[0], ids[1]]], size);
    expect(pos.get(ids[0])![1]).toBe(pos.get(ids[1])![1]);
    expect(pos.get(ids[1])![0]).toBeGreaterThan(pos.get(ids[0])![0]);
    expect(Math.min(...ids.slice(2).map((id) => pos.get(id)![1]))).toBeGreaterThan(pos.get(ids[0])![1]);
  });
});
