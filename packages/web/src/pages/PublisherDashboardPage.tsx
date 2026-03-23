import { useEffect, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Eye, Download, TrendingUp, BarChart3, ArrowUpDown, Star, ExternalLink } from 'lucide-react'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { usePublisherStore } from '@reeeeecall/shared/stores/publisher-store'
import type { PublisherListingStats } from '@reeeeecall/shared/stores/publisher-store'

type SortKey = 'title' | 'view_count' | 'acquire_count' | 'conversion_rate' | 'avg_rating' | 'created_at'
type SortDir = 'asc' | 'desc'

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export function PublisherDashboardPage() {
  const { t: _t } = useTranslation(['marketplace', 'common'])
  const navigate = useNavigate()
  const { stats, loading, error, fetchPublisherStats } = usePublisherStore()

  const [sortKey, setSortKey] = useState<SortKey>('view_count')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  useEffect(() => {
    fetchPublisherStats()
  }, [fetchPublisherStats])

  const sortedListings = useMemo(() => {
    if (!stats?.listings) return []
    return [...stats.listings].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      switch (sortKey) {
        case 'title': return dir * a.title.localeCompare(b.title)
        case 'view_count': return dir * ((a.view_count ?? 0) - (b.view_count ?? 0))
        case 'acquire_count': return dir * ((a.acquire_count ?? 0) - (b.acquire_count ?? 0))
        case 'conversion_rate': return dir * ((a.conversion_rate ?? 0) - (b.conversion_rate ?? 0))
        case 'avg_rating': return dir * ((a.avg_rating ?? 0) - (b.avg_rating ?? 0))
        case 'created_at': return dir * a.created_at.localeCompare(b.created_at)
        default: return 0
      }
    })
  }, [stats?.listings, sortKey, sortDir])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  if (loading && !stats) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-32 bg-accent rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-card rounded-xl border border-border p-8 text-center">
        <p className="text-destructive mb-2">{error}</p>
        <button onClick={fetchPublisherStats} className="text-brand text-sm hover:underline cursor-pointer">
          Retry
        </button>
      </div>
    )
  }

  // Empty state
  if (!stats || (stats.total_listings === 0 && stats.listings.length === 0)) {
    return (
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-foreground mb-6">Publisher Dashboard</h1>
        <div className="bg-card rounded-xl border border-border p-8 sm:p-12 text-center">
          <div className="text-4xl sm:text-5xl mb-4">📊</div>
          <h2 className="text-lg font-semibold text-foreground mb-2">No Published Listings Yet</h2>
          <p className="text-muted-foreground text-sm mb-4">
            Publish a deck on the marketplace to start tracking views and acquisitions.
          </p>
          <button
            onClick={() => navigate('/decks')}
            className="px-4 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand cursor-pointer"
          >
            Go to Decks
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-xl sm:text-2xl font-bold text-foreground mb-6">Publisher Dashboard</h1>

      {/* ── Overview Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard
          icon={<BarChart3 className="w-5 h-5" />}
          label="Active Listings"
          value={formatNumber(stats.total_listings)}
          color="blue"
        />
        <StatCard
          icon={<Eye className="w-5 h-5" />}
          label="Total Views"
          value={formatNumber(stats.total_views)}
          color="green"
        />
        <StatCard
          icon={<Download className="w-5 h-5" />}
          label="Total Acquisitions"
          value={formatNumber(stats.total_acquires)}
          color="purple"
        />
        <StatCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="Avg Conversion"
          value={`${stats.avg_conversion_rate}%`}
          color="orange"
        />
      </div>

      {/* ── Charts Row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Daily Views Chart */}
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="text-sm font-medium text-foreground mb-3">Daily Views (Last 30 Days)</h3>
          {stats.daily_views.length === 0 ? (
            <p className="text-sm text-content-tertiary py-8 text-center">No data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={stats.daily_views}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v: string) => v.slice(5)} // MM-DD
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={35} />
                <Tooltip />
                <Line type="monotone" dataKey="views" stroke="#6366f1" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="unique_viewers" stroke="#10b981" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Top Listings by Views */}
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="text-sm font-medium text-foreground mb-3">Top Listings by Views</h3>
          {stats.top_listings.length === 0 ? (
            <p className="text-sm text-content-tertiary py-8 text-center">No data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stats.top_listings} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                <YAxis
                  type="category"
                  dataKey="title"
                  tick={{ fontSize: 10 }}
                  width={100}
                  tickFormatter={(v: string) => v.length > 15 ? v.slice(0, 15) + '...' : v}
                />
                <Tooltip />
                <Bar dataKey="view_count" fill="#6366f1" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Acquisition Trend */}
      {stats.daily_acquires.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-4 mb-6">
          <h3 className="text-sm font-medium text-foreground mb-3">Acquisition Trend (Last 30 Days)</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={stats.daily_acquires}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10 }}
                tickFormatter={(v: string) => v.slice(5)}
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={35} />
              <Tooltip />
              <Bar dataKey="acquires" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Listings Table ── */}
      <div className="bg-card rounded-xl border border-border overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-medium text-foreground">Your Listings</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted">
                <SortHeader label="Title" sortKey="title" current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Views" sortKey="view_count" current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Acquires" sortKey="acquire_count" current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Conv %" sortKey="conversion_rate" current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Rating" sortKey="avg_rating" current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Created" sortKey="created_at" current={sortKey} dir={sortDir} onSort={handleSort} />
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedListings.map((listing) => (
                <ListingRow key={listing.id} listing={listing} navigate={navigate} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Recent Activity Feed ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Acquisitions */}
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="text-sm font-medium text-foreground mb-3">Recent Acquisitions</h3>
          {stats.recent_acquires.length === 0 ? (
            <p className="text-sm text-content-tertiary text-center py-4">No acquisitions yet</p>
          ) : (
            <div className="space-y-2">
              {stats.recent_acquires.map((acq) => (
                <div key={acq.id} className="flex items-center gap-2 text-sm">
                  <Download className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                  <span className="text-foreground truncate">
                    <span className="font-medium">{acq.user_name || 'Anonymous'}</span>
                    {' acquired '}
                    <span className="font-medium">{acq.deck_title}</span>
                  </span>
                  <span className="text-xs text-content-tertiary shrink-0 ml-auto">{timeAgo(acq.accepted_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Reviews */}
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="text-sm font-medium text-foreground mb-3">Recent Reviews</h3>
          {stats.recent_reviews.length === 0 ? (
            <p className="text-sm text-content-tertiary text-center py-4">No reviews yet</p>
          ) : (
            <div className="space-y-2">
              {stats.recent_reviews.map((review) => (
                <div key={review.id} className="text-sm border-b border-gray-50 pb-2 last:border-0">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-0.5">
                      {Array.from({ length: 5 }, (_, i) => (
                        <Star
                          key={i}
                          className={`w-3 h-3 ${i < review.rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200'}`}
                        />
                      ))}
                    </div>
                    <span className="text-muted-foreground truncate">{review.deck_title}</span>
                    <span className="text-xs text-content-tertiary ml-auto shrink-0">{timeAgo(review.created_at)}</span>
                  </div>
                  {review.body && (
                    <p className="text-muted-foreground text-xs mt-1 line-clamp-1">{review.body}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ──

const COLOR_MAP = {
  blue: 'bg-brand/10 text-brand',
  green: 'bg-success/10 text-success',
  purple: 'bg-purple-50 text-purple-600',
  orange: 'bg-orange-50 text-orange-600',
}

function StatCard({ icon, label, value, color }: {
  icon: React.ReactNode
  label: string
  value: string
  color: keyof typeof COLOR_MAP
}) {
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${COLOR_MAP[color]}`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground truncate">{label}</p>
          <p className="text-lg font-semibold text-foreground">{value}</p>
        </div>
      </div>
    </div>
  )
}

function SortHeader({ label, sortKey: sk, current, dir, onSort }: {
  label: string
  sortKey: SortKey
  current: SortKey
  dir: SortDir
  onSort: (key: SortKey) => void
}) {
  const isActive = current === sk
  return (
    <th
      className="px-3 py-2 text-left text-xs font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground"
      onClick={() => onSort(sk)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className={`w-3 h-3 ${isActive ? 'text-brand' : 'text-content-tertiary'}`} />
        {isActive && <span className="text-brand">{dir === 'asc' ? '\u2191' : '\u2193'}</span>}
      </span>
    </th>
  )
}

function ListingRow({ listing, navigate }: { listing: PublisherListingStats; navigate: (path: string) => void }) {
  return (
    <tr className="border-b border-gray-50 hover:bg-muted">
      <td className="px-3 py-2.5 font-medium text-foreground max-w-[200px] truncate">{listing.title}</td>
      <td className="px-3 py-2.5 text-muted-foreground">{formatNumber(listing.view_count)}</td>
      <td className="px-3 py-2.5 text-muted-foreground">{formatNumber(listing.acquire_count)}</td>
      <td className="px-3 py-2.5 text-muted-foreground">{listing.conversion_rate}%</td>
      <td className="px-3 py-2.5">
        <span className="inline-flex items-center gap-1">
          <Star className={`w-3 h-3 ${listing.avg_rating > 0 ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200'}`} />
          <span className="text-muted-foreground">{listing.avg_rating > 0 ? listing.avg_rating.toFixed(1) : '-'}</span>
          {listing.review_count > 0 && (
            <span className="text-content-tertiary text-xs">({listing.review_count})</span>
          )}
        </span>
      </td>
      <td className="px-3 py-2.5 text-content-tertiary text-xs">{new Date(listing.created_at).toLocaleDateString()}</td>
      <td className="px-3 py-2.5">
        <span className={`px-2 py-0.5 text-xs rounded-full ${
          listing.is_active ? 'bg-success/10 text-success' : 'bg-accent text-muted-foreground'
        }`}>
          {listing.is_active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <button
          onClick={() => navigate(`/marketplace/${listing.id}`)}
          className="text-brand hover:text-brand cursor-pointer"
          title="View listing"
        >
          <ExternalLink className="w-4 h-4" />
        </button>
      </td>
    </tr>
  )
}
