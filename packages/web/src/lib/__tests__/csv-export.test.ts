import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * jsdom does not implement `URL.createObjectURL`, and `vi.spyOn` cannot stub a property that
 * does not exist — it throws "createObjectURL does not exist".
 *
 * This file passed anyway, for a reason that had nothing to do with it: vitest shards test files
 * across workers, some other file in the same worker defined the property first, and this one
 * inherited it. Adding a single unrelated test file elsewhere in the repo reshuffles that
 * assignment and these four tests start failing — which is exactly what happened.
 *
 * So the file provides what it needs. `configurable: true` so `vi.spyOn` can still replace it and
 * `vi.restoreAllMocks()` can put it back.
 */
beforeEach(() => {
  vi.restoreAllMocks()
  for (const name of ['createObjectURL', 'revokeObjectURL'] as const) {
    if (typeof (URL as unknown as Record<string, unknown>)[name] !== 'function') {
      Object.defineProperty(URL, name, {
        value: () => undefined, writable: true, configurable: true,
      })
    }
  }
})

describe('csv-export', () => {
  describe('escapeCsvValue (via exportToCsv output)', () => {
    it('handles null and undefined', async () => {
      const { exportToCsv } = await import('../csv-export')
      const rows = [{ a: null, b: undefined, c: '' }]

      let csvContent = ''
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
      const mockLink = {
        href: '',
        setAttribute: vi.fn(),
        click: vi.fn(),
      }
      vi.spyOn(document, 'createElement').mockReturnValue(mockLink as unknown as HTMLElement)
      vi.spyOn(document.body, 'appendChild').mockImplementation(() => null as unknown as Node)
      vi.spyOn(document.body, 'removeChild').mockImplementation(() => null as unknown as Node)

      const BlobSpy = vi.spyOn(globalThis, 'Blob').mockImplementation(function (parts) {
        csvContent = (parts as string[])[0]
        return { size: csvContent.length, type: 'text/csv' } as Blob
      })

      exportToCsv('test', rows as unknown as Record<string, unknown>[])

      // BOM + header + data
      expect(csvContent).toContain('\uFEFF')
      expect(csvContent).toContain('a,b,c')
      // null/undefined should be empty
      expect(csvContent).toContain(',,')
      BlobSpy.mockRestore()
    })

    it('escapes commas and quotes in values', async () => {
      const { exportToCsv } = await import('../csv-export')
      const rows = [{ name: 'Hello, World', desc: 'She said "hi"' }]

      let csvContent = ''
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
      vi.spyOn(document, 'createElement').mockReturnValue({
        href: '', setAttribute: vi.fn(), click: vi.fn(),
      } as unknown as HTMLElement)
      vi.spyOn(document.body, 'appendChild').mockImplementation(() => null as unknown as Node)
      vi.spyOn(document.body, 'removeChild').mockImplementation(() => null as unknown as Node)

      const BlobSpy = vi.spyOn(globalThis, 'Blob').mockImplementation(function (parts) {
        csvContent = (parts as string[])[0]
        return { size: csvContent.length, type: 'text/csv' } as Blob
      })

      exportToCsv('test', rows)

      expect(csvContent).toContain('"Hello, World"')
      expect(csvContent).toContain('"She said ""hi"""')
      BlobSpy.mockRestore()
    })

    it('stringifies objects in values', async () => {
      const { exportToCsv } = await import('../csv-export')
      const rows = [{ data: { nested: true } }]

      let csvContent = ''
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
      vi.spyOn(document, 'createElement').mockReturnValue({
        href: '', setAttribute: vi.fn(), click: vi.fn(),
      } as unknown as HTMLElement)
      vi.spyOn(document.body, 'appendChild').mockImplementation(() => null as unknown as Node)
      vi.spyOn(document.body, 'removeChild').mockImplementation(() => null as unknown as Node)

      const BlobSpy = vi.spyOn(globalThis, 'Blob').mockImplementation(function (parts) {
        csvContent = (parts as string[])[0]
        return { size: csvContent.length, type: 'text/csv' } as Blob
      })

      exportToCsv('test', rows as unknown as Record<string, unknown>[])

      // JSON objects should be stringified
      expect(csvContent).toContain('nested')
      expect(csvContent).toContain('true')
      BlobSpy.mockRestore()
    })
  })

  describe('exportToCsv', () => {
    it('does nothing with empty rows', async () => {
      const { exportToCsv } = await import('../csv-export')
      const createSpy = vi.spyOn(document, 'createElement')
      exportToCsv('test', [])
      expect(createSpy).not.toHaveBeenCalled()
    })

    it('uses custom columns when provided', async () => {
      const { exportToCsv } = await import('../csv-export')
      const rows = [{ id: '1', name: 'Test', extra: 'ignored' }]
      const columns = [
        { key: 'name', label: 'Name' },
        { key: 'id', label: 'ID' },
      ]

      let csvContent = ''
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
      vi.spyOn(document, 'createElement').mockReturnValue({
        href: '', setAttribute: vi.fn(), click: vi.fn(),
      } as unknown as HTMLElement)
      vi.spyOn(document.body, 'appendChild').mockImplementation(() => null as unknown as Node)
      vi.spyOn(document.body, 'removeChild').mockImplementation(() => null as unknown as Node)

      const BlobSpy = vi.spyOn(globalThis, 'Blob').mockImplementation(function (parts) {
        csvContent = (parts as string[])[0]
        return { size: csvContent.length, type: 'text/csv' } as Blob
      })

      exportToCsv('test', rows, columns)

      // Header should use custom labels in order
      expect(csvContent).toContain('Name,ID')
      // Should NOT include 'extra' column
      expect(csvContent).not.toContain('ignored')
      BlobSpy.mockRestore()
    })
  })

  describe('formatCsvDate', () => {
    it('formats valid ISO dates', async () => {
      const { formatCsvDate } = await import('../csv-export')
      const result = formatCsvDate('2026-03-20T10:30:45.000Z')
      // Should return YYYY-MM-DD HH:mm:ss format (local time)
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    })

    it('returns original string for invalid dates', async () => {
      const { formatCsvDate } = await import('../csv-export')
      expect(formatCsvDate('not-a-date')).toBe('not-a-date')
    })
  })

  describe('EXPORT_CONFIGS', () => {
    it('has configs for all sections', async () => {
      const { EXPORT_CONFIGS } = await import('../csv-export')
      expect(EXPORT_CONFIGS.users).toBeDefined()
      expect(EXPORT_CONFIGS.auditLogs).toBeDefined()
      expect(EXPORT_CONFIGS.studyActivity).toBeDefined()
      expect(EXPORT_CONFIGS.marketListings).toBeDefined()
    })

    it('each config has filename and columns', async () => {
      const { EXPORT_CONFIGS } = await import('../csv-export')
      for (const [, config] of Object.entries(EXPORT_CONFIGS)) {
        expect(config.filename).toBeTruthy()
        expect(config.columns.length).toBeGreaterThan(0)
        for (const col of config.columns) {
          expect(col.key).toBeTruthy()
          expect(col.label).toBeTruthy()
        }
      }
    })
  })
})
