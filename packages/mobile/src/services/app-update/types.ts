/**
 * App-update gate — domain types.
 *
 * The gate decides whether the installed binary may keep running ('ok'),
 * should nudge the user to update ('optional'), or must be blocked until the
 * user installs a newer build from the store ('blocked').
 *
 * `UpdateRequirementSource` is the Dependency-Inversion seam: the domain never
 * knows whether the requirement came from Supabase, a static JSON file, or a
 * bundled fallback. Swap the implementation without touching the gate or UI.
 */

export type UpdateGateStatus = 'ok' | 'optional' | 'blocked'

/** Backend-driven update policy for a single platform. */
export interface UpdateRequirement {
  /**
   * Lowest binary version the backend still supports. An installed version
   * strictly below this is hard-blocked.
   */
  minSupportedVersion: string
  /**
   * Latest version available in the store. An installed version below this but
   * at/above `minSupportedVersion` gets a dismissable "update available" nudge.
   * `null` disables the soft prompt.
   */
  latestVersion: string | null
  /** Optional store-URL override; when null the platform default is used. */
  storeUrl: string | null
  /** Optional server-supplied message; when null the UI uses its i18n copy. */
  message: string | null
}

export interface UpdateGateResult {
  status: UpdateGateStatus
  /** The installed binary version that was evaluated. */
  currentVersion: string
  /** The requirement the decision was based on (null = none available). */
  requirement: UpdateRequirement | null
}

/** Where an `UpdateRequirement` is fetched from. Swap freely (DIP). */
export interface UpdateRequirementSource {
  /** Resolve the requirement for a platform, or null when unavailable. */
  fetch(platform: string): Promise<UpdateRequirement | null>
}
