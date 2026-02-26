import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { downloadFile } from '../download-file'

describe('downloadFile', () => {
  let createObjectURLSpy: ReturnType<typeof vi.fn>
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>
  let appendChildSpy: ReturnType<typeof vi.fn>
  let removeChildSpy: ReturnType<typeof vi.fn>
  let clickSpy: ReturnType<typeof vi.fn>
  let mockAnchor: { href: string; download: string; click: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    createObjectURLSpy = vi.fn(() => 'blob:mock-url')
    revokeObjectURLSpy = vi.fn()
    appendChildSpy = vi.fn()
    removeChildSpy = vi.fn()
    clickSpy = vi.fn()
    mockAnchor = { href: '', download: '', click: clickSpy }

    vi.stubGlobal('URL', {
      createObjectURL: createObjectURLSpy,
      revokeObjectURL: revokeObjectURLSpy,
    })

    vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor as unknown as HTMLAnchorElement)
    vi.spyOn(document.body, 'appendChild').mockImplementation(appendChildSpy as typeof document.body.appendChild)
    vi.spyOn(document.body, 'removeChild').mockImplementation(removeChildSpy as typeof document.body.removeChild)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('should add BOM for CSV mime type', () => {
    downloadFile('a,b\n1,2', 'text/csv;charset=utf-8', 'test.csv')

    const blob: Blob = createObjectURLSpy.mock.calls[0][0]
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.type).toBe('text/csv;charset=utf-8')
    // BOM (\uFEFF) is 3 bytes in UTF-8; "a,b\n1,2" is 7 bytes → total 10
    expect(blob.size).toBe(new Blob(['\uFEFF' + 'a,b\n1,2']).size)
  })

  it('should NOT add BOM for JSON mime type', () => {
    const content = '{"key":"value"}'
    downloadFile(content, 'application/json', 'test.json')

    const blob: Blob = createObjectURLSpy.mock.calls[0][0]
    expect(blob.size).toBe(content.length)
  })

  it('should create Blob and call createObjectURL', () => {
    downloadFile('content', 'text/plain', 'file.txt')

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1)
    expect(createObjectURLSpy.mock.calls[0][0]).toBeInstanceOf(Blob)
  })

  it('should call revokeObjectURL for cleanup', () => {
    vi.useFakeTimers()
    downloadFile('content', 'text/plain', 'file.txt')

    // cleanup is deferred via setTimeout
    vi.advanceTimersByTime(100)
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url')
    vi.useRealTimers()
  })

  it('should create anchor element, click it, and remove it', () => {
    vi.useFakeTimers()
    downloadFile('data', 'text/plain', 'output.txt')

    expect(appendChildSpy).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)

    // removeChild is deferred via setTimeout
    vi.advanceTimersByTime(100)
    expect(removeChildSpy).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('should set href to blob URL and download to filename', () => {
    downloadFile('data', 'text/plain', 'my-file.txt')

    expect(mockAnchor.href).toBe('blob:mock-url')
    expect(mockAnchor.download).toBe('my-file.txt')
  })
})
