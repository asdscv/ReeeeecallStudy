import { useState } from 'react'
import { View, StyleSheet } from 'react-native'

/**
 * A small line of the recent rounds' levels; the last point is the round just played. Drawn from
 * plain views (no SVG module): each step of the line is a thin rotated bar, the area under it a
 * skewed column clipped at the bottom, and the last point a ringed dot.
 */
export function Sparkline({ values, color, height = 56, width }: { values: number[]; color: string; height?: number; width?: number }) {
  const [measured, setMeasured] = useState<number | null>(null)
  const w = width ?? measured
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts =
    w === null
      ? []
      : values.map((v, i) => ({
          x: (i / Math.max(1, values.length - 1)) * (w - 12) + 6,
          // A flat run sits mid-height, not on the floor.
          y: max === min ? height / 2 : height - 6 - ((v - min) / span) * (height - 12),
        }))
  const last = pts[pts.length - 1]
  return (
    <View
      style={[styles.box, { height }, width !== undefined && { width }]}
      onLayout={width !== undefined ? undefined : (e) => setMeasured(Math.floor(e.nativeEvent.layout.width))}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      <View style={[StyleSheet.absoluteFill, styles.clip]}>
        {pts.slice(1).map((b, i) => {
          const a = pts[i]
          const dx = b.x - a.x
          const dy = b.y - a.y
          return (
            <View
              key={`a${i}`}
              style={{
                position: 'absolute',
                left: a.x,
                top: (a.y + b.y) / 2,
                width: dx + 0.5,
                height: height + Math.abs(dy),
                backgroundColor: color,
                opacity: 0.15,
                transform: [{ skewY: `${Math.atan2(dy, dx)}rad` }],
              }}
            />
          )
        })}
      </View>
      {pts.slice(1).map((b, i) => {
        const a = pts[i]
        const len = Math.hypot(b.x - a.x, b.y - a.y)
        return (
          <View
            key={`l${i}`}
            style={{
              position: 'absolute',
              left: (a.x + b.x) / 2 - len / 2,
              top: (a.y + b.y) / 2 - 1.25,
              width: len,
              height: 2.5,
              borderRadius: 1.25,
              backgroundColor: color,
              transform: [{ rotate: `${Math.atan2(b.y - a.y, b.x - a.x)}rad` }],
            }}
          />
        )
      })}
      {last ? <View style={[styles.dot, { left: last.x - 5, top: last.y - 5, borderColor: color }]} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { alignSelf: 'stretch' },
  clip: { overflow: 'hidden' },
  dot: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFFFFF', borderWidth: 2.5 },
})
