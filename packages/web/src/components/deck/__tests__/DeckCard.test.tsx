import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { DeckCard } from '../DeckCard'
import type { Deck } from '../../../types/database'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => navigateMock,
  }
})

vi.mock('../../../stores/auth-store', () => ({
  useAuthStore: vi.fn(() => ({
    user: { id: 'me-user-id', email: 'me@test.local' },
  })),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: 'en' },
  }),
}))

vi.mock('../../sharing/ShareBadge', () => ({
  ShareBadge: () => null,
}))

function makeDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'deck-1',
    user_id: 'me-user-id',
    name: 'My Deck',
    description: '',
    default_template_id: null,
    color: '#3B82F6',
    icon: '📚',
    is_archived: false,
    sort_order: 0,
    next_position: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    share_mode: null,
    source_deck_id: null,
    source_owner_id: null,
    is_readonly: false,
    srs_settings: null,
    ...overrides,
  } as Deck
}

function renderCard(props: Partial<Parameters<typeof DeckCard>[0]> = {}) {
  return render(
    <MemoryRouter>
      <DeckCard
        deck={makeDeck()}
        onDelete={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  )
}

describe('DeckCard — owned vs subscribed branching', () => {
  it('owned deck (deck.user_id === user.id) shows Edit and Delete, not Unsubscribe', () => {
    renderCard()
    expect(screen.getByTitle('card.edit')).toBeInTheDocument()
    expect(screen.getByTitle('card.delete')).toBeInTheDocument()
    expect(screen.queryByLabelText('Unsubscribe')).not.toBeInTheDocument()
  })

  it('subscribed deck (deck.user_id !== user.id) shows Unsubscribe, not Edit/Delete', () => {
    const onUnsubscribe = vi.fn()
    renderCard({
      deck: makeDeck({ user_id: 'someone-else', share_mode: 'subscribe', source_owner_id: 'someone-else' }),
      onUnsubscribe,
    })
    expect(screen.queryByTitle('card.edit')).not.toBeInTheDocument()
    expect(screen.queryByTitle('card.delete')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Unsubscribe')).toBeInTheDocument()
  })

  it('subscribed deck without onUnsubscribe prop hides the button (callsite did not opt in)', () => {
    renderCard({
      deck: makeDeck({ user_id: 'someone-else' }),
      // no onUnsubscribe prop
    })
    expect(screen.queryByLabelText('Unsubscribe')).not.toBeInTheDocument()
  })

  it('clicking Unsubscribe invokes the handler with the deck', () => {
    const onUnsubscribe = vi.fn()
    const deck = makeDeck({ user_id: 'someone-else' })
    renderCard({ deck, onUnsubscribe })
    screen.getByLabelText('Unsubscribe').click()
    expect(onUnsubscribe).toHaveBeenCalledTimes(1)
    expect(onUnsubscribe).toHaveBeenCalledWith(deck)
  })

  it('Study button is always present (owned and subscribed)', () => {
    renderCard()
    expect(screen.getByText('card.startStudy')).toBeInTheDocument()
    renderCard({
      deck: makeDeck({ user_id: 'someone-else' }),
      onUnsubscribe: vi.fn(),
    })
    expect(screen.getAllByText('card.startStudy').length).toBeGreaterThan(0)
  })
})
