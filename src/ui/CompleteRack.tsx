// "Complete this rack": what the rack still lacks (a supply for each Pi, outlets, a switch, its uplink), one button to
// put it all on and connect it, in one undo step. Shown on Start and at the top of the Plugs step's To do list.
import { useMemo } from 'react';
import { completeRack } from '../model/complete';
import { useApp } from '../state';
import { completeThisRack } from './linkOps';
import { Icon, I } from './icons';

export function CompleteRack() {
  const p = useApp((s) => s.project);
  const gaps = useMemo(() => (p ? completeRack(p) : []), [p]);
  if (!p || !gaps.length) return null;
  return (
    <div className="completecard">
      <div className="cc-head"><b>Complete this rack</b><button className="btn small primary" onClick={completeThisRack} title="Adds what is missing and connects it: one undo step"><Icon d={I.wand} /> Complete it</button></div>
      <ul>{gaps.map((g, i) => <li key={i}>{g.text}</li>)}</ul>
    </div>
  );
}
