// What the build is doing, in words, for the page to show while it works (a big rack takes a while). The worker sets
// where the words go; the build says each thing it starts. Nothing happens when nobody listens.
let sink: ((s: string) => void) | null = null;

/** Where the words go (null: nowhere). */
export const listenProgress = (f: ((s: string) => void) | null) => { sink = f; };

/** Say what is being built now. */
export const progress = (s: string) => { sink?.(s); };
