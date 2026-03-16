import { describe, it, expect } from 'vitest'
import { reconcileFieldValues } from '../card-utils'
import type { TemplateField } from '../../types/database'

function makeFields(...names: string[]): TemplateField[] {
  return names.map((name, i) => ({
    key: `field_${name}`,
    name,
    type: 'text' as const,
    order: i,
  }))
}

describe('reconcileFieldValues', () => {
  it('should return empty object when template has no fields', () => {
    const result = reconcileFieldValues([], { field_front: '안녕' })
    expect(result).toEqual({})
  })

  it('should return empty values when card has no data', () => {
    const fields = makeFields('앞면', '뒷면')
    const result = reconcileFieldValues(fields, {})
    expect(result).toEqual({ field_앞면: '', field_뒷면: '' })
  })

  it('should preserve matching field values', () => {
    const fields = makeFields('앞면', '뒷면')
    const values = { field_앞면: '你好', field_뒷면: '안녕하세요' }
    const result = reconcileFieldValues(fields, values)
    expect(result).toEqual({ field_앞면: '你好', field_뒷면: '안녕하세요' })
  })

  it('should add empty string for new template fields', () => {
    const fields = makeFields('앞면', '뒷면', '발음')
    const values = { field_앞면: '你好', field_뒷면: '안녕하세요' }
    const result = reconcileFieldValues(fields, values)
    expect(result).toEqual({
      field_앞면: '你好',
      field_뒷면: '안녕하세요',
      field_발음: '',
    })
  })

  it('should drop orphaned fields not in template', () => {
    const fields = makeFields('앞면')
    const values = { field_앞면: '你好', field_뒷면: '안녕하세요', field_예문: '你好吗' }
    const result = reconcileFieldValues(fields, values)
    expect(result).toEqual({ field_앞면: '你好' })
  })

  it('should handle mixed: some match, some new, some removed', () => {
    const fields = makeFields('앞면', '발음', '힌트')
    const values = { field_앞면: '你好', field_뒷면: '안녕하세요' }
    const result = reconcileFieldValues(fields, values)
    expect(result).toEqual({
      field_앞면: '你好',
      field_발음: '',
      field_힌트: '',
    })
  })

  it('should handle null/undefined card values as empty', () => {
    const fields = makeFields('앞면')
    const result = reconcileFieldValues(fields, null as unknown as Record<string, string>)
    expect(result).toEqual({ field_앞면: '' })
  })

  it('should preserve field order from template', () => {
    const fields = makeFields('C', 'A', 'B')
    const values = { field_B: 'b', field_A: 'a', field_C: 'c' }
    const result = reconcileFieldValues(fields, values)
    const keys = Object.keys(result)
    expect(keys).toEqual(['field_C', 'field_A', 'field_B'])
  })

  it('should not mutate original card values', () => {
    const fields = makeFields('앞면')
    const values = { field_앞면: '你好', field_뒷면: '안녕' }
    const original = { ...values }
    reconcileFieldValues(fields, values)
    expect(values).toEqual(original)
  })

  it('should work correctly when fields have detail property', () => {
    const fields: TemplateField[] = [
      { key: 'field_word', name: '단어', type: 'text', order: 0, detail: '중국어 단어' },
      { key: 'field_meaning', name: '뜻', type: 'text', order: 1, detail: '한국어 의미를 입력하세요' },
    ]
    const values = { field_word: '你好' }
    const result = reconcileFieldValues(fields, values)
    expect(result).toEqual({ field_word: '你好', field_meaning: '' })
  })
})
