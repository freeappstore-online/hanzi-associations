import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function Button({ secondary, className = '', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { secondary?: boolean }) {
  const label = typeof children === 'string' ? children : undefined
  const icon = label && (/refresh|check|retry/i.test(label) ? '↻' : /copy/i.test(label) ? '⧉' : /import/i.test(label) ? '↑' : /export/i.test(label) ? '↓' : /disconnect/i.test(label) ? '⏏' : /connect/i.test(label) ? '↗' : /save/i.test(label) ? '✓' : /reset/i.test(label) ? '↺' : /generate|publish/i.test(label) ? '✦' : /revise|edit/i.test(label) ? '✎' : /create|yours/i.test(label) ? '＋' : '…')
  return <button aria-label={label} title={label} {...props} className={`min-h-11 min-w-11 max-w-full wrap-anywhere rounded-xl px-2.5 py-2.5 sm:px-4 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${secondary ? 'border border-line-strong bg-panel text-ink hover:bg-paper-deep' : 'bg-accent text-paper hover:bg-accent-hover'} ${className}`}>{label ? <><span className="inline-block text-2xl leading-none sm:hidden" aria-hidden="true">{icon}</span><span className="hidden sm:inline">{children}</span></> : children}</button>
}
export function Notice({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return <div role={danger ? 'alert' : undefined} className={`rounded-xl border p-4 text-sm leading-relaxed ${danger ? 'border-danger/30 bg-danger-soft text-ink' : 'border-line bg-paper-deep text-muted'}`}>{children}</div>
}
