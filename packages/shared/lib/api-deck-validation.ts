/**
 * Deck creation validation — pure functions, no side effects.
 */

export interface DeckCreatePayload {
  name: string
  description?: string
  color?: string
  icon?: string
  default_template_id?: string
  srs_settings?: {
    again_days: number
    hard_days: number
    good_days: number
    easy_days: number
  }
}

export interface DeckValidationResult {
  valid: boolean
  errors: string[]
  sanitized?: DeckCreatePayload
}

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const DEFAULT_COLOR = '#3B82F6'
const DEFAULT_ICON = '📚'

const SRS_KEYS = ['again_days', 'hard_days', 'good_days', 'easy_days'] as const

/** Validate a deck creation payload. */
export function validateDeckPayload(payload: unknown): DeckValidationResult {
  const errors: string[] = []

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, errors: ['request body must be an object'] }
  }

  const p = payload as Record<string, unknown>

  // name (required)
  const rawName = typeof p.name === 'string' ? p.name.trim() : ''
  if (!rawName) {
    errors.push('name is required')
  } else if (rawName.length > 100) {
    errors.push('name must be 100 characters or less')
  }

  // description (optional)
  if (p.description !== undefined) {
    if (typeof p.description !== 'string') {
      errors.push('description must be a string')
    } else if (p.description.length > 500) {
      errors.push('description must be 500 characters or less')
    }
  }

  // color (optional, default #3B82F6)
  if (p.color !== undefined) {
    if (typeof p.color !== 'string' || !HEX_COLOR_RE.test(p.color)) {
      errors.push('color must be a valid hex color (e.g. #3B82F6)')
    }
  }

  // icon (optional, default 📚)
  if (p.icon !== undefined) {
    if (typeof p.icon !== 'string') {
      errors.push('icon must be a string')
    } else if (p.icon.length > 10) {
      errors.push('icon must be 10 characters or less')
    }
  }

  // default_template_id (optional, UUID)
  if (p.default_template_id !== undefined) {
    if (typeof p.default_template_id !== 'string' || !UUID_RE.test(p.default_template_id)) {
      errors.push('default_template_id must be a valid UUID')
    }
  }

  // srs_settings (optional)
  if (p.srs_settings !== undefined) {
    if (!p.srs_settings || typeof p.srs_settings !== 'object' || Array.isArray(p.srs_settings)) {
      errors.push('srs_settings must be an object')
    } else {
      const srs = p.srs_settings as Record<string, unknown>
      for (const key of SRS_KEYS) {
        if (typeof srs[key] !== 'number' || !Number.isFinite(srs[key] as number)) {
          errors.push(`srs_settings.${key} must be a non-negative number`)
        } else if ((srs[key] as number) < 0) {
          errors.push(`srs_settings.${key} must be a non-negative number`)
        }
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return {
    valid: true,
    errors: [],
    sanitized: {
      name: rawName,
      description: p.description as string | undefined,
      color: (p.color as string) || DEFAULT_COLOR,
      icon: (p.icon as string) || DEFAULT_ICON,
      default_template_id: p.default_template_id as string | undefined,
      srs_settings: p.srs_settings as DeckCreatePayload['srs_settings'],
    },
  }
}
