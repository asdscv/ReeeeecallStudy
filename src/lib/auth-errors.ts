const errorMap: Record<string, string> = {
  'Invalid login credentials': '이메일 또는 비밀번호가 올바르지 않습니다.',
  'Email not confirmed': '이메일 인증이 완료되지 않았습니다. 메일함을 확인해주세요.',
  'User already registered': '이미 가입된 이메일입니다.',
  'Password should be at least 6 characters': '비밀번호는 6자 이상이어야 합니다.',
  'Email rate limit exceeded': '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
  'For security purposes, you can only request this after':
    '보안을 위해 잠시 후 다시 시도해주세요.',
  'New password should be different from the old password':
    '새 비밀번호는 기존 비밀번호와 달라야 합니다.',
  'Unable to validate email address: invalid format':
    '올바른 이메일 형식이 아닙니다.',
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
