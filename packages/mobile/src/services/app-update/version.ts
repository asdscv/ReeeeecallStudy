/**
 * Minimal, dependency-free semantic-version comparison.
 *
 * Tolerant parser: accepts "1", "1.2", "1.2.3", optional leading "v", and
 * ignores any pre-release / build suffix ("1.2.3-beta.1", "1.2.3+42"). Extra
 * components ("1.2.3.4") are truncated to three; missing ones default to 0.
 * Returns null for anything without a leading numeric major so callers can
 * fail open on garbage input rather than mis-block.
 */
export interface SemVer {
  major: number
  minor: number
  patch: number
}

export function parseVersion(input: string | null | undefined): SemVer | null {
  if (input == null) return null
  const trimmed = String(input).trim().replace(/^v/i, '')
  if (trimmed === '') return null
  // Keep only the release portion before any '-' (pre-release) or '+' (build).
  const release = trimmed.split(/[-+]/, 1)[0]
  const parts = release.split('.')
  const nums: number[] = []
  for (let i = 0; i < 3; i++) {
    const raw = parts[i] ?? '0'
    if (!/^\d+$/.test(raw)) return null
    nums.push(parseInt(raw, 10))
  }
  return { major: nums[0], minor: nums[1], patch: nums[2] }
}

/**
 * Compare two version strings.
 * @returns -1 if a < b, 1 if a > b, 0 if equal OR either side is unparseable
 *          (equal-on-garbage keeps the gate fail-open).
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return 0
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1
  return 0
}

/** True only when both parse AND `version` is strictly older than `floor`. */
export function isOlderThan(version: string, floor: string): boolean {
  if (!parseVersion(version) || !parseVersion(floor)) return false
  return compareVersions(version, floor) < 0
}
