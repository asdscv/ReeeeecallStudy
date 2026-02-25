import { useState, useRef, useEffect } from 'react'
import { Globe, ChevronDown, Check } from 'lucide-react'
import { useLocale } from '../../hooks/useLocale'
import { SUPPORTED_LANGUAGE_OPTIONS } from '../../lib/locale-utils'

interface LanguageSelectorProps {
  direction?: 'up' | 'down'
  compact?: boolean
  className?: string
}

export function LanguageSelector({ direction = 'down', compact = false, className }: LanguageSelectorProps) {
  const { language, changeLanguage } = useLocale()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const currentLang = SUPPORTED_LANGUAGE_OPTIONS.find((l) => language?.startsWith(l.code)) ?? SUPPORTED_LANGUAGE_OPTIONS[0]

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSelect = (code: string) => {
    changeLanguage(code)
    setOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false)
  }

  const dropdownPosition = direction === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'

  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`}>
      <button
        data-testid="language-selector-trigger"
        onClick={() => setOpen(!open)}
        onKeyDown={handleKeyDown}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-gray-600 bg-transparent border border-gray-200 rounded-lg hover:border-gray-300 hover:bg-gray-50 transition cursor-pointer"
      >
        <Globe className="w-4 h-4" />
        {!compact && <span>{currentLang.label}</span>}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="listbox"
          className={`absolute ${dropdownPosition} left-0 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 min-w-[160px]`}
        >
          {SUPPORTED_LANGUAGE_OPTIONS.map((lang) => {
            const isSelected = currentLang.code === lang.code
            return (
              <button
                key={lang.code}
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelect(lang.code)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition cursor-pointer border-none bg-transparent flex items-center justify-between ${
                  isSelected ? 'text-blue-600 font-medium' : 'text-gray-600'
                }`}
              >
                <span>{lang.label}</span>
                {isSelected && <Check className="w-4 h-4" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
