/**
 * A registry: one map from id to descriptor, with the four operations every catalogue in this
 * repo has needed — register, has, get, list.
 *
 * `packages/shared/learning/registry/knowledge-registry.ts` carries the rule that produced this
 * file: *"A near-twin of `LearningDomainRegistry` rather than a shared generic … Merge them when
 * a third appears, not before."* The AI hub is the third, so the generic is written here.
 *
 * The two learning registries are deliberately NOT retrofitted onto it. They throw
 * `LearningError` (`packages/shared/learning/domain/errors.ts`), and that module's contract is
 * that the learning kernel imports nothing outside itself — pulling it onto a generic in `lib/`
 * would invert that isolation to save eight lines. When a learning change next touches them,
 * they can adopt `Registry` and re-throw as `LearningError`; nothing here blocks that.
 *
 * No framework, storage, or network imports: a registry is a data structure, and both platforms
 * build one at module load before any of their own infrastructure exists.
 */

/** Not exported: callers branch on `RegistryError`, and nothing outside needs to name the code. */
type RegistryErrorCode = 'INVALID_REGISTRY_ID' | 'DUPLICATE_REGISTRATION'

export class RegistryError extends Error {
  readonly code: RegistryErrorCode
  readonly registryName: string
  readonly id: string

  constructor(code: RegistryErrorCode, registryName: string, id: string, message: string) {
    super(message)
    this.name = 'RegistryError'
    this.code = code
    this.registryName = registryName
    this.id = id
    // Keep the prototype chain intact so `instanceof` survives the ES5 class downlevel.
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** The one thing a registry needs from what it stores. */
export interface Identified {
  readonly id: string
}

export class Registry<T extends Identified> {
  readonly name: string
  private readonly byId = new Map<string, T>()

  constructor(name: string) {
    this.name = name
  }

  /** Chainable, so a catalogue reads as one expression. Throws on a blank or repeated id. */
  register(entry: T): this {
    const id = entry.id.trim()
    if (!id) {
      throw new RegistryError('INVALID_REGISTRY_ID', this.name, entry.id, `Blank id in ${this.name}`)
    }
    if (this.byId.has(id)) {
      throw new RegistryError(
        'DUPLICATE_REGISTRATION',
        this.name,
        id,
        `Duplicate registration in ${this.name}: "${id}"`,
      )
    }
    this.byId.set(id, entry)
    return this
  }

  has(id: string): boolean {
    return this.byId.has(id)
  }

  /** Throws for an id this build does not ship. Use `find` where a miss is expected. */
  get(id: string): T {
    const entry = this.byId.get(id)
    if (!entry) {
      throw new RegistryError('INVALID_REGISTRY_ID', this.name, id, `Unknown id in ${this.name}: "${id}"`)
    }
    return entry
  }

  /** `null`, never a throw — so a persisted id from a newer or older build degrades quietly. */
  find(id: string): T | null {
    return this.byId.get(id) ?? null
  }

  /** Sorted, matching the learning registries. Display order belongs on the descriptor. */
  ids(): readonly string[] {
    return [...this.byId.keys()].sort()
  }

  /** Registration order. Callers that render a list should sort by their own order field. */
  all(): readonly T[] {
    return [...this.byId.values()]
  }
}
