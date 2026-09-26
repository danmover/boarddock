// Brand mark and the hero illustration (boards docking onto a DIN rail).
export function Mark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <rect x="1" y="1" width="30" height="30" rx="8.5" fill="var(--accent)" />
      <rect x="8" y="6.5" width="16" height="12" rx="2" fill="var(--accent-ink)" />
      <circle cx="10.7" cy="9.2" r="1.1" fill="var(--accent)" />
      <circle cx="21.3" cy="9.2" r="1.1" fill="var(--accent)" />
      <rect x="13.2" y="10.4" width="5.6" height="4.4" rx="0.8" fill="var(--accent)" />
      <path d="M16 18.5v4" stroke="var(--accent-ink)" strokeWidth="2.6" />
      <path d="M5.5 24.5h21" stroke="var(--accent-ink)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function HeroArt() {
  const board = (x: number, y: number, w: number, h: number, k: string) => (
    <g key={k}>
      <rect x={x} y={y} width={w} height={h} rx="5" fill="#1f8a57" stroke="#46d58b" strokeOpacity="0.5" />
      <circle cx={x + 8} cy={y + 8} r="3" fill="#e0a060" /><circle cx={x + w - 8} cy={y + 8} r="3" fill="#e0a060" />
      <rect x={x + w * 0.32} y={y + h * 0.3} width={w * 0.26} height={h * 0.34} rx="2" fill="#141a20" />
      <rect x={x + w - 26} y={y + h - 18} width="20" height="11" rx="2" fill="#cfd6dd" />
    </g>
  );
  return (
    <svg className="art" viewBox="0 0 560 260" fill="none">
      <defs>
        <linearGradient id="hrail" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#aab6c2" /><stop offset="1" stopColor="#5a6674" /></linearGradient>
      </defs>
      <ellipse cx="280" cy="236" rx="250" ry="12" fill="#000" opacity="0.18" />
      {/* rail */}
      <rect x="20" y="200" width="520" height="12" rx="2" fill="url(#hrail)" />
      <rect x="20" y="194" width="520" height="5" rx="2" fill="#7b8794" opacity="0.8" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <rect key={i} x={46 + i * 64} y="203" width="22" height="6" rx="3" fill="#2a323b" />)}
      {/* docks */}
      {[92, 280, 468].map((x, i) => (
        <g key={i} opacity={i === 1 ? 1 : 0.55}>
          <rect x={x - 26} y="170" width="52" height="28" rx="5" fill="var(--accent)" />
          <rect x={x + 20} y="160" width="7" height="30" rx="2" fill="var(--accent)" />
          <rect x={x - 14} y="150" width="28" height="22" rx="4" fill="#5a86ff" />
        </g>
      ))}
      {/* neighbours */}
      <g opacity="0.5">
        <rect x="52" y="60" width="80" height="90" rx="9" fill="none" stroke="var(--muted)" strokeWidth="2" strokeDasharray="5 5" />
        <rect x="428" y="52" width="80" height="98" rx="9" fill="none" stroke="var(--muted)" strokeWidth="2" strokeDasharray="5 5" />
      </g>
      {/* frame holder sliding into the socket */}
      <g className="slide">
        <rect x="206" y="46" width="148" height="104" rx="10" fill="none" stroke="#e9e6df" strokeWidth="6" />
        <rect x="272" y="140" width="16" height="14" rx="2" fill="#e9e6df" />
        {board(214, 54, 132, 88, 'b')}
        <rect x="266" y="30" width="28" height="9" rx="3" fill="#ff4d5e" />
        <rect x="276" y="38" width="8" height="10" fill="#ff4d5e" />
        <path d="M280 12v12" stroke="#ff4d5e" strokeWidth="2" strokeDasharray="3 3" className="blink" />
      </g>
    </svg>
  );
}
