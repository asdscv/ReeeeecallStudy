import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { VocabularyPage } from '../VocabularyPage'

const mockRpc = vi.fn()
const mockRows = vi.fn()
const calls: { method: string; args: unknown[] }[] = []

// A PostgREST builder stand-in: records each filter, resolves to mockRows() when awaited.
function query() {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'contains', 'limit']) {
    builder[method] = (...args: unknown[]) => { calls.push({ method, args }); return builder }
  }
  builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(mockRows()).then(resolve)
  return builder
}

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => query(),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}))

const deck = (lang: string, over: Record<string, unknown> = {}) => ({
  id: `deck-${lang}`, title: `TOEIC 800 (English → ${lang})`, category: 'toeic', card_count: 1500,
  tags: ['category:toeic', 'source:en', `target:${lang}`, 'level:800'], owner_is_official: true, native_language: lang,
  ...over,
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/vocabulary" element={<VocabularyPage />} />
        <Route path="/vocabulary/:slug" element={<VocabularyPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('VocabularyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    calls.length = 0
  })

  it('English index links all 15 exam hubs and the 7 language indexes', () => {
    renderAt('/vocabulary')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Free English Vocabulary Lists')
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs.filter((h) => /^\/vocabulary\/(toeic|ielts|toefl)-/.test(h ?? ''))).toHaveLength(15)
    expect(hrefs).toContain('/vocabulary/ko')
    expect(hrefs).toContain('/vocabulary/es')
  })

  it('a language index lists that language’s official decks as word lists', async () => {
    mockRows.mockReturnValue({ data: [deck('ko', { id: 'd900', tags: ['source:en', 'level:900'] }), deck('ko', { id: 'd800' })], error: null })
    renderAt('/vocabulary/ko')
    await waitFor(() => expect(screen.getByTestId('vocabulary-language-index')).toBeInTheDocument())
    expect(calls).toContainEqual({ method: 'eq', args: ['native_language', 'ko'] })
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(links.indexOf('/d/d800')).toBeLessThan(links.indexOf('/d/d900'))
    expect(screen.getByText(/토익 800점 단어 1,500개/)).toBeInTheDocument()
  })

  it('an exam hub shows the English words and one deck per language', async () => {
    mockRows.mockReturnValue({ data: [deck('ja'), deck('ko')], error: null })
    mockRpc.mockResolvedValue({
      data: { ...deck('ja'), sample_fields: [{ field_values: { kind: 'word', front: 'allocate', back: '割り当てる', example_front: 'We allocate funds.', example_back: '' } }] },
      error: null,
    })
    renderAt('/vocabulary/toeic-800')
    await waitFor(() => expect(screen.getByTestId('vocabulary-hub')).toBeInTheDocument())

    expect(calls).toContainEqual({ method: 'contains', args: ['tags', ['level:800', 'source:en']] })
    expect(mockRpc).toHaveBeenCalledWith('get_public_listing_preview', { p_listing_id: 'deck-ko' })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('TOEIC 800 Vocabulary List — 1,500 Words with Example Sentences')
    expect(screen.getByText('allocate')).toBeInTheDocument()
    expect(screen.getByText('We allocate funds.')).toBeInTheDocument()
    expect(screen.queryByText('割り当てる')).not.toBeInTheDocument()
    const chooser = screen.getByTestId('hub-language-chooser')
    expect([...chooser.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/d/deck-ko', '/d/deck-ja'])
  })

  it('an unknown slug is a 404', () => {
    renderAt('/vocabulary/toeic-999')
    expect(screen.getByText('404')).toBeInTheDocument()
  })
})
