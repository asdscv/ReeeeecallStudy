import Constants from 'expo-constants'

/**
 * Installed binary version, read from the embedded Expo config (app.json
 * `version`). Because the runtimeVersion policy is `appVersion`, an OTA update
 * can never change this for a given binary, so it is a reliable proxy for the
 * native/store version.
 *
 * Returns '' when unavailable so the gate fails open — an unparseable version
 * is treated as 'ok' and never blocked.
 */
export function getCurrentAppVersion(): string {
  return Constants.expoConfig?.version ?? ''
}
