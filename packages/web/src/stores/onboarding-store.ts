import { create } from 'zustand'
import { supabase } from '../lib/supabase'

// Extensible step definitions — add/remove/reorder without code changes elsewhere
export const ONBOARDING_STEPS = [
  { key: 'welcome', order: 0 },
  { key: 'create_deck', order: 1 },
  { key: 'card_template', order: 2 },
  { key: 'add_cards', order: 3 },
  { key: 'first_study', order: 4 },
  { key: 'explore_market', order: 5 },
] as const

export type OnboardingStepKey = typeof ONBOARDING_STEPS[number]['key']

interface OnboardingState {
  isCompleted: boolean
  completedSteps: Set<OnboardingStepKey>
  currentStep: number  // index into ONBOARDING_STEPS
  showOnboarding: boolean
  loading: boolean

  // Data created during onboarding flow
  sampleDeckId: string | null
  sampleTemplateId: string | null

  initialize: () => Promise<void>
  completeStep: (stepKey: OnboardingStepKey) => Promise<void>
  nextStep: () => void
  prevStep: () => void
  goToStep: (index: number) => void
  skip: () => Promise<void>
  dismiss: () => void  // hide without completing
  restart: () => Promise<void>  // reset onboarding to start over
  setSampleDeckId: (id: string | null) => void
  setSampleTemplateId: (id: string | null) => void
}

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  isCompleted: true,  // default true to avoid flash
  completedSteps: new Set(),
  currentStep: 0,
  showOnboarding: false,
  loading: false,
  sampleDeckId: null,
  sampleTemplateId: null,

  initialize: async () => {
    // Skip if already loaded (avoid unnecessary RPC on every page)
    if (get().loading) return
    if (get().completedSteps.size > 0 || get().isCompleted) return
    set({ loading: true })
    try {
      const { data, error } = await supabase.rpc('get_onboarding_status')
      if (error) throw error

      const result = data as { completed: boolean; steps: { step_key: string; completed_at: string }[] }
      const completedSteps = new Set(result.steps.map(s => s.step_key as OnboardingStepKey))

      set({
        isCompleted: result.completed,
        completedSteps,
        showOnboarding: !result.completed,
        currentStep: findNextIncompleteStep(completedSteps),
      })
    } catch {
      // If RPC fails (e.g. column doesn't exist yet), just hide onboarding
      set({ isCompleted: true, showOnboarding: false })
    } finally {
      set({ loading: false })
    }
  },

  completeStep: async (stepKey) => {
    const { completedSteps } = get()
    if (completedSteps.has(stepKey)) return

    try {
      await supabase.rpc('complete_onboarding_step', { p_step_key: stepKey })
    } catch { /* continue anyway */ }

    const newCompleted = new Set(completedSteps)
    newCompleted.add(stepKey)

    const allDone = ONBOARDING_STEPS.every(s => newCompleted.has(s.key))

    set({
      completedSteps: newCompleted,
      isCompleted: allDone,
      showOnboarding: !allDone,
    })
  },

  nextStep: () => {
    const { currentStep } = get()
    if (currentStep < ONBOARDING_STEPS.length - 1) {
      set({ currentStep: currentStep + 1 })
    }
  },

  prevStep: () => {
    const { currentStep } = get()
    if (currentStep > 0) {
      set({ currentStep: currentStep - 1 })
    }
  },

  goToStep: (index) => {
    if (index >= 0 && index < ONBOARDING_STEPS.length) {
      set({ currentStep: index })
    }
  },

  skip: async () => {
    try {
      await supabase.rpc('skip_onboarding')
    } catch { /* continue */ }
    set({ isCompleted: true, showOnboarding: false })
  },

  dismiss: () => {
    set({ showOnboarding: false })
  },

  restart: async () => {
    set({ loading: true })
    try {
      // Reset onboarding_completed flag on profile
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase
          .from('profiles')
          .update({ onboarding_completed: false })
          .eq('id', user.id)

        // Delete existing onboarding progress rows
        await supabase
          .from('onboarding_progress')
          .delete()
          .eq('user_id', user.id)
      }
    } catch { /* continue anyway */ }

    set({
      isCompleted: false,
      completedSteps: new Set(),
      currentStep: 0,
      showOnboarding: true,
      loading: false,
      sampleDeckId: null,
      sampleTemplateId: null,
    })
  },

  setSampleDeckId: (id) => set({ sampleDeckId: id }),
  setSampleTemplateId: (id) => set({ sampleTemplateId: id }),
}))

function findNextIncompleteStep(completed: Set<OnboardingStepKey>): number {
  const idx = ONBOARDING_STEPS.findIndex(s => !completed.has(s.key))
  return idx === -1 ? 0 : idx
}
