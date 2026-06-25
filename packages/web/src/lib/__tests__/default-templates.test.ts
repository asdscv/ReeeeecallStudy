import { describe, it, expect } from 'vitest'
import {
  QUICK_PRESETS,
  presetFieldSpecs,
  buildPresetTemplate,
} from '@reeeeecall/shared/lib/default-templates'

describe('quick-create field-count presets', () => {
  it('exposes 4 presets, all 1 front, back 1..4, unique ids + template names', () => {
    expect(QUICK_PRESETS.map((p) => [p.front, p.back])).toEqual([[1, 1], [1, 2], [1, 3], [1, 4]])
    expect(new Set(QUICK_PRESETS.map((p) => p.id)).size).toBe(4)
    expect(new Set(QUICK_PRESETS.map((p) => p.templateName)).size).toBe(4)
  })

  it('presetFieldSpecs: front cells then back cells, sequential field_N keys', () => {
    const p = QUICK_PRESETS.find((x) => x.id === 'f1b2')!
    expect(presetFieldSpecs(p)).toEqual([
      { key: 'field_1', side: 'front', index: 1 },
      { key: 'field_2', side: 'back', index: 1 },
      { key: 'field_3', side: 'back', index: 2 },
    ])
  })

  it('buildPresetTemplate: text fields + front/back layouts match the shape', () => {
    const p = QUICK_PRESETS.find((x) => x.id === 'f1b3')!
    const { fields, front_layout, back_layout } = buildPresetTemplate(p)
    expect(fields.map((f) => f.key)).toEqual(['field_1', 'field_2', 'field_3', 'field_4'])
    expect(fields.every((f) => f.type === 'text')).toBe(true)
    expect(fields.map((f) => f.order)).toEqual([0, 1, 2, 3])
    expect(front_layout).toEqual([{ field_key: 'field_1', style: 'primary' }])
    expect(back_layout).toEqual([
      { field_key: 'field_2', style: 'primary' },
      { field_key: 'field_3', style: 'detail' },
      { field_key: 'field_4', style: 'detail' },
    ])
  })

  it('basic preset (1·1) names its two fields 앞면 / 뒷면', () => {
    const { fields } = buildPresetTemplate(QUICK_PRESETS[0])
    expect(fields.map((f) => f.name)).toEqual(['앞면', '뒷면'])
  })

  it('multi-back preset numbers extra back fields (뒷면 / 뒷면 2 …)', () => {
    const { fields } = buildPresetTemplate(QUICK_PRESETS.find((x) => x.id === 'f1b3')!)
    expect(fields.map((f) => f.name)).toEqual(['앞면', '뒷면', '뒷면 2', '뒷면 3'])
  })
})
