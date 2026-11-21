import { useRef, useState } from 'react'

/** Reserve the action immediately, before React renders the disabled controls. */
export function useQuizAction() {
  const inFlight = useRef(false)
  const [pending, setPending] = useState(false)

  const perform = async (action: () => Promise<void>) => {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    try {
      await action()
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return { pending, perform }
}
