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
          study_mode: string
          cards_studied: number
          total_cards: number
          total_duration_ms: number
          ratings: Record<string, number>
          started_at: string
          completed_at: string
        }
        Insert: {
          id?: string
          user_id: string
          deck_id: string
          study_mode: string
          cards_studied: number
          total_cards: number
          total_duration_ms: number
          ratings: Record<string, number>
          started_at: string
          completed_at?: string
        }
        Update: Partial<Database['public']['Tables']['study_sessions']['Insert']>
      }
    }
  }
}

export type StudyMode = 'srs' | 'sequential_review' | 'random' | 'sequential' | 'by_date'
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
