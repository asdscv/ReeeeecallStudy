import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import {
  MARKETPLACE_CATEGORIES,
  DIFFICULTY_LEVELS,
  SHARE_MODES,
  DATE_RANGE_OPTIONS,
  countActiveFilters,
  type SortBy,
  type ListingFilters,
} from '../../lib/marketplace'

interface SearchFiltersProps {
  filters: ListingFilters & { sortBy: SortBy }
  popularTags: string[]
  onFilterChange: (filters: Partial<ListingFilters & { sortBy: SortBy }>) => void
  onReset: () => void
}

export function SearchFilters({
  filters,
  popularTags,
  onFilterChange,
  onReset,
}: SearchFiltersProps) {
  const { t } = useTranslation('marketplace')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const activeCount = countActiveFilters(filters)

  const handleTagToggle = (tag: string) => {
    const current = filters.tags ?? []
    const next = current.includes(tag)
      ? current.filter((t) => t !== tag)
      : [...current, tag]
    onFilterChange({ tags: next.length > 0 ? next : undefined })
  }

  return (
    <div className="space-y-3">
      {/* Search bar — full width */}
      <input
        type="text"
        value={filters.query ?? ''}
        onChange={(e) => onFilterChange({ query: e.target.value || undefined })}
        placeholder={t('searchPlaceholder')}
        className="w-full px-3 sm:px-4 py-2.5 rounded-lg border border-border focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none text-sm text-foreground"
      />

      {/* Row 1: Category + Sort + Verified toggle + Advanced button */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
        <select
          value={filters.category ?? ''}
          onChange={(e) => onFilterChange({ category: e.target.value || undefined })}
          className="px-3 py-2 rounded-lg border border-border text-sm text-foreground outline-none"
        >
          <option value="">{t('allCategories')}</option>
          {MARKETPLACE_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{t(c.labelKey as string)}</option>
          ))}
        </select>

        <select
          value={filters.sortBy}
          onChange={(e) => onFilterChange({ sortBy: e.target.value as SortBy })}
          className="px-3 py-2 rounded-lg border border-border text-sm text-foreground outline-none"
        >
          <option value="newest">{t('sortNewest')}</option>
          <option value="popular">{t('sortPopular')}</option>
          <option value="trending">{t('sortTrending', { defaultValue: 'Trending' })}</option>
          <option value="card_count">{t('sortCardCount')}</option>
          <option value="top_rated">{t('sortTopRated', { defaultValue: 'Top Rated' })}</option>
        </select>

        {/* Verified toggle */}
        <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm text-foreground cursor-pointer hover:bg-muted select-none whitespace-nowrap">
          <input
            type="checkbox"
            checked={filters.verifiedOnly ?? false}
            onChange={(e) => onFilterChange({ verifiedOnly: e.target.checked || undefined })}
            className="rounded border-border text-brand focus:ring-brand"
          />
          <span className="inline-flex items-center gap-1">
            <svg className="w-3.5 h-3.5 text-brand" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            {t('verifiedOnly', { defaultValue: 'Verified' })}
          </span>
        </label>

        {/* Advanced filters toggle */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-foreground hover:bg-muted cursor-pointer whitespace-nowrap"
        >
          {t('advancedFilters', { defaultValue: 'Advanced' })}
          {activeCount > 0 && (
            <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-medium bg-brand text-white rounded-full">
              {activeCount}
            </span>
          )}
          {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {/* Reset button (shown when filters are active) */}
        {activeCount > 0 && (
          <button
            onClick={onReset}
            className="flex items-center gap-1 px-3 py-2 rounded-lg text-sm text-destructive hover:bg-destructive/10 cursor-pointer whitespace-nowrap"
          >
            <X className="w-3.5 h-3.5" />
            {t('resetFilters', { defaultValue: 'Reset' })}
          </button>
        )}
      </div>

      {/* Advanced filters panel (collapsible) */}
      {showAdvanced && (
        <div className="p-4 bg-muted rounded-lg border border-border space-y-4">
          {/* Card count slider */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {t('minCardCount', { defaultValue: 'Minimum cards' })}: {filters.minCardCount ?? 0}
            </label>
            <input
              type="range"
              min={0}
              max={200}
              step={5}
              value={filters.minCardCount ?? 0}
              onChange={(e) => {
                const v = Number(e.target.value)
                onFilterChange({ minCardCount: v > 0 ? v : undefined })
              }}
              className="w-full sm:w-64 accent-blue-600"
            />
          </div>

          {/* Minimum rating */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {t('minRating', { defaultValue: 'Minimum rating' })}: {filters.minRating ?? 0}{'\u2605'}
            </label>
            <input
              type="range"
              min={0}
              max={5}
              step={1}
              value={filters.minRating ?? 0}
              onChange={(e) => {
                const v = Number(e.target.value)
                onFilterChange({ minRating: v > 0 ? v : undefined })
              }}
              className="w-full sm:w-64 accent-yellow-500"
            />
          </div>

          {/* Date range chips */}
          <div>
            <span className="text-xs font-medium text-muted-foreground mb-1.5 block">
              {t('dateRange', { defaultValue: 'Published in' })}
            </span>
            <div className="flex flex-wrap gap-2">
              {DATE_RANGE_OPTIONS.map((range) => {
                const isActive = (filters.dateRange ?? 'all') === range
                return (
                  <button
                    key={range}
                    onClick={() => onFilterChange({ dateRange: range === 'all' ? undefined : range })}
                    className={`px-3 py-1.5 text-xs rounded-full border cursor-pointer transition ${
                      isActive
                        ? 'bg-brand text-white border-brand'
                        : 'bg-card text-muted-foreground border-border hover:border-brand/30'
                    }`}
                  >
                    {range === 'all'
                      ? t('dateRangeAll', { defaultValue: 'All time' })
                      : t(`dateRange_${range}`, { defaultValue: `Last ${range}` })}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Share mode chips */}
          <div>
            <span className="text-xs font-medium text-muted-foreground mb-1.5 block">
              {t('shareModeFilter', { defaultValue: 'Share mode' })}
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => onFilterChange({ shareMode: undefined })}
                className={`px-3 py-1.5 text-xs rounded-full border cursor-pointer transition ${
                  !filters.shareMode
                    ? 'bg-brand text-white border-brand'
                    : 'bg-card text-muted-foreground border-border hover:border-brand/30'
                }`}
              >
                {t('allModes', { defaultValue: 'All' })}
              </button>
              {SHARE_MODES.map((mode) => {
                const isActive = filters.shareMode === mode
                return (
                  <button
                    key={mode}
                    onClick={() => onFilterChange({ shareMode: isActive ? undefined : mode })}
                    className={`px-3 py-1.5 text-xs rounded-full border cursor-pointer transition ${
                      isActive
                        ? 'bg-brand text-white border-brand'
                        : 'bg-card text-muted-foreground border-border hover:border-brand/30'
                    }`}
                  >
                    {t(`shareModes.${mode}`, mode)}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Difficulty level */}
          <div>
            <span className="text-xs font-medium text-muted-foreground mb-1.5 block">
              {t('difficultyFilter', { defaultValue: 'Difficulty' })}
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => onFilterChange({ difficulty: undefined })}
                className={`px-2.5 py-1 text-xs rounded-full border cursor-pointer transition ${
                  !filters.difficulty
                    ? 'bg-brand/15 text-brand border-brand/30'
                    : 'bg-card text-muted-foreground border-border hover:border-brand/30'
                }`}
              >
                {t('allDifficulty', { defaultValue: 'All' })}
              </button>
              {DIFFICULTY_LEVELS.map(({ value, labelKey }) => {
                const isActive = filters.difficulty === value
                return (
                  <button
                    key={value}
                    onClick={() => onFilterChange({ difficulty: isActive ? undefined : value })}
                    className={`px-2.5 py-1 text-xs rounded-full border cursor-pointer transition ${
                      isActive
                        ? 'bg-brand/15 text-brand border-brand/30'
                        : 'bg-card text-muted-foreground border-border hover:border-brand/30'
                    }`}
                  >
                    {t(labelKey, value)}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Popular tags cloud */}
          {popularTags.length > 0 && (
            <div>
              <span className="text-xs font-medium text-muted-foreground mb-1.5 block">
                {t('popularTags', { defaultValue: 'Popular tags' })}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {popularTags.map((tag) => {
                  const isActive = filters.tags?.includes(tag)
                  return (
                    <button
                      key={tag}
                      onClick={() => handleTagToggle(tag)}
                      className={`px-2.5 py-1 text-xs rounded-full border cursor-pointer transition ${
                        isActive
                          ? 'bg-brand/15 text-brand border-brand/30'
                          : 'bg-card text-muted-foreground border-border hover:border-brand/30'
                      }`}
                    >
                      #{tag}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
