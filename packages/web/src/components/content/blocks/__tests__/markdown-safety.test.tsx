import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HeroBlock } from '../HeroBlock'
import { HeadingBlock } from '../HeadingBlock'
import { FeatureCardsBlock } from '../FeatureCardsBlock'
import { NumberedListBlock } from '../NumberedListBlock'
import { HighlightBoxBlock } from '../HighlightBoxBlock'
import { CtaBlock } from '../CtaBlock'

// Mock useTrackEvent used by CtaBlock
vi.mock('../../../../hooks/useTrackEvent', () => ({
  useTrackEvent: () => vi.fn(),
}))

function wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>
}

describe('HeroBlock markdown safety', () => {
  it('strips markdown from title', () => {
    render(<HeroBlock props={{ title: '### **Bold Title**' }} />)
    expect(screen.getByText('Bold Title')).toBeInTheDocument()
    expect(screen.queryByText(/###/)).toBeNull()
    expect(screen.queryByText(/\*\*/)).toBeNull()
  })

  it('strips markdown from subtitle', () => {
    render(<HeroBlock props={{ title: 'Title', subtitle: '> *Italic subtitle*' }} />)
    expect(screen.getByText('Italic subtitle')).toBeInTheDocument()
  })
})

describe('HeadingBlock markdown safety', () => {
  it('strips markdown from text', () => {
    render(<HeadingBlock props={{ level: 2, text: '## **Heading Text**' }} />)
    expect(screen.getByText('Heading Text')).toBeInTheDocument()
  })
})

describe('FeatureCardsBlock markdown safety', () => {
  it('strips markdown from item titles', () => {
    render(
      <FeatureCardsBlock
        props={{
          items: [{ icon: 'star', title: '### Feature', description: 'desc', color: 'blue' }],
        }}
      />,
    )
    expect(screen.getByText('Feature')).toBeInTheDocument()
  })
})

describe('NumberedListBlock markdown safety', () => {
  it('strips markdown from item headings', () => {
    render(
      <NumberedListBlock
        props={{
          items: [{ heading: '**Step One**', description: 'desc' }],
        }}
      />,
    )
    expect(screen.getByText('Step One')).toBeInTheDocument()
  })
})

describe('HighlightBoxBlock markdown safety', () => {
  it('strips markdown from title', () => {
    render(
      <HighlightBoxBlock
        props={{ title: '### **Important**', description: 'desc', variant: 'blue' }}
      />,
    )
    expect(screen.getByText('Important')).toBeInTheDocument()
  })
})

describe('CtaBlock markdown safety', () => {
  it('strips markdown from title and description', () => {
    render(
      <CtaBlock
        props={{
          title: '### **Get Started**',
          description: '> *Join now*',
          buttonText: 'Sign Up',
          buttonUrl: '/auth/login',
        }}
      />,
      { wrapper },
    )
    expect(screen.getByText('Get Started')).toBeInTheDocument()
    expect(screen.getByText('Join now')).toBeInTheDocument()
  })
})
