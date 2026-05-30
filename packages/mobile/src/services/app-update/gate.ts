import { parseVersion, compareVersions } from './version'
import type { UpdateRequirement, UpdateGateResult } from './types'

/**
 * Pure gate decision — the single source of truth for "may this build run?".
 *
 * Fail-open by construction: a missing requirement OR an unparseable current
 * version yields 'ok', so a backend hiccup or odd version string never bricks
 * an install. Only a parseable current version strictly below a parseable
 * `minSupportedVersion` produces 'blocked'; 'blocked' always wins over
 * 'optional'.
 */
export function evaluateUpdateGate(
  currentVersion: string,
  requirement: UpdateRequirement | null,
): UpdateGateResult {
  const base: UpdateGateResult = { status: 'ok', currentVersion, requirement }

  if (!requirement) return base
  if (!parseVersion(currentVersion)) return base

  const { minSupportedVersion, latestVersion } = requirement

  if (
    parseVersion(minSupportedVersion) &&
    compareVersions(currentVersion, minSupportedVersion) < 0
  ) {
    return { ...base, status: 'blocked' }
  }

  if (
    latestVersion &&
    parseVersion(latestVersion) &&
    compareVersions(currentVersion, latestVersion) < 0
  ) {
    return { ...base, status: 'optional' }
  }

  return base
}
