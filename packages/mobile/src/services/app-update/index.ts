/**
 * App-update gate — public surface.
 *
 * Layers: pure domain (`version`, `gate`, `types`) ← infrastructure
 * (`current-version`, `store-url`, `remote-config`) ← application (`store`).
 * UI consumes only `useAppUpdateStore`; tests target the pure domain.
 */
export * from './types'
export { parseVersion, compareVersions, isOlderThan } from './version'
export { evaluateUpdateGate } from './gate'
export { getCurrentAppVersion } from './current-version'
export { defaultStoreUrl, IOS_APP_STORE_ID, ANDROID_PACKAGE } from './store-url'
export { SupabaseUpdateRequirementSource } from './remote-config'
export { useAppUpdateStore, setUpdateRequirementSource } from './store'
