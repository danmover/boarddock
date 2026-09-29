// Reference data: connectors and their mating plugs, package size heuristics, materials, printers, defaults.
// Dimensions are typical catalogue values; every one is editable in the app because real parts vary.
import { PRINTERS_DB, printerByName } from './printers';
import { applyHoleRoles } from './holes';
import { DEBUG_HINT, isDebugPort, isUartPort, numberLinks } from './links';
import type { ArrangeSettings, Board, Comp, CompKind, ConnSetup, HolderSettings, Material, Module, MountSettings, PanelSettings, PlugSpec, PrinterSettings, Project, StandSettings } from './types';

export interface ConnType {
  id: string;
  name: string;
  entry: 'edge' | 'top';
  body: { w: number; l: number; h: number }; // receptacle: w across the mouth, l along the insertion axis, h above board
  zc: number; // plug axis above the board surface
  overhang: number; // typical overhang of the receptacle past the board edge
  plug: PlugSpec;
  match: RegExp;
  /** Words that name this connector but could also name a chip or a diode: they count only on a connector's reference (J1, CN2, HDMI1). */
  weak?: RegExp;
  cradle: boolean; // sensible default
  note?: string;
}

// Order matters: first match wins, so specific names come before generic ones. Besides the names in footprints
// (KiCad's, and the usual ones in other tools) each type knows the common makers' part numbers, as a footprint or a
// value is often only that: Molex 105017 (micro-USB), Bel A829-1A1T (RJ45), CUI PJ-102AH (DC jack) and so on.
export const CONNECTORS: ConnType[] = [
  { id: 'usb_c', name: 'USB-C', entry: 'edge', body: { w: 8.94, l: 7.35, h: 3.26 }, zc: 1.63, overhang: 0.6, plug: { w: 12.4, h: 6.6, len: 22, cable: 4 }, match: /usb[\s_-]?c\b|type[\s_-]?c|usb_?c_|usbc|gct_usb4|\busb4[01]\d\d(?!\d)|\b1240[12]\d{3}|\bgsb1c|12401598|124019772|1240201\d|217175|105450|216990|\bcx90|\bdx07s|63272[123]\d{6}|\bu262-|\buj31|\bujc-|2012670005|2295018/i, cradle: true },
  { id: 'usb_micro_b', name: 'USB Micro-B', entry: 'edge', body: { w: 7.5, l: 5.3, h: 2.8 }, zc: 1.4, overhang: 0.6, plug: { w: 11, h: 7.5, len: 20, cable: 3.5 }, match: /micro[\s_-]?usb|usb[\s_-]?micro|microusb|micro[\s_-]?a?b\b|micro[\s_-]?b[\s_-]|\bu-?usb|µusb|105017|105133|1051330|47346|47589|10118192|10118193|10118194|10103594|\bzx62|\bdx4r|629105|614105|uj2-mbh|usb313\d|\bu254-|micro[\s_-]?5p/i, cradle: true },
  { id: 'usb_mini_b', name: 'USB Mini-B', entry: 'edge', body: { w: 7.7, l: 9.2, h: 3.9 }, zc: 2.0, overhang: 0.8, plug: { w: 12, h: 8, len: 22, cable: 4 }, match: /mini[\s_-]?usb|usb[\s_-]?mini|mini[\s_-]?b\b|mini[\s_-]?b[\s_-]|67503|54819|\bux60|65100516|uj2-mibh|1734035/i, cradle: true },
  { id: 'usb_a_dual', name: 'USB-A (stacked x2)', entry: 'edge', body: { w: 13.1, l: 17.5, h: 15.6 }, zc: 7.8, overhang: 2.5, plug: { w: 16, h: 17, len: 32, cable: 4.5 }, match: /usb[\s_-]?(3(\.\d)?[\s_-]?)?a.*(dual|stack|x2|2x)|dual.*usb|67298|\buj2-a2|\buj3-a2/i, cradle: false },
  { id: 'usb_a', name: 'USB-A', entry: 'edge', body: { w: 13.1, l: 14, h: 7 }, zc: 3.5, overhang: 1.5, plug: { w: 16, h: 8.5, len: 32, cable: 4.5 }, match: /usb[\s_-]?a\b|usb_a|usb[\s_-]?3(\.\d)?[\s_-]?a\b|(?<!hdmi[\s_-]?)type[\s_-]?a\b|48037|67643|292303|87520|87583|uj2-adh|\buj3-a|usb-a1|kusbx-a|614004\d{6}\b|1734028|ue27ac/i, cradle: true },
  { id: 'usb_b', name: 'USB-B', entry: 'edge', body: { w: 12, l: 16.3, h: 10.9 }, zc: 5.5, overhang: 6.3, plug: { w: 16, h: 13, len: 32, cable: 5 }, match: /usb[\s_-]?b\b|usb_b|usb[\s_-]?3(\.\d)?[\s_-]?b\b|67068|292304|61400416|uj2-bh|usb-b1|kusbx-b|5787834/i, cradle: true },
  { id: 'dp', name: 'DisplayPort', entry: 'edge', body: { w: 18.6, l: 16, h: 5.2 }, zc: 2.6, overhang: 0.5, plug: { w: 20.5, h: 9, len: 38, cable: 6 }, match: /\bdp[\s_-]?(receptacle|conn|jack|socket|port)\b|47272/i, weak: /display[\s_-]?port/i, cradle: true },
  { id: 'hdmi_micro', name: 'Micro HDMI (D)', entry: 'edge', body: { w: 6.5, l: 7, h: 3 }, zc: 1.5, overhang: 0.5, plug: { w: 11, h: 7, len: 26, cable: 5 }, match: /micro[\s_-]?hdmi|hdmi[\s_-]?micro|hdmi[\s_-]?d\b|46765/i, cradle: true },
  { id: 'hdmi_mini', name: 'Mini HDMI (C)', entry: 'edge', body: { w: 11.2, l: 7.5, h: 3.2 }, zc: 1.6, overhang: 0.5, plug: { w: 15, h: 8, len: 30, cable: 6 }, match: /mini[\s_-]?hdmi|hdmi[\s_-]?mini|hdmi[\s_-]?c\b|47291|2051333/i, cradle: true },
  { id: 'hdmi_a', name: 'HDMI (A)', entry: 'edge', body: { w: 15, l: 11, h: 5.6 }, zc: 2.8, overhang: 0.5, plug: { w: 21, h: 11, len: 38, cable: 7 }, match: /hdmi[\s_-]?(type[\s_-]?)?a\b|hdmi[\s_-]?(conn|receptacle|jack|socket|19)|47151|208658|2007435|10029449|685119/i, weak: /hdmi/i, cradle: true },
  { id: 'rj45', name: 'RJ45 / Ethernet', entry: 'edge', body: { w: 16, l: 21, h: 13.5 }, zc: 6.8, overhang: 2.5, plug: { w: 14, h: 13, len: 30, cable: 6 }, match: /rj[\s_-]?45|8p8c|magjack|\bhr9[01]\d|\bhy911|\blpj\d|rjhse|\brjmg|\brje\d|\barjm|\bjxd\d|\bj00\d\d[a-z]|\bj1011|\bjk0\d|7499\d{3}|615008|08b0-|0826-1|\b[al]8\d\d-?1[a-z0-9]1t|\bsi-\d{5}|\brb1-|\b5406\d{3}|\bhfj\d\d|\btrj[a-z]?\d{3}|\bss-?[67]\d{3}/i, weak: /ethernet|lan[\s_-]?(jack|conn)/i, cradle: false, note: 'The plug latch holds it; add a cable tie anchor for strain relief.' },
  { id: 'rj11', name: 'RJ11 / RJ12 (phone, 6-way)', entry: 'edge', body: { w: 13.5, l: 15.5, h: 11.5 }, zc: 5.8, overhang: 2, plug: { w: 10, h: 9, len: 25, cable: 4 }, match: /rj[\s_-]?1[124]\b|rj[\s_-]?25\b|6p[246]c|4p4c|rj[\s_-]?9\b|95501|\b5520\d{3}/i, cradle: false, note: 'The plug latch holds it; add a cable tie anchor for strain relief.' },
  { id: 'dsub', name: 'D-sub (DE-9, DA-15, DB-25)', entry: 'edge', body: { w: 30.8, l: 12.5, h: 12.6 }, zc: 6.3, overhang: 1, plug: { w: 31, h: 16, len: 45, cable: 6 }, match: /d[\s_-]?sub|dsub|\bsub[\s_-]?d(?![a-z])|\bd[be][\s_-]?9\b|\bd[ae][\s_-]?15\b|\bdb[\s_-]?(15|25)(?!\d)|\bhd[\s_-]?15\b|\bdc[\s_-]?37\b|574578[01]|5747840|\b182-00\d|\b17[12]-[a-z]\d\d|\bl77sde|\bl717sd/i, weak: /rs[\s_-]?232/i, cradle: false, note: "The plug's own jackscrews hold it: no cap, add a tie anchor." },
  // recognised by name only (they are not in the toolbox): sizes are typical ones, and every one is editable
  // (w: Molex 67800-8005 is 16.9 long, KiCad Connector_SATA_SAS: SATA_Amphenol_10029364-001LF's data block is 14 to 16 wide; l and h: its 3D model 9.4 x 5.4)
  { id: 'sata', name: 'SATA (data)', entry: 'edge', body: { w: 16.9, l: 9, h: 6 }, zc: 3, overhang: 0, plug: { w: 14, h: 7, len: 25, cable: 5 }, match: /\be?sata\b|sata[\s_-]|serial[\s_-]?ata|\b67800|\b6749[01]/i, cradle: false, note: 'Its plug latches in: add a tie anchor for the cable.' },
  // (l: KiCad Connector: Connector_SFP_and_Cage, TE 2227302, 48.7 long and 14.5 wide)
  { id: 'sfp', name: 'SFP / SFP+ cage', entry: 'edge', body: { w: 14, l: 48.7, h: 8.95 }, zc: 4.5, overhang: 0, plug: { w: 13.4, h: 8.5, len: 35, cable: 6 }, match: /\b[qx]?sfp(?![a-z])/i, cradle: false, note: 'The module latches in: add a tie anchor for its cable.' },
  { id: 'minidin', name: 'Mini-DIN / DIN (PS/2, S-Video, MIDI)', entry: 'edge', body: { w: 13.5, l: 14, h: 13 }, zc: 6.5, overhang: 1, plug: { w: 14, h: 14, len: 30, cable: 5 }, match: /mini[\s_-]?din|\bps[\s_-]?\/?2\b|\bdin[\s_-]?[3-9]\b|\bs[\s_-]?video/i, cradle: false },
  { id: 'xt60', name: 'XT60 (battery, high current)', entry: 'edge', body: { w: 15.8, l: 16, h: 8.3 }, zc: 4.15, overhang: 0, plug: { w: 16, h: 8.5, len: 24, cable: 5 }, match: /xt[\s_-]?60|xt[\s_-]?90/i, cradle: false, note: 'Its plug is a tight push fit: add a tie anchor for its leads.' },
  { id: 'xt30', name: 'XT30 (battery)', entry: 'edge', body: { w: 10.2, l: 11, h: 5.3 }, zc: 2.65, overhang: 0, plug: { w: 10.5, h: 5.6, len: 18, cable: 3.5 }, match: /xt[\s_-]?30/i, cradle: false, note: 'Its plug is a tight push fit: add a tie anchor for its leads.' },
  { id: 'barrel', name: 'DC barrel jack 5.5/2.1', entry: 'edge', body: { w: 9, l: 14, h: 11 }, zc: 6.5, overhang: 1.5, plug: { w: 10, h: 10, len: 32, cable: 3.5 }, match: /barrel|dc[\s_-]?jack|jack[\s_-]?dc|\bpj[\s_-]?[0-2]\d\d|\bpjm?-0\d\d|dc[\s_-]?0\d\d|power[\s_-]?jack|bar(rel)?_?jack|rapc7\d\d|\bkldx|\bkld[a-z]{1,3}[\s_-]?\d|\bdcj\d|\b54-00\d{3}|694106|\bdc[\s_-]?(in|power)[\s_-]?(jack|socket)|\bpj\d[\s_-]?[0-2]\d\d|\bpwr[\s_-]?jack|\bej508|\bdc[\s_-]?(pwr|power|socket)\b/i, cradle: true },
  { id: 'rca', name: 'RCA / phono jack', entry: 'edge', body: { w: 10, l: 13, h: 12.5 }, zc: 7, overhang: 3, plug: { w: 11, h: 11, len: 28, cable: 5 }, match: /\brca\b|rca[\s_-]|phono|cinch|\brcj-?\d/i, cradle: true },
  // (l: KiCad Connector_Audio: Jack_3.5mm_PJ31060-I_Horizontal 6.2 x 14, Jack_3.5mm_PJ320D_Horizontal 5.8 x 13.8)
  { id: 'audio35', name: '3.5 mm audio jack', entry: 'edge', body: { w: 6, l: 14, h: 5 }, zc: 2.5, overhang: 1.0, plug: { w: 8.5, h: 8.5, len: 25, cable: 3.5 }, match: /\bpj[\s_-]?3\d\d|phone[\s_-]?jack|audio[\s_-]?jack|\bsj1?-\d{3,4}|\bsj-43|\bfc68\d|\bstx-?35|35rapc/i, weak: /3\.5\s?mm|audio|\btrs\b|headphone/i, cradle: true },
  { id: 'microsd', name: 'microSD slot', entry: 'edge', body: { w: 11.5, l: 14, h: 1.9 }, zc: 0.9, overhang: 0, plug: { w: 14, h: 6, len: 8, cable: 0 }, match: /micro[\s_-]?sd|tf[\s_-]?card|microsd|\bdm3[a-d]|104031|503182|47219|472192|\bmem20[3-6]\d|\btf-(push|01)/i, cradle: false, note: 'Opening sized for card access and a fingertip, no cradle.' },
  { id: 'sd', name: 'SD card slot', entry: 'edge', body: { w: 28, l: 29, h: 3 }, zc: 1.5, overhang: 0, plug: { w: 24, h: 2.1, len: 10, cable: 0 }, match: /\bsd[\s_-]?(card|slot|socket|conn)|sdcard|\bsd_(kyocera|te|molex)|2041021|67840/i, cradle: false, note: 'Opening sized for card access and a fingertip, no cradle.' },
  // (KiCad Connector_Coaxial: BNC_Amphenol_B6252HB-NPP3G-50_Horizontal, footprint 14.7 x 35.5 and its 3D model 19.4 high with the axis 12.2 up; 031-6575 is 14.4 x 36.2)
  { id: 'bnc', name: 'BNC', entry: 'edge', body: { w: 14.7, l: 35.5, h: 19.4 }, zc: 12.2, overhang: 11, plug: { w: 14.5, h: 14.5, len: 32, cable: 5 }, match: /\bbnc|031-5431|\b5227161/i, cradle: false, note: 'Its bayonet holds the plug: no cap.' },
  { id: 'ufl', name: 'u.FL / IPEX (antenna lead)', entry: 'top', body: { w: 3, l: 3, h: 1.25 }, zc: 0, overhang: 0, plug: { w: 2.2, h: 2.2, len: 2.2, cable: 1.2 }, match: /\bu\.?fl\b|u\.fl|\bw\.fl|\bx\.fl|ipex|\bmhf\d?\b|\bi-pex|\bu-fl/i, cradle: false, note: 'A thin lead snaps onto it from above, off to an antenna: leave room over it.' },
  // (KiCad Connector_Coaxial: SMA_Amphenol_132289_EdgeMount 15.88 x 10.16, SMA_Molex_73251-1153_EdgeMount_Horizontal 16.29 x 9.52; its 3D model 15.1 x 11.3 x 10.8)
  { id: 'sma', name: 'SMA / RP-SMA (edge)', entry: 'edge', body: { w: 10.16, l: 15.88, h: 10.16 }, zc: 0, overhang: 7, plug: { w: 9, h: 9, len: 16, cable: 3 }, match: /rp[\s_-]?sma|132134|132289|\b1321\d\d|901-144|consma|\bsma-j|73251|73386/i, weak: /\bsma\b|sma_/i, cradle: false },
  { id: 'rf_mini', name: 'MMCX / MCX / SMB (small coax)', entry: 'edge', body: { w: 6, l: 8, h: 5.5 }, zc: 2.75, overhang: 0, plug: { w: 7, h: 7, len: 14, cable: 2.5 }, match: /\bmmcx|73386-|\b1[0-9]{2}-?mmcx/i, weak: /\bmcx\b|\bsmb(?![a-z])|smb_/i, cradle: false, note: 'Its lead snaps on: add a tie anchor.' },
  { id: 'fpc', name: 'FFC / FPC flat cable (latching)', entry: 'edge', body: { w: 21, l: 5.5, h: 2.5 }, zc: 1.2, overhang: 0, plug: { w: 16, h: 0.6, len: 12, cable: 0.6 }, match: /\bfpc|\bffc|\bzif\b|\bfh(12|19|26|28|29|33|34|35|41|52)|\bxf2[a-z]|52559|52610|503480|54548|84952|84953|\bafc\d\d|\bcsi[\s_-]?(conn|camera)|camera[\s_-]?conn|display[\s_-]?conn/i, cradle: false, note: 'Its latch holds the flat cable: no cap.' },
  { id: 'qwiic', name: 'JST-SH / Qwiic (side)', entry: 'edge', body: { w: 6, l: 4.3, h: 2.9 }, zc: 1.5, overhang: 0, plug: { w: 6.5, h: 3.5, len: 6, cable: 3 }, match: /qwiic|stemma|jst[\s_-]?sh|sm0\dB-SRSS|bm0\dB-SRSS/i, cradle: false },
  { id: 'terminal', name: 'Screw terminal block', entry: 'edge', body: { w: 10.2, l: 7.5, h: 10 }, zc: 3, overhang: 0, plug: { w: 10, h: 4, len: 15, cable: 2 }, match: /terminal[\s_-]?block|screw[\s_-]?terminal|terminalblock|kf301|kf128|kf350|kf2edg|mstb|mkds|\bmc[\s_-]?1,5|wago|phoenix|\bdg30\d|\bdg128|\bxy128|\bwj\d{3}|\bost[tv]|691\d{9}|1935\d{3}|1729\d{3}|282834|282836|1776275|\btb00\d|\bmc00\d{4}\b|\bterm[\s_-]?bl(oc)?k|\btblock|conn[\s_-]?term|\bbl[zp]{0,2}[\s_-]?[35]\.\d{1,2}|\bsl[\s_-]?(3\.5|5\.08|3\.81)|\bptsm|\bptr[\s_-]?ak|\bak[\s_-]?[359]\d\d\b|\bctb\d|\bdg[\s_-]?3\d\d|\bdb127/i, weak: /\btb[\s_-]?\d|\bterm[\s_-]?\d|(?:^|\s)(17|18|19)\d{5}(?:\s|$)/i, cradle: false, note: 'Wires only: add a tie anchor.' },
  // wire-to-board sockets whose plug goes in from the side (right-angle ones: "S2B-PH", "SM04B-GHS", Molex 53048,
  // DuraClik 502352), ahead of the upright ones of the same families
  { id: 'wtb_side', name: 'Wire-to-board, side entry (JST, Molex)', entry: 'edge', body: { w: 8, l: 6, h: 6 }, zc: 3, overhang: 0, plug: { w: 8, h: 4.5, len: 10, cable: 1.6 }, match: /\bS\d{1,2}B-(PH|XH|ZR|EH|GH|VH|PA|PUD)|\bSM\d\dB-(GHS|ZESS|PASS|ZR)|(jst|molex|picoblade|pico[\s_-]?clasp|clik[\s_-]?mate|duraclik|micro[\s_-]?fit|mini[\s_-]?fit|\bkk).*(horizontal|right[\s_-]?angle)|53048|53261|502352|502386|502494|\b5569\b|39-?30-?\d|39301|22-?05-?[37]/i, cradle: false, note: 'Its plug latches in: add a tie anchor for its wires.' },
  { id: 'microfit', name: 'Molex Micro-Fit 3.0 (top entry)', entry: 'top', body: { w: 9.6, l: 9.8, h: 9.4 }, zc: 0, overhang: 0, plug: { w: 9.6, h: 10, len: 14, cable: 3 }, match: /micro[\s_-]?fit|nano[\s_-]?fit|43045|43650|43025|43020|105309|105310/i, cradle: false },
  { id: 'minifit', name: 'Molex Mini-Fit Jr (top entry, ATX)', entry: 'top', body: { w: 10.6, l: 10.4, h: 13 }, zc: 0, overhang: 0, plug: { w: 10.6, h: 10, len: 16, cable: 3.6 }, match: /mini[\s_-]?fit|mega[\s_-]?fit|ultra[\s_-]?fit|76829|\b5566\b|39-?2[89]-?\d|39281|39291|atx[\s_-]?(24|20|power)|eps[\s_-]?12v/i, cradle: false },
  { id: 'jst_gh', name: 'JST-GH (top entry, 1.25 mm)', entry: 'top', body: { w: 6.75, l: 4.25, h: 4.25 }, zc: 0, overhang: 0, plug: { w: 6.75, h: 4.25, len: 6, cable: 1.4 }, match: /jst[\s_-]?gh|bm\d\dB-GHS|\bB\dB-GH|\bgh[\s_-]?1\.25/i, cradle: false },
  { id: 'jst_zh', name: 'JST-ZH (top entry, 1.5 mm)', entry: 'top', body: { w: 7.5, l: 3.5, h: 6.5 }, zc: 0, overhang: 0, plug: { w: 7.5, h: 3.5, len: 8, cable: 1.4 }, match: /jst[\s_-]?zh|\bB\d{1,2}B-ZR|\bzh[\s_-]?1\.5/i, cradle: false },
  { id: 'picoblade', name: 'Molex PicoBlade (top entry, 1.25 mm)', entry: 'top', body: { w: 6.95, l: 3.5, h: 5.4 }, zc: 0, overhang: 0, plug: { w: 6.9, h: 3.2, len: 7, cable: 1.2 }, match: /pico[\s_-]?blade|pico[\s_-]?ezmate|7817[12]|\bdf1[34][a-z]?-\d|53047|53398|clik[\s_-]?mate|502382|pico[\s_-]?clasp|501331|501568|501571/i, cradle: false },
  { id: 'kk254', name: 'Molex KK / fan header (2.54 mm)', entry: 'top', body: { w: 10.2, l: 5.8, h: 9 }, zc: 0, overhang: 0, plug: { w: 10, h: 5, len: 13, cable: 1.6 }, match: /\bkk[\s_-]?(254|100|396|156)?\b|22-?27-?2\d|22-?23-?2\d|\b6410\b|\b7395\b|fan[\s_-]?(header|conn|[34]p)|\b171856|\b640456|\bb\d{1,2}p-vh|26-?(48|60)-?\d{4}/i, cradle: false },
  { id: 'jst_xh', name: 'JST-XH (top entry)', entry: 'top', body: { w: 9.9, l: 5.75, h: 7 }, zc: 0, overhang: 0, plug: { w: 9.9, h: 5.75, len: 12, cable: 2 }, match: /jst[\s_-]?xh|b\dB-XH|b\d{1,2}b-eh|\bdf1b?-\d|\bxh[\s_-]?\d|\bxh[\s_-]?2\.5/i, cradle: false },
  { id: 'jst_ph', name: 'JST-PH (top entry)', entry: 'top', body: { w: 7.9, l: 4.5, h: 6 }, zc: 0, overhang: 0, plug: { w: 7.9, h: 4.5, len: 10, cable: 2 }, match: /jst[\s_-]?ph|b\dB-PH|\bdf(3|11)[a-z]?-\d|\bph[\s_-]?\d|\bph[\s_-]?2\.0/i, cradle: false },
  // box headers for a ribbon (an IDC socket pushes in): CNC Tech 3020-10-0100 upright, 3020-10-0200 right-angle
  // (l: KiCad Connector_IDC: IDC-Header_2x05_P2.54mm_Horizontal is 13.6 deep)
  { id: 'idc_ra', name: 'Box header, right-angle (IDC ribbon)', entry: 'edge', body: { w: 20.3, l: 13.6, h: 8.9 }, zc: 4.45, overhang: 0, plug: { w: 18.3, h: 7.6, len: 9, cable: 1.2 }, match: /\b3020-?\d\d-?02|(box[\s_-]?header|idc[\s_-]?(header|box)|shrouded).*(horizontal|right[\s_-]?angle|\br\/?a\b)|\b6120\d\d23621/i, cradle: false, note: 'The ribbon socket latches in: add a tie anchor for the ribbon.' },
  { id: 'idc', name: 'Box header (IDC ribbon, 2.54 mm)', entry: 'top', body: { w: 20.3, l: 8.9, h: 9 }, zc: 0, overhang: 0, plug: { w: 18.3, h: 7.6, len: 6.5, cable: 1.2 }, match: /box[\s_-]?header|idc[\s_-]?(header|box)|\bidc[\s_-]?\d|shrouded|\b3020-?\d\d-?0[13]|\bds1013|\bbh[\s_-]?\d\d\b|\b6120\d\d21621|\bn25\d\d-\d{4}|\b75869-|\b5103308|\b302-s\d/i, cradle: false },
  // debug connectors: a probe (J-Link, ST-Link) plugs in from above with an IDC socket on a ribbon
  { id: 'swd10', name: 'Debug 10-pin (Cortex, 1.27 mm)', entry: 'top', body: { w: 12.7, l: 5.8, h: 5.6 }, zc: 0, overhang: 0, plug: { w: 12.4, h: 5.4, len: 5.5, cable: 1 }, match: /$^/, cradle: false, note: 'A J-Link plugs in with its 10-pin ribbon (the 20-to-10-pin adapter on a 20-pin J-Link).' },
  { id: 'cortex20', name: 'Debug 20-pin (Cortex + trace, 1.27 mm)', entry: 'top', body: { w: 17.8, l: 5.8, h: 5.6 }, zc: 0, overhang: 0, plug: { w: 17.5, h: 5.4, len: 5.5, cable: 1 }, match: /$^/, cradle: false, note: "A J-Link plugs in with a 20-pin 1.27 mm ribbon (the J-Link 19-pin Cortex-M adapter on a 20-pin J-Link)." },
  { id: 'jtag20', name: 'Debug 20-pin (JTAG, 2.54 mm)', entry: 'top', body: { w: 33.2, l: 8.9, h: 9 }, zc: 0, overhang: 0, plug: { w: 31, h: 7.6, len: 6.5, cable: 1.2 }, match: /$^/, cradle: false, note: "A J-Link's own 20-pin ribbon plugs straight in." },
  { id: 'tagconnect', name: 'Tag-Connect pads', entry: 'top', body: { w: 10, l: 5, h: 0.1 }, zc: 0, overhang: 0, plug: { w: 10, h: 5, len: 22, cable: 1 }, match: /$^/, cradle: false, note: 'Pads only: the Tag-Connect cable clips onto the board from above.' },
  { id: 'header', name: 'Pin header (Dupont)', entry: 'top', body: { w: 10.2, l: 2.54, h: 8.5 }, zc: 0, overhang: 0, plug: { w: 10.2, h: 2.54, len: 14, cable: 1.5 }, match: /pin[\s_-]?header|pin[\s_-]?socket|conn_\d+x\d+|header_\d|^[12]x\d\d\b|pinhd|\bhdr[\s_-]?\d/i, cradle: false },
  { id: 'pins_ra', name: 'Pin header, right-angle (Dupont)', entry: 'edge', body: { w: 15.24, l: 2.5, h: 2.5 }, zc: 1.27, overhang: 0, plug: { w: 15.2, h: 2.5, len: 14, cable: 1.4 }, match: /$^/, cradle: false, note: 'Jumper wires push onto its pins one by one.' },
  { id: 'ac_au', name: 'Mains outlet, AU/NZ', entry: 'top', body: { w: 36, l: 36, h: 0.5 }, zc: 0, overhang: 0, plug: { w: 34, h: 26, len: 24, cable: 7.5 }, match: /$^/, cradle: false },
  { id: 'ac_uk', name: 'Mains outlet, UK', entry: 'top', body: { w: 42, l: 42, h: 0.5 }, zc: 0, overhang: 0, plug: { w: 44, h: 30, len: 26, cable: 7.5 }, match: /$^/, cradle: false },
  { id: 'ac_us', name: 'Mains outlet, US', entry: 'top', body: { w: 36, l: 36, h: 0.5 }, zc: 0, overhang: 0, plug: { w: 32, h: 24, len: 22, cable: 7 }, match: /$^/, cradle: false },
  { id: 'ac_eu', name: 'Mains outlet, EU (Schuko)', entry: 'top', body: { w: 44, l: 44, h: 0.5 }, zc: 0, overhang: 0, plug: { w: 38, h: 38, len: 26, cable: 8 }, match: /$^/, cradle: false },
  { id: 'mains_lead', name: 'Mains lead (fixed)', entry: 'edge', body: { w: 10, l: 10, h: 10 }, zc: 0, overhang: 0, plug: { w: 12, h: 12, len: 22, cable: 7.5 }, match: /$^/, cradle: false },
  { id: 'iec_c14', name: 'Mains inlet (IEC C14)', entry: 'edge', body: { w: 26.5, l: 24, h: 19.8 }, zc: 9.9, overhang: 0, plug: { w: 27, h: 20, len: 40, cable: 8 }, match: /iec[\s_-]?(60320[\s_-]?)?c?[\s_-]?(14|13|16|18|20)\b|\bc14\b|appliance[\s_-]?inlet|iec[\s_-]?(inlet|socket)/i, cradle: false, note: 'The lead is held by friction: add a tie anchor for it.' },
  { id: 'iec_c7', name: 'Mains (figure-8, C7)', entry: 'edge', body: { w: 11.5, l: 12, h: 8 }, zc: 4, overhang: 0, plug: { w: 13, h: 9, len: 30, cable: 6 }, match: /iec[\s_-]?60320|figure[\s_-]?8/i, cradle: false },
  // recognised by name only (not in the toolbox): typical sizes, every one editable. What plugs into these is a lead, a card or a board.
  // (KiCad Connector_Audio: Jack_XLR_Neutrik_NC3FAH_Horizontal 25.3 x 22.2, and the maker's 25 high)
  { id: 'xlr', name: 'XLR (3-pin audio)', entry: 'edge', body: { w: 25.3, l: 22.2, h: 25 }, zc: 12.5, overhang: 2, plug: { w: 26, h: 26, len: 50, cable: 8 }, match: /\bxlr|\bnc[35][mf][a-z]{1,3}\b|neutrik/i, cradle: false, note: 'Its latch holds the plug: add a tie anchor for the cable.' },
  // (KiCad Connector: Banana_Cliff_FCR7350B_S16N-PC_Horizontal, footprint 12 x 33 and its 3D model 12.3 high; CalTest_CT3151 right-angle jack is 13.5 x 27.7)
  { id: 'banana', name: '4 mm banana jack / binding post', entry: 'edge', body: { w: 12, l: 33, h: 12.3 }, zc: 6.15, overhang: 2, plug: { w: 12, h: 12, len: 28, cable: 4 }, match: /banana|binding[\s_-]?post|test[\s_-]?jack/i, cradle: false, note: 'Its lead is a pair of 4 mm banana plugs: add a tie anchor.' },
  { id: 'm12', name: 'M12 / M8 circular (sensor)', entry: 'edge', body: { w: 16, l: 20, h: 16 }, zc: 8, overhang: 2, plug: { w: 18, h: 18, len: 35, cable: 6 }, match: /\bm12[\s_-]?(conn|sensor|circular|[458][\s_-]?p|[abd][\s_-]?cod)|\bm8[\s_-]?(conn|sensor|circular|[34][\s_-]?p)|circular[\s_-]?conn/i, cradle: false, note: 'Its knurled nut holds the plug: no cap, add a tie anchor.' },
  // (KiCad OptoDevice: Toshiba_TORX170_TORX173_TORX193_TORX194, 13.0 x 15.55)
  { id: 'toslink', name: 'TOSLINK (optical audio)', entry: 'edge', body: { w: 13, l: 15.5, h: 12 }, zc: 6, overhang: 0, plug: { w: 12, h: 12, len: 22, cable: 4 }, match: /toslink|\btorx|\btotx|\bjis[\s_-]?f05/i, cradle: false },
  // (KiCad Connector_Card: microSIM_JAE_SF53S006VCBR2000 12.9 x 15.45; nanoSIM_GCT_SIM8060-6-0-14-00 11.7 x 14)
  { id: 'sim', name: 'SIM card slot', entry: 'edge', body: { w: 12.9, l: 15.5, h: 2 }, zc: 1, overhang: 0, plug: { w: 13, h: 6, len: 8, cable: 0 }, match: /(nano|micro|mini)[\s_-]?sim|sim[\s_-]?(card|slot|holder|socket|tray|conn)/i, weak: /\bsim\b/i, cradle: false, note: 'Opening sized for card access and a fingertip, no cradle.' },
  // (a card in these lies over the board or stands up from it: only the socket is drawn, so keep clear of the card yourself)
  // (l: KiCad Connector_Samtec LSHM 4.98, Connector_Molex SlimStack 52991 5.1, Connector_Hirose DF12 4.35 to 4.55; h: Samtec QSH socket 3.25 above the board, mated 5)
  { id: 'b2b', name: 'Board-to-board (mezzanine)', entry: 'top', body: { w: 20, l: 5, h: 3.25 }, zc: 0, overhang: 0, plug: { w: 20, h: 6, len: 3, cable: 0 }, match: /\b(qs[he]|qt[he]|qms|qfs|seam|seaf|erm[58]|erf[58]|bs[he]|bt[he]|lshm)-?\d{2,3}|\bdf(12|17|37|40)[a-z]?[\s(_-]|slim[\s_-]?stack|mezzanine|board[\s_-]?to[\s_-]?board/i, cradle: false, note: 'Another board mates on it: no cable goes here (put the two in a stack).' },
  { id: 'm2', name: 'M.2 / mini PCIe card socket', entry: 'top', body: { w: 22, l: 5, h: 4 }, zc: 0, overhang: 0, plug: { w: 22, h: 3.5, len: 3, cable: 0 }, match: /\bm\.?2[\s_-]?(key|socket|conn|slot|card)|\bngff\b|mini[\s_-]?pci[\s_-]?e|\bmpcie/i, weak: /\bm\.2\b/i, cradle: false, note: 'The card lies over the board: keep clear of it.' },
  { id: 'pcie', name: 'PCIe slot', entry: 'top', body: { w: 89, l: 7.5, h: 11 }, zc: 0, overhang: 0, plug: { w: 89, h: 2, len: 3, cable: 0 }, match: /pci[\s_-]?e(xpress)?[\s_-]?x(1|4|8|16)(?!\d)|pcie[\s_-]?(slot|socket|conn|edge)|pci[\s_-]?express[\s_-]?(slot|socket|conn)/i, cradle: false, note: 'The card stands up from the board: keep clear of it.' },
  { id: 'dimm', name: 'DIMM / SO-DIMM socket', entry: 'top', body: { w: 137, l: 9.5, h: 10 }, zc: 0, overhang: 0, plug: { w: 137, h: 2, len: 3, cable: 0 }, match: /sodimm|so[\s_-]dimm|dimm[\s_-]?(socket|slot|conn)|ddr[2-5][\s_-]?dimm/i, weak: /(?:^|[^a-z])dimm(?![a-z])/i, cradle: false, note: 'The module stands up or lies over the board: keep clear of it.' },
  { id: 'pogo', name: 'Spring-pin (pogo) pads', entry: 'top', body: { w: 10, l: 2.5, h: 0.1 }, zc: 0, overhang: 0, plug: { w: 10, h: 2.5, len: 5, cable: 0 }, match: /pogo/i, cradle: false, note: 'Pads only: a test fixture presses spring pins onto them.' },
  { id: 'custom', name: 'Custom connector', entry: 'edge', body: { w: 10, l: 8, h: 5 }, zc: 2.5, overhang: 0.5, plug: { w: 12, h: 8, len: 20, cable: 4 }, match: /$^/, cradle: true },
];

export const connById = (id: string) => CONNECTORS.find((c) => c.id === id) ?? CONNECTORS[CONNECTORS.length - 1];

export function connSetup(type: ConnType, angle: number): ConnSetup {
  return {
    type: type.id,
    entry: type.entry,
    angle,
    zc: type.zc,
    plug: { ...type.plug },
    cradle: type.cradle,
    cap: type.cradle,
    guard: !type.cradle && type.entry === 'edge',
    tie: !type.cradle || type.entry === 'top',
  };
}

// ---- package size heuristics (footprint / package name -> body size) ----
const CHIP: Record<string, [number, number, number]> = {
  '01005': [0.4, 0.2, 0.15], '0201': [0.6, 0.3, 0.3], '0402': [1.0, 0.5, 0.4], '0603': [1.6, 0.8, 0.5], '0805': [2.0, 1.25, 0.6],
  '1206': [3.2, 1.6, 0.7], '1210': [3.2, 2.5, 0.7], '1812': [4.5, 3.2, 1.0], '2010': [5.0, 2.5, 0.7], '2512': [6.4, 3.2, 0.7],
};

export interface PkgGuess { w: number; l: number; h: number; kind?: CompKind; tht?: boolean; conn?: ConnType }

const num = (s: string | undefined) => (s ? parseFloat(s.replace(',', '.')) : NaN);

/** A socket (female) header by its name: KiCad's PinSocket, "female", Samtec's and Sullins' socket series, Würth's. */
export const SOCKET_NAME = /socket|female|receptacle|\b(PPTC|PPPC|NPTC|NPPC|LPPB|SSW|SSQ|SSM|SLW|BCS|ESW|ESQ|CES|SFM|FLE|CLP)[-\d]|\b6130\d\d[12]1821\b/i;

/** Connector types that are through-hole unless their name says SMD. */
const THT = new Set(['usb_a', 'usb_a_dual', 'usb_b', 'rj45', 'rj11', 'dsub', 'xt60', 'xt30', 'iec_c14', 'minidin', 'xlr', 'banana', 'm12', 'toslink', 'pcie', 'barrel', 'rca', 'bnc', 'terminal', 'microfit', 'minifit', 'kk254', 'jst_xh', 'jst_ph', 'idc', 'idc_ra', 'header']);

/**
 * How many pins a connector's name says it has: "1x04" or "2x05", JST's "B4B-" and "SM04B-", the circuits in a Molex
 * part number ("53047-0410", "22-27-2041"), CNC Tech's "3020-10-", Hirose's "FH12-24S", "10P". 0 when it says none.
 */
export function nameCircuits(name: string): number {
  let m;
  if ((m = name.match(/(?:^|[^\d.])(\d{1,2})\s?x\s?(\d{1,2})(?![\d.])/i))) return +m[1] * +m[2];
  if ((m = name.match(/\b[BS]M?(\d{1,2})[BP]-/i))) return +m[1];
  if ((m = name.match(/\b(?:53047|53048|53398|53261|43650|43045|502352|502382|502386|502494|5566|5569|39281|39301|52559|52610|503480|54548)-?(\d\d)/))) return +m[1];
  if ((m = name.match(/\b22-?(?:27|23|05)-?\d(\d\d)/))) return +m[1];
  if ((m = name.match(/\b3020-?(\d\d)-?0/))) return +m[1];
  if ((m = name.match(/\bFH\d\d[A-Z]*-(\d{1,2})S/i))) return +m[1];
  if ((m = name.match(/(?:^|[^\d.])(\d{1,2})[\s_-]?(?:pins?|pos|way|p)\b/i))) return +m[1];
  return 0;
}

/** Pitch and ends of the wire-to-board families, for their width from their number of pins. */
const WTB: Record<string, { pitch: number; pad: number; rows?: number }> = {
  jst_gh: { pitch: 1.25, pad: 3 }, jst_zh: { pitch: 1.5, pad: 3 }, picoblade: { pitch: 1.25, pad: 3.2 }, kk254: { pitch: 2.54, pad: 2.54 },
  jst_ph: { pitch: 2, pad: 3.9 }, jst_xh: { pitch: 2.5, pad: 4.9 }, microfit: { pitch: 3, pad: 6.6, rows: 2 }, minifit: { pitch: 4.2, pad: 6.4, rows: 2 },
};
/** The pitch a side-entry wire-to-board socket's name says. */
export function wtbPitch(name: string): number {
  const m = /_P(\d+(?:\.\d+)?)mm/i.exec(name);
  if (m) return +m[1];
  if (/-(GH|GHS)\b|GHS|53048|53261|pico/i.test(name)) return 1.25;
  if (/-ZR|ZESS/i.test(name)) return 1.5;
  if (/-(PH|PA|PUD)\b|502352|duraclik/i.test(name)) return 2;
  if (/-(XH|EH)\b/i.test(name)) return 2.5;
  if (/micro[\s_-]?fit/i.test(name)) return 3;
  if (/-VH\b|22-?05-?[37]/i.test(name)) return 3.96;
  if (/mini[\s_-]?fit|5569|39-?30|39301/i.test(name)) return 4.2;
  return 2;
}

/** A KK / JST-VH header's pitch: 3.96 mm for the big ones, else 2.54. */
export const kkPitch = (name: string) => (/396|3\.96|-VH|26-?(48|60)/i.test(name) ? 3.96 : 2.54);

/** A connector type sized for the number of pins its name says (a 2 x 8 box header, a 6-pin JST): body and plug as wide as that. */
export function sizedConn(t: ConnType, name: string): ConnType {
  const wide = (w: number, l = t.body.l, h = t.body.h): ConnType => ({ ...t, body: { w, l, h }, plug: { ...t.plug, w } });
  // (slot lengths from the lanes: x1 25 mm, x4 39, x8 56, x16 89, as KiCad Connector_PCBEdge BUS_PCIexpress_x1..x16's pads step 14, 17 and 33 mm;
  // an SO-DIMM socket 73 long with its latches and 14.2 deep, KiCad Connector_PCBEdge: SODIMM-260_DDR4_H4.0-5.2_OrientationStd_Socket, 5.2 high;
  // a mini PCIe socket 30 wide and 9 deep, KiCad Connector_PCBEdge: BUS_PCI_Express_Mini)
  if (t.id === 'pcie') { const m = /(?:^|[^a-z])x(1|4|8|16)(?!\d)/i.exec(name); return wide(({ 1: 25, 4: 39, 8: 56, 16: 89 } as Record<number, number>)[m ? +m[1] : 16]); }
  if (t.id === 'dimm' && /so[\s_-]?dimm/i.test(name)) return wide(73, 14.2, 5.2);
  if (t.id === 'm2' && /mini[\s_-]?pci|mpcie/i.test(name)) return wide(30, 9);
  const n = nameCircuits(name);
  if (!n || n > 80) return t;
  let w = t.body.w;
  const f = WTB[t.id];
  // (the bigger pitches inside a family: KK / JST-VH 3.96 mm, Nano-Fit 2.5, Ultra-Fit 3.5, Mega-Fit 5.7)
  const pitch = !f ? 0 : t.id === 'kk254' ? kkPitch(name) : t.id === 'microfit' && /nano/i.test(name) ? 2.5 : t.id === 'minifit' && /ultra/i.test(name) ? 3.5 : t.id === 'minifit' && /mega|76829/i.test(name) ? 5.7 : f.pitch;
  if (f) { const rows = f.rows === 2 && !/43650|1x\d/i.test(name) && n > 1 ? 2 : 1; w = (Math.ceil(n / rows) - 1) * pitch + f.pad; }
  else if (t.id === 'idc' || t.id === 'idc_ra') w = Math.ceil(n / 2) * 2.54 + 7.6;
  else if (t.id === 'wtb_side') w = (n - 1) * wtbPitch(name) + 4;
  else if (t.id === 'fpc') { const m = /_P(\d+(?:\.\d+)?)mm/i.exec(name); w = (n - 1) * (m ? +m[1] : n <= 15 ? 1 : 0.5) + 5; }
  else return t;
  w = Math.round(w * 100) / 100;
  return { ...t, body: { ...t.body, w }, plug: { ...t.plug, w: Math.max(1, Math.round((t.plug.w + w - t.body.w) * 100) / 100) } };
}

/** Guess body size and kind from a footprint/package name and reference designator. */
export function guessPackage(pkg: string, ref = '', value = ''): PkgGuess {
  const name = `${pkg} ${value}`;
  const p = pkg.toUpperCase();
  let g: PkgGuess = { w: 3, l: 3, h: 2 };
  const imperial = p.match(/(?:^|[^0-9])(01005|0201|0402|0603|0805|1206|1210|1812|2010|2512)(?:[^0-9]|$)/);
  if (imperial) {
    const [w, l, h] = CHIP[imperial[1]];
    g = { w, l, h };
  }
  let m;
  if ((m = p.match(/SOT-?23-?(\d)?/))) g = { w: 2.9, l: 2.4, h: 1.1 };
  if (/SOT-?223/.test(p)) g = { w: 6.5, l: 7, h: 1.8, kind: 'hot' };
  if (/SOT-?89/.test(p)) g = { w: 4.5, l: 4.2, h: 1.6 };
  if (/TO-?252|DPAK/.test(p)) g = { w: 6.6, l: 10, h: 2.4, kind: 'hot' };
  if (/TO-?263|D2PAK/.test(p)) g = { w: 10.2, l: 15, h: 4.6, kind: 'hot' };
  if (/TO-?220/.test(p)) g = { w: 10.2, l: 4.6, h: 16, kind: 'hot', tht: true };
  if (/TO-?92/.test(p)) g = { w: 4.8, l: 3.8, h: 5, tht: true };
  if ((m = p.match(/(?:SOIC|SOP|SO)-?(\d+)/)) && !/SOT/.test(p)) g = { w: 6, l: 1.27 * (+m[1] / 2) + 0.4, h: 1.75 };
  if ((m = p.match(/(?:TSSOP|MSOP|SSOP)-?(\d+)/))) g = { w: 6.4, l: 0.65 * (+m[1] / 2) + 0.6, h: 1.2 };
  if ((m = p.match(/DIP-?(\d+)/))) g = { w: 7.62 + 1.5, l: 2.54 * (+m[1] / 2) + 0.5, h: 5, tht: true };
  if ((m = p.match(/(?:QFN|DFN|LQFP|TQFP|QFP|BGA|LGA)-?\d*[_-](\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)/))) g = { w: num(m[1]), l: num(m[2]), h: /LQFP|TQFP|QFP/.test(p) ? 1.6 : 1.0 };
  // KiCad-style explicit sizes
  if ((m = p.match(/_L(\d+(?:\.\d+)?)MM_W(\d+(?:\.\d+)?)MM/))) g = { ...g, w: num(m[1]), l: num(m[2]) };
  else if ((m = p.match(/(\d+(?:\.\d+)?)X(\d+(?:\.\d+)?)(?:X(\d+(?:\.\d+)?))?MM/))) g = { ...g, w: num(m[1]), l: num(m[2]), h: m[3] ? num(m[3]) : g.h };
  if ((m = p.match(/_D(\d+(?:\.\d+)?)MM/))) g = { ...g, w: num(m[1]), l: num(m[1]), h: num(m[1]) * 1.4 };
  if ((m = p.match(/_H(\d+(?:\.\d+)?)MM/))) g = { ...g, h: num(m[1]) };
  if (/CP_RADIAL|C_RADIAL|ELEC/.test(p)) g = { ...g, tht: /RADIAL/.test(p) || g.tht, kind: 'generic' };
  if ((m = p.match(/PIN(?:HEADER|SOCKET)_(\d+)X(\d+)_P(\d+(?:\.\d+)?)MM/))) {
    const rows = +m[1], cols = +m[2], pitch = num(m[3]);
    g = { w: pitch * cols, l: pitch * rows, h: /SOCKET/.test(p) ? 8.5 : 8.5, tht: true, kind: 'header', conn: connById('header') };
    if (/HORIZONTAL/.test(p)) g.h = 2.5 + pitch;
  }
  // IPC-7251 header names (Allegro libraries, Ultra Librarian, SamacSys): HDRV10W64P254_1X10_...: 10 pins, 0.64 mm leads,
  // 2.54 mm pitch, 1 row of 10; HDRRA the right-angle ones; SIP4 a single row of 4
  if ((m = p.match(/\bHDR(V|RA)\d+W\d+P(\d+)(?:X\d+)?_(\d+)X(\d+)/))) {
    const pitch = +m[2] / 100, rows = +m[3], cols = +m[4];
    if (pitch >= 1 && pitch <= 5 && rows * cols <= 80) g = { w: pitch * cols, l: pitch * rows, h: m[1] === 'RA' ? 2.5 + pitch : 8.5, tht: true, kind: 'header', conn: connById('header') };
  } else if ((m = p.match(/\bSIP[\s_-]?(\d{1,2})\b/)) && +m[1] >= 2) g = { w: 2.54 * +m[1], l: 2.54, h: 8.5, tht: true, kind: 'header', conn: connById('header') };
  // Samtec pin headers and sockets by part number: TSW-110-07-L-S is 10 pins in one row (S; D is two rows) at 2.54 mm,
  // FTSH / FTS / TFM / SFM at 1.27 mm
  const up = `${p} ${value.toUpperCase()}`.replace(/_/g, ' '); // ("SAMTEC_TSW-110": the part number starts a word)
  const SAMTEC = 'H?TSW|SSW|SSQ|MTSW|ZW|BCS|ESW|HLE|TLW|FTSH|FTS|TFM|SFM|CLP|FLE|SHF';
  if ((m = up.match(new RegExp(`\\b(${SAMTEC})-1(\\d\\d)-[\\w.-]*?-(S|D|T)V?\\b`)) ?? up.match(new RegExp(`\\b(${SAMTEC})1(\\d\\d)\\d\\d[A-Z]{1,2}(S|D|T)[A-Z]{0,4}\\b`)))) {
    const pitch = /^(FTSH|FTS|TFM|SFM|CLP|FLE|SHF)$/.test(m[1]) ? 1.27 : 2.54, rows = m[3] === 'D' ? 2 : 1, cols = +m[2];
    g = { w: pitch * cols, l: pitch * rows, h: 8.5, tht: !/SM|SMT/.test(p), kind: 'header', conn: connById('header') };
  }
  // Sullins headers (PBC03SAAN: 3 pins in one row, D two rows) and sockets (PPTC122LFBN: 12 a row, two rows), Würth
  // WR-PHD (613 004 111 21: 4 pins in one row; 118 21 the socket) and Harwin M20 (M20-9990345: 3 pins)
  const hdr = (cols: number, rows: number, pitch: number) => { if (cols > 0 && cols <= 80) g = { w: pitch * cols, l: pitch * rows, h: 8.5, tht: !/SMD|SMT/.test(p), kind: 'header', conn: connById('header') }; };
  if ((m = up.match(/\b(PBC|PEC|PREC|PRPC|PZC|PTC|NRPN|GRPB)(\d{2,3})([SD])[A-Z]{2,3}N?\b/))) hdr(+m[2], m[3] === 'D' ? 2 : 1, m[1] === 'NRPN' ? 2 : m[1] === 'GRPB' ? 1.27 : 2.54);
  else if ((m = up.match(/\b(PPTC|PPPC|NPTC|NPPC|LPPB)(\d\d)([12])[A-Z]/))) hdr(+m[2], +m[3], /^N/.test(m[1]) ? 2 : m[1] === 'LPPB' ? 1.27 : 2.54);
  else if ((m = up.match(/\b6130(\d\d)([12])1[18]21\b/))) hdr(Math.ceil(+m[1] / +m[2]), +m[2], 2.54);
  else if ((m = up.match(/\bM20-99([89])(\d\d)\d\d\b/))) hdr(+m[2], m[1] === '8' ? 2 : 1, 2.54);
  if (/MOUNTINGHOLE|MOUNTING_HOLE|MTG|FIDUCIAL/.test(p)) g = { w: 0, l: 0, h: 0 };
  if (/ESP32|ESP8266|WROOM|WROVER|NINA|RFM9|BLE|NRF52.*MODULE|RP2040.*ZERO/.test(p + ' ' + name.toUpperCase())) g = { ...g, kind: 'antenna', h: Math.max(g.h, 3.2) };
  if (/LED/.test(p) || /^LED/i.test(ref)) g = { ...g, kind: 'led' };
  if (/^(SW|S|BTN|KEY)\d/i.test(ref) || /SW_|SWITCH|TACT|BUTTON|PUSH/.test(p)) g = { ...g, kind: 'switch', h: Math.max(g.h, 3.5) };
  if (/INDUCTOR|^L_|CRYSTAL|XTAL/.test(p)) g = { ...g, h: Math.max(g.h, 2) };
  // a debug header (SWD / JTAG) by its shape or its name: a probe plugs in there
  const dbg = debugType(pkg, ref, value);
  if (dbg) { const t = connById(dbg); return { w: t.body.w, l: t.body.l, h: t.body.h, kind: 'connector', tht: dbg !== 'tagconnect' && !/smd/i.test(pkg), conn: t }; }
  // connectors
  const isConnRef = CONN_REF.test(ref);
  // (also with underscores as spaces: in "Hirose_FH12-24S" the part number starts a word)
  const spaced = name.replace(/_/g, ' ');
  const says = (r?: RegExp) => !!r && (r.test(name) || r.test(spaced));
  // part numbers and unmistakable names count anywhere; a bare word (HDMI, SMA, TRS, TB6612) only on a connector's reference
  const hit = CONNECTORS.find((c) => c.id !== 'custom' && says(c.match)) ?? (isConnRef ? CONNECTORS.find((c) => c.id !== 'custom' && says(c.weak)) : undefined);
  if (hit && (isConnRef || hit.id !== 'header' || g.kind === 'header')) {
    const keepSize = hit.entry === 'top' && g.w > 0 && g.kind === 'header';
    const t = keepSize ? hit : sizedConn(hit, name);
    g = {
      w: keepSize ? g.w : t.body.w, l: keepSize ? g.l : t.body.l, h: keepSize ? g.h : t.body.h,
      kind: hit.entry === 'top' && hit.id === 'header' ? 'header' : 'connector', tht: g.tht ?? (!/smd|smt/i.test(name) && (THT.has(hit.id) || /usb[\s_-]?[ab]\b|rj45|barrel|jack|terminal|header/i.test(name))), conn: t,
    };
  } else if (isConnRef && !g.kind) g = { ...g, kind: 'connector', conn: connById('custom') };
  return g;
}

/**
 * The debug connector a footprint is, if any (debugType() picks them; their `match` never does): Tag-Connect pads;
 * a 2 x 5 header at 1.27 mm (the Cortex debug connector, whatever it is called); or a 10 or 20-pin header whose
 * name, value or reference says JTAG / SWD / debug. Other headers named for debug (a 1 x 4 SWD header) stay pin
 * headers: jumper wires go there, and they still count as a debug port.
 */
export function debugType(pkg: string, ref = '', value = ''): 'swd10' | 'cortex20' | 'jtag20' | 'tagconnect' | null {
  const text = `${pkg} ${value} ${ref}`;
  if (/tag[\s_-]?connect|tc20[35]0/i.test(text)) return 'tagconnect';
  const grid = pkg.match(/(\d+)x(\d+)/i);
  const rows = grid ? +grid[1] : 0, pins = grid ? rows * +grid[2] : 0;
  const pitch = /1\.27|P127(?!\d)/.test(pkg) ? 1.27 : /2\.54|P254(?!\d)/.test(pkg) ? 2.54 : 0;
  // part numbers: Samtec FTSH / SHF 1.27 mm headers (105: 2 x 5, 110: 2 x 10) and CNC Tech's 3220 ones
  if (/(ftsh|shf)[\s_-]?110|3220[\s_-]?20\b/i.test(pkg + ' ' + value)) return 'cortex20';
  if (/(ftsh|shf)[\s_-]?105|3220[\s_-]?10\b/i.test(pkg + ' ' + value) || (pins === 10 && rows === 2 && pitch === 1.27)) return 'swd10';
  if (!DEBUG_HINT.test(text)) return null;
  const n = pins || +(text.match(/(?:_|\b)(10|20)(?:[\s_-]?pins?)?\b/i)?.[1] ?? 0);
  if (n === 10 && pitch !== 2.54) return 'swd10';
  if (n === 20 && pitch === 1.27) return 'cortex20';
  if (n === 20) return 'jtag20';
  return null;
}

/** A reference that says connector: J1, P3, CN2, X4, CON1, JP2, HDR1. */
export const CONN_REF = /^(J|JK|JP|P|PL|CN|CON|CONN|X|XS|USB|HDR|HD|TB|RJ|SK|SKT|ANT|HDMI|DP|ETH|LAN|SD|SIM|PWR|JACK|PORT|MICROSD|SATA|SMA|BNC|RCA|AUDIO|TERM)\d/i;

/**
 * A header's pins as a grid, from where they are: one or two rows, all pitches the same (2.54, 2.0 or 1.27 mm), every
 * place filled. Mounting and shield pads (not numbered) are left out. Null when the pins are not a header's.
 */
export function pinGrid(pins: Comp['pins']): { rows: number; cols: number; pitch: number } | null {
  const ps = (pins ?? []).filter((q) => /^\d+$/.test(q.n));
  if (ps.length < 2 || ps.length > 80) return null;
  // along the rows: the pins' main axis (their spread's longest direction)
  const mx = ps.reduce((t, p) => t + p.x, 0) / ps.length, my = ps.reduce((t, p) => t + p.y, 0) / ps.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of ps) { sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; sxy += (p.x - mx) * (p.y - my); }
  const t = 0.5 * Math.atan2(2 * sxy, sxx - syy), a = { x: mx, y: my };
  const u = [Math.cos(t), Math.sin(t)], v = [-u[1], u[0]];
  const cluster = (xs: number[], tol: number) => { const out: number[] = []; for (const x of [...xs].sort((m, n) => m - n)) if (!out.length || x - out[out.length - 1] > tol) out.push(x); return out; };
  let near = Infinity;
  for (const p of ps) for (const q of ps) if (p !== q) near = Math.min(near, Math.hypot(p.x - q.x, p.y - q.y));
  const pitch = [2.54, 2.0, 1.27].find((t) => Math.abs(near - t) < 0.08);
  if (!pitch) return null;
  const along = cluster(ps.map((p) => (p.x - a.x) * u[0] + (p.y - a.y) * u[1]), pitch / 3);
  const across = cluster(ps.map((p) => (p.x - a.x) * v[0] + (p.y - a.y) * v[1]), pitch / 3);
  if (across.length > 2 || along.length * across.length !== ps.length) return null;
  const even = (xs: number[]) => xs.every((x, i) => i === 0 || Math.abs(x - xs[i - 1] - pitch) < 0.1);
  return even(along) && even(across) ? { rows: across.length, cols: along.length, pitch } : null;
}

/**
 * A D-sub by its pins, whatever it is called: two staggered rows (5 and 4 for a DE-9, 8 and 7, 13 and 12, 19 and 18)
 * at 2.77 mm, the rows 2.84 mm apart. Its number of pins, or null.
 */
export function dsubPins(pins: Comp['pins']): number | null {
  const ps = (pins ?? []).filter((q) => /^\d+$/.test(q.n));
  if (![9, 15, 25, 37].includes(ps.length)) return null;
  const mx = ps.reduce((t, p) => t + p.x, 0) / ps.length, my = ps.reduce((t, p) => t + p.y, 0) / ps.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of ps) { sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; sxy += (p.x - mx) * (p.y - my); }
  const t = 0.5 * Math.atan2(2 * sxy, sxx - syy), u = [Math.cos(t), Math.sin(t)], v = [-u[1], u[0]];
  const across = ps.map((p) => (p.x - mx) * v[0] + (p.y - my) * v[1]);
  const lo = Math.min(...across), hi = Math.max(...across);
  if (Math.abs(hi - lo - 2.84) > 0.15) return null;
  const rowA = ps.filter((_, i) => across[i] - lo < 0.5), rowB = ps.filter((_, i) => hi - across[i] < 0.5);
  if (rowA.length + rowB.length !== ps.length || Math.abs(rowA.length - rowB.length) !== 1) return null;
  const even = (row: typeof ps) => { const xs = row.map((p) => (p.x - mx) * u[0] + (p.y - my) * u[1]).sort((a, b) => a - b); return xs.every((x, i) => i === 0 || Math.abs(x - xs[i - 1] - 2.77) < 0.12); };
  return even(rowA) && even(rowB) ? ps.length : null;
}

/** Nets that say debug (SWD or JTAG) or serial, on a header's pins. */
const DEBUG_NETS = /(^|[^a-z])(swdio|swclk|swdclk|swo|tms|tck|tdi|tdo|n?trst)([^a-z]|$)/i;
const UART_NETS = /(^|[^a-z])(u?art\d?_?)?(txd?|rxd?)\d?([^a-z]|$)/i;

/**
 * A connector known by its pins when its name says nothing BoardDock knows (an Allegro footprint's "CON10" or
 * "HDR2X5"): a 2 x 5 header at 1.27 mm is the 10-pin debug connector, a 2 x 10 at 2.54 mm with JTAG nets the 20-pin
 * one, and any other one or two-row header a pin header, marked for debug or serial when its nets say so.
 */
function byPins(c: Comp, g: PkgGuess): { conn: ConnType; kind: CompKind; role?: string; w: number; l: number } | null {
  if (!c.pins || (g.conn && g.conn.id !== 'custom' && g.conn.id !== 'header' && g.conn.id !== 'idc')) return null;
  if (!g.conn && !CONN_REF.test(c.ref)) return null;
  const ds = dsubPins(c.pins);
  if (ds) { const t = connById('dsub'), w = ({ 9: 30.8, 15: 39.1, 25: 53, 37: 69.3 } as Record<number, number>)[ds] ?? 30.8; return { conn: { ...t, body: { ...t.body, w }, plug: { ...t.plug, w: w + 0.5 } }, kind: 'connector', w, l: t.body.l }; }
  const grid = pinGrid(c.pins);
  if (!grid) return null;
  const n = grid.rows * grid.cols, nets = c.pins.map((q) => q.net ?? '').join(' ');
  const dbg = DEBUG_NETS.test(nets), uart = !dbg && UART_NETS.test(nets) && n <= 8;
  if (grid.rows === 2 && n === 10 && grid.pitch === 1.27) return { conn: connById('swd10'), kind: 'connector', w: 12.7, l: 5.8 };
  if (dbg && grid.rows === 2 && n === 20 && grid.pitch === 2.54) return { conn: connById('jtag20'), kind: 'connector', w: 33.2, l: 8.9 };
  if ((dbg || DEBUG_HINT.test(`${c.ref} ${c.pkg} ${c.value ?? ''}`)) && grid.rows === 2 && n === 20 && grid.pitch === 1.27) return { conn: connById('cortex20'), kind: 'connector', w: 17.8, l: 5.8 };
  const role = dbg ? { role: 'debug' } : uart ? { role: 'uart' } : {};
  // a box header named as one stays one (its shroud), as wide as its pins say
  if (g.conn?.id === 'idc' && grid.rows === 2 && grid.pitch === 2.54) { const t = sizedConn(g.conn, `${grid.rows}x${grid.cols}`); return { conn: t, kind: 'connector', ...role, w: t.body.w, l: t.body.l }; }
  return { conn: connById('header'), kind: 'header', ...role, w: grid.pitch * grid.cols, l: grid.pitch * grid.rows };
}

/** Fill in kind / connector setup for a component from its names, or its pins where the names say nothing known. Keeps sizes that are already known. */
export function classify(c: Comp, sizeKnown: boolean, boardEdgeAngle?: number): Comp {
  let g = guessPackage(c.pkg, c.ref, c.value);
  const pinned = byPins(c, g);
  if (pinned) {
    g = { ...g, w: pinned.w, l: pinned.l, h: pinned.conn.id === 'header' ? 8.5 : pinned.conn.body.h, kind: pinned.kind, tht: true, conn: pinned.conn };
    if (pinned.role && !c.role) c = { ...c, role: pinned.role };
  }
  const out: Comp = { ...c, kind: g.kind ?? c.kind ?? 'generic', tht: c.tht || !!g.tht };
  if (!sizeKnown) {
    out.w = g.w || 1;
    out.l = g.l || 1;
  }
  if (!c.h || !sizeKnown) out.h = g.h;
  if (g.conn && !c.conn) {
    out.conn = connSetup(g.conn, boardEdgeAngle ?? 0); // importers aim edge connectors at the nearest edge afterwards
  }
  return out;
}

// ---- materials ----
export interface MaterialProps { E: number; nu: number; strainAllow: number; yield: number; density: number; tg: number }
export const MATERIALS: Record<Material, MaterialProps> = {
  // Typical printed values (E in MPa, yield in MPa, density g/cm3, softening point C). Printed parts vary a lot.
  PLA: { E: 3500, nu: 0.35, strainAllow: 0.015, yield: 50, density: 1.24, tg: 55 },
  PETG: { E: 2100, nu: 0.38, strainAllow: 0.02, yield: 45, density: 1.27, tg: 75 },
  ABS: { E: 2200, nu: 0.35, strainAllow: 0.02, yield: 40, density: 1.04, tg: 95 },
  ASA: { E: 2000, nu: 0.35, strainAllow: 0.02, yield: 40, density: 1.07, tg: 95 },
  PA: { E: 1800, nu: 0.39, strainAllow: 0.03, yield: 45, density: 1.14, tg: 70 },
  PC: { E: 2300, nu: 0.37, strainAllow: 0.025, yield: 55, density: 1.2, tg: 110 },
};

export const PRINTERS: PrinterSettings[] = PRINTERS_DB.map((x) => ({ name: x.name, bed: x.bed, spacing: 6, maxZ: x.maxZ }));

export const DEFAULT_HOLDER: HolderSettings = {
  wall: 1.8, base: 2.0, gap: 0.3, wallAbove: 0.8, standoff: null, minStandoff: 3, leadLen: 1.8,
  pattern: 'hex', cell: 10, rib: 1.8, tabs: 'auto', tabLip: 0.7, notches: true, label: '', chamfer: true, pinClear: 0.15, material: 'PETG', style: 'frame',
};

export const DEFAULT_FEATURES = { cradles: true, caps: true, ties: true, guards: true };

/** Holder presets: sturdier walls, or lean for faster prints and less filament. */
export const HOLDER_PRESETS: Record<'sturdy' | 'balanced' | 'lean', Partial<HolderSettings>> = {
  sturdy: { style: 'tray', wall: 2.4, base: 2.4, pattern: 'hex', cell: 9, rib: 2.2, wallAbove: 1.2, chamfer: true },
  balanced: { style: 'frame', wall: 1.8, base: 2.0, pattern: 'hex', cell: 10, rib: 1.8, wallAbove: 0.8, chamfer: true },
  lean: { style: 'frame', wall: 1.6, base: 1.6, pattern: 'hex', cell: 14, rib: 1.6, wallAbove: 0.4, chamfer: false },
};

export const DEFAULT_MOUNT: MountSettings = { kind: 'din', mode: 'flat', rotation: 0, edge: 'bottom', clipWidth: 14, tabSide: 'down', railT: 1.0, at: null };

export const DEFAULT_STAND: StandSettings = {
  enabled: false, shape: 'round', size: 10, depth: 12, fit: 'slip', clearance: 0.3, axis: 'edge', edge: 'bottom', offset: 0, wall: 3,
};

export const DEFAULT_ARRANGE: ArrangeSettings = { mode: 'stack', stackGap: 3, sideGap: 0.4, sideAxis: 'x', links: true };

export const DEFAULT_PANEL: PanelSettings = { auto: true, rowDir: 'h', pairs: true, gap: 2, maxRail: 400, rowGap: 25, stands: true, rails: [], mounts: [] };

export function newModule(board: Board, holder?: HolderSettings): Module {
  applyHoleRoles(board, [], false);
  return { id: Math.random().toString(36).slice(2, 9), board, holder: { ...(holder ?? DEFAULT_HOLDER), label: board.name.slice(0, 24) }, original: structuredClone(board) };
}

export function newProject(board: Board): Project {
  return {
    version: 3,
    modules: [newModule(board)],
    active: 0,
    layout: 'panel',
    panel: structuredClone(DEFAULT_PANEL),
    arrange: { ...DEFAULT_ARRANGE },
    mount: { ...DEFAULT_MOUNT },
    stand: { ...DEFAULT_STAND },
    printer: { ...PRINTERS[0] },
  };
}

/** Upgrade older project files (single board) to the current format. */
/**
 * A board laid out by face as a box is (a J-Link, a USB-serial adapter, or one saved when they were boxes) made the
 * ordinary board it is: each port on an edge gets its connector's own footprint, flush with that edge as a board's
 * connectors are, and the board keeps its size, parts, colour and port names, so its cables stay put. Mutates `b`.
 */
export function bareToBoard(b: Board, role: 'probe' | 'adapter'): Board {
  const xs = b.outline.map((q) => q[0]), ys = b.outline.map((q) => q[1]);
  const bb = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  for (const c of b.comps) {
    if (!c.conn || c.conn.entry !== 'edge') continue;
    const t = connById(c.conn.type), a = ((Math.round(c.conn.angle) % 360) + 360) % 360;
    if (a % 90) continue;
    const horizontal = a === 0 || a === 180, out = a === 0 || a === 90 ? 1 : -1;
    const edge = a === 0 ? bb.x1 : a === 180 ? bb.x0 : a === 90 ? bb.y1 : bb.y0;
    const depth = t.body.l, mid = edge + out * (t.overhang - depth / 2);
    const across = horizontal ? c.l : c.w; // a row of pins keeps the width its pins give it
    if (horizontal) { c.x = mid; c.w = depth; c.l = across; } else { c.y = mid; c.l = depth; c.w = across; }
    c.h = t.body.h;
    c.conn.zc = t.zc;
  }
  if (b.box?.ribbon) b.ribbon = b.box.ribbon;
  delete b.box;
  delete b.kind;
  b.role = role;
  return b;
}

export function migrate(p: any): Project {
  if (p && p.version === 1 && p.board) {
    p = { version: 2, modules: [{ id: 'm0', board: p.board, holder: p.holder }], active: 0, arrange: { ...DEFAULT_ARRANGE }, mount: p.mount, stand: p.stand, printer: p.printer };
  }
  if (!p?.modules?.length) throw new Error('Not a BoardDock project file');
  // a switch's or powered hub's barrel input was saved as a plug that leaves the rack: it is a DC input (its supply goes on the rack)
  for (const m of p.modules) {
    const s = m.board?.box;
    if (m.board?.kind !== 'box' || !s?.groups || !/switch|hub/i.test(m.board.name ?? '')) continue;
    for (const g of s.groups) if (g.type === 'barrel' && g.role === 'other') { g.role = 'power-in-dc'; g.volts ??= 12; }
    for (const c of m.board.comps ?? []) if (c.conn?.type === 'barrel' && c.role === 'other') c.role = 'power-in-dc';
  }
  // J-Links and USB-serial adapters were boxes that slid into a slot behind their board: they are boards now, and the
  // ones stacked on each other stand in a column
  for (const m of p.modules) {
    const b = m.board;
    if (b?.kind === 'box' && b.comps?.some((c: Comp) => isDebugPort(c) || isUartPort(c))) bareToBoard(b, b.comps.some((c: Comp) => isDebugPort(c)) ? 'probe' : 'adapter');
  }
  for (const m of p.modules) if (m.on && m.onMode === 'towers' && m.board?.role && p.modules.find((x: Module) => x.id === m.on)?.board?.role) m.onMode = 'column';
  // v2 -> v3: boards go onto DIN rail docks, laid out automatically
  return {
    ...p,
    version: 3,
    layout: p.layout ?? 'panel',
    panel: { ...structuredClone(DEFAULT_PANEL), ...(p.panel ?? {}) },
    arrange: { ...DEFAULT_ARRANGE, ...(p.arrange ?? {}) },
    active: Math.min(p.active ?? 0, p.modules.length - 1),
    links: numberLinks(p.links ?? []),
    // printers saved under an older combined name get the matching one from the list, with its build height
    printer: ((pr) => (pr ? { ...p.printer, name: pr.name, maxZ: pr.maxZ } : p.printer ?? { ...PRINTERS[0] }))(printerByName(p.printer?.name ?? '')),
  };
}

/**
 * Switch between DIN rail docks and loose holders. Loose holders start without the DIN clip (they are loose because
 * there is no rail), unless it was switched on or off by hand before.
 */
export function setLayout(p: Project, layout: Project['layout']) {
  p.layout = layout;
  if (layout === 'loose' && !p.mount.picked) p.mount.kind = 'none';
  // loose holders start side by side (a stack of towers is a choice, not a surprise)
  if (layout === 'loose' && !p.arrange.picked) p.arrange.mode = 'side';
}

/** Ports that only matter with a screen or speakers plugged in: what a headless board (a Pi run over the network) can do without. */
const SCREEN_PORTS = ['hdmi_micro', 'hdmi_mini', 'hdmi_a', 'audio35'];

/** Screen and audio ports that have a cradle but no cable, on every board (not boxes), as module id and ref. */
export function headlessCradles(p: Project): { module: string; ref: string }[] {
  const cabled = new Set((p.links ?? []).flatMap((l) => [l.a, l.b].map((e) => `${e.module}/${e.ref.replace(/:2$/, '')}`)));
  return p.modules.flatMap((m) => (m.board.kind === 'box' ? [] : m.board.comps
    .filter((c) => c.conn && !c.hidden && c.conn.cradle && SCREEN_PORTS.includes(c.conn.type) && !cabled.has(`${m.id}/${c.ref}`))
    .map((c) => ({ module: m.id, ref: c.ref }))));
}

/** Run the boards headless: drop the cradles (and so the caps) of their unused screen and audio ports. */
export function makeHeadless(p: Project): number {
  const drop = headlessCradles(p);
  for (const d of drop) {
    const c = p.modules.find((m) => m.id === d.module)?.board.comps.find((x) => x.ref === d.ref);
    if (c?.conn) { c.conn.cradle = false; c.conn.cap = false; c.conn.use = 'no'; } // no screen: they stay empty
  }
  return drop.length;
}

export const activeModule = (p: Project): Module => p.modules[Math.min(p.active, p.modules.length - 1)];
