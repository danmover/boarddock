import { useEffect, useState, type ReactNode } from 'react';

export function Num({ label, value, onChange, step = 0.1, min, max, unit = 'mm', hint, disabled }: {
  label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; unit?: string; hint?: string; disabled?: boolean;
}) {
  const [txt, setTxt] = useState(fmt(value));
  useEffect(() => setTxt(fmt(value)), [value]);
  const commit = (s: string) => {
    const v = parseFloat(s.replace(',', '.'));
    if (!isNaN(v)) {
      const c = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
      if (c !== value) onChange(c);
      setTxt(fmt(c));
    } else setTxt(fmt(value));
  };
  return (
    <label className="field" title={hint}>
      <span>{label}{unit && <em>{unit}</em>}</span>
      <input type="number" step={step} min={min} max={max} value={txt} disabled={disabled}
        onChange={(e) => setTxt(e.target.value)} onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }} />
    </label>
  );
}

const fmt = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : '');

export function Text({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [txt, setTxt] = useState(value);
  useEffect(() => setTxt(value), [value]);
  return (
    <label className="field">
      <span>{label}</span>
      <input type="text" value={txt} placeholder={placeholder} onChange={(e) => setTxt(e.target.value)} onBlur={() => txt !== value && onChange(txt)} onKeyDown={(e) => { if (e.key === 'Enter') onChange(txt); }} />
    </label>
  );
}

export function Pick<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={String(value)} onChange={(e) => onChange(options.find(([k]) => String(k) === e.target.value)![0])}>
        {options.map(([k, l]) => <option key={String(k)} value={String(k)}>{l}</option>)}
      </select>
    </label>
  );
}

export function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(([k, l]) => <button key={String(k)} className={k === value ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>)}
    </div>
  );
}

export function Check({ label, value, onChange, hint }: { label: ReactNode; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="toggle" title={hint}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="section">
      <h3><span>{title}</span>{right}</h3>
      {children}
    </div>
  );
}

export function Chip({ status, children }: { status?: 'ok' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  return <span className={`chip ${status ?? ''}`}>{children}</span>;
}

export function download(name: string, data: Uint8Array | string, type = 'application/octet-stream') {
  const blob = new Blob([typeof data === 'string' ? data : (data as BlobPart)], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function safeName(s: string) {
  return s.replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'board';
}
