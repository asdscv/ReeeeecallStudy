import { useEffect, useState, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useAchievementStore } from '../../stores/achievement-store'

interface Particle {
  id: number
  x: number
  y: number
  color: string
  size: number
  angle: number
  speed: number
  rotation: number
  rotSpeed: number
}

const COLORS = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8']
const PARTICLE_COUNT = 60
const AUTO_DISMISS_MS = 3000

export function LevelUpCelebration() {
  const { t } = useTranslation('common')
  const { level, xp } = useAchievementStore()
  const [visible, setVisible] = useState(false)
  const [displayLevel, setDisplayLevel] = useState(0)
  const [particles, setParticles] = useState<Particle[]>([])
  const prevLevelRef = useRef(level)
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dismiss = useCallback(() => {
    setVisible(false)
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = null
    }
  }, [])

  // Detect level change
  useEffect(() => {
    const prevLevel = prevLevelRef.current
    prevLevelRef.current = level

    // Only trigger on actual level up (not initial load or decrease)
    if (prevLevel > 0 && level > prevLevel) {
      setDisplayLevel(level)
      setVisible(true)

      // Generate confetti particles
      const newParticles: Particle[] = Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
        id: i,
        x: 50 + (Math.random() - 0.5) * 20,
        y: 50 + (Math.random() - 0.5) * 10,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        size: 4 + Math.random() * 8,
        angle: Math.random() * 360,
        speed: 2 + Math.random() * 6,
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 20,
      }))
      setParticles(newParticles)

      // Auto-dismiss after 3s
      dismissTimerRef.current = setTimeout(dismiss, AUTO_DISMISS_MS)
    }
  }, [level, dismiss])

  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
    }
  }, [])

  if (!visible) return null

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 levelup-overlay"
      onClick={dismiss}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Escape') dismiss() }}
    >
      {/* Confetti particles */}
      {particles.map(p => (
        <div
          key={p.id}
          className="levelup-particle"
          style={{
            '--px': `${p.x}%`,
            '--py': `${p.y}%`,
            '--angle': `${p.angle}deg`,
            '--speed': `${p.speed}`,
            '--rot': `${p.rotation}deg`,
            '--rotSpeed': `${p.rotSpeed}`,
            '--size': `${p.size}px`,
            '--color': p.color,
          } as React.CSSProperties}
        />
      ))}

      {/* Center content */}
      <div className="text-center levelup-content" onClick={e => e.stopPropagation()}>
        <div className="levelup-star mb-4">
          {'\u2B50'}
        </div>
        <h2 className="text-4xl sm:text-5xl font-extrabold text-white mb-2 levelup-title">
          {t('levelUp.title')}
        </h2>
        <p className="text-6xl sm:text-7xl font-black text-yellow-400 mb-3 levelup-level">
          {t('levelUp.level', { level: displayLevel })}
        </p>
        <p className="text-lg text-yellow-200 mb-4 levelup-xp">
          {t('levelUp.xpEarned', { xp })}
        </p>
        <p className="text-md text-white/80 levelup-message">
          {t('levelUp.message')}
        </p>
      </div>

      <style>{`
        .levelup-overlay {
          animation: levelup-fadein 0.3s ease-out;
        }
        @keyframes levelup-fadein {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .levelup-star {
          font-size: 4rem;
          animation: levelup-star-spin 1s ease-out;
        }
        @keyframes levelup-star-spin {
          0% { transform: scale(0) rotate(-180deg); opacity: 0; }
          60% { transform: scale(1.3) rotate(10deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }

        .levelup-title {
          animation: levelup-scalein 0.5s ease-out 0.1s both;
        }
        .levelup-level {
          animation: levelup-scalein 0.5s ease-out 0.2s both;
          text-shadow: 0 0 30px rgba(250, 204, 21, 0.5);
        }
        .levelup-xp {
          animation: levelup-scalein 0.4s ease-out 0.4s both;
        }
        .levelup-message {
          animation: levelup-scalein 0.4s ease-out 0.5s both;
        }
        @keyframes levelup-scalein {
          0% { transform: scale(0.3); opacity: 0; }
          70% { transform: scale(1.05); }
          100% { transform: scale(1); opacity: 1; }
        }

        .levelup-particle {
          position: absolute;
          left: var(--px);
          top: var(--py);
          width: var(--size);
          height: var(--size);
          background: var(--color);
          border-radius: 2px;
          pointer-events: none;
          animation: levelup-confetti 2s ease-out forwards;
          --dx: calc(cos(var(--angle)) * var(--speed) * 80px);
          --dy: calc(sin(var(--angle)) * var(--speed) * 80px);
        }
        @keyframes levelup-confetti {
          0% {
            transform: translate(0, 0) rotate(var(--rot)) scale(1);
            opacity: 1;
          }
          100% {
            transform:
              translate(
                calc(cos(var(--angle)) * var(--speed) * 80px),
                calc(sin(var(--angle)) * var(--speed) * 120px + 200px)
              )
              rotate(calc(var(--rot) + var(--rotSpeed) * 360deg))
              scale(0.3);
            opacity: 0;
          }
        }

        @supports not (left: calc(cos(45deg) * 1px)) {
          .levelup-particle {
            animation: levelup-confetti-fallback 2s ease-out forwards;
          }
          @keyframes levelup-confetti-fallback {
            0% {
              transform: translate(0, 0) rotate(0deg) scale(1);
              opacity: 1;
            }
            100% {
              transform: translate(
                calc((var(--speed) - 4) * 60px),
                calc(var(--speed) * 80px)
              ) rotate(720deg) scale(0.2);
              opacity: 0;
            }
          }
        }
      `}</style>
    </div>
  )
}
