import { render } from '@testing-library/react'
import { Button } from '../button'

describe('Button', () => {
  it('primary variant darkens on hover via the brand-hover token (the dead-hover fix)', () => {
    const { getByRole } = render(<Button>Save</Button>)
    const cls = getByRole('button').className
    expect(cls).toContain('bg-brand')
    expect(cls).toContain('hover:bg-brand-hover')
    expect(cls).toContain('active:bg-brand-active')
  })

  it('destructive variant uses the destructive-hover token', () => {
    const { getByRole } = render(<Button variant="destructive">Delete</Button>)
    expect(getByRole('button').className).toContain('hover:bg-destructive-hover')
  })

  it('defaults to type="button" to avoid accidental form submission', () => {
    const { getByRole } = render(<Button>Click</Button>)
    expect(getByRole('button').getAttribute('type')).toBe('button')
  })

  it('respects an explicit type', () => {
    const { getByRole } = render(<Button type="submit">Submit</Button>)
    expect(getByRole('button').getAttribute('type')).toBe('submit')
  })

  it('signals disabled state with the not-allowed cursor', () => {
    const { getByRole } = render(<Button disabled>Nope</Button>)
    const cls = getByRole('button').className
    expect(cls).toContain('disabled:cursor-not-allowed')
    expect(cls).toContain('disabled:opacity-50')
  })

  it('asChild renders the child element (e.g. an anchor) with button styling, not a <button>', () => {
    const { getByRole, queryByRole } = render(
      <Button asChild>
        <a href="/decks">Decks</a>
      </Button>,
    )
    const link = getByRole('link')
    expect(link.tagName).toBe('A')
    expect(link.className).toContain('bg-brand')
    expect(queryByRole('button')).toBeNull()
  })
})
