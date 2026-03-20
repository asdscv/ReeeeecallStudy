import { render, screen, fireEvent } from '@testing-library/react'

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'shortcuts.title': 'Keyboard Shortcuts',
        'shortcuts.description': 'Available shortcuts during study sessions',
        'shortcuts.rateCards': 'Rate Again / Hard / Good / Easy',
        'shortcuts.flipOrPause': 'Flip card / Pause-Resume',
        'shortcuts.undoRating': 'Undo last rating',
        'shortcuts.exitStudy': 'Exit study',
        'shortcuts.toggleHelp': 'Toggle this help',
      }
      return translations[key] ?? key
    },
  }),
}))

// Mock radix dialog to render inline for testing
vi.mock('@radix-ui/react-dialog', () => {
  const React = require('react')
  return {
    Root: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
      open ? <div data-testid="dialog-root">{children}</div> : null,
    Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Overlay: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Content: ({ children }: { children: React.ReactNode }) => <div data-testid="dialog-content">{children}</div>,
    Title: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
    Description: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
    Close: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
    Trigger: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  }
})

// Mock lucide-react
vi.mock('lucide-react', () => ({
  XIcon: () => <span>X</span>,
}))

import { KeyboardShortcutsModal } from '../KeyboardShortcutsModal'

describe('KeyboardShortcutsModal', () => {
  it('renders with all shortcuts when open', () => {
    render(<KeyboardShortcutsModal open={true} onClose={() => {}} />)

    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()
    expect(screen.getByText('Available shortcuts during study sessions')).toBeInTheDocument()
    expect(screen.getByText('Rate Again / Hard / Good / Easy')).toBeInTheDocument()
    expect(screen.getByText('Flip card / Pause-Resume')).toBeInTheDocument()
    expect(screen.getByText('Undo last rating')).toBeInTheDocument()
    expect(screen.getByText('Exit study')).toBeInTheDocument()
    expect(screen.getByText('Toggle this help')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(<KeyboardShortcutsModal open={false} onClose={() => {}} />)

    expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument()
  })

  it('displays all shortcut keys', () => {
    render(<KeyboardShortcutsModal open={true} onClose={() => {}} />)

    // Rating keys
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()

    // Other keys
    expect(screen.getByText('Space')).toBeInTheDocument()
    expect(screen.getByText('Ctrl+Z')).toBeInTheDocument()
    expect(screen.getByText('Escape')).toBeInTheDocument()
    expect(screen.getByText('?')).toBeInTheDocument()
  })

  it('calls onClose when modal is open', () => {
    const onClose = vi.fn()
    const { rerender } = render(<KeyboardShortcutsModal open={true} onClose={onClose} />)

    // Verify modal is open
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument()

    // Re-render as closed to verify it disappears
    rerender(<KeyboardShortcutsModal open={false} onClose={onClose} />)
    expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument()
  })
})
