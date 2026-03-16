import { useEffect } from 'react'
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
import { useContentStore } from '../stores/content-store'

import { ScrollProgress } from '../components/landing/ScrollProgress'
import { LandingNav } from '../components/landing/LandingNav'
import { HeroSection } from '../components/landing/HeroSection'
import { TrustBadgesSection } from '../components/landing/TrustBadgesSection'
import { AppPreviewSection } from '../components/landing/AppPreviewSection'
import { SectionDivider } from '../components/landing/SectionDivider'
import { FeaturesSection } from '../components/landing/FeaturesSection'
import { StatsSection } from '../components/landing/StatsSection'
import { BenefitsSection } from '../components/landing/BenefitsSection'
import { SocialProofSection } from '../components/landing/SocialProofSection'
import { HowItWorksSection } from '../components/landing/HowItWorksSection'
import { InsightsSection } from '../components/landing/InsightsSection'
import { FAQSection } from '../components/landing/FAQSection'
import { FinalCTASection } from '../components/landing/FinalCTASection'
import { FooterSection } from '../components/landing/FooterSection'
import { FloatingCTA } from '../components/landing/FloatingCTA'

export function LandingPage() {
  const { t } = useTranslation('landing')
  const { fetchContents } = useContentStore()

  useEffect(() => {
    fetchContents(true)
  }, [fetchContents])

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
    <div className="min-h-screen bg-white">
      <SEOHead
        title={t('seo.title')}
        description={t('seo.description')}
        ogImage={SEO.DEFAULT_OG_IMAGE}
        ogType="website"
        canonicalUrl={SEO.SITE_URL}
        jsonLd={landingSchemas}
        keywords={['spaced repetition', 'flashcards', 'SRS', 'study app', 'learning platform', 'memorization', 'active recall']}
        hreflangAlternates={buildStaticHreflangAlternates('/')}
      />
      <ScrollProgress />
      <LandingNav />
      <HeroSection />
      <TrustBadgesSection />
      <AppPreviewSection />
      <SectionDivider type="wave" color="#f9fafb" />
      <FeaturesSection />
      <SectionDivider type="curve" color="#ffffff" />
      <StatsSection />
      <BenefitsSection />
      <SocialProofSection />
      <SectionDivider type="wave" color="#f9fafb" />
      <HowItWorksSection />
      <InsightsSection />
      <FAQSection />
      <SectionDivider type="curve" color="#ffffff" />
      <FinalCTASection />
      <FooterSection />
      <FloatingCTA />
    </div>
  )
}
