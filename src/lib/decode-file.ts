/**
 * Decode file text with automatic encoding detection.
 * Handles UTF-8 (with/without BOM), UTF-16 LE/BE, and EUC-KR (Korean Excel default).
 */
export async function decodeFileText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const uint8 = new Uint8Array(buffer)

  // Empty file
  if (uint8.length === 0) return ''

  // BOM detection
  if (uint8[0] === 0xef && uint8[1] === 0xbb && uint8[2] === 0xbf)
    return new TextDecoder('utf-8').decode(uint8.slice(3))
  if (uint8[0] === 0xff && uint8[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(uint8)
  if (uint8[0] === 0xfe && uint8[1] === 0xff)
    return new TextDecoder('utf-16be').decode(uint8)

  // UTF-8 strict → EUC-KR fallback → lenient UTF-8
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(uint8)
  } catch {
    /* not valid UTF-8 */
  }
  try {
    return new TextDecoder('euc-kr').decode(uint8)
  } catch {
    /* no EUC-KR support */
  }
  return new TextDecoder('utf-8').decode(uint8)
}
