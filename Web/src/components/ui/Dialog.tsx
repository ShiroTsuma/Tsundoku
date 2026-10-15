import { X } from 'lucide-react'
import { useEffect, useEffectEvent, useId, useRef, type ReactNode } from 'react'
import { useBodyScrollLock } from '@/components/app/useBodyScrollLock'
import { cn } from '@/lib/utils'
import { Button } from './Button'

export type DialogProps = {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  /** Controls shown in the header, before the close button. */
  actions?: ReactNode
  /** Tailwind max-width class for the panel. */
  widthClassName?: string
  /** Set false while an operation must not be interrupted. */
  dismissible?: boolean
  /** Fits the panel to the screen and scrolls the body, so the footer stays visible. */
  scrollBody?: boolean
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  actions,
  widthClassName = 'max-w-[960px]',
  dismissible = true,
  scrollBody = false,
}: DialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  useBodyScrollLock(open)

  const onEscape = useEffectEvent(() => {
    if (dismissible) onClose()
  })

  // Only on open: re-running on every render would pull focus back to the panel.
  useEffect(() => {
    if (!open) return undefined
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onEscape()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus()
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-overlay px-4 py-10">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'flex w-full flex-col overflow-hidden rounded-dialog border border-line-strong bg-surface text-ink shadow-overlay outline-none',
          scrollBody && 'max-h-[calc(100dvh-5rem)]',
          widthClassName,
        )}
      >
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3 px-6 pt-5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="m-0 font-display text-2xl font-bold">
              {title}
            </h2>
            {description ? (
              <div id={descriptionId} className="mt-1 text-ink-2">
                {description}
              </div>
            ) : null}
          </div>
          {actions ? (
            <div className="order-last w-full sm:order-none sm:w-auto">{actions}</div>
          ) : null}
          {dismissible ? (
            <Button variant="ghost" size="iconSm" aria-label="Close" onClick={onClose}>
              <X aria-hidden="true" className="size-[18px]" />
            </Button>
          ) : null}
        </div>
        {scrollBody ? <div className="min-h-0 flex-1 overflow-y-auto">{children}</div> : children}
        {footer ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-line bg-sunk px-6 py-3.5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}
