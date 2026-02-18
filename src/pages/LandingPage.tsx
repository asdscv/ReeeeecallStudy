import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Brain, Layers, BarChart3, Share2, Globe, Smartphone, Zap, BookOpen, CheckCircle2 } from 'lucide-react'
import { SEOHead } from '../components/content/SEOHead'
import { buildWebApplicationJsonLd } from '../lib/content-seo'

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

  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200/60">
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-between py-4">
        <div className="flex items-center gap-3.5">
          <img src="/favicon.png" alt="" className="w-14 h-14 sm:w-16 sm:h-16" />
          <img src="/logo-text.png" alt="ReeeeecallStudy" className="h-14 sm:h-16 hidden sm:block" />
          <span className="font-extrabold text-gray-900 sm:hidden text-3xl tracking-tight">ReeeeecallStudy</span>
        </div>
        <nav className="flex items-center gap-4">
          <Link to="/content" className="text-sm text-gray-600 hover:text-gray-900 transition no-underline">
            {t('nav.blog', 'Insights')}
          </Link>
        </nav>
      </div>
    </header>
  )
}

export function LandingPage() {
  const { t } = useTranslation('landing')
  const navigate = useNavigate()
  const goLogin = () => navigate('/auth/login')

  const features = FEATURE_ICONS.map(f => ({
    ...f,
    title: t(`features.${f.key}.title`),
    desc: t(`features.${f.key}.desc`),
  }))

  const benefits = Array.from({ length: 8 }, (_, i) => t(`benefits.${i}`))

  return (
    <div className="min-h-screen bg-white">
      <SEOHead
        title={t('seo.title')}
        description={t('seo.description')}
        ogImage="/favicon.png"
        ogType="website"
        canonicalUrl="https://reeeeecallstudy.com"
        jsonLd={buildWebApplicationJsonLd()}
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
      <footer className="border-t border-gray-200 bg-gray-50">
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
        </div>
      </footer>

      {/* ─── Floating CTA ─────────────────────── */}
      <button
        onClick={goLogin}
        className="group fixed bottom-12 left-1/2 -translate-x-1/2 sm:left-auto sm:translate-x-0 sm:right-16 flex items-center gap-3 px-6 py-4 bg-transparent cursor-pointer z-50 whitespace-nowrap touch-manipulation"
      >
        <div className="relative">
          <img src="/favicon.png" alt="" className="w-14 h-14 relative z-10 transition-transform duration-300 group-hover:scale-120 group-hover:rotate-12 active:scale-120 active:rotate-12" />
          <div className="absolute inset-0 bg-blue-500/0 rounded-full blur-xl transition-all duration-300 group-hover:bg-blue-500/40 group-hover:scale-150 group-active:bg-blue-500/40 group-active:scale-150" />
        </div>
        <div className="relative">
          <span className="text-2xl font-bold text-gray-900 relative z-10 transition-all duration-300 group-hover:text-blue-600 group-hover:tracking-wider group-active:text-blue-600 group-active:tracking-wider">{t('floatingCta')}</span>
          <div className="absolute -bottom-1 left-0 w-0 h-0.5 bg-blue-500 rounded-full transition-all duration-300 group-hover:w-full group-hover:shadow-[0_0_10px_rgba(59,130,246,0.6)] group-active:w-full group-active:shadow-[0_0_10px_rgba(59,130,246,0.6)]" />
        </div>
      </button>
    </div>
  )
}
