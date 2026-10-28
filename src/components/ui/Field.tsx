import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start gap-6 py-3', className)}>
      <div className="w-56 shrink-0">
        <div className="text-sm text-ink/90">{label}</div>
        {hint && <div className="text-xs text-faint mt-0.5 leading-snug">{hint}</div>}
      </div>
      <div className="flex-1 min-w-0 flex justify-end">{children}</div>
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-5 w-9 rounded-full transition-colors duration-200 border',
        checked ? 'bg-signal/25 border-signal/50' : 'bg-white/[0.04] border-hairline',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-3.5 w-3.5 rounded-full transition-transform duration-200 ease-swift',
          checked ? 'translate-x-[18px] bg-signal' : 'translate-x-0.5 bg-muted',
        )}
      />
    </button>
  );
}

export function Select({ value, onChange, options, className }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'h-7 rounded bg-raised border border-hairline px-2 text-xs text-ink',
        'hover:border-hairline/80 focus:outline-none focus:border-signal/50',
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-panel">{o.label}</option>
      ))}
    </select>
  );
}

export function TextInput({ value, onChange, placeholder, className, mono }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  mono?: boolean;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'h-7 rounded bg-raised border border-hairline px-2.5 text-xs text-ink w-64',
        'focus:outline-none focus:border-signal/50',
        mono && 'font-mono',
        className,
      )}
    />
  );
}
