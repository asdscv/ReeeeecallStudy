# 05. Phase 2 — Authentication

> **Status**: Draft
> **Duration**: ~1 week

---

## 현재 상태 (Web)

| 기능 | 상태 | 비고 |
|------|------|------|
| 이메일/비밀번호 로그인 | ✅ 완료 | Supabase Auth |
| 회원가입 + 이메일 인증 | ✅ 완료 | |
| 비밀번호 재설정 | ✅ 완료 | |
| Google 소셜 로그인 | ✅ 완료 | 웹에 이미 반영됨 |
| Apple 소셜 로그인 | ⏳ 예정 | 추후 웹+모바일 동시 추가 |

---

## Goals (Mobile)

- [ ] 이메일/비밀번호 로그인
- [ ] 회원가입 + 이메일 인증
- [ ] 비밀번호 재설정
- [ ] Google 소셜 로그인 (웹 구현 기반으로 모바일 연동)
- [ ] Apple 소셜 로그인 (iOS 필수 — App Store 심사 요구사항)
- [ ] 세션 관리 (SecureStore)
- [ ] 딥링크 Auth Callback 처리
- [ ] 자동 로그인 (앱 재시작 시)

### Apple 로그인 참고

> **App Store 심사 요구사항**: 소셜 로그인을 제공하는 앱은 반드시 Apple Sign-In도 함께 제공해야 함 (App Store Review Guidelines 4.8).
> Google 로그인이 있으므로 Apple 로그인은 **모바일 출시 전 필수**.
> 웹에도 동시에 추가하여 플랫폼 간 계정 통합 유지.

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

### Google OAuth (모바일)

웹에서 이미 Google OAuth가 구현되어 있으므로, Supabase 프로젝트의 Google provider 설정은 동일하게 사용.
모바일에서는 `expo-auth-session`을 통해 OAuth flow를 처리.

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

#### 모바일 Google OAuth 추가 설정

| Platform | 필요 작업 |
|----------|----------|
| **iOS** | Google Cloud Console에서 iOS 클라이언트 ID 추가 (Bundle ID 등록) |
| **Android** | Google Cloud Console에서 Android 클라이언트 ID 추가 (SHA-1 fingerprint 등록) |
| **Supabase** | Redirect URL에 Expo scheme 추가: `{scheme}://auth/callback` |

### Apple Sign-In (iOS + Web)

Apple 로그인은 모바일과 웹에 동시에 추가할 예정.

#### iOS (네이티브)

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

#### Android (Apple 로그인)

Android에서는 Apple 네이티브 SDK가 없으므로 웹 기반 OAuth flow 사용:

```typescript
async function signInWithAppleAndroid() {
  const redirectTo = AuthSession.makeRedirectUri()
  const { data } = await supabase.auth.signInWithOAuth({
    provider: 'apple',
    options: { redirectTo },
  })
  if (data.url) {
    await WebBrowser.openAuthSessionAsync(data.url, redirectTo)
  }
}
```

#### Web (Apple 로그인 — 추후 추가)

```typescript
// 기존 웹 로그인 페이지에 Apple 버튼 추가
async function signInWithApple() {
  await supabase.auth.signInWithOAuth({
    provider: 'apple',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  })
}
```

#### Apple 로그인 사전 설정

| 항목 | 설명 |
|------|------|
| Apple Developer 계정 | Sign in with Apple capability 활성화 |
| Service ID | 웹용 Apple Sign-In (identifier + return URL) |
| App ID | iOS 앱 Bundle ID에 Sign in with Apple 추가 |
| Supabase | Apple provider 설정 (Service ID, Secret Key) |

---

## Screens

| Screen | Components |
|--------|-----------|
| LoginScreen | Email input, Password input, Login button, Social buttons (Google + Apple), Forgot password link |
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

---

## 구현 순서

```
1. 이메일 로그인/회원가입 (공유 로직 활용)
2. Google 소셜 로그인 (웹 설정 재사용 + 모바일 redirect 추가)
3. Apple 소셜 로그인 (iOS 네이티브 + Android 웹 OAuth + 웹 추가)
4. 세션 관리 + 자동 로그인
5. 딥링크 callback 처리
```
