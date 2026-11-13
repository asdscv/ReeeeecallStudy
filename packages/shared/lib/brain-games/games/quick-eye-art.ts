import { createRng } from '../rng'
import type { QePlaceId, QuickEyeView } from '../types'

/**
 * Quick Eye's drawing, shared by web (SVG) and mobile (Views) so the two show the same field.
 *
 * The measuring frame follows the protocol's display (EVIDENCE §2.3, #37): a mid-grey field
 * (relative luminance 0.185 in every stage group, only the hue changes), one light ink for every
 * stimulus, a centre box of the field's tone with a 2dp ink border, and a backward mask laid only
 * on the field whose mean luminance matches the stimulus frame it covers, at Michelson 0.40 (≤ 0.5),
 * random rounded cells (no stripes, no checks). On the old dark-blue field the mask made the field
 * ~10× brighter at once and a 33ms flash survived as an afterimage.
 *
 * Shapes are geometry, never emoji or font glyphs: a regular five-point star and an equilateral
 * triangle of the same area (±2%), so a distractor never stands out by brightness; a circle and a
 * rounded square of the same area, so the centre answer is never a brightness cue.
 *
 * Unit shapes: centred on (0, 0), y down, the outer radius R = 1 (draw at R = stim / 2).
 */

/** The ink every stimulus is drawn in — about 3.9:1 against every field tint (WCAG 1.4.11 asks 3:1). */
export const QE_INK = '#F3F0E8'
/** The warm glow on a right centre answer in the reveal (never during the measured frames). */
export const QE_WARM = '#F2C46B'

/** Field tint per stage group, all at relative luminance 0.185 ± 0.01 (pinned by a test). */
export const QE_FIELD_TINT: Record<QePlaceId, string> = {
  dock: '#7A766F',
  shore: '#6E7A80',
  pines: '#727B6C',
  tea: '#787A68',
  lake: '#7A7488',
}

/**
 * The reveal layer's colours per stage group — drawn only after the answer, outside the measured
 * frames: the star (and triangles) take one hue of the group. Null: nothing of that kind there.
 */
export const QE_REVEAL_ART: Record<QePlaceId, { star: string | null; triangle: string | null }> = {
  dock: { star: null, triangle: null },
  shore: { star: '#E39A7A', triangle: null },
  pines: { star: '#D8694E', triangle: '#9DAA8F' },
  tea: { star: '#9F8BD6', triangle: '#B7B48C' },
  lake: { star: '#EAD27A', triangle: '#E9E4D8' },
}

/** The star's inner radius: the golden-ratio star (0.382 R). Area 1.1227 R². */
export const QE_STAR_CORE_R = 0.382

/** The ten points of the star, outer first at 12 o'clock, clockwise. */
export const QE_STAR: readonly [number, number][] = Array.from({ length: 10 }, (_, k) => {
  const a = -Math.PI / 2 + (k * Math.PI) / 5
  const r = k % 2 === 0 ? 1 : QE_STAR_CORE_R
  return [round4(r * Math.cos(a)), round4(r * Math.sin(a))] as [number, number]
})

/**
 * One spike of the star for platforms without polygons (mobile): a triangle on a side of the inner
 * pentagon. Five of them — each in a star-sized wrapper rotated 72°·k about its own centre — over a
 * core circle of radius QE_STAR_CORE_R make the star exactly (the circle stays inside the spikes).
 * `apothem` is the inner pentagon's: the spike's base sits that far above the centre.
 */
export const QE_STAR_SPIKE = { halfBase: 0.2245, height: 0.691, apothem: 0.309 } as const

/** The triangle's circumradius: an equilateral triangle of the star's area. */
export const QE_TRIANGLE_R = 0.93

/** The triangle's three points, apex up, centred on its centroid. */
export const QE_TRIANGLE: readonly [number, number][] = [0, 1, 2].map((k) => {
  const a = -Math.PI / 2 + (k * 2 * Math.PI) / 3
  return [round4(QE_TRIANGLE_R * Math.cos(a)), round4(QE_TRIANGLE_R * Math.sin(a))] as [number, number]
})

/**
 * The triangle as a border triangle (mobile): transparent left/right borders of `halfBase`, an ink
 * bottom border of `height`; its centroid sits `height / 3` above the box's bottom edge — place the
 * box so that point is the slot centre.
 */
export const QE_TRIANGLE_BORDER = { halfBase: 0.8055, height: 1.395 } as const

/** Area of a polygon given as points (shoelace), for the tests. */
export function polygonArea(points: readonly (readonly [number, number])[]): number {
  let a = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % points.length]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a) / 2
}

/** Corner radius of a centre square as a fraction of its side ('square:<radius %>'). */
function squareRadius(shapeId: string): number {
  return Math.max(0, Math.min(50, Number(shapeId.split(':')[1]) || 0)) / 100
}

/**
 * The side of a centre shape relative to the circle's diameter, so both have the same area: a
 * rounded square of side a and corner radius p·a has area a²(1 − (4 − π)p²), the circle πd²/4.
 * 'circle' → 1; 'square:0' → 0.886; 'square:40' → 0.954. Answer buttons draw the same shapes.
 */
export function centerShapeScale(shapeId: string): number {
  if (shapeId === 'circle' || !shapeId.startsWith('square')) return 1
  const p = squareRadius(shapeId)
  return Math.sqrt(Math.PI / 4 / (1 - (4 - Math.PI) * p * p))
}

// ── luminance ───────────────────────────────────────────────────────────────

function hexChannels(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as [number, number, number]
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

function linearHex(rgb: readonly number[]): string {
  return `#${rgb.map((c) => Math.round(Math.max(0, Math.min(1, toSrgb(Math.max(0, Math.min(1, c))))) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

/** WCAG relative luminance of a #rrggbb colour (linear light, 0-1). */
export function relLum(hex: string): number {
  const [r, g, b] = hexChannels(hex).map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio of two colours. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// ── the mask ────────────────────────────────────────────────────────────────

/** A rounded rectangle's area (corner radius r). */
const roundedArea = (w: number, h: number, r: number) => w * h - (4 - Math.PI) * r * r

/** Star area at R = 1; the triangle's matches it within 0.1%. */
const STAR_AREA = 5 * QE_STAR_CORE_R * Math.sin(Math.PI / 5)
const TRIANGLE_AREA = ((3 * Math.sqrt(3)) / 4) * QE_TRIANGLE_R * QE_TRIANGLE_R

/**
 * The share of the field covered in ink during the stimulus: the centre shape(s), the star, the
 * triangles and the box border. `geo` is quickEyeGeometry's stim with quickEyeBox's sizes; the box
 * corner radius is QUICK_EYE_BOX_RADIUS (12), its border 2.
 */
export function quickEyeInkFraction(
  view: Pick<QuickEyeView, 'center' | 'target' | 'distractors'>,
  geo: { stim: number; boxW: number; boxH: number; shape: number },
  fieldArea: number,
): number {
  if (fieldArea <= 0) return 0
  const r = geo.stim / 2
  const centre = view.center.length * Math.PI * (geo.shape / 2) ** 2
  const star = view.target ? STAR_AREA * r * r : 0
  const triangles = view.distractors.length * TRIANGLE_AREA * r * r
  const border = roundedArea(geo.boxW, geo.boxH, 12) - roundedArea(geo.boxW - 4, geo.boxH - 4, 10)
  return Math.max(0, Math.min(1, (centre + star + triangles + border) / fieldArea))
}

/** Michelson contrast of the mask tones: (max − min) / (max + min). EVIDENCE #37 allows ≤ 0.5. */
export const QE_MASK_MICHELSON = 0.4
const MASK_TONES = 6

/** The stimulus frame's mean linear luminance: the field (1 − a) plus the ink (a). */
function maskMean(inkFraction: number, tint: string): number {
  const a = Math.max(0, Math.min(1, inkFraction))
  return relLum(tint) * (1 - a) + relLum(QE_INK) * a
}

/** The colour in `tint`'s hue at linear luminance `y`. */
function tintAt(tint: string, y: number): string {
  const field = Math.max(1e-6, relLum(tint))
  return linearHex(hexChannels(tint).map((c) => (toLinear(c) * y) / field))
}

/**
 * Six mask tones in the field's hue whose mean linear luminance equals the stimulus frame's (the
 * field's share plus the ink's), evenly spaced from mean·0.6 to mean·1.4 — Michelson 0.40.
 */
export function quickEyeMaskTones(inkFraction: number, tint: string): string[] {
  const mean = maskMean(inkFraction, tint)
  return Array.from({ length: MASK_TONES }, (_, k) => tintAt(tint, mean * (1 - QE_MASK_MICHELSON + (2 * QE_MASK_MICHELSON * k) / (MASK_TONES - 1))))
}

/** The mean tone, to fill the field under the cells (their rounded corners show it). */
export function quickEyeMaskMean(inkFraction: number, tint: string): string {
  return tintAt(tint, maskMean(inkFraction, tint))
}

/**
 * The mask's cells: a cols × rows grid, every cell one of the six tones in equal shares (a shuffled
 * deck, so the mean stays on target on every trial), in a random order — no stripes or checks.
 * x / y are cell indices. Platforms draw each as a rounded square (30% corners) clipped to the field.
 */
export function quickEyeMaskCells(seed: number, cols: number, tones: readonly string[], rows = cols): { x: number; y: number; tone: string }[] {
  const n = Math.max(0, cols * rows)
  if (tones.length === 0) return []
  const deck = Array.from({ length: n }, (_, i) => tones[i % tones.length])
  const shuffled = createRng(seed).shuffle(deck)
  return shuffled.map((tone, i) => ({ x: i % cols, y: Math.floor(i / cols), tone }))
}

function round4(v: number): number {
  return Math.round(v * 10_000) / 10_000
}
