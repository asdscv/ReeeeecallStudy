import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Supabase mock ──────────────────────────────────────────
const mockSupabase = vi.hoisted(() => ({
  rpc: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabase: mockSupabase }))

import { useVersionStore } from '../version-store'

const sampleVersions = [
  {
    id: 'v2',
    deck_id: 'deck-1',
    version_number: 2,
    change_summary: 'Added 5 new cards',
    card_count: 15,
    created_by: 'user-1',
    created_at: '2024-02-01T00:00:00Z',
  },
  {
    id: 'v1',
    deck_id: 'deck-1',
    version_number: 1,
    change_summary: 'Initial version',
    card_count: 10,
    created_by: 'user-1',
    created_at: '2024-01-01T00:00:00Z',
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  useVersionStore.setState({
    versions: [],
    loading: false,
    error: null,
    creating: false,
  })
})

// ─── fetchVersions ─────────────────────────────────────────
describe('fetchVersions', () => {
  it('should fetch versions via get_deck_versions RPC', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: sampleVersions, error: null })

    await useVersionStore.getState().fetchVersions('deck-1')

    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_deck_versions', {
      p_deck_id: 'deck-1',
    })
    expect(useVersionStore.getState().versions).toEqual(sampleVersions)
    expect(useVersionStore.getState().loading).toBe(false)
  })

  it('should handle fetch error', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: null, error: { message: 'Access denied' } })

    await useVersionStore.getState().fetchVersions('deck-1')

    expect(useVersionStore.getState().error).toBeTruthy()
    expect(useVersionStore.getState().versions).toEqual([])
  })

  it('should not fetch if already loading', async () => {
    useVersionStore.setState({ loading: true })

    await useVersionStore.getState().fetchVersions('deck-1')

    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it('should handle empty results', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null })

    await useVersionStore.getState().fetchVersions('deck-1')

    expect(useVersionStore.getState().versions).toEqual([])
  })
})

// ─── createVersion ─────────────────────────────────────────
describe('createVersion', () => {
  it('should create a version and refresh the list', async () => {
    // First call: create, second call: fetch
    mockSupabase.rpc
      .mockResolvedValueOnce({ data: 'new-version-uuid', error: null })
      .mockResolvedValueOnce({ data: sampleVersions, error: null })

    const result = await useVersionStore.getState().createVersion('deck-1', 'Added cards')

    expect(mockSupabase.rpc).toHaveBeenCalledWith('create_deck_version', {
      p_deck_id: 'deck-1',
      p_change_summary: 'Added cards',
    })
    expect(result).toEqual({ id: 'new-version-uuid' })
    expect(useVersionStore.getState().creating).toBe(false)
    // Should have refreshed the list
    expect(useVersionStore.getState().versions).toEqual(sampleVersions)
  })

  it('should handle create error', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'Only the deck owner can create versions' },
    })

    const result = await useVersionStore.getState().createVersion('deck-1')

    expect(result).toBeNull()
    expect(useVersionStore.getState().error).toBeTruthy()
  })

  it('should pass null summary when not provided', async () => {
    mockSupabase.rpc
      .mockResolvedValueOnce({ data: 'v-id', error: null })
      .mockResolvedValueOnce({ data: [], error: null })

    await useVersionStore.getState().createVersion('deck-1')

    expect(mockSupabase.rpc).toHaveBeenCalledWith('create_deck_version', {
      p_deck_id: 'deck-1',
      p_change_summary: null,
    })
  })
})

// ─── reset ─────────────────────────────────────────────────
describe('reset', () => {
  it('should clear all state', () => {
    useVersionStore.setState({
      versions: sampleVersions,
      loading: true,
      error: 'some error',
      creating: true,
    })

    useVersionStore.getState().reset()

    expect(useVersionStore.getState().versions).toEqual([])
    expect(useVersionStore.getState().loading).toBe(false)
    expect(useVersionStore.getState().error).toBeNull()
    expect(useVersionStore.getState().creating).toBe(false)
  })
})

// ─── version auto-increment (validated in DB, tested via mock) ─
describe('version numbering', () => {
  it('versions should be sorted by version_number descending', async () => {
    mockSupabase.rpc.mockResolvedValue({ data: sampleVersions, error: null })

    await useVersionStore.getState().fetchVersions('deck-1')

    const versions = useVersionStore.getState().versions
    expect(versions[0].version_number).toBeGreaterThan(versions[1].version_number)
  })
})
