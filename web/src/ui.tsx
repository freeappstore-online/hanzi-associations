import type { ButtonHTMLAttributes, ReactNode } from 'react'

const icons = { refresh: '↻', copy: '⧉', import: '↑', export: '↓', disconnect: '⏏', connect: '↗', save: '✓', reset: '↺', publish: '✦', edit: '✎', create: '＋', pending: '◷' } as const
export function Button({ icon, secondary, className = '', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: keyof typeof icons; secondary?: boolean }) {
  const label = typeof children === 'string' ? children : undefined
  return <button aria-label={label} title={label} {...props} className={`min-h-11 min-w-11 max-w-full wrap-anywhere rounded-xl px-2.5 py-2.5 sm:px-4 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${secondary ? 'border border-line-strong bg-panel text-ink hover:bg-paper-deep' : 'bg-accent text-paper hover:bg-accent-hover'} ${className}`}>{label ? <><span className="inline-block text-2xl leading-none sm:hidden" aria-hidden="true">{icons[icon]}</span><span className="hidden sm:inline">{children}</span></> : children}</button>
}
export function Notice({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return <div role={danger ? 'alert' : undefined} className={`rounded-xl border p-4 text-sm leading-relaxed ${danger ? 'border-danger/30 bg-danger-soft text-ink' : 'border-line bg-paper-deep text-muted'}`}>{children}</div>
}
