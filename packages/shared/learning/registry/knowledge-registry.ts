import { duplicateRegistrationError, invalidRegistryIdError } from '../domain/errors.ts'
import type { KnowledgeCriterion } from '../application/knowledge.ts'

/**
 * Registry of "what counts as learned" rules.
 *
 * A near-twin of `LearningDomainRegistry` rather than a shared generic: two registries with
 * four methods each is less code than the generic that would unify them, and the two are free to
 * diverge (criteria will grow a selection rule; domains will not). Merge them when a third
 * appears, not before.
 */
export class KnowledgeCriterionRegistry {
  private readonly criteria = new Map<string, KnowledgeCriterion>()

  register(criterion: KnowledgeCriterion): this {
    const id = criterion.id.trim()
    if (!id) throw invalidRegistryIdError('KnowledgeCriterionRegistry', criterion.id)
    if (this.criteria.has(id)) throw duplicateRegistrationError('KnowledgeCriterionRegistry', id)
    this.criteria.set(id, criterion)
    return this
  }

  has(id: string): boolean {
    return this.criteria.has(id)
  }

  get(id: string): KnowledgeCriterion {
    const criterion = this.criteria.get(id)
    if (!criterion) throw invalidRegistryIdError('KnowledgeCriterionRegistry', id)
    return criterion
  }

  ids(): readonly string[] {
    return [...this.criteria.keys()].sort()
  }
}
