import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PublicListingPage } from '../PublicListingPage'

const mockRpc = vi.fn()

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}))

vi.mock('../../stores/auth-store', () => ({
  useAuthStore: vi.fn(() => ({ user: null, loading: false })),
}))

const mockListing = {
  id: 'listing-1',
  title: 'Test Deck',
  description: 'A test deck description',
  tags: ['test', 'flashcards'],
  category: 'general',
  card_count: 50,
  acquire_count: 10,
  share_mode: 'copy',
  created_at: '2025-01-01T00:00:00Z',
  owner_name: 'TestUser',
  owner_is_official: false,
  sample_fields: [
    { field_values: { front: 'hello', back: 'world' } },
    { field_values: { front: 'foo', back: 'bar' } },
  ],
}

function renderPage(listingId = 'listing-1') {
  return render(
    <MemoryRouter initialEntries={[`/d/${listingId}`]}>
      <Routes>
        <Route path="/d/:listingId" element={<PublicListingPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PublicListingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show loading skeleton initially', () => {
    mockRpc.mockReturnValue(new Promise(() => {})) // never resolves
    renderPage()
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('should render listing title and description after loading', async () => {
    mockRpc.mockResolvedValue({ data: mockListing, error: null })
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('listing-title')).toHaveTextContent('Test Deck')
    })
    expect(screen.getByTestId('listing-description')).toHaveTextContent('A test deck description')
  })

  it('should show 404 when RPC returns error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'not found' } })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('404')).toBeInTheDocument()
    })
  })

  it('should show 404 when RPC returns null data', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('404')).toBeInTheDocument()
    })
  })

  it('should show login CTA for unauthenticated users', async () => {
    mockRpc.mockResolvedValue({ data: mockListing, error: null })
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('cta-login')).toBeInTheDocument()
    })
    expect(screen.getByTestId('cta-signup')).toBeInTheDocument()
    // Login CTA should link to /auth/login with redirect
    expect(screen.getByTestId('cta-login')).toHaveAttribute(
      'href',
      `/auth/login?redirect=${encodeURIComponent('/marketplace/listing-1')}`,
    )
  })

  it('should show marketplace CTA for authenticated users', async () => {
    const { useAuthStore } = await import('../../stores/auth-store')
    vi.mocked(useAuthStore).mockReturnValue({ user: { id: 'user-1' }, loading: false } as ReturnType<typeof useAuthStore>)

    mockRpc.mockResolvedValue({ data: mockListing, error: null })
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('cta-marketplace')).toBeInTheDocument()
    })
    expect(screen.getByTestId('cta-marketplace')).toHaveAttribute('href', '/marketplace/listing-1')
  })

  it('should display tags', async () => {
    mockRpc.mockResolvedValue({ data: mockListing, error: null })
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('test')).toBeInTheDocument()
    })
    expect(screen.getByText('flashcards')).toBeInTheDocument()
  })

  it('should call RPC with correct listing ID', async () => {
    mockRpc.mockResolvedValue({ data: mockListing, error: null })
    renderPage('my-listing-id')

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('get_public_listing_preview', {
        p_listing_id: 'my-listing-id',
      })
    })
  })
})
