const errorMap: Record<string, string> = {
  'Invalid login credentials': 'errors:auth.invalidCredentials',
  'Email not confirmed': 'errors:auth.emailNotConfirmed',
  'User already registered': 'errors:auth.userAlreadyRegistered',
  'Password should be at least 6 characters': 'errors:auth.passwordTooShort',
  'Email rate limit exceeded': 'errors:auth.rateLimitExceeded',
  'For security purposes, you can only request this after':
    'errors:auth.securityCooldown',
  'New password should be different from the old password':
    'errors:auth.samePassword',
  'Unable to validate email address: invalid format':
    'errors:auth.invalidEmailFormat',
}

const exactKeys = Object.keys(errorMap)

export function localizeAuthError(message: string): string {
  // 정확 매칭
  if (errorMap[message]) return errorMap[message]

  // 부분 매칭 (startsWith)
  for (const key of exactKeys) {
    if (message.startsWith(key)) return errorMap[key]
  }

  // 미매칭 → 원본 반환
  return message
}
