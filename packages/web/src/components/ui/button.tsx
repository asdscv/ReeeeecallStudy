import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

/**
 * Button — the single source of truth for button styling.
 *
 * Encodes hover / active / disabled / focus states once so every CTA gets
 * consistent, big-tech-grade feedback (filled buttons darken on hover via the
 * brand/destructive-hover tokens, press scales slightly, disabled shows the
 * not-allowed cursor). Extensible: add a key to `variant`/`size` to grow the
 * system without touching call sites. Use `asChild` to render a Link/anchor
 * with button styling.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-[color,background-color,transform] cursor-pointer select-none active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-brand text-brand-foreground hover:bg-brand-hover active:bg-brand-active',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-accent',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive-hover active:bg-destructive-active',
        outline: 'border border-border bg-transparent text-foreground hover:bg-accent',
        ghost: 'bg-transparent text-foreground hover:bg-accent',
        link: 'bg-transparent text-brand underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-4 text-sm',
        lg: 'h-11 px-6 text-base',
        icon: 'h-10 w-10 p-0',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        ref={ref}
        // Buttons default to type="button" unless explicitly a submit/reset —
        // prevents accidental form submission, a classic web footgun.
        type={asChild ? undefined : (type ?? 'button')}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { buttonVariants }
