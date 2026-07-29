import { duplicateRegistrationError, invalidRegistryIdError } from '../domain/errors.ts'
import type { LearningDomainAdapter } from '../domain/types.ts'

export class LearningDomainRegistry {
  private readonly adapters = new Map<string, LearningDomainAdapter>()

  register(adapter: LearningDomainAdapter): this {
    const id = adapter.id.trim()
    if (!id) throw invalidRegistryIdError('LearningDomainRegistry', adapter.id)
    if (this.adapters.has(id)) throw duplicateRegistrationError('LearningDomainRegistry', id)
    this.adapters.set(id, adapter)
    return this
  }

  has(id: string): boolean {
    return this.adapters.has(id)
  }

  get(id: string): LearningDomainAdapter {
    const adapter = this.adapters.get(id)
    if (!adapter) throw invalidRegistryIdError('LearningDomainRegistry', id)
    return adapter
  }

  ids(): readonly string[] {
    return [...this.adapters.keys()].sort()
  }
}
