# 12. Security — Mobile App Security Guide

> **Status**: Draft
> **Last Updated**: 2026-03-16

---

## Security Layers

```
┌─────────────────────────────────────────┐
│ Layer 1: Transport Security              │
│ - HTTPS only (Supabase, AI APIs)         │
│ - Certificate pinning (optional)         │
├─────────────────────────────────────────┤
│ Layer 2: Authentication                  │
│ - Supabase Auth (JWT)                    │
│ - Biometric unlock (Face ID / Fingerprint)│
│ - Session timeout                        │
├─────────────────────────────────────────┤
│ Layer 3: Data at Rest                    │
│ - AI API Keys → expo-secure-store        │
│   (iOS Keychain / Android Keystore)      │
│ - User preferences → MMKV (encrypted)   │
│ - Auth tokens → Supabase SecureStore     │
├─────────────────────────────────────────┤
│ Layer 4: Code Protection                 │
│ - ProGuard/R8 (Android obfuscation)      │
│ - Hermes bytecode (not readable JS)      │
│ - No secrets in bundle                   │
└─────────────────────────────────────────┘
```

---

## API Key Storage (Mobile vs Web)

| | Web (현재) | Mobile (계획) |
|---|-----------|---------------|
| Storage | localStorage (AES-GCM encrypted) | **expo-secure-store** |
| Encryption | Manual AES-GCM + PBKDF2 | **OS-level** (Keychain/Keystore) |
| Key derivation | User UID | **Hardware-backed** |
| XSS risk | Possible (browser) | **N/A** (no browser) |
| Rooted device | N/A | Detect + warn |

**Mobile is inherently more secure** — expo-secure-store uses hardware-backed encryption provided by the OS. No need to implement manual AES-GCM on mobile.

---

## Supabase Auth Token Storage

```typescript
// Default: Supabase stores tokens in AsyncStorage (plaintext)
// Secure: Use custom storage adapter with expo-secure-store

import { createClient } from '@supabase/supabase-js'
import * as SecureStore from 'expo-secure-store'

const SecureStorageAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: SecureStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,  // Important for RN
  },
})
```

---

## Sensitive Data Checklist

| Data | Storage | Encryption | Cleared on Logout |
|------|---------|------------|-------------------|
| Auth JWT | SecureStore | OS-level | Yes |
| Refresh token | SecureStore | OS-level | Yes |
| AI API keys | SecureStore | OS-level | No (user preference) |
| Study progress | Supabase DB | Server-side | N/A |
| User preferences | MMKV | Optional | No |
| Card content | Supabase DB | Server-side | N/A |

---

## Threat Model

| Threat | Severity | Mitigation |
|--------|----------|------------|
| Device theft | High | Biometric lock, auto-lock timeout, SecureStore |
| Man-in-the-middle | High | HTTPS only, cert pinning (optional) |
| Rooted/jailbroken device | Medium | Detect + warn (don't block) |
| Memory dump | Low | Hermes bytecode, no plaintext secrets in memory |
| Reverse engineering | Low | ProGuard, no hardcoded secrets |
| Malicious keyboard | Low | Secure text input for API keys |
| Screenshot capture | Low | Prevent screenshots on sensitive screens (optional) |

---

## Implementation Notes

### Biometric Authentication (Optional Pro Feature)
```typescript
import * as LocalAuthentication from 'expo-local-authentication'

async function authenticateWithBiometrics(): Promise<boolean> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync()
  if (!hasHardware) return true // Skip if no biometric hardware

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Unlock ReeeeecallStudy',
    fallbackLabel: 'Use passcode',
  })
  return result.success
}
```

### Secure Text Input
```tsx
// Always use secureTextEntry for API key inputs
<TextInput
  secureTextEntry={true}
  autoComplete="off"
  textContentType="none"  // Prevent iOS autofill
/>
```
