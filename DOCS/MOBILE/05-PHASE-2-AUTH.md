# 05. Phase 2 — Authentication

> **Status**: Draft
> **Duration**: ~1 week

---

## Goals

- [ ] 이메일/비밀번호 로그인
- [ ] 회원가입 + 이메일 인증
- [ ] 비밀번호 재설정
- [ ] 소셜 로그인 (Google, Apple)
- [ ] 세션 관리 (SecureStore)
- [ ] 딥링크 Auth Callback 처리
- [ ] 자동 로그인 (앱 재시작 시)

---

## Supabase Auth on React Native

### 핵심 차이점 (Web vs RN)

| | Web | React Native |
|---|-----|-------------|
| Token storage | localStorage | expo-secure-store |
| OAuth redirect | Browser redirect | expo-auth-session + deep link |
| Session detect | URL hash | `detectSessionInUrl: false` |
| Auto refresh | Built-in | Built-in |

### Supabase Client 초기화

```typescript
import { createClient } from '@supabase/supabase-js'
import * as SecureStore from 'expo-secure-store'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: {
      getItem: (key) => SecureStore.getItemAsync(key),
      setItem: (key, value) => SecureStore.setItemAsync(key, value),
      removeItem: (key) => SecureStore.deleteItemAsync(key),
    },
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
```

### Google OAuth

```typescript
import * as AuthSession from 'expo-auth-session'
import * as WebBrowser from 'expo-web-browser'

WebBrowser.maybeCompleteAuthSession()

const redirectTo = AuthSession.makeRedirectUri()

async function signInWithGoogle() {
  const { data } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  })
  if (data.url) {
    await WebBrowser.openAuthSessionAsync(data.url, redirectTo)
  }
}
```

### Apple Sign-In (iOS)

```typescript
import * as AppleAuthentication from 'expo-apple-authentication'

async function signInWithApple() {
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  })
  const { data } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken!,
  })
  return data
}
```

---

## Screens

| Screen | Components |
|--------|-----------|
| LoginScreen | Email input, Password input, Login button, Social buttons, Forgot password link |
| SignUpScreen | Email, Password, Confirm password, Sign up button |
| ForgotPasswordScreen | Email input, Send reset link |

---

## Auth Store Changes

`auth-store.ts`에서 `window.location.origin` 사용을 제거하고 config에서 주입:

```typescript
// Before (web-only)
redirectTo: `${window.location.origin}/auth/callback`

// After (platform-agnostic)
redirectTo: getAuthRedirectUrl()  // injected via adapter
```
