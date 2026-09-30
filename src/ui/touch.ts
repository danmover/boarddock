// Wording for the way in. On a phone or tablet there is no click, no hover, no Shift and no wheel: hints say "tap",
// "press and hold" and "pinch" instead.

/** A touch screen is the way in (a phone or tablet). */
export const touchy = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

/** `s` as it should read here: on a touch screen "click" is "tap", "hover" is "press and hold", "double-click" "double-tap". */
export function say(s: string, touch = touchy()): string {
  if (!touch) return s;
  return s
    .replace(/\b(Double-)?click(s|ed)?\b/gi, (m) => {
      const w = /^double/i.test(m) ? 'double-tap' : /s$/i.test(m) ? 'taps' : /ed$/i.test(m) ? 'tapped' : 'tap';
      return m[0] === m[0].toUpperCase() ? w[0].toUpperCase() + w.slice(1) : w;
    })
    .replace(/\bhover(ing)?\b/gi, (m) => (m[0] === 'H' ? 'Press and hold' : 'press and hold'));
}
