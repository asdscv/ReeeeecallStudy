/**
 * The in-app "research basis" page — what the feature borrows from research, and what research
 * does and does not show.
 *
 * Korean and English only. Health-related copy is held back in the other six locales until each
 * market's rules on health claims have been reviewed; those locales show the disclaimer and the
 * game descriptions, and no link to this page.
 *
 * Deliberately METHODS, not results: the page explains where the training's structure came from,
 * says plainly that brain training has not been shown to prevent dementia, and makes no claim of
 * benefit. Under Korea's medical-device rules software "for the purpose of preventing disease" is a
 * medical device and intended use is judged from labelling and advertising as a whole, so
 * guideline and commission citations about dementia risk reduction stay off this page until a
 * legal review (or an MFDS inquiry) has looked at them. Every sentence here has a source in the
 * internal evidence table (DOCS/BRAIN_TRAINING/EVIDENCE.md).
 */
export interface ResearchSection {
  heading: string
  paragraphs?: string[]
  bullets?: string[]
}

export interface ResearchContent {
  title: string
  sections: ResearchSection[]
  referencesTitle: string
  references: string[]
  disclaimer: string
}

const REFERENCES = [
  'Ball K, et al. (2002). Effects of cognitive training interventions with older adults: a randomized controlled trial. JAMA 288(18):2271–2281. https://doi.org/10.1001/jama.288.18.2271',
  'Ball KK, et al. (2013). Speed of processing training in the ACTIVE study: how much is needed and who benefits? J Aging Health 25(8 Suppl):65S–84S. https://doi.org/10.1177/0898264312470167',
  'Rebok GW, et al. (2014). Ten-year effects of the ACTIVE cognitive training trial on cognition and everyday functioning in older adults. J Am Geriatr Soc 62(1):16–24. https://doi.org/10.1111/jgs.12607',
  'Wolinsky FD, et al. (2013). A randomized controlled trial of cognitive training using a visual speed of processing intervention in middle aged and older adults. PLoS One 8(5):e61624. https://doi.org/10.1371/journal.pone.0061624',
  'Edwards JD, et al. (2018). Systematic review and meta-analyses of useful field of view cognitive training. Neurosci Biobehav Rev 84:72–91. https://doi.org/10.1016/j.neubiorev.2017.11.004',
  'Kaernbach C. (1991). Simple adaptive testing with the weighted up-down method. Percept Psychophys 49(3):227–229. https://doi.org/10.3758/BF03214307',
  'Kessels RPC, et al. (2000). The Corsi block-tapping task: standardization and normative data. Appl Neuropsychol 7(4):252–258. https://doi.org/10.1207/S15324826AN0704_8',
  'Lampit A, et al. (2014). Computerized cognitive training in cognitively healthy older adults: a systematic review and meta-analysis of effect modifiers. PLoS Med 11(11):e1001756. https://doi.org/10.1371/journal.pmed.1001756',
  'Gates NJ, et al. (2020). Computerised cognitive training for 12 or more weeks for maintaining cognitive function in cognitively healthy people in late life. Cochrane Database Syst Rev 2020;(2):CD012277. https://doi.org/10.1002/14651858.CD012277.pub3',
  'Simons DJ, et al. (2016). Do "brain-training" programs work? Psychol Sci Public Interest 17(3):103–186. https://doi.org/10.1177/1529100616661983',
]

const KO: ResearchContent = {
  title: '연구 근거',
  sections: [
    {
      heading: '이 기능은 무엇인가요',
      paragraphs: [
        '두뇌 트레이닝은 집중력과 기억을 쓰는 게임으로 꾸준한 두뇌 활동 습관을 만들도록 돕는 기능입니다. 의료기기가 아니며, 질병의 진단·치료·예방을 목적으로 하지 않습니다.',
      ],
    },
    {
      heading: '어떤 연구를 참고했나요 — 효과가 아니라 «방법»입니다',
      bullets: [
        '「빠른 눈」: 미국의 대규모 노인 인지훈련 연구(ACTIVE)와 후속 연구(IHAMS)에서 쓰인 처리속도 훈련 방식을 참고했습니다. 화면 가운데와 가장자리에 그림이 아주 짧게 나타나면 무엇이 어디에 있었는지 고르는 과제로, 실력에 따라 보이는 시간이 짧아지고 방해물이 늘어납니다. 다만 ACTIVE는 강사가 진행하는 소규모 수업이었고(IHAMS에는 집에서 혼자 한 집단도 있었습니다), 이 앱의 게임은 그 프로그램과 같지 않으며 연구로 검증되지 않았습니다. [1–5]',
        '난이도 자동 조절: 정답률이 일정 수준(빠른 눈 약 80%, 다른 게임 약 85%)에 머물도록 난이도를 조금씩 올리고 내리는 심리학의 «가중 상하법»을 썼습니다. 원래 연구의 목표 정답률은 75%였는데, 다른 게임은 기회가 3번인 라운드가 너무 빨리 끝나지 않도록 조금 높였습니다. 빠른 눈은 기회 없이 20문제씩 하고, 80%는 저희가 정한 기준입니다. [6]',
        '순서·공간 기억 게임: 표준 «코르시 블록» 과제처럼 한 길이에 기회를 두 번 줍니다. 순서 기억 게임은 이 과제처럼 1초에 하나씩 보여 줍니다. [7]',
        '주 3회, 한 번에 5분 또는 20분: 여러 연구를 모은 분석에서 주 3회 이하로 훈련한 연구들이 그보다 자주 한 연구들보다 결과가 좋았지만, 서로 다른 연구를 비교한 것이라 확실하지 않습니다. 같은 분석에서 30분 미만 세션은 근거가 약했는데, 「오늘의 훈련」은 부담 없이 이어 가도록 5분이나 20분 중에서 고르게 해 둘 다 이 기준보다 짧습니다. [8]',
        '기본 과정과 복습 과정: ACTIVE 연구는 10회 수업을 마친 참가자 중 일부에게 약 1년, 3년 시점에 복습 수업을 했습니다. 이 구조를 빌려 10세션 기본 과정과 복습 과정을 만들었습니다. [1, 2]',
      ],
    },
    {
      heading: '연구가 보여 준 것과 보여 주지 못한 것',
      bullets: [
        '인지훈련을 하면 훈련한 과제는 확실히 잘하게 됩니다. 하지만 다른 능력이나 일상생활로 옮겨 간다는 근거는 약합니다. [10]',
        '처리속도 훈련을 받은 사람들은 훈련과 거의 같은 검사의 점수가 올랐고, 10년 뒤에도 일부 차이가 남았습니다. 기억력 같은 다른 능력으로는 옮겨 가지 않았습니다. 그 연구의 훈련은 약 10~12시간이었고, 이 앱의 기본 과정(약 4시간)보다 훨씬 깁니다. [1, 3, 5]',
        '여러 연구를 종합한 코크란 리뷰에서도 효과는 작았고, 1년 뒤까지 유지된다는 근거는 없었습니다. [9]',
        '그래서 게임 레벨은 그 게임의 실력일 뿐, 기억력이나 두뇌 건강을 재는 점수가 아닙니다.',
        '인지훈련이 치매를 예방한다는 것은 확인되지 않았습니다. 이 앱은 그런 효과를 주장하지 않습니다.',
      ],
    },
    {
      heading: '기억력이 걱정된다면',
      paragraphs: [
        '게임을 더 하기보다 가까운 보건소·치매안심센터나 의사와 상담하세요. 만 60세 이상은 보건소(치매안심센터)에서 무료로 인지 선별검사를 받을 수 있습니다.',
      ],
    },
  ],
  referencesTitle: '참고문헌',
  references: REFERENCES,
  disclaimer: '이 기능은 의료기기가 아니며 질병의 진단·치료·예방을 목적으로 하지 않습니다.',
}

const EN: ResearchContent = {
  title: 'Research basis',
  sections: [
    {
      heading: 'What this feature is',
      paragraphs: [
        'Brain Training helps you build a regular brain-activity habit with games that use focus and memory. It is not a medical device and is not intended to diagnose, treat, cure, or prevent any medical condition.',
      ],
    },
    {
      heading: 'What research we drew on — for methods, not results',
      bullets: [
        'Quick Eye is modelled on the speed-of-processing training used in a large US study of older adults (ACTIVE) and a follow-up trial (IHAMS). Pictures flash briefly in the centre and at the edges, and you report what and where they were; the display time shortens and distractors increase as you improve. ACTIVE used small trainer-led classes (IHAMS also had an at-home group); our game is not the same program and has not been tested in a study. [1–5]',
        'Automatic difficulty uses a weighted up-down rule from psychology that keeps your accuracy around a set level (about 80% in Quick Eye, about 85% in the other games). The original studies aimed for 75%; we raised it a little so the other games\' rounds with 3 chances don\'t end too quickly. Quick Eye has no chances (it runs in sets of 20); its 80% is our own choice. [6]',
        'The order and spatial memory games follow the standard Corsi block task\'s two tries at each length; the order game also shows one item per second, as that task does. [7]',
        'Three sessions a week, 5 or 20 minutes each: in a pooled analysis, studies that trained three times a week or less did better than those that trained more often, though this compares different studies and is uncertain. Sessions under 30 minutes had weak evidence; Today\'s Training lets you pick 5 or 20 minutes to keep it easy to stick with, and both are shorter than that. [8]',
        'Core course and refresher course: ACTIVE offered refresher classes about one and three years later to some participants who completed its ten sessions. We borrowed that structure. [1, 2]',
      ],
    },
    {
      heading: 'What the research shows — and what it doesn\'t',
      bullets: [
        'Brain training reliably makes you better at the trained tasks. Evidence that this carries over to other abilities or everyday life is weak. [10]',
        'People in the speed-training study improved on tests very similar to the training, and some difference remained ten years later. The gains did not carry over to other abilities such as memory. That training took about 10–12 hours, far more than this app\'s core course (about 4 hours). [1, 3, 5]',
        'A Cochrane review found small benefits that were not shown to last a year. [9]',
        'Your game levels show your skill at that game. They are not a measure of memory or brain health.',
        'It has not been shown that brain training prevents dementia, and this app makes no such claim.',
      ],
    },
    {
      heading: 'If you are worried about your memory',
      paragraphs: ['Please talk to a doctor or a local health service rather than playing more games.'],
    },
  ],
  referencesTitle: 'References',
  references: REFERENCES,
  disclaimer: 'This feature is not a medical device and is not intended to diagnose, treat, cure, or prevent any medical condition.',
}

/** The page for a language, or null where it is not published yet. */
export function researchContent(language: string | undefined): ResearchContent | null {
  const lang = (language ?? '').slice(0, 2)
  if (lang === 'ko') return KO
  if (lang === 'en') return EN
  return null
}
