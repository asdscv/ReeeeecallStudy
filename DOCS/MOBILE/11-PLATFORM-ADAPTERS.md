# 11. Platform Adapters — Browser API to RN Migration Guide

> **Status**: Draft
> **Last Updated**: 2026-03-16

---

## Overview

5개 브라우저 API를 React Native로 대체하는 구체적 가이드입니다.

---

## 1. Storage (localStorage → MMKV)

### Web Implementation
```typescript
// web/src/adapters/web-storage.ts
export class WebStorage implements IStorage {
  async getItem(key: string) {
    try { return localStorage.getItem(key) } catch { return null }
  }
  async setItem(key: string, value: string) {
    try { localStorage.setItem(key, value) } catch {}
  }
  async removeItem(key: string) {
    try { localStorage.removeItem(key) } catch {}
  }
}
```

### RN Implementation
```typescript
// mobile/src/adapters/rn-storage.ts
import { MMKV } from 'react-native-mmkv'

const storage = new MMKV()

export class RNStorage implements IStorage {
  async getItem(key: string) {
    return storage.getString(key) ?? null
  }
  async setItem(key: string, value: string) {
    storage.set(key, value)
  }
  async removeItem(key: string) {
    storage.delete(key)
  }
}
```

**Why MMKV over AsyncStorage:**
- 30x faster (synchronous C++ bridge)
- Encryption support built-in
- Used by WeChat (1B+ users)

---

## 2. Crypto (Web Crypto API → expo-crypto)

### Web Implementation
```typescript
// web/src/adapters/web-crypto.ts
export class WebCrypto implements ICryptoAdapter {
  async encrypt(plaintext: string, uid: string): Promise<string> {
    // Existing AesGcmCrypto implementation
  }
  async decrypt(ciphertext: string, uid: string): Promise<string> {
    // Existing AesGcmCrypto implementation
  }
  getRandomBytes(length: number): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(length))
  }
  async sha256(input: string): Promise<string> {
    const encoded = new TextEncoder().encode(input)
    const hash = await crypto.subtle.digest('SHA-256', encoded)
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
  }
}
```

### RN Implementation
```typescript
// mobile/src/adapters/rn-crypto.ts
import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'

export class RNCrypto implements ICryptoAdapter {
  async encrypt(plaintext: string, uid: string): Promise<string> {
    // Option A: Use expo-secure-store (iOS Keychain / Android Keystore)
    // Option B: Port AES-GCM using react-native-aes-crypto
  }
  getRandomBytes(length: number): Uint8Array {
    return Crypto.getRandomBytes(length)
  }
  async sha256(input: string): Promise<string> {
    return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input)
  }
}
```

**Note:** For API key storage on mobile, `expo-secure-store` (iOS Keychain / Android Keystore) is more secure than manual AES-GCM. Consider using SecureStore directly instead of porting the encryption layer.

---

## 3. Device Info (navigator → expo-device)

### Web Implementation
```typescript
// web/src/adapters/web-device.ts
export class WebDevice implements IDeviceAdapter {
  getUniqueId() { return localStorage.getItem('device-id') ?? generateId() }
  getUserAgent() { return navigator.userAgent }
  getDeviceType() { return window.innerWidth < 768 ? 'mobile' : 'desktop' }
  getPlatform() { return 'web' as const }
}
```

### RN Implementation
```typescript
// mobile/src/adapters/rn-device.ts
import * as Device from 'expo-device'
import * as Application from 'expo-application'
import { Platform } from 'react-native'

export class RNDevice implements IDeviceAdapter {
  async getUniqueId() {
    return Application.getIosIdForVendorAsync() ?? Application.androidId ?? 'unknown'
  }
  getUserAgent() {
    return `ReeeeecallStudy/${Application.nativeApplicationVersion} (${Platform.OS})`
  }
  getDeviceType() {
    return Device.deviceType === Device.DeviceType.TABLET ? 'tablet' : 'mobile'
  }
  getPlatform() {
    return Platform.OS as 'ios' | 'android'
  }
}
```

---

## 4. TTS (Web Speech API → expo-speech)

### Web Implementation
```typescript
// web/src/adapters/web-tts.ts
export class WebTTS implements ITTSAdapter {
  speak(text: string, lang: string, rate = 1.0) {
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = lang
    utterance.rate = rate
    speechSynthesis.speak(utterance)
    return new Promise<void>(resolve => { utterance.onend = () => resolve() })
  }
  stop() { speechSynthesis.cancel() }
  isSupported() { return 'speechSynthesis' in window }
}
```

### RN Implementation
```typescript
// mobile/src/adapters/rn-tts.ts
import * as Speech from 'expo-speech'

export class RNTTS implements ITTSAdapter {
  async speak(text: string, lang: string, rate = 1.0) {
    return new Promise<void>((resolve) => {
      Speech.speak(text, {
        language: lang,
        rate,
        onDone: () => resolve(),
      })
    })
  }
  stop() { Speech.stop() }
  isSupported() { return true } // Always supported on mobile
}
```

---

## 5. Audio (HTMLAudioElement → expo-av)

### Web Implementation
```typescript
// web/src/adapters/web-audio.ts
export class WebAudio implements IAudioAdapter {
  private audio: HTMLAudioElement | null = null
  async play(url: string) {
    this.audio = new Audio(url)
    await this.audio.play()
  }
  stop() { this.audio?.pause() }
}
```

### RN Implementation
```typescript
// mobile/src/adapters/rn-audio.ts
import { Audio } from 'expo-av'

export class RNAudio implements IAudioAdapter {
  private sound: Audio.Sound | null = null
  async play(url: string) {
    const { sound } = await Audio.Sound.createAsync({ uri: url })
    this.sound = sound
    await sound.playAsync()
  }
  stop() { this.sound?.stopAsync() }
}
```

---

## Migration Priority

| Adapter | Blocks | Priority |
|---------|--------|----------|
| Storage | Auth, Settings, AI Keys | Phase 1 (Setup) |
| Device | Analytics, Bot Detection | Phase 2 (Auth) |
| Crypto | AI Key Vault | Phase 5 (Features) |
| TTS | Study Session | Phase 4 (Study) |
| Audio | Edge TTS Playback | Phase 4 (Study) |
