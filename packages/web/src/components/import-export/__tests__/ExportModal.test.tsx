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

describe('ExportModal', () => {

  // ─── Stateless export: no done step ────────────────

  describe('Stateless export flow', () => {
    it('should stay on select screen after successful export', async () => {
      mockDownloadFile.mockImplementation(() => {})
      const user = userEvent.setup()
      render(<ExportModal {...defaultProps} />)

      await user.click(screen.getByTestId('export-submit'))

      // Modal stays on select screen — export button still present
      expect(screen.getByTestId('export-submit')).toBeInTheDocument()
      expect(screen.getByTestId('export-submit')).not.toBeDisabled()
      // No done screen
      expect(screen.queryByText('exportComplete')).not.toBeInTheDocument()
    })

    it('should allow multiple consecutive exports without reopening', async () => {
      mockDownloadFile.mockImplementation(() => {})
      const user = userEvent.setup()
      render(<ExportModal {...defaultProps} />)

      // First export: CSV
      await user.click(screen.getByTestId('export-submit'))
      expect(mockDownloadFile).toHaveBeenCalledTimes(1)
      expect(mockDownloadFile.mock.calls[0][2]).toMatch(/\.csv$/)

      // Switch to JSON and export again
      await user.click(screen.getByRole('radio', { name: /JSON/i }))
      await user.click(screen.getByTestId('export-submit'))
      expect(mockDownloadFile).toHaveBeenCalledTimes(2)
      expect(mockDownloadFile.mock.calls[1][2]).toMatch(/\.json$/)
    })

    it('should allow exporting from both tabs without reopening', async () => {
      mockDownloadFile.mockImplementation(() => {})
      const user = userEvent.setup()
      render(<ExportModal {...defaultProps} />)

      // Export cards CSV
      await user.click(screen.getByTestId('export-submit'))
      expect(mockDownloadFile).toHaveBeenCalledTimes(1)
      expect(mockDownloadFile.mock.calls[0][2]).toMatch(/_cards_/)

      // Switch to template tab and export
      await user.click(screen.getByTestId('export-tab-template'))
      await user.click(screen.getByTestId('export-submit'))
      expect(mockDownloadFile).toHaveBeenCalledTimes(2)
      expect(mockDownloadFile.mock.calls[1][2]).toMatch(/_template_/)
    })
  })

  // ─── Loading indicator ─────────────────────────────

  describe('Loading indicator', () => {
    it('should show normal export text after failed export (not stuck on exporting)', async () => {
      mockDownloadFile.mockImplementation(() => { throw new Error('fail') })
      const user = userEvent.setup()
      render(<ExportModal {...defaultProps} />)

      await user.click(screen.getByTestId('export-submit'))

      expect(screen.getByTestId('export-submit')).toHaveTextContent('export')
      expect(screen.getByTestId('export-submit')).not.toBeDisabled()
    })
  })

  // ─── Error banner ──────────────────────────────────

  describe('Error banner on download failure', () => {
    it('should show error banner when downloadFile throws', async () => {
      mockDownloadFile.mockImplementation(() => { throw new Error('Download blocked') })
      const user = userEvent.setup()
      render(<ExportModal {...defaultProps} />)

      await user.click(screen.getByTestId('export-submit'))

      expect(screen.getByText('exportFailed')).toBeInTheDocument()
      expect(screen.getByTestId('export-submit')).toBeInTheDocument()
    })

    it('should clear error banner when user retries export successfully', async () => {
      mockDownloadFile.mockImplementationOnce(() => { throw new Error('fail') })
      const user = userEvent.setup()
      render(<ExportModal {...defaultProps} />)

      await user.click(screen.getByTestId('export-submit'))
      expect(screen.getByText('exportFailed')).toBeInTheDocument()

      // Retry succeeds
      mockDownloadFile.mockImplementationOnce(() => {})
      await user.click(screen.getByTestId('export-submit'))

      expect(screen.queryByText('exportFailed')).not.toBeInTheDocument()
    })

    it('should clear error banner when switching tabs', async () => {
      mockDownloadFile.mockImplementation(() => { throw new Error('fail') })
      const user = userEvent.setup()
      render(<ExportModal {...defaultProps} />)

      await user.click(screen.getByTestId('export-submit'))
      expect(screen.getByText('exportFailed')).toBeInTheDocument()

      await user.click(screen.getByTestId('export-tab-template'))
      expect(screen.queryByText('exportFailed')).not.toBeInTheDocument()
    })
  })
})
