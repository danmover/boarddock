// Brand mark and the hero illustration (a board docking into its holder on a DIN rail).
export function Mark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <rect x="1" y="1" width="30" height="30" rx="9" fill="#0c4a30" stroke="#3ddc97" strokeWidth="1.5" />
      <rect x="7" y="8" width="18" height="12" rx="2" fill="#3ddc97" />
      <circle cx="9.8" cy="10.8" r="1.2" fill="#0c4a30" />
      <circle cx="22.2" cy="10.8" r="1.2" fill="#0c4a30" />
      <rect x="13" y="11.5" width="6" height="5" rx="0.8" fill="#0c4a30" />
      <path d="M5 24h22" stroke="#e8a15a" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M9 20v4M23 20v4" stroke="#3ddc97" strokeWidth="1.6" />
    </svg>
  );
}

export function HeroArt() {
  return (
    <svg className="art" viewBox="0 0 560 250" fill="none">
      <defs>
        <linearGradient id="hrail" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#9fb0bf" /><stop offset="1" stopColor="#4b5b69" /></linearGradient>
        <linearGradient id="htray" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#3ddc97" /><stop offset="1" stopColor="#1fae70" /></linearGradient>
      </defs>
      {/* DIN rail */}
      <rect x="10" y="176" width="540" height="12" rx="2" fill="url(#hrail)" />
      <rect x="10" y="168" width="540" height="6" rx="2" fill="#6d7e8c" opacity="0.7" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <rect key={i} x={40 + i * 66} y="179" width="22" height="6" rx="3" fill="#2d3a45" />)}
      {/* neighbour holders */}
      <g opacity="0.55">
        <rect x="38" y="84" width="110" height="88" rx="10" fill="#1fae70" opacity="0.25" stroke="#3ddc97" strokeOpacity="0.4" />
        <rect x="412" y="72" width="120" height="100" rx="10" fill="#1fae70" opacity="0.25" stroke="#3ddc97" strokeOpacity="0.4" />
      </g>
      {/* tray */}
      <rect x="176" y="92" width="208" height="84" rx="12" fill="url(#htray)" />
      <rect x="186" y="100" width="188" height="68" rx="7" fill="#0b1a14" opacity="0.45" />
      {[0, 1, 2, 3, 4, 5].map((i) => <path key={i} d={`M${205 + i * 30} 120l9-5 9 5v10l-9 5-9-5z`} fill="#0b1a14" opacity="0.55" />)}
      {/* clip + pull tab */}
      <rect x="262" y="176" width="36" height="16" rx="3" fill="#ff6b5b" />
      <rect x="258" y="200" width="44" height="12" rx="6" fill="#ff6b5b" />
      <rect x="276" y="190" width="8" height="12" fill="#ff6b5b" />
      <path d="M314 206h26" stroke="#ff6b5b" strokeWidth="2" strokeDasharray="4 4" className="blink" />
      <text x="346" y="210" fontFamily="JetBrains Mono, monospace" fontSize="11" fill="#ff8b7d">pull</text>
      {/* board sliding in */}
      <g className="slide">
        <rect x="192" y="60" width="176" height="60" rx="5" fill="#0c4a30" stroke="#3ddc97" strokeWidth="1.5" />
        <circle cx="203" cy="71" r="4" fill="#e8a15a" /><circle cx="357" cy="71" r="4" fill="#e8a15a" />
        <circle cx="203" cy="109" r="4" fill="#e8a15a" /><circle cx="357" cy="109" r="4" fill="#e8a15a" />
        <rect x="250" y="74" width="34" height="30" rx="3" fill="#1a232c" />
        <rect x="296" y="80" width="22" height="10" rx="2" fill="#c9d3dd" />
        <rect x="222" y="96" width="16" height="10" rx="2" fill="#ffd166" opacity="0.9" />
        <path d="M210 88h30M300 100h40" stroke="#3ddc97" strokeOpacity="0.6" strokeWidth="1.2" />
        {/* USB plug in its cradle */}
        <rect x="368" y="84" width="40" height="18" rx="4" fill="#e8a15a" opacity="0.9" />
        <path d="M408 93h40" stroke="#e8a15a" strokeWidth="5" strokeLinecap="round" opacity="0.7" />
      </g>
    </svg>
  );
}
