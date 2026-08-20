import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '../../lib/utils'

/**
 * 부차적인 동작을 담는 "더보기" 메뉴.
 *
 * 툴바에 버튼을 계속 늘리면 무엇이 주된 동작인지 사라집니다. 자주 쓰지 않는 것은
 * 여기로 내려두고, 툴바에는 진짜 주인공만 남깁니다.
 *
 * Radix 드롭다운 프리미티브는 이 패키지에 없어서(대화상자와 slot 만 있습니다) 의존성을
 * 늘리지 않고 필요한 만큼만 구현했습니다 — Escape 로 닫기, 바깥 클릭으로 닫기, 닫힐 때
 * 트리거로 포커스 되돌리기, role=menu/menuitem.
 */
export interface OverflowMenuItem {
  key: string
  label: string
  icon?: ReactNode
  onSelect: () => void
}

export function OverflowMenu({
  items,
  label,
  className,
}: {
  items: OverflowMenuItem[]
  /** 아이콘만 있는 버튼이라 스크린리더용 이름이 필요합니다. */
  label: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (items.length === 0) return null

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-center px-2.5 sm:px-3 py-2 bg-card border border-border text-muted-foreground rounded-lg hover:bg-muted hover:text-foreground transition cursor-pointer"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {open && (
        <ul
          id={menuId}
          role="menu"
          aria-label={label}
          className="absolute right-0 z-20 mt-1 min-w-44 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-lg"
        >
          {items.map((item) => (
            <li key={item.key} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-muted transition cursor-pointer"
              >
                {item.icon}
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
