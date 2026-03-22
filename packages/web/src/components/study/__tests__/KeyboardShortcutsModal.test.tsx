import { render, screen } from '@testing-library/react'

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => {
      const translations: Record<string, string> = {
        'shortcuts.title': 'Keyboard Shortcuts',
        'shortcuts.description': 'Available shortcuts during study sessions',
        'shortcuts.rateCards': 'Again / Hard / Good / Easy',
        'shortcuts.flipCard': 'Flip card (both directions)',
        'shortcuts.undoRating': 'Undo last rating',
        'shortcuts.exitStudy': 'Exit study',
        'shortcuts.toggleHelp': 'Toggle this help',
        'shortcuts.gotIt': 'Got It',
        'shortcuts.missed': 'Missed',
        'shortcuts.known': 'Known',
        'shortcuts.unknown': 'Unknown',
        'shortcuts.swipeHint': 'In swipe mode, swipe left/right to rate cards.',
      }
      return translations[key] ?? fallback ?? key
    },
  }),
}))

// Mock radix dialog to render inline for testing
vi.mock('@radix-ui/react-dialog', () => {
  type P = { children: import('react').ReactNode; open?: boolean }
  return {
    Root: ({ children, open }: P) =>
      open ? <div data-testid="dialog-root">{children}</div> : null,
    Portal: ({ children }: P) => <>{children}</>,
    Overlay: ({ children }: P) => <div>{children}</div>,
    Content: ({ children }: P) => <div data-testid="dialog-content">{children}</div>,
    Title: ({ children }: P) => <h2>{children}</h2>,
    Description: ({ children }: P) => <p>{children}</p>,
    Close: ({ children }: P) => <button>{children}</button>,
    Trigger: ({ children }: P) => <button>{children}</button>,
  }
})

vi.mock('lucide-react', () => ({
  XIcon: () => <span>X</span>,
}))

import { KeyboardShortcutsModal } from '../KeyboardShortcutsModal'

describe('KeyboardShortcutsModal', () => {
  it('renders SRS mode shortcuts when open', () => {
    render(<KeyboardShortcutsModal open={true} onClose={() => {}} mode="srs" />)

    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()
    expect(screen.getByText('Again / Hard / Good / Easy')).toBeInTheDocument()
    expect(screen.getByText('Flip card (both directions)')).toBeInTheDocument()
    expect(screen.getByText('Undo last rating')).toBeInTheDocument()
    expect(screen.getByText('Exit study')).toBeInTheDocument()
  })

  it('renders non-SRS mode shortcuts with arrow keys', () => {
    render(<KeyboardShortcutsModal open={true} onClose={() => {}} mode="random" />)

    expect(screen.getByText('Known')).toBeInTheDocument()
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })

  it('renders swipe mode with hint', () => {
    render(<KeyboardShortcutsModal open={true} onClose={() => {}} mode="srs" isSwipeMode />)

    expect(screen.getByText('In swipe mode, swipe left/right to rate cards.')).toBeInTheDocument()
    // No rating keys in swipe mode
    expect(screen.queryByText('Again / Hard / Good / Easy')).not.toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(<KeyboardShortcutsModal open={false} onClose={() => {}} />)
    expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument()
  })

  it('displays common shortcut keys', () => {
    render(<KeyboardShortcutsModal open={true} onClose={() => {}} mode="srs" />)

    expect(screen.getByText('Space')).toBeInTheDocument()
    expect(screen.getByText('Ctrl+Z')).toBeInTheDocument()
    expect(screen.getByText('Escape')).toBeInTheDocument()
    expect(screen.getByText('?')).toBeInTheDocument()
  })
})
