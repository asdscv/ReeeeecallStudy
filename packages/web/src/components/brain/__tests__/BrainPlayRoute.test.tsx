import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { BrainPlayPage } from '../../../pages/brain/BrainPlayPage'

/**
 * Quick Eye was removed by the owner (2026-11-13): an old link or bookmark to its play route goes
 * back to the brain home, like any id that is not a game.
 */
function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/brain" element={<p>brain home</p>} />
        <Route path="/brain/training" element={<p>training</p>} />
        <Route path="/brain/play/:mode" element={<BrainPlayPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('/brain/play/:mode', () => {
  it('/brain/play/quickEye redirects to /brain', () => {
    at('/brain/play/quickEye')
    expect(screen.getByText('brain home')).toBeInTheDocument()
  })

  it('an unknown game redirects to /brain too; the old mix goes to Today’s Training', () => {
    at('/brain/play/nope')
    expect(screen.getByText('brain home')).toBeInTheDocument()
    at('/brain/play/mix')
    expect(screen.getByText('training')).toBeInTheDocument()
  })
})
