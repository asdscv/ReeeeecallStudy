import type { TemplateField } from '../types/database'

/**
 * Reconcile card field_values with the current template fields.
 *
 * - Template fields are the source of truth
 * - Matching fields: preserve existing value
 * - New fields (in template, not in card): empty string
 * - Orphaned fields (in card, not in template): dropped
 *
 * This enables lazy migration — cards are reconciled at edit time,
 * not when the template changes.
 */
export function reconcileFieldValues(
  templateFields: TemplateField[],
  cardValues: Record<string, string> | null | undefined,
): Record<string, string> {
  const existing = cardValues ?? {}
  const result: Record<string, string> = {}

  for (const field of templateFields) {
    result[field.key] = existing[field.key] ?? ''
  }

  return result
}
