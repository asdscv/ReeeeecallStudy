export interface AnalyticsEvent {
  category: string
  action: string
  label?: string
  value?: number
}

export interface ValidateEventResult {
  valid: boolean
  event?: AnalyticsEvent
}

const MAX_CATEGORY = 100
const MAX_ACTION = 100
const MAX_LABEL = 200

/**
 * Validate and sanitize an analytics event.
 * Returns { valid: true, event } or { valid: false }.
 */
export function validateEvent(input: AnalyticsEvent): ValidateEventResult {
  if (!input.category?.trim() || !input.action?.trim()) {
    return { valid: false }
  }

  const event: AnalyticsEvent = {
    category: input.category.slice(0, MAX_CATEGORY),
    action: input.action.slice(0, MAX_ACTION),
  }

  if (input.label) {
    event.label = input.label.slice(0, MAX_LABEL)
  }

  if (input.value !== undefined) {
    event.value = input.value
  }

  return { valid: true, event }
}
