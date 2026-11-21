import { expect, it, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@reklue/shared/lib/supabase', () => ({ supabase: { rpc } }))

import { useQuizStore } from '@reklue/shared/stores/quiz-store'

it('keeps the requested quiz when the previous run responds later', async () => {
  let resolveOld!: (response: object) => void
  rpc.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve }))
  rpc.mockResolvedValueOnce({ data: { run_id: 'new' }, error: null })

  const { loadRun } = useQuizStore.getState()
  const oldLoad = loadRun('old')
  await loadRun('new')
  resolveOld({ data: { run_id: 'old' }, error: null })
  await oldLoad

  expect(useQuizStore.getState().run?.run_id).toBe('new')
})
