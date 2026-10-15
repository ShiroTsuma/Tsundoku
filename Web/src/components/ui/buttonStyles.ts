import { cva, type VariantProps } from 'class-variance-authority'

export const buttonStyles = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-control font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-accent font-semibold text-accent-ink hover:bg-accent-hover',
        secondary: 'border border-line-strong bg-raised text-ink hover:bg-selected',
        outline: 'border border-line-strong bg-transparent text-ink hover:bg-hover',
        ghost: 'bg-transparent text-ink-2 hover:bg-hover hover:text-ink',
        danger: 'border border-danger-line bg-danger-soft text-danger-ink hover:bg-danger-line',
      },
      size: {
        sm: 'h-9 px-3 text-[13px]',
        md: 'h-10 px-4 text-sm',
        lg: 'h-11 px-5 text-[15px]',
        icon: 'size-10 p-0',
        iconSm: 'size-9 p-0',
        row: 'tablet-touch-target h-[34px] px-3 text-[13px]',
        iconRow: 'tablet-touch-target size-[34px] p-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

export type ButtonStyleProps = VariantProps<typeof buttonStyles>
