import { X } from 'lucide-react'
import { useId, useState } from 'react'
import { cn } from '@/lib/utils'

const popoverClass =
  'absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-field border border-line-strong bg-raised p-1 shadow-popover'

export function ChipBox({
  ariaLabel,
  input,
  placeholder,
  selected,
  suggestions,
  onInputChange,
  onPick,
  onRemove,
  onCreate,
  suggestionsPending = false,
  variant = 'genre',
  collapseAfter,
}: {
  ariaLabel: string
  input: string
  placeholder: string
  selected: { key: string; label: string }[]
  suggestions: {
    key: string
    label: string
    description?: string | null | undefined
    global?: boolean | undefined
  }[]
  /** Genres are solid chips, tags lighter ones (as on the details page). */
  variant?: 'genre' | 'tag'
  /** Shows only this many chips until "Show all N". */
  collapseAfter?: number | undefined
  onInputChange: (value: string) => void
  onPick: (key: string) => void
  onRemove: (key: string) => void
  onCreate?: ((value: string) => void) | undefined
  suggestionsPending?: boolean
}) {
  const trimmed = input.trim()
  const canCreate = Boolean(
    onCreate &&
    trimmed &&
    !suggestionsPending &&
    !suggestions.some((item) => item.label.toLocaleLowerCase() === trimmed.toLocaleLowerCase()),
  )
  const [activeIndex, setActiveIndex] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const collapsed = collapseAfter !== undefined && !showAll && selected.length > collapseAfter
  const visibleChips = collapsed ? selected.slice(0, collapseAfter) : selected
  const activeIndexResetKey = JSON.stringify([
    input,
    suggestions.map((item) => item.key),
    canCreate,
  ])
  const [trackedResetKey, setTrackedResetKey] = useState(activeIndexResetKey)
  const listboxId = useId()
  const choiceCount = suggestions.length + (canCreate ? 1 : 0)

  if (trackedResetKey !== activeIndexResetKey) {
    setTrackedResetKey(activeIndexResetKey)
    setActiveIndex(0)
  }

  function pickActiveChoice() {
    const activeSuggestion = suggestions[activeIndex]
    if (activeSuggestion) {
      onPick(activeSuggestion.key)
      return
    }
    if (canCreate) {
      onCreate?.(trimmed)
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if ((event.key === 'Enter' || event.key === 'Tab') && trimmed && choiceCount > 0) {
      event.preventDefault()
      pickActiveChoice()
      return
    }

    if (event.key === 'ArrowDown' && choiceCount > 0) {
      event.preventDefault()
      setActiveIndex((current) => (current + 1) % choiceCount)
      return
    }

    if (event.key === 'ArrowUp' && choiceCount > 0) {
      event.preventDefault()
      setActiveIndex((current) => (current - 1 + choiceCount) % choiceCount)
      return
    }

    const lastSelected = selected.at(-1)
    if (event.key === 'Backspace' && !input && lastSelected) {
      event.preventDefault()
      onRemove(lastSelected.key)
    }
  }

  return (
    <div className="relative">
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-control border border-line-strong bg-ground p-1.5 focus-within:border-ink">
        {visibleChips.map((item) => (
          <span
            className={cn(
              'inline-flex h-[30px] items-center gap-1 rounded-pill border pr-1 pl-2.5',
              variant === 'genre'
                ? 'border-line-strong bg-raised'
                : 'border-line bg-surface text-[13px]',
            )}
            key={item.key}
          >
            {item.label}
            <button
              aria-label={`Remove ${item.label}`}
              className="flex size-[22px] items-center justify-center rounded border-0 bg-transparent text-ink-3 hover:text-ink"
              type="button"
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onRemove(item.key)
              }}
            >
              <X aria-hidden="true" className="size-3" strokeWidth={2.4} />
            </button>
          </span>
        ))}
        {collapseAfter !== undefined && selected.length > collapseAfter ? (
          <button
            className="h-[30px] rounded-pill border-0 bg-transparent px-2.5 font-medium text-ink hover:underline"
            type="button"
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? 'Show fewer' : `Show all ${selected.length}`}
          </button>
        ) : null}
        <input
          aria-activedescendant={
            trimmed && choiceCount > 0 ? `${listboxId}-option-${activeIndex}` : undefined
          }
          aria-autocomplete="list"
          aria-controls={trimmed ? listboxId : undefined}
          aria-expanded={Boolean(trimmed)}
          aria-label={ariaLabel}
          className="h-[30px] min-w-[100px] flex-[1_1_120px] border-0 bg-transparent px-1 text-ink outline-none placeholder:text-ink-3"
          placeholder={placeholder}
          role="combobox"
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
      {trimmed ? (
        <div aria-busy={suggestionsPending} className={popoverClass} id={listboxId} role="listbox">
          {suggestions.map((item, index) => (
            <button
              aria-selected={activeIndex === index}
              className={`w-full rounded-control border-0 px-3 py-2 text-left text-sm text-ink hover:bg-hover ${activeIndex === index ? 'bg-selected' : 'bg-transparent'}`}
              id={`${listboxId}-option-${index}`}
              key={item.key}
              role="option"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPick(item.key)}
            >
              <span className="font-medium">
                {item.global ? (
                  <span aria-label="global" className="mr-1.5 text-[10px] text-status-reading-ink">
                    ◆
                  </span>
                ) : null}
                {item.label}
              </span>
              {item.description ? (
                <span className="mt-0.5 block text-xs text-ink-3">{item.description}</span>
              ) : null}
            </button>
          ))}
          {canCreate ? (
            <button
              aria-selected={activeIndex === suggestions.length}
              className={`w-full rounded-control border-0 px-3 py-2 text-left text-sm font-medium text-ink hover:bg-hover ${activeIndex === suggestions.length ? 'bg-selected' : 'bg-transparent'}`}
              id={`${listboxId}-option-${suggestions.length}`}
              role="option"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onCreate?.(trimmed)}
            >
              Add "{trimmed}"
            </button>
          ) : null}
          {suggestionsPending && !suggestions.length ? (
            <div className="px-3 py-2 text-sm text-ink-3">Searching...</div>
          ) : null}
          {!suggestionsPending && !suggestions.length && !canCreate ? (
            <div className="px-3 py-2 text-sm text-ink-3">No results.</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
