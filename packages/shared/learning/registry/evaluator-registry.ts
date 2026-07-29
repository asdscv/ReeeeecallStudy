import { duplicateRegistrationError, invalidRegistryIdError } from '../domain/errors.ts'
import type { Evaluator } from '../ports/evaluator.ts'

export type EvaluatorFactory = () => Evaluator

export class EvaluatorRegistry {
  private readonly factories = new Map<string, EvaluatorFactory>()

  register(type: string, factory: EvaluatorFactory): this {
    const id = type.trim()
    if (!id) throw invalidRegistryIdError('EvaluatorRegistry', type)
    if (this.factories.has(id)) throw duplicateRegistrationError('EvaluatorRegistry', id)
    this.factories.set(id, factory)
    return this
  }

  has(type: string): boolean {
    return this.factories.has(type)
  }

  create(type: string): Evaluator {
    const factory = this.factories.get(type)
    if (!factory) throw invalidRegistryIdError('EvaluatorRegistry', type)
    return factory()
  }

  ids(): readonly string[] {
    return [...this.factories.keys()].sort()
  }
}
