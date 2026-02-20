import { motion, useScroll, useSpring, useReducedMotion } from 'motion/react'

export function ScrollProgress() {
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, { stiffness: 100, damping: 30, restDelta: 0.001 })
  const prefersReduced = useReducedMotion()

  if (prefersReduced) return null

  return (
    <motion.div
      className="fixed top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-blue-500 via-cyan-400 to-blue-500 z-[60] origin-left"
      style={{ scaleX }}
    />
  )
}
