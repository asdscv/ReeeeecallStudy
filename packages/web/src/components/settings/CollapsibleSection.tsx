import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

/**
 * Accordion section for the Settings page. Header (icon + title + optional badge)
 * toggles the body open/closed. Defaults to collapsed.
 */
export function CollapsibleSection({
  title,
  icon,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string
  icon?: ReactNode
  badge?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="bg-card rounded-xl border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 p-4 sm:p-5 text-left cursor-pointer hover:bg-accent/40 transition"
      >
        <div className="flex items-center gap-2 min-w-0">
          {icon && <span className="shrink-0 flex items-center">{icon}</span>}
          <h2 className="text-sm sm:text-base font-semibold text-foreground truncate">{title}</h2>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {badge}
          <ChevronDown className={`w-5 h-5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>
      {open && <div className="px-4 sm:px-5 pb-4 sm:pb-5 pt-0">{children}</div>}
    </section>
  )
}
