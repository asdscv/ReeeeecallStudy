import type { ReactNode } from 'react'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'

/**
 * EmptyState — shared first-run / no-data / no-results panel.
 *
 * Mirrors the mobile EmptyState API (icon + title + description + action) so
 * both platforms read the same. Always give first-run states a primary action
 * and no-results states a "clear" action — a dead-end empty screen is the tell
 * of an unfinished product.
 */
interface EmptyStateProps {
  /** Emoji string or an icon node. */
  icon?: ReactNode
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
  secondaryAction?: { label: string; onClick: () => void }
  className?: string
}

export function EmptyState({ icon, title, description, action, secondaryAction, className }: EmptyStateProps) {
  return (
    <div className={cn('bg-card rounded-xl border border-border p-8 sm:p-12 text-center', className)}>
      {icon != null && (
        <div className="text-4xl sm:text-5xl mb-4" aria-hidden="true">
          {icon}
        </div>
      )}
      <p className="text-foreground font-medium text-sm sm:text-base">{title}</p>
      {description && <p className="text-muted-foreground mt-1 mb-4 text-sm">{description}</p>}
      {(action || secondaryAction) && (
        <div className={cn('flex items-center justify-center gap-2', description ? '' : 'mt-4')}>
          {action && (
            <Button onClick={action.onClick}>{action.label}</Button>
          )}
          {secondaryAction && (
            <Button variant="outline" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
