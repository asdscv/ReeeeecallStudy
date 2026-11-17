import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from 'i18next'
import en from '../../../../public/locales/en/traffic.json'
const { fetchTraffic, rpc } = vi.hoisted(() => ({ fetchTraffic: vi.fn(), rpc: vi.fn() }))
vi.mock('../../../lib/traffic-analytics', async () => ({ ...await vi.importActual('../../../lib/traffic-analytics'), fetchTraffic }))
vi.mock('../../../lib/supabase', () => ({ supabase: { rpc } }))
import { TrafficDashboard } from '../TrafficDashboard'

const report = {
  summary: { total: 101, page_views: 60, content_views: 40, http_requests: 1, visitors: 22, sessions: 25, engaged_reads: 10, avg_duration_ms: 5000, avg_scroll_percent: 40 },
  classes: [{ classification: 'external', page_views: 60, content_views: 40, http_requests: 1 }],
  daily: [], pages: [], sources: [], devices: [], campaigns: [], countries: [], conversions: [],
  rows: [{ id: 'article-id', kind: 'content', created_at: '2026-11-05T06:39:25Z', page_path: '/insight/example', title: 'Example article',
    viewer_id: null, session_id: 'same-session', account_name: '', hostname: 'reklue.com', environment: 'production', user_agent: 'Chrome example UA',
    referrer: 'https://www.bing.com', referrer_domain: 'www.bing.com', source: 'search', device: 'mobile', viewport_width: 412,
    duration_ms: 5000, scroll_percent: 100, classification: 'external', evidence: 'no_known_automation_signal' }],
  end: '2026-11-17T00:00:00Z', coverage: { first_browser_context: null, first_edge_request: null },
}
beforeEach(async () => {
  vi.clearAllMocks()
  i18n.addResourceBundle('en','traffic',en,true,true)
  await i18n.changeLanguage('en')
  fetchTraffic.mockResolvedValue(report)
  rpc.mockResolvedValue({ data: [], error: null })
})
describe('traffic investigation dashboard', () => {
  it('renders distinct metrics, exposes evidence and follows a whole session', async () => {
    render(<TrafficDashboard />)
    await screen.findByText('Example article')
    expect(screen.getByText('Visitor identifiers')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    expect(screen.getByText('Chrome example UA')).toBeInTheDocument()
    expect(screen.getByText('Public hostname; no known bot signal (not proof of a person)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Inspect this session/ }))
    await waitFor(() => expect(fetchTraffic.mock.lastCall?.[0]).toMatchObject({ session: 'same-session', classification: 'all' }))
  })
  it('applies filters to the backend and exposes load errors instead of stale totals', async () => {
    render(<TrafficDashboard />)
    await screen.findByText('Example article')
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'search' } })
    fetchTraffic.mockRejectedValueOnce(new Error('Forbidden'))
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
    await waitFor(() => expect(fetchTraffic.mock.lastCall?.[0]).toMatchObject({ source: 'search' }))
    await screen.findByRole('alert')
    expect(screen.queryByText('Example article')).not.toBeInTheDocument()
  })
})
