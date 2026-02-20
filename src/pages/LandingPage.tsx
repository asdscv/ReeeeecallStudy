import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Brain, Layers, BarChart3, Share2, Globe, Smartphone, Zap, BookOpen, CheckCircle2, Menu, X } from 'lucide-react'
import { SEOHead } from '../components/content/SEOHead'
import {
  buildWebApplicationJsonLd,
  buildOrganizationJsonLd,
  buildWebSiteJsonLd,
  buildHowToJsonLd,
  buildFAQJsonLd,
  buildStaticHreflangAlternates,
} from '../lib/content-seo'
import { SEO } from '../lib/seo-config'
import { useContentStore } from '../stores/content-store'

const FEATURE_ICONS = [
  { icon: Brain, color: 'bg-blue-100 text-blue-600', key: 'srs' },
  { icon: Layers, color: 'bg-purple-100 text-purple-600', key: 'modes' },
  { icon: BarChart3, color: 'bg-green-100 text-green-600', key: 'stats' },
  { icon: Share2, color: 'bg-orange-100 text-orange-600', key: 'sharing' },
  { icon: Globe, color: 'bg-pink-100 text-pink-600', key: 'tts' },
  { icon: Smartphone, color: 'bg-indigo-100 text-indigo-600', key: 'responsive' },
]

function LandingNav() {
  const { t } = useTranslation('landing')
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200/60">
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-between py-4">
        <div className="flex items-center gap-2 sm:gap-3.5 min-w-0">
          <img src="/favicon.png" alt="" className="w-9 h-9 md:w-16 md:h-16 shrink-0 object-contain" />
          <img src="/logo-text.png" alt="ReeeeecallStudy" className="h-14 md:h-16 hidden md:block" />
          <span className="font-extrabold text-gray-900 md:hidden text-lg tracking-tight truncate">ReeeeecallStudy</span>
        </div>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-3">
          <Link to="/content" className="text-sm text-gray-600 hover:text-gray-900 transition no-underline">
            {t('nav.blog', 'Insights')}
          </Link>
          <Link to="/auth/login" className="text-sm text-gray-600 hover:text-gray-900 transition no-underline">
            {t('nav.login', 'Log in')}
          </Link>
          <Link
            to="/auth/login"
            className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition no-underline"
          >
            {t('nav.start', 'Get Started')}
          </Link>
        </nav>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="md:hidden p-2 text-gray-600 hover:bg-gray-100 rounded-lg cursor-pointer"
          aria-label="Menu"
        >
          {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden border-t border-gray-100 bg-white/95 backdrop-blur-md">
          <nav className="max-w-6xl mx-auto px-4 py-3 flex flex-col gap-1">
            <Link
              to="/content"
              onClick={() => setMenuOpen(false)}
              className="px-3 py-3 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition no-underline"
            >
              {t('nav.blog', 'Insights')}
            </Link>
            <Link
              to="/auth/login"
              onClick={() => setMenuOpen(false)}
              className="px-3 py-3 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition no-underline"
            >
              {t('nav.login', 'Log in')}
            </Link>
            <Link
              to="/auth/login"
              onClick={() => setMenuOpen(false)}
              className="mx-3 mt-1 px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition no-underline text-center"
            >
              {t('nav.start', 'Get Started')}
            </Link>
          </nav>
        </div>
      )}
    </header>
  )
}

export function LandingPage() {
  const { t } = useTranslation('landing')
  const navigate = useNavigate()
  const goLogin = () => navigate('/auth/login')
  const { items: contentItems, listLoading: contentLoading, fetchContents } = useContentStore()

  useEffect(() => {
    fetchContents(true)
  }, [fetchContents])

  const features = FEATURE_ICONS.map(f => ({
    ...f,
    title: t(`features.${f.key}.title`),
    desc: t(`features.${f.key}.desc`),
  }))

  const benefits = Array.from({ length: 8 }, (_, i) => t(`benefits.${i}`))

  const howToSteps = [
    { name: t('howItWorks.step1.title'), text: t('howItWorks.step1.desc') },
    { name: t('howItWorks.step2.title'), text: t('howItWorks.step2.desc') },
    { name: t('howItWorks.step3.title'), text: t('howItWorks.step3.desc') },
  ]

  const faqItems = [
    { question: t('faq.q1', 'What is spaced repetition (SRS)?'), answer: t('faq.a1', 'Spaced repetition is a scientifically proven learning method that schedules reviews at optimal intervals to maximize long-term memory retention.') },
    { question: t('faq.q2', 'Is ReeeeecallStudy free?'), answer: t('faq.a2', 'Yes! ReeeeecallStudy is free to use. Sign up with email and password to start learning immediately.') },
    { question: t('faq.q3', 'What study modes are available?'), answer: t('faq.a3', 'ReeeeecallStudy supports 5 study modes: SRS (spaced repetition), Random, Sequential, Sequential Review, and By Date.') },
    { question: t('faq.q4', 'Can I share my flashcard decks?'), answer: t('faq.a4', 'Yes! You can share decks in 3 modes: Copy, Subscribe, and Snapshot. Browse other users\' decks in the marketplace.') },
  ]

  const landingSchemas = [
    buildWebApplicationJsonLd(),
    buildOrganizationJsonLd(),
    buildWebSiteJsonLd(),
    buildHowToJsonLd(t('howItWorks.title'), howToSteps, 'PT3M'),
    buildFAQJsonLd(faqItems),
  ].filter(Boolean)

  return (
    <div className="min-h-screen bg-white">
      <SEOHead
        title={t('seo.title')}
        description={t('seo.description')}
        ogImage={SEO.DEFAULT_OG_IMAGE}
        ogType="website"
        canonicalUrl={`${SEO.SITE_URL}/landing`}
        jsonLd={landingSchemas}
        keywords={['spaced repetition', 'flashcards', 'SRS', 'study app', 'learning platform', 'memorization', 'active recall']}
        hreflangAlternates={buildStaticHreflangAlternates('/landing')}
      />
      <LandingNav />

      {/* ─── Hero ────────────────────────────── */}
      <section className="py-16 sm:py-24 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-blue-50 text-blue-600 text-sm font-medium rounded-full mb-6">
            <Zap className="w-4 h-4" />
            {t('hero.badge')}
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-gray-900 leading-tight mb-6">
            {t('hero.title1')}
            <br />
            <span className="text-blue-600">{t('hero.title2')}</span>
          </h1>

          <p className="text-lg sm:text-xl text-gray-500 max-w-2xl mx-auto mb-10 leading-relaxed">
            {t('hero.subtitle1')}
            <br className="hidden sm:block" />
            {t('hero.subtitle2')}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
            <button
              onClick={goLogin}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-3.5 bg-blue-600 text-white text-base font-semibold rounded-xl hover:bg-blue-700 transition shadow-lg shadow-blue-600/20 cursor-pointer"
            >
              {t('hero.cta.start')} <ArrowRight className="w-5 h-5" />
            </button>
            <button
              onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
              className="w-full sm:w-auto px-8 py-3.5 border border-gray-300 text-gray-700 text-base font-medium rounded-xl hover:bg-gray-50 transition cursor-pointer"
            >
              {t('hero.cta.learn')}
            </button>
          </div>
        </div>
      </section>

      {/* ─── App Preview ────────────────────── */}
      <section className="px-4 pb-16 sm:pb-24">
        <div className="max-w-4xl mx-auto">
          <div className="bg-gray-900 rounded-2xl p-4 sm:p-8 lg:p-10 text-center">
            <img src="/favicon.png" alt="" className="w-32 h-32 sm:w-40 sm:h-40 mx-auto mb-5 opacity-90" />
            <img src="/logo-text.png" alt="ReeeeecallStudy" className="h-20 sm:h-28 mx-auto mb-2 brightness-0 invert" />
            <p className="text-gray-400 text-lg sm:text-2xl">{t('preview.tagline')}</p>
          </div>
        </div>
      </section>

      {/* ─── Features ──────────────────────── */}
      <section id="features" className="py-16 sm:py-24 px-4 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12 sm:mb-16">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">{t('featuresSection.title')}</h2>
            <p className="text-gray-500 text-base sm:text-lg max-w-2xl mx-auto">
              {t('featuresSection.subtitle')}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {features.map((f) => (
              <div key={f.key} className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md transition">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${f.color}`}>
                  <f.icon className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-gray-900 mb-2">{f.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Benefits ──────────────────────── */}
      <section id="benefits" className="py-16 sm:py-24 px-4">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center">
          <div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
              {t('benefitsSection.title')}
            </h2>
            <p className="text-gray-500 text-base sm:text-lg mb-8">
              {t('benefitsSection.subtitle')}
            </p>

            <ul className="space-y-3">
              {benefits.map((b, i) => (
                <li key={i} className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                  <span className="text-gray-700 text-sm sm:text-base">{b}</span>
                </li>
              ))}
            </ul>

            <button
              onClick={goLogin}
              className="mt-8 flex items-center gap-2 px-6 py-3 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition shadow-lg shadow-blue-600/20 cursor-pointer"
            >
              {t('benefitsSection.cta')} <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          <div className="bg-gray-900 rounded-2xl p-6 sm:p-8 space-y-4">
            {Array.from({ length: 4 }, (_, i) => ({
              label: t(`stats.${i}.label`),
              value: t(`stats.${i}.value`),
              change: t(`stats.${i}.change`),
            })).map((stat) => (
              <div key={stat.label} className="flex items-center justify-between bg-gray-800 rounded-xl p-4">
                <div>
                  <p className="text-xs text-gray-400">{stat.label}</p>
                  <p className="text-2xl font-bold text-white">{stat.value}</p>
                </div>
                <span className="text-sm font-semibold text-green-400">{stat.change}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── How it works ──────────────────── */}
      <section className="py-16 sm:py-24 px-4 bg-gray-50">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-12">{t('howItWorks.title')}</h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-8">
            {[
              { step: '1', icon: BookOpen, key: 'step1' },
              { step: '2', icon: Brain, key: 'step2' },
              { step: '3', icon: BarChart3, key: 'step3' },
            ].map((s) => (
              <div key={s.step} className="flex flex-col items-center">
                <div className="w-16 h-16 rounded-full bg-blue-600 text-white text-2xl font-bold flex items-center justify-center mb-5 shadow-lg shadow-blue-600/25">
                  {s.step}
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">{t(`howItWorks.${s.key}.title`)}</h3>
                <p className="text-sm text-gray-500 leading-relaxed whitespace-pre-line max-w-[200px]">{t(`howItWorks.${s.key}.desc`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Latest Insights ────────────────── */}
      {!contentLoading && contentItems.length > 0 && (
        <section className="py-16 sm:py-24 px-4">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-10">
              <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-3">
                {t('nav.blog', 'Insights')}
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              {contentItems.slice(0, 3).map((item) => (
                <Link
                  key={item.id}
                  to={`/content/${item.slug}`}
                  className="group block rounded-2xl overflow-hidden no-underline transition-transform duration-300 hover:scale-[0.98] h-[280px]"
                >
                  {item.thumbnail_url ? (
                    <div className="relative w-full h-full">
                      <img src={item.thumbnail_url} alt={item.title} className="w-full h-full object-cover" loading="lazy" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                      <div className="absolute bottom-0 left-0 right-0 p-5">
                        <h3 className="text-xl font-bold text-white leading-snug">{item.title}</h3>
                      </div>
                    </div>
                  ) : (
                    <div className="relative w-full h-full bg-gradient-to-br from-blue-600 to-blue-800">
                      <div className="absolute bottom-0 left-0 right-0 p-5">
                        <h3 className="text-xl font-bold text-white leading-snug">{item.title}</h3>
                      </div>
                    </div>
                  )}
                </Link>
              ))}
            </div>
            <div className="text-center mt-8">
              <Link
                to="/content"
                className="inline-flex items-center gap-2 text-blue-600 font-semibold hover:text-blue-800 transition no-underline"
              >
                {t('nav.blog', 'Insights')} <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ─── FAQ ─────────────────────────────── */}
      <section className="py-16 sm:py-24 px-4 bg-gray-50">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-10 text-center">
            {t('faq.title', 'Frequently Asked Questions')}
          </h2>
          <div className="space-y-4">
            {faqItems.map((item, i) => (
              <details key={i} className="group bg-white rounded-xl border border-gray-200 overflow-hidden">
                <summary className="flex items-center justify-between cursor-pointer p-5 text-left font-semibold text-gray-900 hover:bg-gray-50 transition">
                  {item.question}
                  <ArrowRight className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-90 shrink-0 ml-4" />
                </summary>
                <div className="px-5 pb-5 text-gray-600 leading-relaxed">
                  {item.answer}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA ───────────────────────────── */}
      <section id="cta" className="py-16 sm:py-24 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
            {t('cta.title')}
          </h2>
          <p className="text-gray-500 text-base sm:text-lg mb-8">
            {t('cta.subtitle')}
          </p>
          <button
            onClick={goLogin}
            className="inline-flex items-center gap-2 px-10 py-4 bg-blue-600 text-white text-lg font-semibold rounded-xl hover:bg-blue-700 transition shadow-lg shadow-blue-600/25 cursor-pointer"
          >
            {t('cta.button')} <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </section>

      {/* ─── Footer ────────────────────────── */}
      <footer className="border-t border-gray-200 bg-gray-50 pb-20 sm:pb-0">
        <div className="max-w-6xl mx-auto px-4 py-10 sm:py-12">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <img src="/favicon.png" alt="" className="w-7 h-7" />
              <span className="font-bold text-gray-900">ReeeeecallStudy</span>
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-500">
              <Link to="/content" className="hover:text-gray-700 transition no-underline">{t('nav.blog', 'Insights')}</Link>
              <Link to="/docs/api" className="hover:text-gray-700 transition no-underline">{t('footer.apiDocs')}</Link>
            </div>
            <p className="text-sm text-gray-400">
              {t('footer.copyright')}
            </p>
          </div>
          <div className="mt-4 text-center sm:text-right">
            <a href="mailto:admin@reeeeecallstudy.xyz" className="text-sm text-gray-400 hover:text-gray-600 transition no-underline">
              admin@reeeeecallstudy.xyz
            </a>
          </div>
        </div>
      </footer>

      {/* ─── Floating CTA ─────────────────────── */}
      <button
        onClick={goLogin}
        className="group fixed bottom-6 sm:bottom-12 left-1/2 -translate-x-1/2 sm:left-auto sm:translate-x-0 sm:right-16 flex items-center gap-2 sm:gap-3 px-4 sm:px-6 py-3 sm:py-4 bg-transparent cursor-pointer z-50 whitespace-nowrap touch-manipulation"
      >
        <div className="relative">
          <img src="/favicon.png" alt="" className="w-10 h-10 sm:w-14 sm:h-14 object-contain relative z-10 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-12 active:scale-110 active:rotate-12" />
          <div className="absolute inset-0 bg-blue-500/0 rounded-full blur-xl transition-all duration-300 group-hover:bg-blue-500/40 group-hover:scale-150 group-active:bg-blue-500/40 group-active:scale-150" />
        </div>
        <div className="relative">
          <span className="text-lg sm:text-2xl font-bold text-gray-900 relative z-10 transition-all duration-300 group-hover:text-blue-600 group-hover:tracking-wider group-active:text-blue-600 group-active:tracking-wider">{t('floatingCta')}</span>
          <div className="absolute -bottom-1 left-0 w-0 h-0.5 bg-blue-500 rounded-full transition-all duration-300 group-hover:w-full group-hover:shadow-[0_0_10px_rgba(59,130,246,0.6)] group-active:w-full group-active:shadow-[0_0_10px_rgba(59,130,246,0.6)]" />
        </div>
      </button>
    </div>
  )
}
