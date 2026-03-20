import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { OnboardingOverlay } from '../OnboardingOverlay'
import { ONBOARDING_STEPS } from '../../../stores/onboarding-store'

// ─── Mocks ──────────────────────────────────────────────────
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

// Mock the onboarding store with controllable state
const mockNextStep = vi.fn()
const mockPrevStep = vi.fn()
const mockSkip = vi.fn()
const mockCompleteStep = vi.fn()
const mockDismiss = vi.fn()

let mockCurrentStep = 0

vi.mock('../../../stores/onboarding-store', async () => {
  const actual = await vi.importActual('../../../stores/onboarding-store')
  return {
    ...actual,
    useOnboardingStore: () => ({
      currentStep: mockCurrentStep,
      showOnboarding: true,
      nextStep: mockNextStep,
      prevStep: mockPrevStep,
      skip: mockSkip,
      completeStep: mockCompleteStep,
      dismiss: mockDismiss,
    }),
  }
})

const renderOverlay = () =>
  render(
    <MemoryRouter>
      <OnboardingOverlay />
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  mockCurrentStep = 0
})

// ─── Rendering ──────────────────────────────────────────────
describe('OnboardingOverlay rendering', () => {
  it('should render the overlay', () => {
    renderOverlay()
    expect(screen.getByTestId('onboarding-overlay')).toBeInTheDocument()
  })

  it('should show 6 step indicator dots', () => {
    renderOverlay()
    const dots = screen.getByTestId('step-dots')
    expect(dots.children).toHaveLength(ONBOARDING_STEPS.length)
  })

  it('should display the first step title (Welcome)', () => {
    renderOverlay()
    expect(screen.getByText('onboarding.welcome.title')).toBeInTheDocument()
  })
})

// ─── Navigation ─────────────────────────────────────────────
describe('OnboardingOverlay navigation', () => {
  it('should call skip when skip button is clicked', async () => {
    const user = userEvent.setup()
    renderOverlay()

    await user.click(screen.getByTestId('onboarding-skip'))
    expect(mockSkip).toHaveBeenCalled()
  })

  it('should call completeStep and nextStep when Get Started is clicked', async () => {
    const user = userEvent.setup()
    renderOverlay()

    await user.click(screen.getByText('onboarding.welcome.action'))
    expect(mockCompleteStep).toHaveBeenCalledWith('welcome')
    expect(mockNextStep).toHaveBeenCalled()
  })

  it('should call prevStep when Back button is clicked on non-first step', async () => {
    mockCurrentStep = 2
    const user = userEvent.setup()
    renderOverlay()

    await user.click(screen.getByLabelText('onboarding.back'))
    expect(mockPrevStep).toHaveBeenCalled()
  })

  it('should have back button disabled on first step', () => {
    mockCurrentStep = 0
    renderOverlay()

    const backBtn = screen.getByLabelText('onboarding.back')
    expect(backBtn).toBeDisabled()
  })
})

// ─── Step titles ────────────────────────────────────────────
describe('Step content display', () => {
  it('should show Welcome step at index 0', () => {
    mockCurrentStep = 0
    renderOverlay()
    expect(screen.getByText('onboarding.welcome.title')).toBeInTheDocument()
  })

  it('should show Create Deck step at index 1', () => {
    mockCurrentStep = 1
    renderOverlay()
    expect(screen.getByText('onboarding.createDeck.title')).toBeInTheDocument()
  })

  it('should show Card Template step at index 2', () => {
    mockCurrentStep = 2
    renderOverlay()
    expect(screen.getByText('onboarding.cardTemplate.title')).toBeInTheDocument()
  })

  it('should show Add Cards step at index 3', () => {
    mockCurrentStep = 3
    renderOverlay()
    expect(screen.getByText('onboarding.addCards.title')).toBeInTheDocument()
  })

  it('should show First Study step at index 4', () => {
    mockCurrentStep = 4
    renderOverlay()
    expect(screen.getByText('onboarding.firstStudy.title')).toBeInTheDocument()
  })

  it('should show Explore Market step at index 5', () => {
    mockCurrentStep = 5
    renderOverlay()
    expect(screen.getByText('onboarding.exploreMarket.title')).toBeInTheDocument()
  })
})

// ─── Action buttons ─────────────────────────────────────────
describe('Action buttons', () => {
  it('should dismiss and navigate when Create Deck action is clicked', async () => {
    mockCurrentStep = 1
    const user = userEvent.setup()
    renderOverlay()

    await user.click(screen.getByText('onboarding.createDeck.action'))
    expect(mockCompleteStep).toHaveBeenCalledWith('create_deck')
    expect(mockDismiss).toHaveBeenCalled()
    expect(mockNavigate).toHaveBeenCalledWith('/decks')
  })

  it('should dismiss and navigate when Browse Marketplace is clicked', async () => {
    mockCurrentStep = 5
    const user = userEvent.setup()
    renderOverlay()

    await user.click(screen.getByText('onboarding.exploreMarket.action'))
    expect(mockCompleteStep).toHaveBeenCalledWith('explore_market')
    expect(mockDismiss).toHaveBeenCalled()
    expect(mockNavigate).toHaveBeenCalledWith('/marketplace')
  })

  it('should dismiss when Finish Setup is clicked on last step', async () => {
    mockCurrentStep = 5
    const user = userEvent.setup()
    renderOverlay()

    await user.click(screen.getByText('onboarding.exploreMarket.actionFinish'))
    expect(mockCompleteStep).toHaveBeenCalledWith('explore_market')
    expect(mockDismiss).toHaveBeenCalled()
  })
})
