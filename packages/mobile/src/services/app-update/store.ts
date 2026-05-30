import { create } from 'zustand'
import { Linking, Platform } from 'react-native'
import type { UpdateGateResult, UpdateGateStatus, UpdateRequirementSource } from './types'
import { evaluateUpdateGate } from './gate'
import { getCurrentAppVersion } from './current-version'
import { defaultStoreUrl } from './store-url'
import { SupabaseUpdateRequirementSource } from './remote-config'

// DIP seam: the concrete source is wired here (composition root) but can be
// swapped — e.g. in tests or for an alternative backend — without touching the
// store, gate, or UI.
let requirementSource: UpdateRequirementSource = new SupabaseUpdateRequirementSource()
export function setUpdateRequirementSource(source: UpdateRequirementSource): void {
  requirementSource = source
}

interface AppUpdateState {
  status: UpdateGateStatus
  result: UpdateGateResult | null
  /** True once a check has completed (success or fail-open). */
  checked: boolean
  /** User dismissed the soft prompt this session (never affects 'blocked'). */
  optionalDismissed: boolean
  /** Run the gate check once per app session. Safe to call repeatedly. */
  check: () => Promise<void>
  /** Open the relevant store listing for the current platform. */
  openStore: () => void
  /** Dismiss the soft 'optional' prompt (no effect on a hard block). */
  dismissOptional: () => void
}

// Module-level guard so concurrent callers (e.g. an effect that re-runs) share
// one in-flight check instead of racing two RPCs.
let inFlight: Promise<void> | null = null

export const useAppUpdateStore = create<AppUpdateState>((set, get) => ({
  status: 'ok',
  result: null,
  checked: false,
  optionalDismissed: false,

  check: async () => {
    if (get().checked) return
    if (inFlight) return inFlight
    inFlight = (async () => {
      const requirement = await requirementSource.fetch(Platform.OS)
      const result = evaluateUpdateGate(getCurrentAppVersion(), requirement)
      set({ result, status: result.status, checked: true })
    })()
    try {
      await inFlight
    } finally {
      inFlight = null
    }
  },

  openStore: () => {
    const url = get().result?.requirement?.storeUrl || defaultStoreUrl()
    Linking.openURL(url).catch(() => {})
  },

  dismissOptional: () => set({ optionalDismissed: true }),
}))
