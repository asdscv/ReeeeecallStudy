import { create } from 'zustand'
import i18next from 'i18next'
import { supabase } from '../lib/supabase'
import { guard } from '../lib/rate-limit-instance'
import { buildPresetTemplate, type QuickPreset } from '../lib/default-templates'
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
  /**
   * Quick-Create: reuse (or create once) the user's card_template for a
   * field-count preset. Keyed on the preset's stable name + the
   * card_templates(user_id,name) UNIQUE index, so repeated quick decks of the
   * same shape share one template instead of spawning duplicates.
   */
  findOrCreatePresetTemplate: (preset: QuickPreset) => Promise<CardTemplate | null>
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
    if (!check.allowed) { set({ error: check.message ?? 'errors:template.rateLimitReached' }); return null }

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

  findOrCreatePresetTemplate: async (preset) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const find = async (): Promise<CardTemplate | null> => {
      const { data } = await supabase
        .from('card_templates')
        .select('*')
        .eq('user_id', user.id)
        .eq('name', preset.templateName)
        .maybeSingle()
      return (data as CardTemplate | null) ?? null
    }

    const existing = await find()
    if (existing) return existing

    const shape = buildPresetTemplate(preset)
    const created = await get().createTemplate({ name: preset.templateName, ...shape })
    if (created) return created

    // A concurrent quick-create of the same preset may have won the
    // UNIQUE(user_id,name) race — re-read instead of failing.
    return await find()
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
      set({ error: i18next.t('errors:template.inUseByDecks', { count: decks.length }) })
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
        name: `${original.name} (${i18next.t('common:duplicate')})`,
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
