import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

/**
 * Accordion section for the Settings page. Header (icon + title + optional badge)
 * toggles the body with a smooth height animation (grid-template-rows 0fr→1fr).
 * Children mount lazily on first open (so e.g. WalletSummary only fetches when the
 * user expands it) and stay mounted afterwards so re-toggles animate. Default closed.
 */
export function CollapsibleSection({
  title,
  subtitle,
  icon,
  tint,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string
  subtitle?: string
  icon?: ReactNode
  /** Accent color (hex) for the icon tile — gives each section a consistent
   *  color identity (the signature grouped-settings look). Icon inherits it via
   *  currentColor, so pass icons WITHOUT their own text-color class. */
  tint?: string
  badge?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [mounted, setMounted] = useState(defaultOpen)

  const toggle = () => {
    setOpen((v) => !v)
    setMounted(true)
  }

  return (
    <section className={`bg-card rounded-2xl border transition-colors ${open ? 'border-border shadow-sm' : 'border-border/70'}`}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="group w-full flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 text-left cursor-pointer rounded-2xl transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <div className="flex items-center gap-3 min-w-0">
          {icon && (
            <span
              className={`shrink-0 flex items-center justify-center w-9 h-9 rounded-[11px] transition-colors ${tint ? '' : 'bg-accent/60 text-muted-foreground group-hover:bg-accent'}`}
              style={tint ? { backgroundColor: tint + '24', color: tint } : undefined}
            >
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-sm sm:text-[15px] font-semibold text-foreground truncate leading-tight">{title}</h2>
            {subtitle && <p className="text-xs text-muted-foreground truncate mt-0.5">{subtitle}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          {badge}
          <ChevronDown className={`w-4 h-4 text-content-tertiary transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>
      <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <div className={`px-4 sm:px-5 pb-5 pt-1 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0'}`}>
            {mounted ? children : null}
          </div>
        </div>
      </div>
    </section>
  )
}
