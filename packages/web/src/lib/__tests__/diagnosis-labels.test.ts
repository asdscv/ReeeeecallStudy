/**
 * 학습 진단이 화면에 그리는 모든 라벨에 번역이 있고, 엣지의 어휘와 같다.
 *
 * 진단은 라벨만 돌려줍니다 — 산문은 한 글자도 없습니다. 그것이 이 기능이 여덟 개 언어에서
 * 똑같은 품질인 이유이고, 동시에 **번역이 하나 빠지면 학습자가 $1 을 내고 `multi_part` 라는
 * 날 문자열을 읽게 되는** 이유입니다.
 *
 * 화면은 계산된 키로 그립니다:
 *
 *     t(`diagnosis.theme.${finding.theme}`)
 *
 * `i18n-key-usage.test.ts` 는 정적 리터럴만 보고, `translation-keys.test.ts` 는 여덟 로케일이
 * en 과 같은지만 봅니다 — 모든 로케일에서 똑같이 빠진 키는 두 검사를 다 통과합니다. 그게
 * `today.error.*` 가 여덟 번들 전부에서 빠진 채 배포된 경위입니다.
 *
 * 뒷부분은 이 구조가 부르는 다른 어긋남입니다. `weak-themes.ts` 는 엣지 파일의 목록을 다시
 * 적어 둡니다(엣지 파일은 import 가 없어야 하므로). 한쪽에만 추가된 라벨은 조용히 버려지고,
 * 학습자는 값을 치른 발견 하나를 못 보게 됩니다.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  WEAK_THEMES, DIAGNOSIS_ACTIONS,
  MCQ_FLAW_LABELS, SHORT_GAP_LABELS, ESSAY_ASPECT_LABELS, topLabels,
} from '@reeeeecall/shared/lib/weak-themes'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../..')
const LOCALES = ['en', 'ko', 'ja', 'zh', 'vi', 'th', 'id', 'es'] as const
const PLATFORMS = [
  { name: 'web', dir: join(ROOT, 'packages/web/public/locales') },
  { name: 'mobile', dir: join(ROOT, 'packages/mobile/src/i18n/locales') },
]

/** `diagnosis.<family>.<member>` — every one of these is reached by a computed key. */
const FAMILIES: Array<[string, readonly string[]]> = [
  ['theme', WEAK_THEMES],
  ['step', DIAGNOSIS_ACTIONS],
  ['flaw', MCQ_FLAW_LABELS],
  ['gap', SHORT_GAP_LABELS],
  ['aspect', ESSAY_ASPECT_LABELS],
]

/** The panel's own sentences. Static keys, but they ship in the same 16 files. */
const FLAT = [
  'evidenceTitle', 'count', 'mcqTitle', 'shortTitle', 'essayTitle', 'trend', 'tagLine',
  'themeTitle', 'stepsTitle', 'buy', 'buying', 'priceNote',
]

describe('every diagnosis label is translated', () => {
  for (const platform of PLATFORMS) {
    for (const locale of LOCALES) {
      it(`${platform.name}/${locale}`, () => {
        const data = JSON.parse(
          readFileSync(join(platform.dir, locale, 'learning.json'), 'utf-8'),
        ) as { diagnosis?: Record<string, unknown> }
        const d = data.diagnosis ?? {}

        const missing: string[] = []
        for (const key of FLAT) {
          const value = d[key]
          if (typeof value !== 'string' || value.trim() === '') missing.push(key)
        }
        for (const [family, members] of FAMILIES) {
          const bucket = d[family] as Record<string, string> | undefined
          for (const member of members) {
            const value = bucket?.[member]
            if (typeof value !== 'string' || value.trim() === '') missing.push(`${family}.${member}`)
          }
        }
        expect(missing, `${platform.name}/${locale}/learning.json diagnosis strings`).toEqual([])
      })
    }
  }

  it('카드 수를 말하는 문장에는 자리표시자가 있다', () => {
    // `{{n}}` 이 빠지면 "카드 장이에요"가 됩니다. 그리고 i18next 는 `{{count}}` 를 복수형으로
    // 예약해 두었으므로 그 이름을 쓰면 안 됩니다 — 이 저장소가 이미 밟은 지뢰입니다.
    for (const platform of PLATFORMS) {
      for (const locale of LOCALES) {
        const d = (JSON.parse(
          readFileSync(join(platform.dir, locale, 'learning.json'), 'utf-8'),
        ) as { diagnosis: Record<string, Record<string, string>> }).diagnosis
        for (const theme of WEAK_THEMES) {
          if (theme === 'no_pattern') continue
          expect(d.theme[theme], `${platform.name}/${locale} theme.${theme}`).toContain('{{n}}')
        }
      }
    }
  })
})

describe('the render-side vocabulary matches the edge contract', () => {
  const edge = readFileSync(join(ROOT, 'supabase/functions/_shared/ai-diagnosis.ts'), 'utf-8')

  const edgeSet = (name: string): string[] => {
    const match = edge.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\] as const`, 's'))
    if (!match) throw new Error(`${name} not found in ai-diagnosis.ts`)
    return [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  }

  it.each([
    ['WEAK_THEMES', WEAK_THEMES],
    ['DIAGNOSIS_ACTIONS', DIAGNOSIS_ACTIONS],
  ])('%s', (edgeName, renderSet) => {
    expect([...renderSet].sort()).toEqual(edgeSet(edgeName).sort())
  })
})

describe('topLabels', () => {
  it('센 것만, 많은 것부터, 우리 어휘 안에서만', () => {
    const out = topLabels(
      { adjacent_sense: 7, right_category_wrong_item: 3, opposite: 0, made_up_label: 99 },
      MCQ_FLAW_LABELS)
    expect(out).toEqual([
      { label: 'adjacent_sense', count: 7 },
      { label: 'right_category_wrong_item', count: 3 },
    ])
  })

  it('서버가 나중에 추가한 라벨은 조용히 무시한다 — 날 문자열을 그리느니', () => {
    expect(topLabels({ brand_new_flaw: 12 }, MCQ_FLAW_LABELS)).toEqual([])
  })

  it('같은 개수는 항상 같은 순서로 — 키 순서에 기대지 않는다', () => {
    // `jsonb_object_agg` 는 키 순서를 약속하지 않습니다. 동점이 렌더마다 자리를 바꾸면
    // 학습자는 데이터가 움직였다고 읽습니다.
    const a = topLabels({ opposite: 4, unrelated: 4 }, MCQ_FLAW_LABELS)
    const b = topLabels({ unrelated: 4, opposite: 4 }, MCQ_FLAW_LABELS)
    expect(a).toEqual(b)
    expect(a[0].label).toBe('opposite')
  })

  it('없으면 빈 목록', () => {
    expect(topLabels(null, MCQ_FLAW_LABELS)).toEqual([])
    expect(topLabels({}, MCQ_FLAW_LABELS)).toEqual([])
  })
})
