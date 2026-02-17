import { Link } from 'react-router-dom'

export type QuickStartVariant = 'public' | 'authenticated'

export function QuickStartBanner({ variant }: { variant: QuickStartVariant }) {
  return (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4 sm:p-5 mb-4 sm:mb-6">
      <h2 className="text-sm font-semibold text-blue-900 mb-2">빠른 시작</h2>
      <div className="space-y-2 text-xs sm:text-sm text-blue-800">
        {variant === 'authenticated' ? (
          <p>1. <Link to="/settings" className="underline font-medium">설정 페이지</Link>에서 API 키를 생성하세요</p>
        ) : (
          <p>1. <Link to="/auth/login" className="underline font-medium">회원가입</Link> 후 API 키를 생성하세요</p>
        )}
        <p>2. 모든 요청에 <code className="bg-blue-100 px-1.5 py-0.5 rounded text-blue-900 font-mono text-xs">Authorization: Bearer rc_...</code> 헤더를 포함하세요</p>
        <p>3. 아래 엔드포인트를 참고하여 API를 호출하세요</p>
      </div>
    </div>
  )
}
