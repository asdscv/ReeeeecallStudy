/** Cells crossed by a finger segment, in order. Coordinates are in cell units.
 * Visiting every crossed cell lets the engine enforce walls even on a fast drag.
 * Outside points are clamped; a cancelled gesture is reset by the platform.
 */
export interface MazePoint { x: number; y: number }
export function mazePoint(x: number, y: number, cols: number, rows: number): MazePoint {
  'worklet'
  return { x: Math.max(0, Math.min(cols - 0.0001, x)), y: Math.max(0, Math.min(rows - 0.0001, y)) }
}
export function mazeDragCells(from: MazePoint, to: MazePoint, cols: number, rows: number): number[] {
  'worklet'
  const a = mazePoint(from.x, from.y, cols, rows), b = mazePoint(to.x, to.y, cols, rows)
  let x = Math.floor(a.x), y = Math.floor(a.y)
  const endX = Math.floor(b.x), endY = Math.floor(b.y)
  const dx = b.x - a.x, dy = b.y - a.y
  const sx = Math.sign(dx), sy = Math.sign(dy)
  let tx = dx === 0 ? Infinity : ((sx > 0 ? x + 1 : x) - a.x) / dx
  let ty = dy === 0 ? Infinity : ((sy > 0 ? y + 1 : y) - a.y) / dy
  const stepX = dx === 0 ? Infinity : 1 / Math.abs(dx), stepY = dy === 0 ? Infinity : 1 / Math.abs(dy)
  const cells: number[] = []
  for (let guard = 0; guard < cols + rows && (x !== endX || y !== endY); guard++) {
    if (tx <= ty) { x += sx; tx += stepX } else { y += sy; ty += stepY }
    if (x < 0 || x >= cols || y < 0 || y >= rows) break
    cells.push(y * cols + x)
  }
  return cells
}
