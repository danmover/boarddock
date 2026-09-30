// What the build is doing, once it has taken a couple of seconds: the holder or the step it is on, and how long it has
// been at it. A big rack takes a while; a rack seen before comes from the cache at once and shows nothing.
import { useEffect, useState } from 'react';
import { useApp } from '../state';

export function BuildStatus() {
  const building = useApp((s) => s.building), note = useApp((s) => s.buildNote);
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!building) { setSecs(0); return; }
    const t0 = Date.now(), id = setInterval(() => setSecs(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(id);
  }, [building]);
  if (!building || secs < 2) return null;
  return (
    <div className="buildstatus floating" role="status" aria-live="polite">
      <div className="progress"><div /></div>
      <span>{note ?? 'Building'}… {secs} s</span>
    </div>
  );
}
