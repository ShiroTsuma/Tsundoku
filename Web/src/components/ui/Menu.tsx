import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export type MenuItem = {
  label: string
  description?: string | undefined
  onSelect: () => void
  disabled?: boolean | undefined
  danger?: boolean | undefined
  /** Set for single-choice menus: the item renders as a radio with a check mark. */
  checked?: boolean | undefined
}

export type MenuSection = { title?: string | undefined; items: MenuItem[] }

/**
 * Small dropdown menu: a trigger button and a list of actions.
 * Closes on Escape, on outside click and after choosing an item.
 * The list renders in a portal with fixed positioning, so scroll containers
 * (tables, panels with overflow) never clip it. It opens upwards when there is
 * more room above the trigger.
 */
export function Menu({
  label,
  triggerContent,
  triggerClassName,
  sections,
  align = 'end',
  widthClassName = 'w-64',
}: {
  /** Accessible name of the trigger. */
  label: string
  triggerContent: ReactNode
  triggerClassName: string
  sections: MenuSection[]
  align?: 'start' | 'end'
  widthClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  function measure() {
    const trigger = triggerRef.current
    if (!trigger) return
    const bounds = trigger.getBoundingClientRect()
    const gap = 8
    const spaceBelow = window.innerHeight - bounds.bottom - gap
    const spaceAbove = bounds.top - gap
    const menuHeight = menuRef.current?.offsetHeight ?? 0
    const menuWidth = menuRef.current?.offsetWidth ?? 0
    const preferredLeft = align === 'start' ? bounds.left : bounds.right - menuWidth
    const viewportLeft = Math.max(8, Math.min(preferredLeft, window.innerWidth - menuWidth - 8))
    const below = spaceBelow >= menuHeight || spaceBelow >= spaceAbove
    setPosition({
      top: below ? bounds.bottom + gap : undefined,
      bottom: below ? undefined : window.innerHeight - bounds.top + gap,
      left: menuWidth ? viewportLeft : align === 'start' ? bounds.left : undefined,
      right: menuWidth ? undefined : align === 'end' ? window.innerWidth - bounds.right : undefined,
      maxHeight: Math.max(120, (below ? spaceBelow : spaceAbove) - 12),
    })
  }

  const onViewportChange = useEffectEvent(measure)

  useEffect(() => {
    if (!open) return undefined
    onViewportChange()
    // The portal exists after the first position update; measure its actual width
    // then keep the dropdown inside the viewport even near the left edge.
    const frame = window.requestAnimationFrame(() => onViewportChange())
    function onPointerDown(event: PointerEvent) {
      const target = event.target
      if (
        target instanceof Node &&
        !rootRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false)
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    const reposition = () => onViewportChange()
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open])

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={triggerClassName}
        ref={triggerRef}
        onClick={() => setOpen((current) => !current)}
      >
        {triggerContent}
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              id={menuId}
              role="menu"
              aria-label={label}
              ref={menuRef}
              className={cn(
                'fixed z-[90] flex flex-col overflow-y-auto rounded-field border border-line-strong bg-raised p-1 shadow-popover',
                widthClassName,
              )}
              style={{
                top: position?.top,
                bottom: position?.bottom,
                left: position?.left,
                right: position?.right,
                maxHeight: position?.maxHeight,
                visibility: position ? 'visible' : 'hidden',
              }}
            >
              {sections.map((section, sectionIndex) => (
                <div
                  key={section.title ?? sectionIndex}
                  className={cn(sectionIndex > 0 && 'mt-1 border-t border-line pt-1')}
                >
                  {section.title ? (
                    <div className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wider text-ink-3 uppercase">
                      {section.title}
                    </div>
                  ) : null}
                  {section.items.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
                      aria-checked={item.checked}
                      disabled={item.disabled}
                      onClick={() => {
                        setOpen(false)
                        item.onSelect()
                      }}
                      className={cn(
                        'flex w-full flex-col items-start rounded-control border-0 bg-transparent px-3 py-2 text-left text-sm disabled:opacity-50',
                        item.danger
                          ? 'text-danger-ink hover:bg-danger-soft'
                          : 'text-ink hover:bg-selected',
                      )}
                    >
                      <span className="flex w-full items-center justify-between gap-3 font-medium">
                        {item.label}
                        {item.checked ? (
                          <Check aria-hidden="true" className="size-4 shrink-0 text-ink-2" />
                        ) : null}
                      </span>
                      {item.description ? (
                        <span className="mt-0.5 text-xs text-ink-3">{item.description}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

type MenuPosition = {
  top: number | undefined
  bottom: number | undefined
  left: number | undefined
  right: number | undefined
  maxHeight: number
}
