import { Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { fieldClass } from './fieldStyles'

export function StateBox({ children, tone }: { children: ReactNode; tone?: 'error' }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-1 rounded-xl border px-6 py-10 text-center',
        tone === 'error'
          ? 'border-danger-line bg-danger-soft text-danger-ink'
          : 'border-dashed border-line text-ink-2',
      )}
      role={tone === 'error' ? 'alert' : undefined}
    >
      {children}
    </div>
  )
}

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'good'
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center rounded-pill border px-2 text-xs font-medium',
        tone === 'good'
          ? 'border-transparent bg-status-finished-soft text-status-finished-ink'
          : 'border-line bg-raised text-ink-2',
      )}
    >
      {children}
    </span>
  )
}

export function ListBox({
  children,
  label,
  onScroll,
  busy,
}: {
  children: ReactNode
  label: string
  onScroll?: (event: React.UIEvent<HTMLDivElement>) => void
  busy?: boolean
}) {
  return (
    <div
      aria-busy={busy}
      aria-label={label}
      className="max-h-[min(70vh,48rem)] overflow-y-auto rounded-xl border border-line bg-sunk"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrollable list must stay keyboard-focusable so it can be scrolled without a mouse (axe scrollable-region-focusable)
      tabIndex={0}
      onScroll={onScroll}
    >
      {children}
    </div>
  )
}

export const listRowClass =
  'flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-soft px-4 py-3 last:border-b-0'

/** Search input with a magnifier, the toolbar search of list screens. */
export function SearchField({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="relative min-w-0 flex-[1_1_320px]">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3"
      />
      <span className="sr-only">{label}</span>
      <input
        autoComplete="off"
        className={cn(fieldClass, 'pl-9 text-sm')}
        placeholder={placeholder}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}
