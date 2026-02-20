export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          display_name: string | null
          daily_new_limit: number
          default_study_mode: StudyMode
          timezone: string
          theme: 'light' | 'dark' | 'system'
          tts_enabled: boolean
          tts_lang: string
          tts_provider: 'web_speech' | 'edge_tts'
          locale: string
          role: UserRole
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          display_name?: string | null
          daily_new_limit?: number
          default_study_mode?: StudyMode
          timezone?: string
          theme?: 'light' | 'dark' | 'system'
          tts_enabled?: boolean
          tts_lang?: string
          tts_provider?: 'web_speech' | 'edge_tts'
          locale?: string
          role?: UserRole
        }
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>
      }
      card_templates: {
        Row: {
          id: string
          user_id: string
          name: string
          fields: TemplateField[]
          front_layout: LayoutItem[]
          back_layout: LayoutItem[]
          layout_mode: LayoutMode
          front_html: string
          back_html: string
          is_default: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          fields: TemplateField[]
          front_layout: LayoutItem[]
          back_layout: LayoutItem[]
          layout_mode?: LayoutMode
          front_html?: string
          back_html?: string
          is_default?: boolean
        }
        Update: Partial<Database['public']['Tables']['card_templates']['Insert']>
      }
      decks: {
        Row: {
          id: string
          user_id: string
          name: string
          description: string | null
          default_template_id: string | null
          color: string
          icon: string
          is_archived: boolean
          sort_order: number
          next_position: number
          srs_settings: SrsSettings
          share_mode: ShareMode | null
          source_deck_id: string | null
          source_owner_id: string | null
          is_readonly: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          description?: string | null
          default_template_id?: string | null
          color?: string
          icon?: string
          is_archived?: boolean
          sort_order?: number
          next_position?: number
          srs_settings?: SrsSettings
          share_mode?: ShareMode | null
          source_deck_id?: string | null
          source_owner_id?: string | null
          is_readonly?: boolean
        }
        Update: Partial<Database['public']['Tables']['decks']['Insert']>
      }
      cards: {
        Row: {
          id: string
          deck_id: string
          user_id: string
          template_id: string
          field_values: Record<string, string>
          tags: string[]
          sort_position: number
          srs_status: SrsStatus
          ease_factor: number
          interval_days: number
          repetitions: number
          next_review_at: string | null
          last_reviewed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          deck_id: string
          user_id: string
          template_id: string
          field_values: Record<string, string>
          tags?: string[]
          sort_position: number
          srs_status?: SrsStatus
          ease_factor?: number
          interval_days?: number
          repetitions?: number
          next_review_at?: string | null
        }
        Update: Partial<Database['public']['Tables']['cards']['Insert']>
      }
      deck_study_state: {
        Row: {
          id: string
          user_id: string
          deck_id: string
          new_start_pos: number
          review_start_pos: number
          new_batch_size: number
          review_batch_size: number
          sequential_pos: number
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          deck_id: string
          new_start_pos?: number
          review_start_pos?: number
          new_batch_size?: number
          review_batch_size?: number
          sequential_pos?: number
        }
        Update: Partial<Database['public']['Tables']['deck_study_state']['Insert']>
      }
      study_logs: {
        Row: {
          id: string
          user_id: string
          card_id: string
          deck_id: string
          study_mode: StudyMode
          rating: string
          prev_interval: number | null
          new_interval: number | null
          prev_ease: number | null
          new_ease: number | null
          review_duration_ms: number | null
          studied_at: string
        }
        Insert: {
          id?: string
          user_id: string
          card_id: string
          deck_id: string
          study_mode: StudyMode
          rating: string
          prev_interval?: number | null
          new_interval?: number | null
          prev_ease?: number | null
          new_ease?: number | null
          review_duration_ms?: number | null
        }
        Update: Partial<Database['public']['Tables']['study_logs']['Insert']>
      }
      study_sessions: {
        Row: {
          id: string
          user_id: string
          deck_id: string
          study_mode: StudyMode
          cards_studied: number
          total_cards: number
          total_duration_ms: number
          ratings: Record<string, number>
          started_at: string
          completed_at: string
          metadata?: Record<string, unknown>
        }
        Insert: {
          id?: string
          user_id: string
          deck_id: string
          study_mode: StudyMode
          cards_studied: number
          total_cards: number
          total_duration_ms: number
          ratings: Record<string, number>
          started_at: string
          completed_at?: string
          metadata?: Record<string, unknown>
        }
        Update: Partial<Database['public']['Tables']['study_sessions']['Insert']>
      }
    }
  }
}

export type UserRole = 'user' | 'admin'
export type StudyMode = 'srs' | 'sequential_review' | 'random' | 'sequential' | 'by_date' | 'cramming'
export type SrsStatus = 'new' | 'learning' | 'review' | 'suspended'
export type LayoutMode = 'default' | 'custom'
export type ShareMode = 'copy' | 'subscribe' | 'snapshot'
export type ShareStatus = 'pending' | 'active' | 'revoked' | 'declined'

export type TemplateField = {
  key: string
  name: string
  type: 'text' | 'image' | 'audio'
  order: number
  detail?: string
  tts_enabled?: boolean
  tts_lang?: string
}

export type LayoutItem = {
  field_key: string
  style: 'primary' | 'secondary' | 'hint' | 'detail' | 'media'
  font_size?: number
}

export type SrsSettings = {
  again_days: number
  hard_days: number
  good_days: number
  easy_days: number
}

export const DEFAULT_SRS_SETTINGS: SrsSettings = {
  again_days: 0,
  hard_days: 1,
  good_days: 1,
  easy_days: 4,
}

// Row type shortcuts
export type Profile = Database['public']['Tables']['profiles']['Row']
export type CardTemplate = Database['public']['Tables']['card_templates']['Row']
export type Deck = Database['public']['Tables']['decks']['Row']
export type Card = Database['public']['Tables']['cards']['Row']
export type DeckStudyState = Database['public']['Tables']['deck_study_state']['Row']
export type StudyLog = Database['public']['Tables']['study_logs']['Row']
export type StudySession = Database['public']['Tables']['study_sessions']['Row']

// Sharing types
export type DeckShare = {
  id: string
  deck_id: string
  owner_id: string
  recipient_id: string | null
  share_mode: ShareMode
  status: ShareStatus
  invite_code: string | null
  invite_email: string | null
  copied_deck_id: string | null
  created_at: string
  accepted_at: string | null
}

export type MarketplaceListing = {
  id: string
  deck_id: string
  owner_id: string
  title: string
  description: string | null
  tags: string[]
  category: string
  share_mode: ShareMode
  card_count: number
  acquire_count: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export type Content = {
  id: string
  slug: string
  locale: string
  title: string
  subtitle: string | null
  thumbnail_url: string | null
  content_blocks: unknown[]
  reading_time_minutes: number
  tags: string[]
  meta_title: string | null
  meta_description: string | null
  og_image_url: string | null
  canonical_url: string | null
  author_name: string
  is_published: boolean
  published_at: string | null
  created_at: string
  updated_at: string
}

export type UserCardProgress = {
  id: string
  user_id: string
  card_id: string
  deck_id: string
  srs_status: SrsStatus
  ease_factor: number
  interval_days: number
  repetitions: number
  next_review_at: string | null
  last_reviewed_at: string | null
  created_at: string
  updated_at: string
}

// ── Admin RPC response types ──

export type AdminOverviewStats = {
  total_users: number
  total_decks: number
  total_cards: number
  total_sessions: number
  total_study_time_ms: number
  total_cards_studied: number
  total_templates: number
  total_shared_decks: number
  total_marketplace_listings: number
}

export type AdminActiveUsers = {
  dau: number
  wau: number
  mau: number
  total_users: number
}

export type AdminUserSignup = {
  date: string
  count: number
}

export type AdminDailyStudyActivity = {
  date: string
  sessions: number
  cards: number
  total_duration_ms: number
}

export type AdminModeBreakdown = {
  mode: string
  session_count: number
  total_cards: number
  total_duration_ms: number
}

export type AdminContentStats = {
  total_listings: number
  active_listings: number
  total_acquires: number
  total_shares: number
  active_shares: number
  share_by_mode: { mode: string; count: number }[] | null
  top_categories: { category: string; count: number }[] | null
}

export type AdminRatingDistribution = {
  rating: string
  count: number
}

export type AdminRecentActivity = {
  date: string
  sessions: number
  active_users: number
  cards: number
}

export type AdminSystemStats = {
  total_api_keys: number
  active_api_keys: number
  expired_api_keys: number
  recently_used_keys: number
  total_contents: number
  published_contents: number
  total_study_logs: number
}

export type AdminSrsStatusBreakdown = {
  status: string
  count: number
}

export type AdminRetentionMetrics = {
  prev_month_active: number
  retained: number
  retention_rate: number
  churned: number
  churn_rate: number
  new_users_this_month: number
}

export type AdminPopularContent = {
  id: string
  title: string
  slug: string
  locale: string
  view_count: number
  unique_viewers: number
  avg_duration_ms: number
}

export type AdminRecentPublished = {
  id: string
  title: string
  slug: string
  locale: string
  published_at: string
  reading_time_minutes: number
  tags: string[]
}

export type AdminReferrerBreakdown = {
  category: string
  count: number
}

export type AdminDeviceBreakdown = {
  device_type: string
  count: number
}

export type AdminScrollDepthData = {
  milestone: number
  count: number
}

export type AdminConversionFunnelData = {
  content_viewers: number
  signed_up: number
  created_deck: number
  studied_cards: number
}

export type AdminBounceRate = {
  total_content_views: number
  bounced_views: number
  engaged_views: number
}

export type AdminTopPage = {
  page_path: string
  view_count: number
  unique_visitors: number
}

export type AdminPageViewsAnalytics = {
  total_page_views: number
  unique_visitors: number
  top_pages: AdminTopPage[]
  daily_page_views: { date: string; views: number; unique_visitors: number }[]
  referrer_breakdown: AdminReferrerBreakdown[]
  device_breakdown: AdminDeviceBreakdown[]
  utm_sources: { utm_source: string; count: number }[]
  bounce_rate: AdminBounceRate
}

export type AdminUtmSourceBreakdown = {
  source: string
  count: number
}

export type AdminContentsAnalytics = {
  total_contents: number
  published_contents: number
  draft_contents: number
  by_locale: { locale: string; count: number; published: number }[]
  top_tags: { tag: string; count: number }[]
  publishing_timeline: { month: string; count: number }[]
  avg_reading_time_minutes: number
  total_views: number
  unique_viewers: number
  avg_view_duration_ms: number
  popular_content: AdminPopularContent[]
  daily_views: { date: string; views: number; unique_viewers: number }[]
  recent_published: AdminRecentPublished[]
  referrer_breakdown: AdminReferrerBreakdown[]
  device_breakdown: AdminDeviceBreakdown[]
  scroll_depth: AdminScrollDepthData[]
  conversion_funnel: AdminConversionFunnelData
  utm_source_breakdown: AdminUtmSourceBreakdown[]
  cta_clicks: number
}
