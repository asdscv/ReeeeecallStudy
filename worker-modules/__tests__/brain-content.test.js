import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BRAIN_GAMES, buildDemo } from '../../packages/shared/lib/brain-games/index.ts'
import { BRAIN_CONTENT_GUIDES, brainGuideForQuery, brainContentTags, brainGuideFromTags, brainGuidePath, brainGuideLoginPath } from '../../packages/shared/lib/brain-content.ts'
import { brainTopic, planBrainTopic, brainPromptSection, validateBrainArticle, brainGuideExample, brainExampleBlock } from '../brain-content.js'
import { topicFromKeyword, chooseKeyword, buildKeywordJevRequest } from '../keyword-planner.js'
import { buildPrompt } from '../prompt-builder.js'
import { validateArticle, enrichCtaUrls } from '../content-schema.js'
import { withDropOffCtas } from '../../packages/shared/lib/content-drop-off.ts'
import { renderBlocksToHtml } from '../seo/content-renderer.js'

const topic = (id) => brainTopic(BRAIN_CONTENT_GUIDES.find(g => g.id === id))
const row = (query) => ({ query, impressions: 10, clicks: 0, position: 20 })
const article = () => ({ title: '숫자 야구 규칙', slug: 'code-break-rules', tags: ['puzzle'], meta_title: '숫자 야구 규칙', meta_description: '스트라이크와 볼로 숫자를 찾는 방법', reading_time_minutes: 5,
  content_blocks: [{ type: 'hero', props: { title: '숫자 야구 규칙' } }, ...Array.from({ length: 5 }, () => ({ type: 'paragraph', props: { text: '12에서 0스트라이크, 2볼이면 숫자의 자리를 바꾸어 21을 확인합니다.' } })), { type: 'cta', props: { title: '직접 풀기', description: '작은 문제부터 시작하세요.', buttonText: '게임 시작', buttonUrl: '/unsafe' } }] })

describe('brain guide selection', () => {
  it('covers exactly the shipped games and round-trips destinations through stable tags', () => {
    expect(BRAIN_CONTENT_GUIDES.filter(g => g.id !== 'overview').map(g => g.id).sort()).toEqual(BRAIN_GAMES.map(g => g.id).sort())
    for (const g of BRAIN_CONTENT_GUIDES) {
      expect(brainGuideFromTags(brainContentTags(g.id))?.id).toBe(g.id)
      expect(brainGuideForQuery(g.query)?.id).toBe(g.id)
    }
    expect(brainGuidePath('quickEye')).toBeNull()
    expect(brainGuidePath('https://evil.test')).toBeNull()
    expect(brainGuideLoginPath('codeBreak')).toBe('/auth/login?redirect=%2Fbrain%2Fplay%2FcodeBreak')
  })
  it('recognizes specific game needs before a generic brain-training mention', () => {
    expect(brainGuideForQuery('두뇌 훈련 숫자 야구 하는 법')?.id).toBe('codeBreak')
    expect(brainGuideForQuery('bulls and cows rules')?.id).toBe('codeBreak')
    expect(brainGuideForQuery('24 game puzzle')?.id).toBe('makeNumber')
    for (const q of ['IQ brain training test', '치매 예방 두뇌 게임', 'brain training to prevent dementia', '토익 800점 단어']) expect(brainGuideForQuery(q)).toBeNull()
  })
  it('promotes a game query as a product answer and excludes medical game intent even if the judge says yes', () => {
    const answers = Object.fromEntries(['fit_0','fit_1'].map(k=>[k,{ type:'noul', noul:0.95 }]))
    for (let i=0;i<2;i++) Object.assign(answers,{ [`brand_${i}`]:{type:'noul',noul:0}, [`lang_${i}`]:{type:'choice',choice:'ko'}, [`format_${i}`]:{type:'choice',choice:'guide'}, [`deck_${i}`]:{type:'choice',choice:'toeic'} })
    const { pick, judged } = chooseKeyword([row('숫자 야구 하는 법'),row('치매 예방 두뇌 게임')],answers)
    expect(pick.brainGuide).toBe('codeBreak'); expect(pick.deckFamily).toBeNull()
    expect(judged[0].score).toBe(19)
    expect(topicFromKeyword(pick)).toMatchObject({ brainGuide:'codeBreak', tags:brainContentTags('codeBreak'), targetQuery:pick.query })
    expect(buildKeywordJevRequest([row('brain game rules')]).questions.fit_0.instructions).toContain('actual brain games')
  })
  it('alternates the no-search fallback with deck guides, skips covered games and eventually stops', async () => {
    const db={ getPlannedArticles:vi.fn().mockResolvedValue([]) }
    expect((await planBrainTopic(db)).brainGuide).toBe('overview')
    db.getPlannedArticles.mockResolvedValue([{ tags:brainContentTags('overview'), target_query:'두뇌 훈련 게임 하는 법' }])
    expect(await planBrainTopic(db)).toBeNull()
    expect((await planBrainTopic(db,{allowConsecutive:true})).brainGuide).toBe('setMatch')
    db.getPlannedArticles.mockResolvedValue([{ target_query:'토익 800점 단어' },{tags:brainContentTags('overview')}])
    expect((await planBrainTopic(db)).brainGuide).toBe('setMatch')
    db.getPlannedArticles.mockResolvedValue(BRAIN_CONTENT_GUIDES.map(g=>({tags:brainContentTags(g.id)})))
    expect(await planBrainTopic(db,{allowConsecutive:true})).toBeNull()
  })
})

describe('engine-grounded writing and publishing', () => {
  it('uses a solved real engine example in every game prompt, never a flashcard assignment', () => {
    for (const g of BRAIN_CONTENT_GUIDES.slice(1)) {
      const t=topic(g.id), section=brainPromptSection(t), demo=buildDemo(g.id,{maxCols:4,maxRows:4})
      expect(section).toContain(JSON.stringify(demo.at(-1).view))
      expect(section).toContain(g.rule)
      for(const locale of ['en','ko','ja','vi']) {
        const prompt=buildPrompt(t,locale)
        expect(prompt.system).toContain('Skip the learning-science')
        expect(prompt.user).toContain('Worked example from the app')
      }
    }
  })
  it('rejects invented health benefits and removed content before publication', () => {
    for (const text of ['치매 예방에 좋습니다','Quick Eye improves your memory','Improve your memory by playing','記憶力向上','cải thiện trí nhớ','IQ test']) {
      const a=article();a.content_blocks[1].props.text=text
      expect(validateBrainArticle(a,topic('codeBreak'))).not.toEqual([])
    }
    const good=article();good.content_blocks.forEach(b=>{if(b.type==='paragraph')b.props.text='Use feedback to narrow the possible codes.'});expect(validateBrainArticle(good,topic('codeBreak'))).toEqual([])
  })
  it('publishes a validated game destination, preserving it through UTM enrichment', () => {
    const a=article();expect(validateArticle(a).valid).toBe(true)
    enrichCtaUrls(a,'ko','codeBreak')
    const href=new URL(a.content_blocks.at(-1).props.buttonUrl,'https://reeeeecallstudy.xyz')
    expect(href.pathname).toBe('/auth/login');expect(href.searchParams.get('redirect')).toBe('/brain/play/codeBreak')
    expect(href.searchParams.get('utm_campaign')).toBe(a.slug)
    const blocks=withDropOffCtas(a.content_blocks,a.slug,'toeic:800','codeBreak','ko')
    const html=renderBlocksToHtml(blocks,{deckLink:{href:'/d/wrong-deck',label:'Wrong deck'}})
    expect(html).toContain('두뇌훈련 시작하기');expect(html).toContain('redirect=%2Fbrain%2Fplay%2FcodeBreak')
    expect(html).not.toContain('Wrong deck')
    expect(blocks.find(b=>b.type==='app_cta').props.deckFamily).toBeUndefined()
  })
})


it('the engine proof keeps exactly the codes consistent with each Bulls and Cows clue', () => {
  const example = brainGuideExample('codeBreak')
  expect(example.candidateHistory.map(r=>r.remainingCandidates)).toEqual([['21','31','42','43'],['42'],['42']])
  for(const locale of ['en','ko','ja','vi']) {
    const block = brainExampleBlock(topic('codeBreak'),locale)
    expect(block.props.items[2].description).toContain(': 42.')
    expect(block.props.items[1].description).toContain('21, 31, 42, 43')
  }
})
