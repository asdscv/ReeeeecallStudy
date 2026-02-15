import { MARKETPLACE_CATEGORIES, type SortBy } from '../../lib/marketplace'

interface SearchFiltersProps {
  query: string
  category: string
  sortBy: SortBy
  onQueryChange: (query: string) => void
  onCategoryChange: (category: string) => void
  onSortChange: (sortBy: SortBy) => void
}

export function SearchFilters({
  query,
  category,
  sortBy,
  onQueryChange,
  onCategoryChange,
  onSortChange,
}: SearchFiltersProps) {
  return (
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
      <input
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="덱 검색..."
        className="flex-1 px-3 sm:px-4 py-2 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-sm text-gray-900"
      />

      <select
        value={category}
        onChange={(e) => onCategoryChange(e.target.value)}
        className="px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 outline-none"
      >
        <option value="">전체 카테고리</option>
        {MARKETPLACE_CATEGORIES.map((c) => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>

      <select
        value={sortBy}
        onChange={(e) => onSortChange(e.target.value as SortBy)}
        className="px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 outline-none"
      >
        <option value="newest">최신순</option>
        <option value="popular">인기순</option>
        <option value="card_count">카드 수</option>
      </select>
    </div>
  )
}
