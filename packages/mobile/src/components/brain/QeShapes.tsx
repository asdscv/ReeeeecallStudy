import { View } from 'react-native'
import { QE_STAR_CORE_R, QE_STAR_SPIKE, QE_TRIANGLE_BORDER, centerShapeScale } from '@reeeeecall/shared/lib/brain-games'

/**
 * Quick Eye's shapes as plain Views, from the shared geometry (quick-eye-art.ts), so the phone
 * draws what the web's SVG draws — never a ★/▲ glyph, whose size and weight change with the font.
 * No SVG module is bundled (OTA-safe means no new native code), so:
 *
 * - Star: a core circle and five spikes. A spike is a border triangle at the top of a star-sized
 *   wrapper rotated 72°·k; a View turns about its own centre, which is the star's, so no transform
 *   origin is needed. The core circle covers every spike's base, so no seam shows between them.
 * - Triangle: one border triangle (transparent sides, ink bottom), its centroid on the slot. Same
 *   area as the star within 2%, so a distractor never stands out by brightness.
 * - CenterShape: a circle, or a rounded square of the circle's area (centerShapeScale) — the
 *   answer buttons draw the same shapes, so what flashed and what is offered look alike.
 *
 * `x` / `y` are the shape's centre in its parent; `size` is the stimulus size (outer radius size / 2).
 */
interface PlacedShape {
  x: number
  y: number
  size: number
  color: string
}

const SPIKES = [0, 1, 2, 3, 4]

export function Star({ x, y, size, color }: PlacedShape) {
  const r = size / 2
  const core = QE_STAR_CORE_R * r
  const half = QE_STAR_SPIKE.halfBase * r
  const height = QE_STAR_SPIKE.height * r
  // The spike's base lies on a side of the inner pentagon, `apothem` above the centre; its tip at R.
  const top = r - QE_STAR_SPIKE.apothem * r - height
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: x - r, top: y - r, width: size, height: size }}>
      {SPIKES.map((k) => (
        <View key={k} style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, transform: [{ rotate: `${k * 72}deg` }] }}>
          <View style={[TRIANGLE, { left: r - half, top, borderLeftWidth: half, borderRightWidth: half, borderBottomWidth: height, borderBottomColor: color }]} />
        </View>
      ))}
      <View style={{ position: 'absolute', left: r - core, top: r - core, width: core * 2, height: core * 2, borderRadius: core, backgroundColor: color }} />
    </View>
  )
}

export function Triangle({ x, y, size, color }: PlacedShape) {
  const r = size / 2
  const half = QE_TRIANGLE_BORDER.halfBase * r
  const height = QE_TRIANGLE_BORDER.height * r
  // The centroid sits a third of the height above the base: that point is the slot.
  return (
    <View
      pointerEvents="none"
      style={[TRIANGLE, { left: x - half, top: y - (height * 2) / 3, borderLeftWidth: half, borderRightWidth: half, borderBottomWidth: height, borderBottomColor: color }]}
    />
  )
}

/** A centre shape — 'circle', or 'square:<corner radius %>' — at the circle's diameter `size`, a square scaled to the same area. */
export function CenterShape({ id, size, color }: { id: string; size: number; color: string }) {
  if (!id.startsWith('square')) return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
  const side = size * centerShapeScale(id)
  const radius = (Math.max(0, Math.min(50, Number(id.split(':')[1]) || 0)) / 100) * side
  return <View style={{ width: side, height: side, borderRadius: radius, backgroundColor: color }} />
}

const TRIANGLE = {
  position: 'absolute',
  width: 0,
  height: 0,
  backgroundColor: 'transparent',
  borderLeftColor: 'transparent',
  borderRightColor: 'transparent',
} as const
