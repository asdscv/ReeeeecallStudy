/**
 * Whether onboarding can appear at all.
 *
 * It could not. `isCompleted` starts `true` on purpose — so the overlay doesn't flash
 * before the server answers — and `initialize()` guarded on that same field:
 *
 *     if (get().completedSteps.size > 0 || get().isCompleted) return
 *
 * On the first call `isCompleted` is the optimistic default, so the guard returned
 * before `get_onboarding_status` was ever sent. `showOnboarding` stayed false forever
 * and `{showOnboarding && <OnboardingOverlay />}` in App.tsx never rendered — for any
 * account, since the app shipped. Caught by driving a brand-new account through the
 * real UI, where the overlay never came up.
 *
 * The fix separates "haven't asked yet" (`hydrated`) from "asked, and they're done"
 * (`isCompleted`). These tests pin that distinction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({ update: () => ({ eq: async () => ({}) }), delete: () => ({ eq: async () => ({}) }) }),
  },
}))

const { useOnboardingStore, ONBOARDING_STEPS } = await import('../onboarding-store')

const FRESH = { completed: false, steps: [] as { step_key: string; completed_at: string }[] }

function reset() {
  useOnboardingStore.setState({
    isCompleted: true,
    completedSteps: new Set(),
    currentStep: 0,
    showOnboarding: false,
    loading: false,
    hydrated: false,
    sampleDeckId: null,
    sampleTemplateId: null,
  })
}

beforeEach(() => {
  rpc.mockReset()
  reset()
})

describe('onboarding initialize', () => {
  it('asks the server even though isCompleted starts true', async () => {
    rpc.mockResolvedValue({ data: FRESH, error: null })
    await useOnboardingStore.getState().initialize()
    expect(rpc).toHaveBeenCalledWith('get_onboarding_status')
  })

  it('shows the overlay for an account that has not finished', async () => {
    rpc.mockResolvedValue({ data: FRESH, error: null })
    await useOnboardingStore.getState().initialize()
    expect(useOnboardingStore.getState().showOnboarding).toBe(true)
  })

  it('stays hidden for an account that already finished', async () => {
    rpc.mockResolvedValue({ data: { completed: true, steps: [] }, error: null })
    await useOnboardingStore.getState().initialize()
    expect(useOnboardingStore.getState().showOnboarding).toBe(false)
  })

  it('only asks once per session', async () => {
    rpc.mockResolvedValue({ data: FRESH, error: null })
    await useOnboardingStore.getState().initialize()
    await useOnboardingStore.getState().initialize()
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('does not retry forever when the RPC fails, and fails closed', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('boom') })
    await useOnboardingStore.getState().initialize()
    expect(useOnboardingStore.getState().showOnboarding).toBe(false)
    expect(useOnboardingStore.getState().hydrated).toBe(true)
    await useOnboardingStore.getState().initialize()
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('resumes at the first step the account has not done', async () => {
    rpc.mockResolvedValue({
      data: { completed: false, steps: [{ step_key: 'welcome', completed_at: 'x' }] },
      error: null,
    })
    await useOnboardingStore.getState().initialize()
    expect(useOnboardingStore.getState().currentStep).toBe(1)
  })

  it('leaves a restart visible instead of re-hydrating over it', async () => {
    rpc.mockResolvedValue({ data: { completed: true, steps: [] }, error: null })
    await useOnboardingStore.getState().restart()
    expect(useOnboardingStore.getState().showOnboarding).toBe(true)
    await useOnboardingStore.getState().initialize()
    expect(useOnboardingStore.getState().showOnboarding).toBe(true)
  })
})

describe('onboarding steps', () => {
  // Content the account can study comes before any authoring chore.
  it('offers a ready-made deck before asking for one to be built', () => {
    const keys = ONBOARDING_STEPS.map((s) => s.key)
    expect(keys.indexOf('quick_start')).toBeLessThan(keys.indexOf('create_deck'))
  })

  it('puts quick_start immediately after the welcome screen', () => {
    expect(ONBOARDING_STEPS.map((s) => s.key).slice(0, 2)).toEqual(['welcome', 'quick_start'])
  })
})
