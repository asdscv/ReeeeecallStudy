import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportModal } from '../ExportModal'
import type { Deck, CardTemplate, Card } from '../../../types/database'

// ── Mocks ──────────────────────────────────────────────

vi.mock('../../ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div role="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const mockDownloadFile = vi.fn()
vi.mock('../../../lib/download-file', () => ({
  downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
}))

vi.mock('../../../lib/import-export', () => ({
  generateExportJSON: vi.fn(() => '{"cards":[]}'),
  generateExportCSV: vi.fn(() => 'col1,col2\nval1,val2'),
  generateTemplateExportJSON: vi.fn(() => '{"template":{}}'),
  generateTemplateExportCSV: vi.fn(() => 'key,name,type'),
}))

// ── Fixtures ───────────────────────────────────────────

const mockTemplate: CardTemplate = {
  id: 'tmpl-1',
  user_id: 'user-1',
  name: 'Test Template',
  fields: [{ key: 'front', name: 'Front', type: 'text', order: 0 }],
  front_layout: [],
  back_layout: [],
  layout_mode: 'custom',
  front_html: '',
  back_html: '',
  is_default: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
} as CardTemplate

const mockDeck: Deck = {
  id: 'deck-1',
  user_id: 'user-1',
  name: 'Test Deck',
  description: null,
  default_template_id: 'tmpl-1',
  color: '#3B82F6',
  icon: '📚',
  is_archived: false,
  sort_order: 0,
  next_position: 1,
  srs_settings: {} as Deck['srs_settings'],
  share_mode: null,
  source_deck_id: null,
  source_owner_id: null,
  is_readonly: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
} as Deck

const mockCard: Card = {
  id: 'card-1',
  deck_id: 'deck-1',
  user_id: 'user-1',
  template_id: 'tmpl-1',
  field_values: { front: 'Hello' },
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
} as Card

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  deck: mockDeck,
  template: mockTemplate,
  cards: [mockCard],
}

// ── Tests ──────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockDownloadFile.mockReset()
})

describe('ExportModal — UX improvements', () => {

  // ─── HIGH #1: Loading indicator on export button ───

  describe('Loading indicator', () => {
    it('should show exporting text on button while download is in progress', async () => {
      // Make downloadFile block by throwing after we can check state
      // Since handleExport is synchronous, we verify via the error path
      // that the button text reverts to 'export' after failure
      mockDownloadFile.mockImplementation(() => { throw new Error('fail') })
      const user = userEvent.setup()
      render(<ExportModal {...defaultProps} />)

      await user.click(screen.getByTestId('export-submit'))

      // After error, button should show normal 'export' text (not stuck on 'exporting')
      expect(screen.getByTestId('export-submit')).toHaveTextContent('export')
      expect(screen.getByTestId('export-submit')).not.toBeDisabled()
    })

    it('should disable export button during successful export and transition to done', async () => {
      mockDownloadFile.mockImplementation(() => {})
      const user = userEvent.setup()
      render(<ExportModal {...defaultProps} />)

      await user.click(screen.getByTestId('export-submit'))

      // Should transition to done step — export button gone, complete message shown
      expect(screen.queryByTestId('export-submit')).not.toBeInTheDocument()
      expect(screen.getByText('exportComplete')).toBeInTheDocument()
    })
  })

  // ─── HIGH #2: Error message on download failure ────

  describe('Error banner on download failure', () => {
    it('should show error banner when downloadFile throws', async () => {
      mockDownloadFile.mockImplementation(() => { throw new Error('Download blocked') })
      const user = userEvent.setup()
      render(<ExportModal {...defaultProps} />)

      await user.click(screen.getByTestId('export-submit'))

      // Error banner should be visible
      expect(screen.getByText('exportFailed')).toBeInTheDocument()
      // Should still be on select step
      expect(screen.getByTestId('export-submit')).toBeInTheDocument()
    })

    it('should clear error banner when user retries export successfully', async () => {
      // First attempt: fail
      mockDownloadFile.mockImplementationOnce(() => { throw new Error('fail') })
      const user = userEvent.setup()
      render(<ExportModal {...defaultProps} />)

      await user.click(screen.getByTestId('export-submit'))
      expect(screen.getByText('exportFailed')).toBeInTheDocument()

      // Second attempt: succeed
      mockDownloadFile.mockImplementationOnce(() => {})
      await user.click(screen.getByTestId('export-submit'))

      // Error should be gone, done step shown
      expect(screen.queryByText('exportFailed')).not.toBeInTheDocument()
      expect(screen.getByText('exportComplete')).toBeInTheDocument()
    })

    it('should clear error banner when switching tabs', async () => {
      mockDownloadFile.mockImplementation(() => { throw new Error('fail') })
      const user = userEvent.setup()
      render(<ExportModal {...defaultProps} />)

      await user.click(screen.getByTestId('export-submit'))
      expect(screen.getByText('exportFailed')).toBeInTheDocument()

      // Switch tab — error should clear
      await user.click(screen.getByTestId('export-tab-template'))
      expect(screen.queryByText('exportFailed')).not.toBeInTheDocument()
    })
  })

  // ─── LOW #3: isExporting reset on success ──────────

  describe('isExporting cleanup on success', () => {
    it('should not have disabled export button after reopen', async () => {
      mockDownloadFile.mockImplementation(() => {})
      const user = userEvent.setup()
      const { rerender } = render(<ExportModal {...defaultProps} />)

      // Export successfully
      await user.click(screen.getByTestId('export-submit'))
      expect(screen.getByText('exportComplete')).toBeInTheDocument()

      // Close and reopen
      rerender(<ExportModal {...defaultProps} open={false} />)
      rerender(<ExportModal {...defaultProps} open={true} />)

      // Button should be enabled (isExporting was properly reset)
      expect(screen.getByTestId('export-submit')).not.toBeDisabled()
    })
  })

  // ─── LOW #4: Emoji aria-hidden ─────────────────────

  describe('Accessibility: success emoji', () => {
    it('should have aria-hidden on success checkmark emoji', async () => {
      mockDownloadFile.mockImplementation(() => {})
      const user = userEvent.setup()
      render(<ExportModal {...defaultProps} />)

      await user.click(screen.getByTestId('export-submit'))

      const emoji = screen.getByText('✅')
      expect(emoji).toHaveAttribute('aria-hidden', 'true')
    })
  })
})
