// A preset on Start: a cluster of Raspberry Pis with a switch, a powerboard and their supplies, all connected in one go.
import { useState } from 'react';
import { CLUSTER_MAX, clusterCount, clusterParts, type ClusterPi } from '../model/cluster';
import { TEMPLATES } from '../model/templates';
import { Check, Seg } from './controls';
import { addCluster } from './clusterOps';
import { Icon, I } from './icons';

const name = (id: string) => (TEMPLATES.find((t) => t.id === id)?.name ?? id).replace(/ \(.*$/, '');

export function ClusterPreset() {
  const [count, setCount] = useState(4);
  const [pi, setPi] = useState<ClusterPi>('rpi4');
  const [poe, setPoe] = useState(false);
  const c = clusterParts({ count, pi, poe });
  return (
    <div className="start-cluster">
      <div className="start-cluster-head">
        <span className="sact-ic"><Icon d={I.stack} /></span>
        <div><b>A cluster</b><small>Raspberry Pis with a switch, a powerboard and their supplies, connected in one go.</small></div>
      </div>
      <div className="start-cluster-set">
        <label className="field"><span>Pis</span>
          <input type="number" min={1} max={CLUSTER_MAX} value={count} onChange={(e) => setCount(clusterCount(+e.target.value))} aria-label="How many Raspberry Pis" />
        </label>
        <Seg value={pi} options={[['rpi4', 'Pi 4'], ['rpi5', 'Pi 5']]} onChange={setPi} />
        <Check label="Power them over Ethernet (PoE)" value={poe} onChange={setPoe} hint="A PoE switch and a PoE HAT on each Pi: no supply for them, one cable each" />
      </div>
      <p className="hint" style={{ margin: '6px 0 8px' }}>
        {[`${count} × ${pi === 'rpi5' ? 'Pi 5' : 'Pi 4'}${poe ? ' with a PoE HAT' : ''}`, name(c.switchId), `${c.powerboards.length > 1 ? `${c.powerboards.length} × ` : ''}${name(c.powerboards[0]).toLowerCase()}`, ...(c.supplies.length ? [`${c.supplies.length} × ${pi === 'rpi5' ? '27 W' : '15 W'} USB-C supply`] : []), "the switch's own supply"].join('; ')}. Joins the rack if one is open.
      </p>
      <button className="btn small" onClick={() => addCluster({ count, pi, poe })}><Icon d={I.wand} /> Build the cluster</button>
    </div>
  );
}
