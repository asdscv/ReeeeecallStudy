import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { guard } from '../lib/rate-limit-instance'
import type { CardTemplate, TemplateField, LayoutItem, LayoutMode } from '../types/database'

interface TemplateState {
  templates: CardTemplate[]
  loading: boolean
  error: string | null

  fetchTemplates: () => Promise<void>
  createTemplate: (data: {
    name: string
    fields: TemplateField[]
    front_layout: LayoutItem[]
    back_layout: LayoutItem[]
    layout_mode?: LayoutMode
    front_html?: string
    back_html?: string
  }) => Promise<CardTemplate | null>
  updateTemplate: (id: string, data: {
    name?: string
    fields?: TemplateField[]
    front_layout?: LayoutItem[]
    back_layout?: LayoutItem[]
    layout_mode?: LayoutMode
    front_html?: string
    back_html?: string
  }) => Promise<boolean>
  deleteTemplate: (id: string) => Promise<boolean>
  duplicateTemplate: (id: string) => Promise<CardTemplate | null>
}

export const useTemplateStore = create<TemplateState>((set, get) => ({
  templates: [],
  loading: false,
  error: null,

  fetchTemplates: async () => {
    set({ loading: true, error: null })
    const { data, error } = await supabase
      .from('card_templates')
      .select('*')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) {
      set({ error: error.message, loading: false })
    } else {
      set({ templates: (data ?? []) as CardTemplate[], loading: false })
    }
  },

  createTemplate: async (input) => {
    const check = guard.check('card_create', 'templates_total')
    if (!check.allowed) { set({ error: check.message ?? 'errors:rateLimit.reached' }); return null }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data: tmpl, error } = await supabase
      .from('card_templates')
      .insert({
        user_id: user.id,
        name: input.name,
        fields: input.fields,
        front_layout: input.front_layout,
        back_layout: input.back_layout,
        layout_mode: input.layout_mode ?? 'default',
        front_html: input.front_html ?? '',
        back_html: input.back_html ?? '',
        is_default: false,
      } as Record<string, unknown>)
      .select()
      .single()

    if (error) {
      set({ error: error.message })
      return null
    }

    guard.recordSuccess('templates_total')
    await get().fetchTemplates()
    return tmpl as CardTemplate
  },

  updateTemplate: async (id, data) => {
    const { error } = await supabase
      .from('card_templates')
      .update(data as Record<string, unknown>)
      .eq('id', id)

    if (error) {
      set({ error: error.message })
      return false
    }

    await get().fetchTemplates()
    return true
  },

  deleteTemplate: async (id) => {
    // 기본 템플릿은 삭제 불가
    const tmpl = get().templates.find((t) => t.id === id)
    if (tmpl?.is_default) {
      set({ error: 'errors:template.cannotDeleteDefault' })
      return false
    }

    // 사용 중인 덱이 있는지 확인
    const { data: decks } = await supabase
      .from('decks')
      .select('id')
      .eq('default_template_id', id)

    if (decks && decks.length > 0) {
      set({ error: 'errors:template.inUseByDecks' })
      return false
    }

    const { error } = await supabase
      .from('card_templates')
      .delete()
      .eq('id', id)

    if (error) {
      set({ error: error.message })
      return false
    }

    await get().fetchTemplates()
    return true
  },

  duplicateTemplate: async (id) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const original = get().templates.find((t) => t.id === id)
    if (!original) return null

    const { data: tmpl, error } = await supabase
      .from('card_templates')
      .insert({
        user_id: user.id,
        name: `${original.name} (Copy)`,
        fields: original.fields,
        front_layout: original.front_layout,
        back_layout: original.back_layout,
        layout_mode: original.layout_mode,
        front_html: original.front_html,
        back_html: original.back_html,
        is_default: false,
      } as Record<string, unknown>)
      .select()
      .single()

    if (error) {
      set({ error: error.message })
      return null
    }

    await get().fetchTemplates()
    return tmpl as CardTemplate
  },
}))
