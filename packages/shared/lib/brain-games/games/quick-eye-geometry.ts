/**
 * Quick Eye's field layout, shared by web and mobile so the two draw the same field.
 *
 * Starts from rings at 0.45R, 0.72R and R (R = field/2 − 24), a stimulus at most 40 and at most
 * 80% of its slot's arc, the inner ring clear of the centre box — and makes two of those rules
 * exact for a phone's field:
 *   - "clear of the box" is checked at every inner slot, not only straight up: the box is square,
 *     and at 45° its corner reaches further than its side, so a ring at box/2 + stim/2 + 8 put the
 *     diagonal stimuli inside the corners;
 *   - neighbouring rings stay a stimulus apart. Slots line up radially across rings, and on a
 *     ~360 field the inner and middle rings' stimuli otherwise sat on top of each other.
 * The stimulus is the largest size (≤ 40) for which all of that fits — one size on every ring, so
 * the target never stands out by size.
 */
export const QUICK_EYE_BOX_RADIUS = 12

/** Distance from a point (relative to the field's centre) to the rounded centre box; < 0 inside. */
function boxDistance(x: number, y: number, halfW: number, halfH: number): number {
  const qx = Math.abs(x) - (halfW - QUICK_EYE_BOX_RADIUS)
  const qy = Math.abs(y) - (halfH - QUICK_EYE_BOX_RADIUS)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - QUICK_EYE_BOX_RADIUS
}

export function quickEyeGeometry(field: number, boxW: number, boxH: number, ringSlots: readonly number[]) {
  const R = field / 2 - 24
  const slots = (i: number) => Math.max(1, ringSlots[i] ?? 16)
  const innerRadius = (stim: number) => {
    let r0 = Math.max(0.45 * R, boxH / 2 + stim / 2 + 8)
    const clears = (r: number) => {
      for (let k = 0; k < slots(0); k++) {
        const a = (k / slots(0)) * 2 * Math.PI
        if (boxDistance(r * Math.sin(a), -r * Math.cos(a), boxW / 2, boxH / 2) < stim / 2 + 6) return false
      }
      return true
    }
    while (!clears(r0) && r0 < R) r0 += 0.5
    return r0
  }
  const fit = (stim: number): number[] | null => {
    const r0 = innerRadius(stim)
    if (R - r0 < 2 * (stim + 4)) return null
    const r1 = Math.min(Math.max(0.72 * R, r0 + stim + 4), R - stim - 4)
    const radii = [r0, r1, R]
    return radii.every((r, i) => (0.8 * 2 * Math.PI * r) / slots(i) >= stim) ? radii : null
  }
  for (let stim = 40; stim >= 12; stim--) {
    const radii = fit(stim)
    if (radii) return { R, radii, stim }
  }
  // A field narrower than any current phone: keep the box clear, let the rings crowd.
  const r0 = innerRadius(12)
  return { R, radii: [r0, (r0 + R) / 2, R], stim: 12 }
}


/**
 * The centre box: 112 square, or 160 wide × 112 tall for the two side-by-side shapes of the
 * same/different variants (a 160 square's corners would push the inner ring out until a phone's
 * stars shrank to ~13). Only a field narrower than a phone shrinks it.
 */
export function quickEyeBox(field: number, two: boolean): { boxW: number; boxH: number; shape: number } {
  const boxH = Math.round(Math.min(112, field * 0.36))
  const boxW = two ? Math.round(Math.min(160, field * 0.46)) : boxH
  return { boxW, boxH, shape: Math.round(two ? boxH * 0.43 : boxH * 0.64) }
}

/** Where slot `slot` of a ring with `slots` slots sits, relative to the field's centre (0 = 12 o'clock, clockwise). */
export function slotPosition(radius: number, slot: number, slots: number): { x: number; y: number } {
  const a = (slot / slots) * 2 * Math.PI
  return { x: radius * Math.sin(a), y: -radius * Math.cos(a) }
}
