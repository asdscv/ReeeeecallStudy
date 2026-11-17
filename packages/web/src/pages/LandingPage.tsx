import { useTranslation } from 'react-i18next'
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

import { LandingNav } from '../components/landing/LandingNav'
import { HeroSection } from '../components/landing/HeroSection'
import { FeaturesSection } from '../components/landing/FeaturesSection'
import { HowItWorksSection } from '../components/landing/HowItWorksSection'
import { PricingSection } from '../components/landing/PricingSection'
import { FAQSection } from '../components/landing/FAQSection'
import { FinalCTASection } from '../components/landing/FinalCTASection'
import { LandingFooter } from '../components/landing/LandingFooter'
import '../components/landing/landing.css'
// Same flag that enables payment — when 'true' it lights up BOTH checkout and the
// landing pricing section. When off, the pricing block is not rendered at all.
import { PAYMENTS_ENABLED } from '../stores/billing-store'

export function LandingPage() {
  const { t, i18n } = useTranslation('landing')
  const howToSteps = [
    { name: t('howItWorks.step1.title'), text: t('howItWorks.step1.desc') },
    { name: t('howItWorks.step2.title'), text: t('howItWorks.step2.desc') },
    { name: t('howItWorks.step3.title'), text: t('howItWorks.step3.desc') },
  ]

  const faqItems = [
    { question: t('faq.q1'), answer: t('faq.a1') },
    { question: t('faq.q2'), answer: t('faq.a2') },
    { question: t('faq.q3'), answer: t('faq.a3') },
    { question: t('faq.q4'), answer: t('faq.a4') },
  ]

  const landingSchemas = [
    buildWebApplicationJsonLd(),
    buildOrganizationJsonLd(),
    buildWebSiteJsonLd(),
    buildHowToJsonLd(t('howItWorks.title'), howToSteps, 'PT3M'),
    buildFAQJsonLd(faqItems),
  ].filter(Boolean)

  return (
    <div className="reklue-landing">
      <SEOHead
        title={t('seo.title')}
        description={t('seo.description')}
        ogImage={SEO.DEFAULT_OG_IMAGE}
        ogType="website"
        canonicalUrl={`${SEO.SITE_URL}/landing${i18n.language !== 'en' ? `?lang=${i18n.language}` : ''}`}
        noIndex={!(SEO.INDEXABLE_LOCALES as readonly string[]).includes(i18n.language)}
        jsonLd={landingSchemas}
        keywords={['spaced repetition', 'flashcards', 'SRS', 'study app', 'learning platform', 'memorization', 'active recall']}
        hreflangAlternates={buildStaticHreflangAlternates('/landing')}
      />
      <LandingNav />
      <main id="landing-main">
        <HeroSection />
        <FeaturesSection />
        <HowItWorksSection />
        {/* Keep the existing payment flag and pricing behavior. */}
        {PAYMENTS_ENABLED && <PricingSection />}
        <FAQSection />
        <FinalCTASection />
      </main>
      <LandingFooter />
    </div>
  )
}
