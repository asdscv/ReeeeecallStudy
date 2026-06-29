import { describe, it, expect } from 'vitest'
import { buildPrompt } from '../prompt-builder.js'
import { GENERATED_LOCALES } from '../locale-policy.js'

const topic = {
  category: 'Study Techniques',
  titleHint: 'Active recall practice',
  keywords: ['active recall', 'retrieval'],
  audience: 'students',
  tags: ['study', 'memory'],
}

const LANG_NAME = {
  en: 'English', ko: 'Korean', zh: 'Chinese', ja: 'Japanese',
  vi: 'Vietnamese', th: 'Thai', id: 'Indonesian', es: 'Spanish',
}

describe('prompt-builder locale coverage (guards the re-expansion promise)', () => {
  // If this import resolved at all, the module-load invariant
  // (GENERATED_LOCALES ⊆ LOCALE_INSTRUCTIONS) already held — flipping generate:true
  // for a locale without instructions would have thrown at import.
  it('every GENERATED locale yields a real localized instruction (not the English fallback)', () => {
    expect(GENERATED_LOCALES.length).toBeGreaterThan(0)
    for (const l of GENERATED_LOCALES) {
      const { user } = buildPrompt(topic, l)
      expect(user).toContain(LANG_NAME[l])
    }
  })

  it('the depth requirement (≥900 words) is enforced in the system prompt', () => {
    const { system } = buildPrompt(topic, 'en')
    expect(system).toContain('900 words')
  })

  it('throws for a generated-but-uninstructed locale (cron-scoped fail-fast, not module load)', () => {
    expect(() => buildPrompt(topic, 'xx')).toThrow(/no LOCALE_INSTRUCTIONS/)
  })
})
