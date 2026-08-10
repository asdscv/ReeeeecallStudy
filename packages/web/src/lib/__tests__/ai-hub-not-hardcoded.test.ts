/**
 * No menu may carry its own copy of the AI feature list.
 *
 * Same shape and same reason as `learning-domains-not-hardcoded.test.ts`. The registry there was
 * written, shipped, and had zero importers for three rounds because every screen kept its own
 * array — and nothing failed, because a hard-coded list renders perfectly. The AI menu has four
 * consumers in two runtimes (web nav, web hub, mobile drawer, mobile hub), so the same mistake
 * here costs four edits per feature instead of one, and the fourth is the one that gets forgotten.
 *
 * A behavioural test cannot see this: a drawer that lists the same three items by hand passes
 * every assertion about what the drawer shows. Only reading the source can.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { aiHubEntries } from '@reeeeecall/shared/lib/ai/hub/catalog'

const REPO_ROOT = join(__dirname, '../../../../..')

/** The four surfaces that render the AI 학습 menu. Each must read it from the registry. */
const MENU_SURFACES = [
  'packages/web/src/components/common/Layout.tsx',
  'packages/web/src/pages/ai/AIHubPage.tsx',
  'packages/mobile/src/navigation/MainDrawer.tsx',
  'packages/mobile/src/screens/ai/AIHubScreen.tsx',
]

/** Strip comments — the prose above and in those files explains ids on purpose. */
function code(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('the AI menu is generated, not typed out', () => {
  it.each(MENU_SURFACES)('%s enumerates the registry', (path) => {
    expect(code(path)).toContain('aiHubEntries')
  })

  it.each(MENU_SURFACES)('%s names no feature route of its own', (path) => {
    // Route strings are the tell. A surface that still writes `/ai-generate` or `'QuizHome'`
    // is deciding for itself what the menu contains, which is exactly what registering is for.
    const source = code(path)
    for (const entry of aiHubEntries()) {
      expect(source, `${path} hardcodes ${entry.webPath}`).not.toContain(`"${entry.webPath}"`)
      expect(source, `${path} hardcodes ${entry.webPath}`).not.toContain(`'${entry.webPath}'`)
      expect(source, `${path} hardcodes ${entry.mobileScreen}`).not.toContain(`'${entry.mobileScreen}'`)
    }
  })

  it.each(MENU_SURFACES)('%s reads titles from the descriptor, not from its own i18n keys', (path) => {
    // The descriptor carries `titleKey`. A surface that writes `t('nav.quiz')` has re-decided
    // what the item is called, and the two will disagree the first time one of them is edited.
    const source = code(path)
    for (const entry of aiHubEntries()) {
      expect(source, `${path} hardcodes ${entry.titleKey}`).not.toContain(entry.titleKey)
    }
  })
})
