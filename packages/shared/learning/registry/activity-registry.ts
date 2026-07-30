import { duplicateRegistrationError, invalidRegistryIdError, unsupportedCapabilityError } from '../domain/errors.ts'
import type { ActivityType, EvaluatorType, ResponseType, StimulusType } from '../domain/types.ts'

export interface ActivityCapability {
  readonly activityType: ActivityType
  readonly stimulusTypes: readonly StimulusType[]
  readonly responseTypes: readonly ResponseType[]
  readonly evaluatorTypes: readonly EvaluatorType[]
}

export class ActivityRegistry {
  private readonly capabilities = new Map<string, ActivityCapability>()

  register(capability: ActivityCapability): this {
    const id = capability.activityType.trim()
    if (!id) throw invalidRegistryIdError('ActivityRegistry', capability.activityType)
    if (this.capabilities.has(id)) throw duplicateRegistrationError('ActivityRegistry', id)
    if (!capability.stimulusTypes.length || !capability.responseTypes.length || !capability.evaluatorTypes.length) {
      throw invalidRegistryIdError('ActivityRegistry capability', id)
    }
    this.capabilities.set(id, Object.freeze({
      ...capability,
      stimulusTypes: Object.freeze([...capability.stimulusTypes]),
      responseTypes: Object.freeze([...capability.responseTypes]),
      evaluatorTypes: Object.freeze([...capability.evaluatorTypes]),
    }))
    return this
  }

  has(activityType: string): boolean {
    return this.capabilities.has(activityType)
  }

  get(activityType: string): ActivityCapability {
    const capability = this.capabilities.get(activityType)
    if (!capability) throw invalidRegistryIdError('ActivityRegistry', activityType)
    return capability
  }

  assertSupported(activityType: string, stimulusType: string, responseType: string, evaluatorType: string): void {
    const capability = this.get(activityType)
    if (!capability.stimulusTypes.includes(stimulusType as StimulusType)) {
      throw unsupportedCapabilityError('stimulus type', stimulusType)
    }
    if (!capability.responseTypes.includes(responseType as ResponseType)) {
      throw unsupportedCapabilityError('response type', responseType)
    }
    if (!capability.evaluatorTypes.includes(evaluatorType as EvaluatorType)) {
      throw unsupportedCapabilityError('evaluator type', evaluatorType)
    }
  }

  ids(): readonly string[] {
    return [...this.capabilities.keys()].sort()
  }
}
