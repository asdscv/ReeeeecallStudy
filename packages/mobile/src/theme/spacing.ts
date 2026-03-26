/**
 * Design tokens — Spacing (4px base grid)
 * Re-exports shared spacing and radius tokens for backward compatibility.
 */
import { spacing as sharedSpacing } from '@reeeeecall/shared/design-tokens/spacing'
import { radius } from '@reeeeecall/shared/design-tokens/radius'

export const spacing = sharedSpacing

export const borderRadius = radius

export type Spacing = keyof typeof spacing
