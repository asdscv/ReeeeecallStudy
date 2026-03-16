import { getDevice } from '../adapters'

export function getDeviceId(): string {
  return getDevice().getDeviceId()
}

export function getDeviceName(): string {
  return getDevice().getDeviceName()
}
