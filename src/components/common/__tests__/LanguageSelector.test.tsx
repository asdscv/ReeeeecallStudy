import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LanguageSelector } from '../LanguageSelector'

// Mock useLocale
const mockChangeLanguage = vi.fn()
vi.mock('../../../hooks/useLocale', () => ({
  useLocale: () => ({
    language: 'en',
    changeLanguage: mockChangeLanguage,
  }),
}))

beforeEach(() => {
  mockChangeLanguage.mockClear()
})

describe('LanguageSelector', () => {
  it('renders trigger button', () => {
    render(<LanguageSelector />)
    expect(screen.getByTestId('language-selector-trigger')).toBeInTheDocument()
  })

  it('shows current language label on trigger', () => {
    render(<LanguageSelector />)
    expect(screen.getByText('English')).toBeInTheDocument()
  })

  it('dropdown is closed by default', () => {
    render(<LanguageSelector />)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('opens dropdown on click', () => {
    render(<LanguageSelector />)
    fireEvent.click(screen.getByTestId('language-selector-trigger'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('shows all 7 languages in dropdown', () => {
    render(<LanguageSelector />)
    fireEvent.click(screen.getByTestId('language-selector-trigger'))
    expect(screen.getAllByRole('option')).toHaveLength(7)
  })

  it('calls changeLanguage on option click', () => {
    render(<LanguageSelector />)
    fireEvent.click(screen.getByTestId('language-selector-trigger'))
    fireEvent.click(screen.getByText('한국어'))
    expect(mockChangeLanguage).toHaveBeenCalledWith('ko')
  })

  it('closes dropdown after selecting a language', () => {
    render(<LanguageSelector />)
    fireEvent.click(screen.getByTestId('language-selector-trigger'))
    fireEvent.click(screen.getByText('한국어'))
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('closes dropdown on Escape key', () => {
    render(<LanguageSelector />)
    fireEvent.click(screen.getByTestId('language-selector-trigger'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByTestId('language-selector-trigger'), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('has aria-expanded attribute', () => {
    render(<LanguageSelector />)
    const trigger = screen.getByTestId('language-selector-trigger')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  it('has aria-haspopup=listbox', () => {
    render(<LanguageSelector />)
    expect(screen.getByTestId('language-selector-trigger')).toHaveAttribute('aria-haspopup', 'listbox')
  })

  it('marks current language with aria-selected', () => {
    render(<LanguageSelector />)
    fireEvent.click(screen.getByTestId('language-selector-trigger'))
    const options = screen.getAllByRole('option')
    const enOption = options.find((o) => o.textContent?.includes('English'))
    expect(enOption).toHaveAttribute('aria-selected', 'true')
  })

  it('applies direction="up" for upward dropdown', () => {
    render(<LanguageSelector direction="up" />)
    fireEvent.click(screen.getByTestId('language-selector-trigger'))
    const listbox = screen.getByRole('listbox')
    expect(listbox.className).toContain('bottom-full')
  })

  it('applies direction="down" for downward dropdown (default)', () => {
    render(<LanguageSelector direction="down" />)
    fireEvent.click(screen.getByTestId('language-selector-trigger'))
    const listbox = screen.getByRole('listbox')
    expect(listbox.className).toContain('top-full')
  })

  it('compact mode hides label text', () => {
    render(<LanguageSelector compact />)
    expect(screen.queryByText('English')).toBeNull()
  })

  it('passes additional className', () => {
    render(<LanguageSelector className="custom-class" />)
    const trigger = screen.getByTestId('language-selector-trigger')
    expect(trigger.parentElement?.className).toContain('custom-class')
  })
})
