import { getDevice } from '../adapters/index.ts'

export function getDeviceId(): string {
  return getDevice().getDeviceId()
}

export function getDeviceName(): string {
  return getDevice().getDeviceName()
}
