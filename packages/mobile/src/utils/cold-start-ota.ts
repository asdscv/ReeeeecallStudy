/**
 * Cold-start OTA swap — PURE core (no `expo-updates` import).
 *
 * Why this exists: expo-updates' default `fallbackToCacheTimeout: 0` means the
 * very first launch always boots from the binary's embedded JS bundle, even
 * when a newer OTA is already published. Users only see the OTA on the *second*
 * launch, after a silent background download. To shorten that loop for the
 * (much more common) case of "user updated the app but is launching for the
 * first time after the latest OTA was published", this helper performs an
 * explicit check + fetch during the splash and {@link UpdatesGate.reload}s if
 * a fresh OTA is available.
 *
 * The gate is an abstract interface — no React Native / expo imports here —
 * so the timeout race and disable rules can be exercised by a plain Node test.
 *
 * Hard caveat: this whole module is itself JS that has to be embedded in the
 * binary to take effect. The very first launch of a freshly *installed* binary
 * still cannot benefit from this; only subsequent installs that already ship
 * with this code do. To cover the truly-first install, `app.json` needs
 * `expo.updates.fallbackToCacheTimeout` set at native build time — that is a
 * separate, store-rebuild-required change.
 */

export interface UpdatesGate {
  /** True when expo-updates is enabled for this binary. False in dev client. */
  readonly isEnabled: boolean
  /** True when the runtime is launching from an emergency embedded bundle
   *  because a prior OTA failed to load — never trigger another swap then. */
  readonly isEmergencyLaunch: boolean
  /** Returns `{ isAvailable: true }` when the EAS Update server has a newer
   *  bundle for this runtimeVersion + channel than the one currently running. */
  checkForUpdate(): Promise<{ isAvailable: boolean }>
  /** Download the newest available bundle into the on-device cache. */
  fetchUpdate(): Promise<void>
  /** Restart the JS runtime, picking up the freshly downloaded bundle. Does
   *  not resolve — control transfers to the new bundle. */
  reload(): Promise<never>
}

export type ColdStartResult =
  | 'disabled'   // dev mode, updates disabled, or emergency launch
  | 'no-update'  // server has no newer bundle
  | 'timeout'    // check/fetch/reload did not finish within the budget
  | 'error'      // network / server / gate threw
  | 'swapping'   // reload was issued (caller should NOT keep booting)

/**
 * Try to swap to a newer OTA bundle during the splash. Bounded by `timeoutMs`
 * so a slow network never traps the user on the splash. Any thrown error from
 * the gate (e.g. offline) is swallowed and reported as `'error'`.
 */
export async function tryColdStartOtaSwap(
  gate: UpdatesGate,
  isDev: boolean,
  timeoutMs: number,
): Promise<ColdStartResult> {
  if (isDev) return 'disabled'
  if (!gate.isEnabled) return 'disabled'
  if (gate.isEmergencyLaunch) return 'disabled'

  const swap = (async (): Promise<ColdStartResult> => {
    try {
      const result = await gate.checkForUpdate()
      if (!result.isAvailable) return 'no-update'
      await gate.fetchUpdate()
      // Hand off the runtime. `reload` is typed `Promise<never>` — its resolve
      // value is unreachable; we return 'swapping' purely as a typing aid.
      void gate.reload()
      return 'swapping'
    } catch {
      return 'error'
    }
  })()

  const timeout = new Promise<ColdStartResult>((resolve) =>
    setTimeout(() => resolve('timeout'), timeoutMs),
  )
  return Promise.race([swap, timeout])
}
