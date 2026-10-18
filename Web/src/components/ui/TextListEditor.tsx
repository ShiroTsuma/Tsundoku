import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'

export function TextListEditor({
  label,
  itemLabel,
  addLabel,
  values,
  onChange,
  maxLength,
  maxItems,
  disabled = false,
}: {
  label: string
  itemLabel: string
  addLabel: string
  values: string[]
  onChange: (values: string[]) => void
  maxLength?: number
  maxItems?: number
  disabled?: boolean
}) {
  const inputs = useRef<(HTMLInputElement | null)[]>([])
  const pendingFocus = useRef<number | null>(null)
  useEffect(() => {
    if (pendingFocus.current !== null) {
      inputs.current[pendingFocus.current]?.focus()
      pendingFocus.current = null
    }
  }, [values.length])

  return (
    <div aria-label={label} className="flex min-w-0 flex-col gap-1.5" role="group">
      {values.map((value, index) => (
        <div
          className="flex items-center gap-2 rounded-control border border-line bg-sunk py-1 pr-1 pl-3"
          key={index}
        >
          <input
            aria-label={`${itemLabel} ${index + 1}`}
            className="h-8 min-w-0 flex-1 border-0 bg-transparent text-ink outline-none"
            disabled={disabled}
            maxLength={maxLength}
            ref={(input) => {
              inputs.current[index] = input
            }}
            value={value}
            onChange={(event) =>
              onChange(
                values.map((current, position) =>
                  position === index ? event.target.value : current,
                ),
              )
            }
          />
          <button
            aria-label={`Remove ${itemLabel.toLowerCase()} ${value || index + 1}`}
            className="flex size-8 shrink-0 items-center justify-center rounded-pill border-0 bg-transparent text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-50"
            disabled={disabled}
            type="button"
            onClick={() => onChange(values.filter((_, position) => position !== index))}
          >
            <X aria-hidden="true" className="size-3.5" strokeWidth={2.2} />
          </button>
        </div>
      ))}
      <button
        className="h-9 self-start rounded-control border border-dashed border-line-strong bg-transparent px-3 text-ink-2 hover:border-line-focus hover:text-ink disabled:opacity-50"
        disabled={disabled || (maxItems !== undefined && values.length >= maxItems)}
        type="button"
        onClick={() => {
          pendingFocus.current = values.length
          onChange([...values, ''])
        }}
      >
        + {addLabel}
      </button>
    </div>
  )
}
