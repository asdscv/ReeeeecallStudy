/**
 * A typed publish/subscribe bus.
 *
 * The repo had no cross-module signal before this. Where one module needed to tell another that
 * something happened, it reached into the other's zustand store with `.getState()` — which works,
 * but it means the *emitter* has to know every consumer by name. That is exactly the coupling
 * that makes an extension point expensive: adding a listener meant editing the thing that fires.
 *
 * The shape is `packages/mobile/src/services/prefetch.ts:43-62` generalised — a `Set` of
 * listeners, an unsubscribe closure, and a snapshot before notifying so a handler may subscribe
 * or unsubscribe from inside a handler without corrupting the iteration.
 *
 * A throwing listener is contained: telemetry must never be able to break the flow it observes.
 * `onError` exists so the swallow is a choice the owner makes, not one this file makes silently.
 */

/** The one thing an event needs: something to subscribe by. Internal — callers pass a union. */
interface BusEvent {
  readonly type: string
}

export type Listener<E> = (event: E) => void
export type Unsubscribe = () => void

interface EventBusOptions<E extends BusEvent> {
  /** Called when a listener throws. Defaults to a no-op. */
  readonly onError?: (error: unknown, event: E) => void
}

export class EventBus<E extends BusEvent> {
  private readonly byType = new Map<string, Set<Listener<E>>>()
  private readonly anyListeners = new Set<Listener<E>>()
  private readonly onError: (error: unknown, event: E) => void

  constructor(options?: EventBusOptions<E>) {
    this.onError = options?.onError ?? (() => {})
  }

  /** Subscribe to one event type. Returns the unsubscribe; calling it twice is harmless. */
  on<T extends E['type']>(type: T, listener: Listener<Extract<E, { type: T }>>): Unsubscribe {
    const set = this.byType.get(type) ?? new Set<Listener<E>>()
    // The cast is the one place the narrowing has to be asserted: `on` promises the listener
    // only ever sees its own variant, and `emit` is what keeps that promise.
    const erased = listener as Listener<E>
    set.add(erased)
    this.byType.set(type, set)
    return () => {
      set.delete(erased)
      if (set.size === 0) this.byType.delete(type)
    }
  }

  /** Subscribe to every event. This is what a telemetry or logging bridge wants. */
  onAny(listener: Listener<E>): Unsubscribe {
    this.anyListeners.add(listener)
    return () => {
      this.anyListeners.delete(listener)
    }
  }

  emit(event: E): void {
    // Snapshot first: a listener is allowed to unsubscribe itself, or subscribe another.
    const typed = this.byType.get(event.type)
    const targets = typed ? [...typed, ...this.anyListeners] : [...this.anyListeners]
    for (const listener of targets) {
      try {
        listener(event)
      } catch (error) {
        this.onError(error, event)
      }
    }
  }

  /** Drops every subscription. Tests use it; nothing in the app should need it. */
  clear(): void {
    this.byType.clear()
    this.anyListeners.clear()
  }
}
