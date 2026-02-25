import { describe, it, expect } from 'vitest'
import { stripMarkdown } from '../content-schema.js'

describe('stripMarkdown', () => {
  // Existing behaviour — bold & italic
  it('strips **bold**', () => {
    expect(stripMarkdown('Hello **world**')).toBe('Hello world')
  })

  it('strips *italic*', () => {
    expect(stripMarkdown('Hello *world*')).toBe('Hello world')
  })

  it('strips nested **bold** and *italic*', () => {
    expect(stripMarkdown('A **bold** and *italic* text')).toBe('A bold and italic text')
  })

  // Heading markers
  it('strips # heading', () => {
    expect(stripMarkdown('# Title')).toBe('Title')
  })

  it('strips ## heading', () => {
    expect(stripMarkdown('## Subtitle')).toBe('Subtitle')
  })

  it('strips ### heading', () => {
    expect(stripMarkdown('### Section')).toBe('Section')
  })

  it('strips ###### heading (h6)', () => {
    expect(stripMarkdown('###### Deep')).toBe('Deep')
  })

  it('does not strip # in mid-text', () => {
    expect(stripMarkdown('Issue #42')).toBe('Issue #42')
  })

  // Blockquote
  it('strips > blockquote', () => {
    expect(stripMarkdown('> Quote text')).toBe('Quote text')
  })

  it('strips > on each line', () => {
    expect(stripMarkdown('> Line 1\n> Line 2')).toBe('Line 1\nLine 2')
  })

  // Unordered list markers
  it('strips - list marker', () => {
    expect(stripMarkdown('- Item one')).toBe('Item one')
  })

  it('strips * list marker (start of line)', () => {
    expect(stripMarkdown('* Item one')).toBe('Item one')
  })

  // Ordered list markers
  it('strips 1. ordered list', () => {
    expect(stripMarkdown('1. First item')).toBe('First item')
  })

  it('strips 12. ordered list', () => {
    expect(stripMarkdown('12. Twelfth item')).toBe('Twelfth item')
  })

  // Code blocks
  it('strips ``` fenced code blocks', () => {
    expect(stripMarkdown('```\ncode here\n```')).toBe('\ncode here\n')
  })

  it('strips ```language fenced code blocks', () => {
    expect(stripMarkdown('```javascript\ncode\n```')).toBe('\ncode\n')
  })

  // Inline code
  it('strips `inline code`', () => {
    expect(stripMarkdown('Use `console.log`')).toBe('Use console.log')
  })

  // Links
  it('strips [text](url) links', () => {
    expect(stripMarkdown('See [our docs](https://example.com)')).toBe('See our docs')
  })

  // Strikethrough
  it('strips ~~strikethrough~~', () => {
    expect(stripMarkdown('This is ~~deleted~~ text')).toBe('This is deleted text')
  })

  // Edge cases
  it('returns non-string input unchanged', () => {
    expect(stripMarkdown(42)).toBe(42)
    expect(stripMarkdown(null)).toBe(null)
    expect(stripMarkdown(undefined)).toBe(undefined)
  })

  it('handles empty string', () => {
    expect(stripMarkdown('')).toBe('')
  })

  it('handles string with no markdown', () => {
    expect(stripMarkdown('Plain text here')).toBe('Plain text here')
  })

  it('handles combined markdown in one string', () => {
    const input = '### **Bold Title**\n> *Italic quote*\n- List item\n1. Ordered'
    const expected = 'Bold Title\nItalic quote\nList item\nOrdered'
    expect(stripMarkdown(input)).toBe(expected)
  })

  it('handles multiline with mixed markers', () => {
    const input = '## Overview\n\nThis is **important** text.\n\n- Feature 1\n- Feature 2'
    const expected = 'Overview\n\nThis is important text.\n\nFeature 1\nFeature 2'
    expect(stripMarkdown(input)).toBe(expected)
  })
})
