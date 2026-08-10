/**
 * The two kernel primitives the AI 학습 menu is built on.
 *
 * `Registry` exists because the repo already had two hand-written copies of it and a docblock
 * saying to merge them when a third appeared. `EventBus` exists because it had none: before this,
 * one module told another that something happened by reaching into its zustand store with
 * `.getState()`, which means the emitter had to name every consumer.
 *
 * What is pinned here is only the behaviour a caller can depend on. The two that matter most are
 * at the bottom: a listener may unsubscribe from inside a handler, and a listener that throws
 * cannot take down the flow it is observing. Both are the kind of thing that works in every test
 * you write on purpose and fails the first time telemetry is added to a real screen.
 */
import { describe, expect, it, vi } from 'vitest'
import { Registry, RegistryError } from '@reeeeecall/shared/lib/kernel/registry'
import { EventBus } from '@reeeeecall/shared/lib/kernel/event-bus'

interface Thing {
  readonly id: string
  readonly label: string
}

const a: Thing = { id: 'a', label: 'A' }
const b: Thing = { id: 'b', label: 'B' }

describe('Registry', () => {
  it('registers and reads back', () => {
    const registry = new Registry<Thing>('Test').register(a).register(b)
    expect(registry.get('a')).toBe(a)
    expect(registry.has('b')).toBe(true)
    expect(registry.has('c')).toBe(false)
  })

  it('refuses a repeat id instead of silently replacing the first', () => {
    const registry = new Registry<Thing>('Test').register(a)
    // Last-write-wins is the failure mode this rules out: two features registering the same id
    // would leave one of them missing from the menu with nothing reported anywhere.
    expect(() => registry.register({ id: 'a', label: 'other' })).toThrow(RegistryError)
    expect(registry.get('a')).toBe(a)
  })

  it('refuses a blank id', () => {
    const registry = new Registry<Thing>('Test')
    expect(() => registry.register({ id: '   ', label: 'x' })).toThrow(RegistryError)
  })

  it('trims the id it stores', () => {
    const registry = new Registry<Thing>('Test').register({ id: ' padded ', label: 'x' })
    expect(registry.ids()).toEqual(['padded'])
  })

  it('names itself in the error, so a repo with several registries says which one broke', () => {
    const registry = new Registry<Thing>('AiHubRegistry').register(a)
    try {
      registry.register(a)
      expect.unreachable('duplicate registration should throw')
    } catch (error) {
      expect(error).toBeInstanceOf(RegistryError)
      expect((error as RegistryError).registryName).toBe('AiHubRegistry')
      expect((error as RegistryError).code).toBe('DUPLICATE_REGISTRATION')
      expect((error as RegistryError).message).toContain('AiHubRegistry')
    }
  })

  it('separates the throwing read from the tolerant one', () => {
    // `get` is for an id the code just produced; `find` is for one that came from storage, a URL,
    // or an older build — where a miss is a fact to handle, not a bug to crash on.
    const registry = new Registry<Thing>('Test').register(a)
    expect(() => registry.get('missing')).toThrow(RegistryError)
    expect(registry.find('missing')).toBeNull()
  })

  it('sorts ids but leaves `all` in registration order', () => {
    const registry = new Registry<Thing>('Test').register(b).register(a)
    expect(registry.ids()).toEqual(['a', 'b'])
    expect(registry.all().map((t) => t.id)).toEqual(['b', 'a'])
  })
})

describe('EventBus', () => {
  it('delivers to type listeners and to onAny', () => {
    const bus = new EventBus<{ type: 'x'; n: number } | { type: 'y' }>()
    const onX = vi.fn()
    const onEverything = vi.fn()
    bus.on('x', onX)
    bus.onAny(onEverything)

    bus.emit({ type: 'x', n: 1 })
    bus.emit({ type: 'y' })

    expect(onX).toHaveBeenCalledTimes(1)
    expect(onX).toHaveBeenCalledWith({ type: 'x', n: 1 })
    expect(onEverything).toHaveBeenCalledTimes(2)
  })

  it('stops delivering after unsubscribe', () => {
    const bus = new EventBus<{ type: 'x' }>()
    const listener = vi.fn()
    const off = bus.on('x', listener)
    bus.emit({ type: 'x' })
    off()
    bus.emit({ type: 'x' })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('survives a listener unsubscribing itself mid-emit', () => {
    // Without the snapshot in `emit`, this mutates the Set being iterated. React does exactly
    // this: an effect's cleanup runs while an event is in flight during a fast unmount.
    const bus = new EventBus<{ type: 'x' }>()
    const second = vi.fn()
    const off = bus.on('x', () => off())
    bus.on('x', second)
    expect(() => bus.emit({ type: 'x' })).not.toThrow()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('does not let a throwing listener stop the others, or the emitter', () => {
    // The bus carries telemetry off the screens that generate and charge for AI. A broken
    // analytics bridge must not be able to prevent a deck from being created.
    const onError = vi.fn()
    const bus = new EventBus<{ type: 'x' }>({ onError })
    const survivor = vi.fn()
    bus.on('x', () => {
      throw new Error('bridge is down')
    })
    bus.on('x', survivor)

    expect(() => bus.emit({ type: 'x' })).not.toThrow()
    expect(survivor).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('swallows a listener throw when no onError is supplied', () => {
    const bus = new EventBus<{ type: 'x' }>()
    bus.on('x', () => {
      throw new Error('boom')
    })
    expect(() => bus.emit({ type: 'x' })).not.toThrow()
  })
})
