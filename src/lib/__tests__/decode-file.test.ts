import { describe, it, expect } from 'vitest'
import { decodeFileText } from '../decode-file'

function makeFile(bytes: Uint8Array, name = 'test.csv'): File {
  // JSDOM doesn't implement Blob/File.arrayBuffer(), so we polyfill
  const file = new File([bytes as unknown as BlobPart], name, { type: 'text/csv' })
  if (!file.arrayBuffer) {
    file.arrayBuffer = () =>
      new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.readAsArrayBuffer(file)
      })
  }
  return file
}

describe('decodeFileText', () => {
  it('should decode plain UTF-8 text', async () => {
    const bytes = new TextEncoder().encode('hello,world')
    const result = await decodeFileText(makeFile(bytes))
    expect(result).toBe('hello,world')
  })

  it('should strip UTF-8 BOM (EF BB BF) and decode', async () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf])
    const text = new TextEncoder().encode('안녕하세요')
    const bytes = new Uint8Array([...bom, ...text])
    const result = await decodeFileText(makeFile(bytes))
    expect(result).toBe('안녕하세요')
  })

  it('should decode UTF-16 LE (FF FE BOM)', async () => {
    const buf = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00])
    const result = await decodeFileText(makeFile(buf))
    expect(result).toContain('AB')
  })

  it('should decode UTF-16 BE (FE FF BOM)', async () => {
    const buf = new Uint8Array([0xfe, 0xff, 0x00, 0x41, 0x00, 0x42])
    const result = await decodeFileText(makeFile(buf))
    expect(result).toContain('AB')
  })

  it('should fallback to EUC-KR for non-UTF-8 Korean text', async () => {
    // "한글" in EUC-KR encoding
    const eucKrBytes = new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb])
    const result = await decodeFileText(makeFile(eucKrBytes))
    expect(result).toBe('한글')
  })

  it('should return empty string for empty file', async () => {
    const result = await decodeFileText(makeFile(new Uint8Array([])))
    expect(result).toBe('')
  })

  it('should handle ASCII-only text', async () => {
    const bytes = new TextEncoder().encode('Word,Meaning,Tags\napple,fruit,noun')
    const result = await decodeFileText(makeFile(bytes))
    expect(result).toBe('Word,Meaning,Tags\napple,fruit,noun')
  })
})
