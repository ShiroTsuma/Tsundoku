import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'

type PillVariant = 'table' | 'detail' | 'genre' | 'tag'

const pillClasses: Record<PillVariant, string> = {
  table:
    'inline-block h-6 max-w-[9rem] min-w-0 truncate rounded-pill border border-line bg-raised px-2 text-xs leading-[22px] text-ink-2',
  detail: 'rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700',
  genre:
    'inline-flex h-[30px] items-center rounded-pill border border-line-strong bg-raised px-3 font-medium text-ink hover:bg-selected hover:text-ink',
  tag: 'inline-flex h-7 items-center rounded-pill border border-line px-2.5 text-[13px] text-ink-2 hover:border-line-strong hover:text-ink',
}

type MetadataSummaryProps = {
  primary: string
  alternatives: string[]
  totalCount?: number
  countNoun: string
  primaryClassName?: string
  /** `pill`: "+N" badge; `text`: "· N alt titles" in muted text. */
  countStyle?: 'pill' | 'text'
  /** Short noun for the text style, e.g. "alt title". */
  shortNoun?: string
}

export function MetadataSummary({
  primary,
  alternatives,
  totalCount = alternatives.length,
  countNoun,
  primaryClassName = 'block min-w-0 truncate',
  countStyle = 'pill',
  shortNoun = countNoun,
}: MetadataSummaryProps) {
  const tooltip = buildAlternativeTooltip(alternatives, totalCount, countNoun)

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className={primaryClassName} title={primary}>
        {primary}
      </span>
      {totalCount > 0 ? (
        <MetadataTooltip
          ariaLabel={`${totalCount} ${pluralize(countNoun, totalCount)}`}
          content={tooltip}
          triggerClassName={
            countStyle === 'text'
              ? 'shrink-0 cursor-help border-0 bg-transparent p-0 text-ink-3 underline decoration-line-strong decoration-dotted underline-offset-[3px] hover:text-ink-2'
              : 'book-table-badge shrink-0 rounded px-2 py-1 text-xs font-medium'
          }
        >
          {countStyle === 'text'
            ? `· ${totalCount} ${pluralize(shortNoun, totalCount)}`
            : `+${totalCount}`}
        </MetadataTooltip>
      ) : null}
    </div>
  )
}

export function DescribedMetadataPills({
  values,
  descriptions = {},
  maxVisible = 3,
  totalCount,
  empty = '-',
  variant = 'table',
  linkTo,
}: {
  values: string[]
  descriptions?: Record<string, string | null | undefined>
  maxVisible?: number
  totalCount?: number
  empty?: ReactNode
  variant?: PillVariant
  /** Makes each pill a link (e.g. to the library filtered by it). */
  linkTo?: ((value: string) => string) | undefined
}) {
  if (!values.length) {
    return empty
  }

  const visibleValues = values.slice(0, maxVisible)
  const hiddenValues = values.slice(maxVisible)
  const resolvedTotalCount = Math.max(totalCount ?? values.length, values.length)
  const hiddenCount = Math.max(0, resolvedTotalCount - visibleValues.length)
  const unlistedCount = Math.max(0, hiddenCount - hiddenValues.length)
  const hiddenTooltip = [...hiddenValues, unlistedCount > 0 ? `+${unlistedCount} more` : null]
    .filter((line): line is string => Boolean(line))
    .join('\n')

  return (
    <div
      className={`flex ${variant === 'table' ? 'min-w-0 flex-nowrap items-center gap-1 overflow-hidden' : variant === 'detail' ? 'flex-wrap gap-2' : 'flex-wrap gap-1.5'}`}
    >
      {visibleValues.map((value) => (
        <DescribedMetadataPill
          description={descriptions[value]}
          key={value}
          to={linkTo?.(value)}
          value={value}
          variant={variant}
        />
      ))}
      {hiddenCount > 0 ? (
        <MetadataTooltip
          ariaLabel={`${hiddenCount} more${hiddenValues.length ? `: ${hiddenValues.join(', ')}` : ''}`}
          content={hiddenTooltip}
          triggerClassName={
            variant === 'detail'
              ? 'rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700'
              : 'inline-block h-6 shrink-0 rounded-pill border border-line bg-transparent px-2 text-xs leading-[22px] font-medium text-ink-3 hover:text-ink'
          }
        >
          +{hiddenCount}
          {variant === 'table' ? null : ' more'}
        </MetadataTooltip>
      ) : null}
    </div>
  )
}

function DescribedMetadataPill({
  value,
  description,
  variant,
  to,
}: {
  value: string
  description?: string | null | undefined
  variant: PillVariant
  to?: string | undefined
}) {
  const triggerClassName = pillClasses[variant]

  if (!description) {
    const plainPill = to ? (
      <Link className={triggerClassName} to={to}>
        {value}
      </Link>
    ) : (
      <span className={triggerClassName}>{value}</span>
    )
    return variant === 'detail' ? <span className="group relative">{plainPill}</span> : plainPill
  }

  const pill = (
    <MetadataTooltip
      ariaLabel={`${value}: ${description}`}
      content={description}
      to={to}
      triggerClassName={`${triggerClassName} ${to ? '' : 'cursor-help'} underline decoration-dotted decoration-1 underline-offset-[3px]`}
    >
      {value}
    </MetadataTooltip>
  )

  return variant === 'detail' ? <span className="group relative">{pill}</span> : pill
}

function MetadataTooltip({
  ariaLabel,
  children,
  content,
  triggerClassName,
  to,
}: {
  ariaLabel: string
  children: ReactNode
  content: string
  triggerClassName: string
  /** Renders the trigger as a link instead of a button. */
  to?: string | undefined
}) {
  const tooltipId = useId()
  const triggerRef = useRef<HTMLElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0, below: false, maxHeight: 320 })
  const wide = content.length > 240
  const maxWidth = wide ? 448 : 288

  function updatePosition() {
    const trigger = triggerRef.current
    if (!trigger) {
      return
    }

    const bounds = trigger.getBoundingClientRect()
    const availableWidth = Math.max(0, window.innerWidth - 24)
    const halfTooltipWidth = Math.min(maxWidth / 2, availableWidth / 2)
    const centeredLeft = bounds.left + bounds.width / 2
    const left = Math.min(
      window.innerWidth - 12 - halfTooltipWidth,
      Math.max(12 + halfTooltipWidth, centeredLeft),
    )

    // Open towards the side with more room and never taller than that room.
    const gap = 8
    const margin = 12
    const spaceAbove = bounds.top - gap - margin
    const spaceBelow = window.innerHeight - bounds.bottom - gap - margin
    const below = spaceBelow > spaceAbove
    setPosition({
      left,
      top: below ? bounds.bottom : bounds.top,
      below,
      maxHeight: Math.max(80, below ? spaceBelow : spaceAbove),
    })
  }

  const onViewportChange = useEffectEvent(updatePosition)

  function showTooltip() {
    updatePosition()
    setIsOpen(true)
  }

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handler = () => onViewportChange()
    // Esc dismisses the tooltip without moving focus.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('resize', handler)
    window.addEventListener('scroll', handler, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('resize', handler)
      window.removeEventListener('scroll', handler, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen])

  return (
    <>
      {to ? (
        <Link
          aria-describedby={isOpen ? tooltipId : undefined}
          aria-label={ariaLabel}
          className={triggerClassName}
          ref={(element) => {
            triggerRef.current = element
          }}
          to={to}
          onBlur={() => setIsOpen(false)}
          onFocus={showTooltip}
          onMouseEnter={showTooltip}
          onMouseLeave={() => setIsOpen(false)}
        >
          {children}
        </Link>
      ) : (
        <button
          aria-describedby={isOpen ? tooltipId : undefined}
          aria-label={ariaLabel}
          className={triggerClassName}
          ref={(element) => {
            triggerRef.current = element
          }}
          type="button"
          // Tap opens it on touch screens, where there is no hover (Safari doesn't focus buttons on tap).
          onClick={showTooltip}
          onBlur={() => setIsOpen(false)}
          onFocus={showTooltip}
          onMouseEnter={showTooltip}
          onMouseLeave={() => setIsOpen(false)}
        >
          {children}
        </button>
      )}
      {isOpen && typeof document !== 'undefined'
        ? createPortal(
            <span
              className="metadata-tooltip ui-chart-tooltip pointer-events-none fixed z-[80] overflow-hidden text-xs leading-5 font-normal whitespace-pre-line shadow-lg"
              id={tooltipId}
              role="tooltip"
              style={{
                left: position.left,
                top: position.top,
                width: maxWidth,
                maxWidth: 'calc(100vw - 1.5rem)',
                maxHeight: position.maxHeight,
                transform: position.below
                  ? 'translate(-50%, 0.5rem)'
                  : 'translate(-50%, calc(-100% - 0.5rem))',
              }}
            >
              {content}
            </span>,
            document.body,
          )
        : null}
    </>
  )
}

function buildAlternativeTooltip(alternatives: string[], totalCount: number, countNoun: string) {
  if (!alternatives.length) {
    return `${totalCount} ${pluralize(countNoun, totalCount)}`
  }

  const hiddenCount = Math.max(0, totalCount - alternatives.length)
  return [
    `${capitalize(pluralize(countNoun, totalCount))}:`,
    ...alternatives,
    hiddenCount ? `+${hiddenCount} more` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

function pluralize(value: string, count: number) {
  return count === 1 ? value : `${value}s`
}

function capitalize(value: string) {
  return value.charAt(0).toLocaleUpperCase() + value.slice(1)
}
