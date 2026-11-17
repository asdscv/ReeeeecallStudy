import { useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, BookOpen, Check, ChevronRight, Grid2X2, Hash, Layers, LockKeyhole, Repeat2, Search } from 'lucide-react'
import './product-showcase.css'

type View = 'decks' | 'review' | 'games'
const VIEWS: View[] = ['decks', 'review', 'games']
const WORDS = ['serendipity', 'curiosity', 'momentum']
const DECKS = [{ key: 'deckOne', count: 24 }, { key: 'deckTwo', count: 16 }, { key: 'deckThree', count: 8 }]
const RATINGS = ['Again', 'Hard', 'Good', 'Easy']

/** Isolated, labelled sample content. It never reads or writes a visitor's study data. */
export function ProductShowcase() {
  const { t } = useTranslation(['landing', 'brain'])
  const [view, setView] = useState<View>('decks')
  const [deck, setDeck] = useState(0)
  const [query, setQuery] = useState('')
  const [answer, setAnswer] = useState(false)
  const [card, setCard] = useState(0)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const icons = { decks: BookOpen, review: Repeat2, games: Grid2X2 }
  const select = (next: View) => { setView(next); setAnswer(false) }
  const nextCard = () => { setCard(v => (v + 1) % WORDS.length); setAnswer(false) }
  const navigateTabs = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % VIEWS.length
    else if (event.key === 'ArrowLeft') next = (index + VIEWS.length - 1) % VIEWS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = VIEWS.length - 1
    else return
    event.preventDefault(); select(VIEWS[next]); tabs.current[next]?.focus()
  }

  return <section id="features" className="rl-showcase" aria-labelledby="rl-workspace-title">
    <div className="rl-container">
      <div className="rl-workspace-heading"><div><p className="rl-eyebrow">{t('showcase.eyebrow')}</p><h2 id="rl-workspace-title">{t('showcase.title')}</h2></div><p>{t('showcase.intro')}</p></div>
      <div className="rl-workspace-tabs" role="tablist" aria-label={t('showcase.eyebrow')}>
        {VIEWS.map((key, index) => { const Icon = icons[key]; return <button key={key} type="button" role="tab" id={`rl-workspace-tab-${key}`} aria-controls="rl-workspace-panel" aria-selected={view === key} tabIndex={view === key ? 0 : -1} ref={node => { tabs.current[index] = node }} onClick={() => select(key)} onKeyDown={event => navigateTabs(event, index)}><span className="rl-workspace-tab-number">0{index + 1}</span><Icon size={17} aria-hidden="true" /><span>{t(`showcase.${key}`)}</span><ArrowRight className="rl-workspace-tab-arrow" size={17} aria-hidden="true" /></button> })}
      </div>
      <div className="rl-workspace-stage" role="tabpanel" id="rl-workspace-panel" tabIndex={0} aria-labelledby={`rl-workspace-tab-${view}`}>
        <aside className="rl-workspace-sidebar">
          <img src="/brand/reklue-lockup-dark.svg" width={114} height={38} alt="" />
          <div className="rl-workspace-sidebar-menu">{VIEWS.map(key => { const Icon = icons[key]; return <button type="button" key={key} aria-pressed={view === key} onClick={() => select(key)} className={view === key ? 'is-active' : ''}><Icon size={16} /><span>{t(`showcase.${key}`)}</span>{view === key && <i />}</button> })}</div>
          <div className="rl-workspace-sidebar-bottom"><span className="rl-workspace-avatar">R</span><span>Reklue</span><Check size={13} /></div>
        </aside>
        <div className="rl-workspace-main">
          <div className="rl-workspace-toolbar"><span>{view === 'decks' ? t('premium.deckLabel') : view === 'review' ? t('showcase.today') : t('premium.playLabel')}</span><span className="rl-workspace-demo"><i />{t('showcase.demo')}</span></div>
          {view === 'decks' && <div className="rl-library">
            <div className="rl-library-list"><label className="rl-library-search"><Search size={16} aria-hidden="true" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('showcase.search')} aria-label={t('showcase.search')} /></label>
              <div className="rl-library-column-head" aria-hidden="true"><span>{t('showcase.deck')}</span><span>{t('showcase.cards')}</span></div>
              <div className="rl-library-rows">{DECKS.map((item, index) => t(`premium.${item.key}`).toLocaleLowerCase().includes(query.toLocaleLowerCase()) && <button key={item.key} type="button" aria-pressed={deck === index} onClick={() => setDeck(index)} className={`rl-library-row ${deck === index ? 'is-selected' : ''}`}><span className={`rl-library-deck-icon rl-library-deck-${index}`}><BookOpen size={19} /></span><span className="rl-library-deck-name">{t(`premium.${item.key}`)}</span><span className="rl-library-count">{item.count}</span><ChevronRight size={15} aria-hidden="true" /></button>)}</div>
              {!DECKS.some(item => t(`premium.${item.key}`).toLocaleLowerCase().includes(query.toLocaleLowerCase())) && <p className="rl-library-empty">{t('showcase.empty')}</p>}
              <div className="rl-library-note"><Layers size={15} aria-hidden="true" /><span>{t('premium.deckText')}</span></div>
            </div>
            <div className="rl-library-preview"><div className="rl-library-preview-header"><span>{t('showcase.preview')}</span><span>01 / 03</span></div><p className="rl-library-preview-deck">{t(`premium.${DECKS[deck].key}`)}</p><div className="rl-library-preview-word"><span lang="en">{WORDS[deck]}</span><p>{t(`premium.meaning${deck + 1}`)}</p></div><button type="button" onClick={() => { setCard(deck); select('review') }}>{t('showcase.study')}<ArrowRight size={16} aria-hidden="true" /></button></div>
          </div>}
          {view === 'review' && <div className="rl-workspace-review">
            <div className="rl-workspace-review-progress"><span>{t(`premium.${DECKS[deck].key}`)}</span><span>0{card + 1} / 03</span></div>
            <div className="rl-workspace-progress-track" aria-hidden="true"><span style={{ width: `${(card + 1) / WORDS.length * 100}%` }} /></div>
            <div className="rl-workspace-review-content"><span className="rl-workspace-card-label">{t(answer ? 'showcase.answer' : 'showcase.question')}</span><strong lang={answer ? undefined : 'en'}>{answer ? t(`premium.meaning${card + 1}`) : WORDS[card]}</strong>{answer ? <p lang="en">{WORDS[card]}</p> : <p>{t('premium.cardPrompt')}</p>}</div>
            <div className="rl-workspace-review-actions">{answer ? <><div className="rl-workspace-ratings" aria-label={t('premium.ratingLabel')}>{RATINGS.map((rating, index) => <button type="button" key={rating} className={`rl-workspace-rating-${index}`} onClick={nextCard}>{rating}</button>)}</div><button type="button" className="rl-workspace-question" onClick={() => setAnswer(false)}>{t('showcase.back')}</button></> : <button type="button" className="rl-workspace-reveal" onClick={() => setAnswer(true)}>{t('showcase.reveal')}<ArrowRight size={16} aria-hidden="true" /></button>}</div>
          </div>}
          {view === 'games' && <div className="rl-workspace-games">
            <div className="rl-workspace-game-intro"><Grid2X2 size={23} aria-hidden="true" /><h3>{t('premium.playLabel')}</h3><p>{t('premium.playText')}</p></div>
            <div className="rl-workspace-game-list">{(['schulte', 'memoryGrid', 'codeBreak'] as const).map((id, index) => <Link key={id} to={`/brain/play/${id}`}><div className={`rl-workspace-game-art rl-workspace-game-${index}`} aria-hidden="true">{index === 0 ? <><Hash size={25} /><span>1 · 2 · 3</span></> : index === 1 ? <div className="rl-workspace-memory">{Array.from({ length: 9 }, (_, i) => <i key={i} className={i === 1 || i === 5 || i === 6 ? 'is-lit' : ''} />)}</div> : <><LockKeyhole size={25} /><span>• • • •</span></>}</div><div><strong>{t(`games.${id}.name`, { ns: 'brain' })}</strong><p>{t(`games.${id}.desc`, { ns: 'brain' })}</p></div><ArrowRight size={16} aria-hidden="true" /></Link>)}</div>
          </div>}
        </div>
      </div>
      <div className="rl-workspace-caption"><p>{t(`showcase.${view}Description`)}</p><Link to={view === 'games' ? '/brain' : '/auth/login'}>{view === 'games' ? t('premium.playLink') : t('showcase.start')}<ArrowRight size={16} aria-hidden="true" /></Link></div>
      <p className="rl-workspace-footnote">{t('premium.extraNote')}</p>
    </div>
  </section>
}
