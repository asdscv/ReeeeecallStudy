import { render, screen } from '@testing-library/react'
import { StudyCard } from '../StudyCard'
import type { Card, CardTemplate } from '../../../types/database'
import type { StudyInputSettings } from '../../../lib/study-input-settings'

// Mock motion/react to avoid animation issues in tests
vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, style, className, onClick, onTouchStart, onTouchMove, onTouchEnd }: Record<string, unknown>) => {
      const props: Record<string, unknown> = { style, className, onClick, onTouchStart, onTouchMove, onTouchEnd }
      const filtered = Object.fromEntries(
        Object.entries(props).filter(([, v]) => v !== undefined),
      )
      return <div {...filtered}>{children as React.ReactNode}</div>
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// Mock lucide-react
vi.mock('lucide-react', () => ({
  Volume2: () => <span data-testid="volume-icon" />,
}))

// Mock card-renderer
vi.mock('../../../lib/card-renderer', () => ({
  renderCardFace: () => ({ mode: 'default' }),
}))

// Mock layout-styles
vi.mock('../../../lib/layout-styles', () => ({
  getLayoutItemStyle: () => ({ className: 'text-base', fontSize: 16 }),
}))

const mockCard: Card = {
  id: 'card-1',
  deck_id: 'deck-1',
  user_id: 'user-1',
  template_id: 'tpl-1',
  field_values: { front: 'Hello', back: 'World' },
  tags: [],
  sort_position: 0,
  srs_status: 'new',
  ease_factor: 2.5,
  interval_days: 0,
  repetitions: 0,
  next_review_at: null,
  last_reviewed_at: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

const mockTemplate: CardTemplate = {
  id: 'tpl-1',
  user_id: 'user-1',
  name: 'Basic',
  fields: [
    { key: 'front', name: 'Front', type: 'text', order: 0 },
    { key: 'back', name: 'Back', type: 'text', order: 1 },
  ],
  front_layout: [{ field_key: 'front', style: 'primary' as const }],
  back_layout: [{ field_key: 'back', style: 'primary' as const }],
  layout_mode: 'default',
  front_html: '',
  back_html: '',
  is_default: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

const swipeSettings: StudyInputSettings = {
  version: 2,
  mode: 'swipe',
  directions: { left: 'again', right: 'good', up: '', down: '' },
}

const buttonSettings: StudyInputSettings = {
  version: 2,
  mode: 'button',
  directions: { left: 'again', right: 'good', up: '', down: '' },
}

describe('StudyCard — back face rendering', () => {
  it('renders back value from template layout when keys match', () => {
    render(
      <StudyCard
        card={mockCard}
        template={mockTemplate}
        isFlipped={true}
        onFlip={() => {}}
      />,
    )
    // Back face should render "World" from field_values['back']
    expect(screen.getByText('World')).toBeInTheDocument()
    // "Hello" appears in both front face (display:none) and back face reminder
    const helloElements = screen.getAllByText('Hello')
    expect(helloElements.length).toBeGreaterThanOrEqual(2)
  })

  it('renders fallback when template field keys do not match card field_values', () => {
    const mismatchedTemplate: CardTemplate = {
      ...mockTemplate,
      front_layout: [{ field_key: 'field_1', style: 'primary' as const }],
      back_layout: [{ field_key: 'field_2', style: 'primary' as const }],
      fields: [
        { key: 'field_1', name: 'Front', type: 'text', order: 0 },
        { key: 'field_2', name: 'Back', type: 'text', order: 1 },
      ],
    }
    // Card uses keys 'front', 'back' — template expects 'field_1', 'field_2'
    render(
      <StudyCard
        card={mockCard}
        template={mismatchedTemplate}
        isFlipped={true}
        onFlip={() => {}}
      />,
    )
    // Should fall back to Object.values — "World" (second value)
    expect(screen.getByText('World')).toBeInTheDocument()
  })

  it('renders fallback when template is null', () => {
    render(
      <StudyCard
        card={mockCard}
        template={null}
        isFlipped={true}
        onFlip={() => {}}
      />,
    )
    // "Hello" appears in front face (display:none) + back face reminder
    const helloElements = screen.getAllByText('Hello')
    expect(helloElements.length).toBeGreaterThanOrEqual(2)
    // Back value: second value "World"
    expect(screen.getByText('World')).toBeInTheDocument()
  })

  it('renders single field value on both faces when only one field exists', () => {
    const singleFieldCard: Card = {
      ...mockCard,
      field_values: { only: 'Single' },
    }
    render(
      <StudyCard
        card={singleFieldCard}
        template={null}
        isFlipped={true}
        onFlip={() => {}}
      />,
    )
    // Both front reminder and back value should show "Single"
    const singleTexts = screen.getAllByText('Single')
    expect(singleTexts.length).toBeGreaterThanOrEqual(1)
  })
})

describe('StudyCard — swipe hints', () => {
  it('shows swipe hint when flipped + swipe mode', () => {
    render(
      <StudyCard
        card={mockCard}
        template={mockTemplate}
        isFlipped={true}
        onFlip={() => {}}
        inputSettings={swipeSettings}
      />,
    )
    const hint = screen.getByTestId('swipe-hint')
    expect(hint).toBeInTheDocument()
    expect(hint.textContent).toContain('again')
    expect(hint.textContent).toContain('good')
  })

  it('does not show swipe hint in button mode', () => {
    render(
      <StudyCard
        card={mockCard}
        template={mockTemplate}
        isFlipped={true}
        onFlip={() => {}}
        inputSettings={buttonSettings}
      />,
    )
    expect(screen.queryByTestId('swipe-hint')).not.toBeInTheDocument()
  })

  it('does not show swipe hint when not flipped', () => {
    render(
      <StudyCard
        card={mockCard}
        template={mockTemplate}
        isFlipped={false}
        onFlip={() => {}}
        inputSettings={swipeSettings}
      />,
    )
    expect(screen.queryByTestId('swipe-hint')).not.toBeInTheDocument()
  })

  it('shows flip hint when not flipped', () => {
    render(
      <StudyCard
        card={mockCard}
        template={mockTemplate}
        isFlipped={false}
        onFlip={() => {}}
        inputSettings={buttonSettings}
      />,
    )
    expect(screen.getByText('card.tapToFlip')).toBeInTheDocument()
  })

  it('does not show swipe hint when inputSettings is null', () => {
    render(
      <StudyCard
        card={mockCard}
        template={mockTemplate}
        isFlipped={true}
        onFlip={() => {}}
        inputSettings={null}
      />,
    )
    expect(screen.queryByTestId('swipe-hint')).not.toBeInTheDocument()
  })
})
