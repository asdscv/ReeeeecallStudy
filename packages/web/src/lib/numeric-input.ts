/**
 * Number fields that must accept an empty box.
 *
 * A cleared `<input type="number">` reports `''`, which is not a number — three
 * forms used to store it with `'' as any` and hoped nothing read it before the
 * user typed again. Modelling the empty state in the type makes it visible to
 * every consumer instead.
 */
export type NumericInputValue = number | ''

/** Parse a number input's raw value, preserving the empty state. */
export function parseNumericInput(raw: string): NumericInputValue {
  if (raw === '') return ''
  const parsed = parseInt(raw, 10)
  return Number.isNaN(parsed) ? 0 : parsed
}

/** Read a numeric input value for persistence, substituting a fallback for empty. */
export function numericInputOr(value: NumericInputValue, fallback: number): number {
  return value === '' ? fallback : value
}
