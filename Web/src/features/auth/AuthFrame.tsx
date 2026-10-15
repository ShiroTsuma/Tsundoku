import { Eye, EyeOff, LibraryBig } from 'lucide-react'
import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { fieldClass } from '@/components/ui/fieldStyles'
import { cn } from '@/lib/utils'

export function AuthFrame({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description: string
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10 text-ink">
      <div className="flex items-center gap-2.5 font-display text-xl font-bold">
        <span className="flex size-8 items-center justify-center rounded-control bg-accent text-accent-ink">
          <LibraryBig aria-hidden="true" className="size-[18px]" />
        </span>
        Tsundoku
      </div>
      <div className="w-full max-w-[400px] rounded-dialog border border-line bg-surface p-6 sm:p-8">
        <h1 className="m-0 font-display text-[28px] leading-tight font-bold">{title}</h1>
        <p className="m-0 mt-1 text-ink-2">{description}</p>
        <div className="mt-6">{children}</div>
      </div>
      <p className="m-0 text-sm text-ink-2">{footer}</p>
    </main>
  )
}

type AuthFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  label: string
  error?: string | undefined
  /** Extra content under the field (e.g. the password checklist), linked as its description. */
  hint?: ReactNode
  password?: boolean
}

/** A labelled input with its error and hint linked through aria-describedby. */
export const AuthField = forwardRef<HTMLInputElement, AuthFieldProps>(function AuthField(
  { label, error, hint, password = false, className, ...inputProps },
  ref,
) {
  const id = useId()
  const [visible, setVisible] = useState(false)
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[13px] font-medium text-ink-2" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          ref={ref}
          aria-describedby={describedBy || undefined}
          aria-invalid={error || inputProps['aria-invalid'] ? 'true' : undefined}
          className={cn(fieldClass, password && 'pr-11', className)}
          id={id}
          {...inputProps}
          type={password ? (visible ? 'text' : 'password') : inputProps.type}
        />
        {password ? (
          <button
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-control border-0 bg-transparent text-ink-3 hover:text-ink"
            type="button"
            onClick={() => setVisible((current) => !current)}
            onMouseDown={(event) => event.preventDefault()}
          >
            {visible ? (
              <EyeOff aria-hidden="true" className="size-4" />
            ) : (
              <Eye aria-hidden="true" className="size-4" />
            )}
          </button>
        ) : null}
      </div>
      {error ? (
        <span className="text-[13px] text-danger-ink" id={`${id}-error`}>
          {error}
        </span>
      ) : null}
      {hint ? <div id={`${id}-hint`}>{hint}</div> : null}
    </div>
  )
})
