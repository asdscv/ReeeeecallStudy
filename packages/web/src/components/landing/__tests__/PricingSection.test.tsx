import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import i18n from 'i18next'
import en from '../../../../public/locales/en/landing.json'
import { BRAIN_GAMES } from '@reklue/shared/lib/brain-games/catalog'
import { STUDY_MODES } from '@reklue/shared/lib/study-validation'
import { PricingSection } from '../PricingSection'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../../lib/supabase', () => ({ supabase: { rpc } }))
vi.mock('../../../stores/billing-store', () => ({ PAYMENTS_ENABLED: true }))
const plans = [{ id: 'standard', title: 'Standard', price_krw: 4900, price_usd_cents: 399, card_limit: 100000, period: 'monthly' }]
const respond = (limit: number | null = 10000, ai: number | null = 10) => rpc.mockImplementation(async (name: string) => name === 'get_public_plans'
  ? { data: plans, error: null }
  : { data: { free_card_limit: limit, free_ai_cards_per_day: ai }, error: limit == null ? { message: 'unavailable' } : null })
const setup = () => render(<MemoryRouter><PricingSection /></MemoryRouter>)
const freePlan = () => screen.getByRole('article', { name: en.pricing.plans.free })

beforeAll(async () => {
  i18n.addResourceBundle('en', 'landing', en, true, true)
  await i18n.changeLanguage('en')
})
beforeEach(() => { rpc.mockReset(); respond() })
afterEach(cleanup)

describe('free-first landing plans', () => {
  it('shows real free limits and the available study modes and games', async () => {
    setup()
    expect(await screen.findByText('Up to 10,000 cards')).toBeInTheDocument()
    const free = within(freePlan())
    expect(free.getByText(`${STUDY_MODES.length} study modes, including SRS`)).toBeInTheDocument()
    expect(free.getByText(`Access to all ${BRAIN_GAMES.length} brain games`)).toBeInTheDocument()
    expect(free.getByText('Daily free AI cards: 10')).toBeInTheDocument()
    expect(free.getByText(en.pricing.features.cards)).toBeInTheDocument()
    expect(free.getByText(en.pricing.features.decks)).toBeInTheDocument()
    expect(free.getByText(en.pricing.features.history)).toBeInTheDocument()
  })

  it('keeps paid plans optional, closed initially and without the paid recommendation', async () => {
    setup()
    const summary = await screen.findByText(en.pricing.optionalTitle)
    const details = summary.closest('details')!
    expect(details).not.toHaveAttribute('open')
    expect(screen.getByText('$3.99/mo')).not.toBeVisible()
    expect(screen.queryByText(en.pricing.recommended)).not.toBeInTheDocument()
    expect(freePlan().compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await userEvent.click(summary)
    expect(details).toHaveAttribute('open')
    expect(screen.getByText('$3.99/mo')).toBeVisible()
    expect(screen.getByText('Up to 100,000 cards')).toBeVisible()
  })

  it('uses changed server limits rather than fixed marketing numbers', async () => {
    respond(12345, 3)
    setup()
    expect(await screen.findByText('Up to 12,345 cards')).toBeInTheDocument()
    expect(screen.getByText('Daily free AI cards: 3')).toBeInTheDocument()
    expect(screen.queryByText('Up to 10,000 cards')).not.toBeInTheDocument()
  })

  it('does not invent storage or AI allowances when the limits request fails', async () => {
    respond(null, null)
    setup()
    await screen.findByText(en.pricing.optionalTitle)
    expect(within(freePlan()).queryByText(/Up to .* cards/)).not.toBeInTheDocument()
    expect(within(freePlan()).queryByText(/Daily free AI cards:/)).not.toBeInTheDocument()
  })

  it('does not advertise a daily AI allowance of zero', async () => {
    respond(10000, 0)
    setup()
    await screen.findByText('Up to 10,000 cards')
    expect(within(freePlan()).queryByText(/Daily free AI cards:/)).not.toBeInTheDocument()
  })

  it('starts the existing signup flow from the free plan', async () => {
    render(<MemoryRouter><Routes><Route path="/" element={<PricingSection />} /><Route path="/auth/login" element={<p>Signup destination</p>} /></Routes></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: en.pricing.ctaFree }))
    expect(screen.getByText('Signup destination')).toBeInTheDocument()
  })
})
