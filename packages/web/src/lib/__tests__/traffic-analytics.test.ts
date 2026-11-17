import { afterEach, describe, expect, it, vi } from 'vitest'
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../supabase', () => ({ supabase: { rpc } }))
import { calendarRange, exportTraffic, trafficCsv, type TrafficFilters, type TrafficRow } from '../traffic-analytics'

afterEach(() => vi.resetAllMocks())
describe('traffic analysis', () => {
  it('includes the entire end calendar day and rejects reversed dates', () => {
    const range = calendarRange('2026-11-05', '2026-11-05')
    const end = new Date(range.end)
    expect(end.getDate()).toBe(6)
    expect(end.getHours()).toBe(0)
    expect(new Date(range.start).getDate()).toBe(5)
    expect(() => calendarRange('2026-11-06', '2026-11-05')).toThrow()
    expect(() => calendarRange('', '')).toThrow()
  })
  it('escapes CSV quotes and prevents formula injection in untrusted paths/referrers', () => {
    const csv = trafficCsv([{ page_path: '=WEBSERVICE("private")', title: 'a,"b"\nnext', referrer: ' \t+cmd' } as TrafficRow])
    expect(csv).toContain('"\'=WEBSERVICE(""private"")"')
    expect(csv).toContain('"a,""b""\nnext"')
    expect(csv).toContain('"\' \t+cmd"')
  })
  it('exports every server page with exactly the selected filters', async () => {
    const filters = { classification: 'unknown', kind: 'content', start: '2026-11-01', end: '2026-11-17', search: 'jlpt' } as TrafficFilters
    rpc.mockResolvedValueOnce({ data: { summary: { total: 1001 }, rows: Array.from({ length: 1000 }, (_, i) => ({ page_path: `/first-${i}` })) }, error: null })
      .mockResolvedValueOnce({ data: { summary: { total: 1001 }, rows: [{ page_path: '/last' }] }, error: null })
    const result = await exportTraffic(filters)
    expect(result.count).toBe(1001)
    expect(result.csv).toContain('/last')
    expect(rpc).toHaveBeenNthCalledWith(2, 'admin_traffic_report', { p_filters: filters, p_offset: 1000, p_limit: 1000 })
  })
  it('reports an interrupted export instead of silently truncating it', async () => {
    rpc.mockResolvedValue({ data: { summary: { total: 4 }, rows: [] }, error: null })
    await expect(exportTraffic({} as TrafficFilters)).rejects.toThrow('exportChanged')
  })
})
