import { describe, it, expect } from 'vitest'
import { stripMarkdownText } from '../content-blocks'

describe('stripMarkdownText', () => {
  // Bold & italic
  it('strips **bold**', () => {
    expect(stripMarkdownText('Hello **world**')).toBe('Hello world')
  })

  it('strips *italic*', () => {
    expect(stripMarkdownText('Hello *world*')).toBe('Hello world')
  })

  // Heading markers
  it('strips ### heading', () => {
    expect(stripMarkdownText('### Section Title')).toBe('Section Title')
  })

  it('strips # through ###### headings', () => {
    expect(stripMarkdownText('# H1')).toBe('H1')
    expect(stripMarkdownText('###### H6')).toBe('H6')
  })

  // Blockquote
  it('strips > blockquote', () => {
    expect(stripMarkdownText('> Important note')).toBe('Important note')
  })

  // List markers
  it('strips - unordered list', () => {
    expect(stripMarkdownText('- List item')).toBe('List item')
  })

  it('strips * unordered list', () => {
    expect(stripMarkdownText('* List item')).toBe('List item')
  })

  it('strips 1. ordered list', () => {
    expect(stripMarkdownText('1. First')).toBe('First')
  })

  // Code
  it('strips `inline code`', () => {
    expect(stripMarkdownText('Use `map()` function')).toBe('Use map() function')
  })

  it('strips ``` fenced code blocks', () => {
    expect(stripMarkdownText('```\ncode\n```')).toBe('\ncode\n')
  })

  // Links
  it('strips [text](url) links', () => {
    expect(stripMarkdownText('Visit [our site](https://example.com)')).toBe('Visit our site')
  })

  // Strikethrough
  it('strips ~~strikethrough~~', () => {
    expect(stripMarkdownText('~~old~~ new')).toBe('old new')
  })

  // Edge cases
  it('returns empty string for empty input', () => {
    expect(stripMarkdownText('')).toBe('')
  })

  it('passes through plain text', () => {
    expect(stripMarkdownText('No markdown here')).toBe('No markdown here')
  })

  it('handles combined markdown', () => {
    expect(stripMarkdownText('### **Bold Title**')).toBe('Bold Title')
  })
})
