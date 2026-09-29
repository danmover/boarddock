// One colour per kind of cable, in the 3D view (the cables, their number badges) and the Wiring view, with the same key.
// The hues follow the Okabe-Ito set (chosen to stay apart for the common kinds of colour blindness), USB near-black and the
// debug ribbon grey as real ones are; each kind also has a line pattern for the flat drawings, so no kind depends on
// colour alone (the number badge and the key say the rest). tests/cablekinds.test.ts checks them under simulated
// red-green and blue-yellow colour blindness.
import type { Link } from './types';

export type CableKind = NonNullable<Link['kind']>;

export const KIND_COLOR: Record<CableKind, string> = {
  usb: '#3a3f47', power: '#d55e00', net: '#0072b2', video: '#a4467f', audio: '#009e73',
  wire: '#e69f00', debug: '#b4bac2', uart: '#56b4e9', jumper: '#f0e442', mains: '#7a4a2b',
};
export const KIND_NAME: Record<CableKind, string> = { usb: 'USB', power: 'power', net: 'Ethernet', video: 'video', audio: 'audio', wire: 'wires', debug: 'debug ribbon', uart: 'USB-serial', jumper: 'jumper wires', mains: 'mains' };
/** SVG stroke-dasharray for the flat drawings: solid for most, patterns for the kinds whose colours sit close together. */
export const KIND_DASH: Record<CableKind, string | undefined> = { usb: undefined, power: undefined, net: undefined, video: undefined, audio: undefined, wire: undefined, debug: '8 3', uart: '6 3 1.5 3', jumper: '1.5 3', mains: '11 4' };
/** The order the key lists them in. */
export const KIND_ORDER: CableKind[] = ['power', 'usb', 'net', 'video', 'audio', 'wire', 'debug', 'uart', 'jumper', 'mains'];
