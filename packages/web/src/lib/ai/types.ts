// Re-export from shared — single source of truth.
//
// This file used to be a byte-identical COPY of the shared types. A duplicate that
// happens to agree today is the same hazard the `prompts.ts` copy turned into: it
// silently drifted and lost the Chinese template/card rules, and only its own test
// noticed nothing because that test also read the copy.
export type {
  GenerateMode, GeneratedTemplateField, GeneratedLayoutItem, GeneratedTemplate,
  GeneratedDeck, GeneratedCard, GenerateStep,
} from '@reeeeecall/shared/lib/ai/types'
