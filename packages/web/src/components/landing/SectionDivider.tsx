interface SectionDividerProps {
  type: 'wave' | 'angle' | 'curve'
  color?: string
  flip?: boolean
}

export function SectionDivider({ type, color = '#f9fafb', flip = false }: SectionDividerProps) {
  const transform = flip ? 'rotate(180deg)' : undefined

  return (
    <div className="w-full leading-[0] -my-px overflow-hidden" style={{ transform }} aria-hidden>
      <svg
        viewBox="0 0 1440 80"
        preserveAspectRatio="none"
        className="w-full h-[40px] sm:h-[60px] md:h-[80px] block"
      >
        {type === 'wave' && (
          <path
            d="M0,40 C240,80 480,0 720,40 C960,80 1200,0 1440,40 L1440,80 L0,80 Z"
            fill={color}
          />
        )}
        {type === 'angle' && (
          <polygon points="0,80 1440,0 1440,80" fill={color} />
        )}
        {type === 'curve' && (
          <path
            d="M0,80 Q720,0 1440,80 L1440,80 L0,80 Z"
            fill={color}
          />
        )}
      </svg>
    </div>
  )
}
