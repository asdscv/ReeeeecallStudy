import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { ContentListItem, ContentDetail } from '../types/content-blocks'
import { getCurrentLanguage } from '../lib/i18n-bridge'
import { toContentLocale, DEFAULT_LOCALE } from '../lib/locale-utils'

const PAGE_SIZE = 12

interface ContentState {
  // List
  items: ContentListItem[]
  hasMore: boolean
  listLoading: boolean
  listError: string | null
  cursor: { publishedAt: string; id: string } | null

  // Detail
  currentArticle: ContentDetail | null
  detailLoading: boolean
  detailError: string | null

  // Related
  relatedArticles: ContentListItem[]

  // Actions
  fetchContents: (reset?: boolean) => Promise<void>
  fetchContentBySlug: (slug: string) => Promise<void>
  fetchRelatedArticles: (slug: string, tags: string[]) => Promise<void>
  resetList: () => void
}

export const useContentStore = create<ContentState>((set, get) => ({
  items: [],
  hasMore: true,
  listLoading: false,
  listError: null,
  cursor: null,

  currentArticle: null,
  detailLoading: false,
  detailError: null,
  relatedArticles: [],

  fetchContents: async (reset = false) => {
    const state = get()
    if (state.listLoading) return

    if (reset) {
      set({ items: [], cursor: null, hasMore: true })
    }

    set({ listLoading: true, listError: null })

    const currentLocale = toContentLocale(getCurrentLanguage())
    const cursor = reset ? null : get().cursor

    let query = supabase
      .from('contents')
      .select('id, slug, title, subtitle, thumbnail_url, reading_time_minutes, tags, published_at')
      .eq('is_published', true)
      .eq('locale', currentLocale)
      .order('published_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PAGE_SIZE + 1)

    if (cursor) {
      query = query.or(
        `published_at.lt.${cursor.publishedAt},and(published_at.eq.${cursor.publishedAt},id.lt.${cursor.id})`,
      )
    }

    const { data, error } = await query

    if (error) {
      set({ listError: error.message, listLoading: false })
      return
    }

    const rows = (data ?? []) as ContentListItem[]
    const hasMore = rows.length > PAGE_SIZE
    const pageItems = hasMore ? rows.slice(0, PAGE_SIZE) : rows

    const lastItem = pageItems[pageItems.length - 1]
    const newCursor = lastItem
      ? { publishedAt: lastItem.published_at, id: lastItem.id }
      : null

    set((s) => ({
      items: reset ? pageItems : [...s.items, ...pageItems],
      hasMore,
      cursor: newCursor,
      listLoading: false,
    }))
  },

  fetchContentBySlug: async (slug: string) => {
    set({ detailLoading: true, detailError: null, currentArticle: null })

    const currentLocale = toContentLocale(getCurrentLanguage())

    // Try current locale first
    let { data, error } = await supabase
      .from('contents')
      .select('*')
      .eq('slug', slug)
      .eq('is_published', true)
      .eq('locale', currentLocale)
      .single()

    // Fallback to default locale if not found in current locale
    if (error && currentLocale !== DEFAULT_LOCALE) {
      const fallback = await supabase
        .from('contents')
        .select('*')
        .eq('slug', slug)
        .eq('is_published', true)
        .eq('locale', DEFAULT_LOCALE)
        .single()

      data = fallback.data
      error = fallback.error
    }

    if (error) {
      set({ detailError: error.message, detailLoading: false })
      return
    }

    set({ currentArticle: data as ContentDetail, detailLoading: false })
  },

  fetchRelatedArticles: async (slug: string, tags: string[]) => {
    const currentLocale = toContentLocale(getCurrentLanguage())
    const { data } = await supabase
      .from('contents')
      .select('id, slug, title, subtitle, thumbnail_url, reading_time_minutes, tags, published_at')
      .eq('is_published', true)
      .eq('locale', currentLocale)
      .neq('slug', slug)
      .order('published_at', { ascending: false })
      .limit(20)

    if (!data || data.length === 0) {
      set({ relatedArticles: [] })
      return
    }

    const tagSet = new Set(tags)
    const scored = (data as ContentListItem[])
      .map((item) => ({
        item,
        score: (item.tags || []).filter((t) => tagSet.has(t)).length,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((s) => s.item)

    set({ relatedArticles: scored })
  },

  resetList: () => {
    set({
      items: [],
      hasMore: true,
      listLoading: false,
      listError: null,
      cursor: null,
    })
  },
}))
