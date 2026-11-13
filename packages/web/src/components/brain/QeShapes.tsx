import { QE_INK, QE_STAR, QE_TRIANGLE, centerShapeScale } from '@reeeeecall/shared/lib/brain-games'

/**
 * Quick Eye's shapes, drawn as SVG geometry — never emoji or font glyphs, so every browser and font
 * shows the same thing: a regular five-point star, a triangle of the star's area (±2%, so a
 * distractor never stands out by brightness), and centre shapes of one area (a circle and a rounded
 * square — the centre answer is never a brightness cue). The unit shapes come from quick-eye-art.ts
 * (R = 1), shared with the app; these only place and scale them.
 */

function points(unit: readonly (readonly [number, number])[], x: number, y: number, r: number): string {
  return unit.map(([px, py]) => `${(x + px * r).toFixed(2)},${(y + py * r).toFixed(2)}`).join(' ')
}

/** The corner radius of a centre square ('square:<radius %>') as a fraction of its side. */
function cornerFraction(id: string): number {
  return Math.max(0, Math.min(50, Number(id.split(':')[1]) || 0)) / 100
}

/** The target star centred on (x, y), outer radius `r` (the stimulus size / 2). Inside an <svg>. */
export function Star({ x, y, r, fill = QE_INK }: { x: number; y: number; r: number; fill?: string }) {
  return <polygon points={points(QE_STAR, x, y, r)} fill={fill} />
}

/** A distractor triangle, apex up, centred on its centroid at (x, y); `r` as for the star. Inside an <svg>. */
export function Triangle({ x, y, r, fill = QE_INK }: { x: number; y: number; r: number; fill?: string }) {
  return <polygon points={points(QE_TRIANGLE, x, y, r)} fill={fill} />
}

/**
 * A centre shape ('circle', or 'square:<corner %>') centred on (x, y). `d` is the circle's diameter;
 * a square is scaled to the circle's area (centerShapeScale). Inside an <svg>.
 */
export function CenterShape({ id, x, y, d, fill = QE_INK }: { id: string; x: number; y: number; d: number; fill?: string }) {
  if (!id.startsWith('square')) return <circle cx={x} cy={y} r={d / 2} fill={fill} />
  const side = d * centerShapeScale(id)
  const rx = side * cornerFraction(id)
  return <rect x={x - side / 2} y={y - side / 2} width={side} height={side} rx={rx} ry={rx} fill={fill} />
}

/** A centre shape on its own, in a `size` box — the answer buttons draw exactly what was flashed. */
export function CenterShapeIcon({ id, size, color = QE_INK }: { id: string; size: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="block">
      <CenterShape id={id} x={size / 2} y={size / 2} d={size} fill={color} />
    </svg>
  )
}
