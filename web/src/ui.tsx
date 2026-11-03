import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function Button({ secondary, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { secondary?: boolean }) {
  return <button {...props} className={`min-h-11 rounded-xl px-4 py-2.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${secondary ? 'border border-line-strong bg-panel text-ink hover:bg-paper-deep' : 'bg-accent text-paper hover:bg-accent-hover'} ${className}`} />
}
export function Notice({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return <div role={danger ? 'alert' : undefined} className={`rounded-xl border p-4 text-sm leading-relaxed ${danger ? 'border-danger/30 bg-danger-soft text-ink' : 'border-line bg-paper-deep text-muted'}`}>{children}</div>
}
