// The words on a cable's number badge in the 3D view (kept apart from links.ts so the view needs nothing else).

/**
 * A cable badge's words in the 3D view: what it is and where it goes, "Power → Pi 5" for "Power: Powerboard → Pi 5".
 * The destination goes first because a narrow badge is cut off at its end: two cables from one charger would
 * otherwise both read "Power · USB charger…". The whole label is in the badge's hover text.
 */
export function badgeText(label: string): string {
  const m = /^([^:]+): .+ → (.+)$/.exec(label);
  return m ? `${m[1]} → ${m[2]}` : label.replace(/^([^:]+): /, '$1 · ');
}
