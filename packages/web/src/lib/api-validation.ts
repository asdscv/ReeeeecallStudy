/**
 * API request validation — pure functions, no side effects.
 */

export interface CardCreatePayload {
  template_id: string
  field_values: Record<string, string>
  tags?: string[]
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export interface CardsValidationResult extends ValidationResult {
  cards: CardCreatePayload[]
}

/** Validate a single card creation payload. */
export function validateCardPayload(payload: CardCreatePayload): ValidationResult {
  const errors: string[] = []

  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['request body must be an object'] }
  }

  if (!payload.template_id || typeof payload.template_id !== 'string') {
    errors.push('template_id is required')
  }

  if (!payload.field_values || typeof payload.field_values !== 'object' || Array.isArray(payload.field_values)) {
    errors.push('field_values is required and must be an object')
  } else {
    const keys = Object.keys(payload.field_values)
    if (keys.length === 0) {
      errors.push('field_values must have at least one field')
    }
    for (const key of keys) {
      if (typeof payload.field_values[key] !== 'string') {
        errors.push(`field_values.${key} must be a string`)
      }
    }
  }

  if (payload.tags !== undefined) {
    if (!Array.isArray(payload.tags) || !payload.tags.every((t) => typeof t === 'string')) {
      errors.push('tags must be an array of strings')
    }
  }

  return { valid: errors.length === 0, errors }
}

/** Validate card creation body — accepts single object or array. */
export function validateCardsPayload(body: unknown): CardsValidationResult {
  if (body === null || body === undefined) {
    return { valid: false, errors: ['request body is required'], cards: [] }
  }

  const items = Array.isArray(body) ? body : [body]

  if (items.length === 0) {
    return { valid: false, errors: ['request body must contain at least one card'], cards: [] }
  }

  if (items.length > 100) {
    return { valid: false, errors: ['maximum 100 cards per request'], cards: [] }
  }

  const allErrors: string[] = []
  for (let i = 0; i < items.length; i++) {
    const result = validateCardPayload(items[i])
    if (!result.valid) {
      for (const err of result.errors) {
        allErrors.push(`[${i}] ${err}`)
      }
    }
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    cards: allErrors.length === 0 ? items : [],
  }
}

/** Parse and clamp pagination params. */
export function validatePagination(params: Record<string, string | undefined>): {
  page: number
  per_page: number
} {
  const rawPage = parseInt(params.page ?? '', 10)
  const rawPerPage = parseInt(params.per_page ?? '', 10)

  const page = Number.isFinite(rawPage) ? Math.max(1, rawPage) : 1
  const per_page = Number.isFinite(rawPerPage) ? Math.max(1, Math.min(100, rawPerPage)) : 50

  return { page, per_page }
}
