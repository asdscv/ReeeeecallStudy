import type { IDeviceAdapter } from '@reeeeecall/shared/adapters/device'
import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'

// device_id는 기기당 단 하나여야 한다. 앱 재시작마다 새로 만들면
// 세션 테이블에 유령 행이 쌓이고 heartbeat가 "다른 기기 로그인"으로 오인해
// 세션을 끊는다. → SecureStore(동기 API)에 영구 저장하여 재설치 전까지 유지.
const DEVICE_ID_KEY = 'reeeeecall_device_id'

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// TODO: Phase 2 — Enhance with expo-device
export class RNDevice implements IDeviceAdapter {
  private deviceId: string | null = null

  getDeviceId(): string {
    // 우선순위: 메모리 캐시 → SecureStore 영구값 → 신규 생성 후 저장
    if (this.deviceId) return this.deviceId

    try {
      const stored = SecureStore.getItem(DEVICE_ID_KEY)
      if (stored) {
        this.deviceId = stored
        return stored
      }
    } catch {
      // SecureStore 접근 실패 — 아래에서 새로 생성 (메모리 캐시로 동일 실행 내 일관성 유지)
    }

    const fresh = generateUUID()
    this.deviceId = fresh
    try {
      SecureStore.setItem(DEVICE_ID_KEY, fresh)
    } catch {
      // 저장 실패해도 메모리 캐시로 이번 실행은 일관. 다음 실행에서 재시도.
    }
    return fresh
  }

  getDeviceName(): string {
    return Platform.OS === 'ios' ? 'iOS Device' : 'Android Device'
  }

  getUserAgent(): string {
    return `ReeeeecallStudy/${Platform.OS}`
  }

  getPlatform(): 'ios' | 'android' {
    return Platform.OS as 'ios' | 'android'
  }
}
