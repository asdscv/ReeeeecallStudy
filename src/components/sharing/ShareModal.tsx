import { useState } from 'react'
import { X, Copy, Check } from 'lucide-react'
import { useSharingStore } from '../../stores/sharing-store'
import type { ShareMode } from '../../types/database'

interface ShareModalProps {
  open: boolean
  onClose: () => void
  deckId: string
  deckName: string
}

const SHARE_MODES: { value: ShareMode; label: string; desc: string }[] = [
  { value: 'copy', label: '복사', desc: '수신자가 독립적인 복사본을 갖게 됩니다.' },
  { value: 'subscribe', label: '구독', desc: '원본이 업데이트되면 구독자도 변경을 봅니다. 학습 진도는 각자 별도.' },
  { value: 'snapshot', label: '스냅샷', desc: '현재 상태의 읽기 전용 복사본을 생성합니다.' },
]

export function ShareModal({ open, onClose, deckId, deckName }: ShareModalProps) {
  const { createShare, error } = useSharingStore()
  const [mode, setMode] = useState<ShareMode>('copy')
  const [loading, setLoading] = useState(false)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  if (!open) return null

  const handleCreate = async () => {
    setLoading(true)
    const share = await createShare({
      deckId,
      mode,
      generateLink: true,
    })
    setLoading(false)

    if (share?.invite_code) {
      const link = `${window.location.origin}/invite/${share.invite_code}`
      setInviteLink(link)
    }
  }

  const handleCopy = async () => {
    if (!inviteLink) return
    await navigator.clipboard.writeText(inviteLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleClose = () => {
    setInviteLink(null)
    setCopied(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div className="bg-white rounded-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">덱 공유</h3>
          <button onClick={handleClose} className="p-1 text-gray-400 hover:text-gray-600 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-sm text-gray-600">
            <span className="font-medium">"{deckName}"</span> 덱을 공유합니다.
          </p>

          {!inviteLink ? (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">공유 모드</label>
                {SHARE_MODES.map((m) => (
                  <label
                    key={m.value}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${
                      mode === m.value
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="shareMode"
                      value={m.value}
                      checked={mode === m.value}
                      onChange={() => setMode(m.value)}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="text-sm font-medium text-gray-900">{m.label}</div>
                      <div className="text-xs text-gray-500">{m.desc}</div>
                    </div>
                  </label>
                ))}
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                onClick={handleCreate}
                disabled={loading}
                className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50 cursor-pointer"
              >
                {loading ? '생성 중...' : '초대 링크 생성'}
              </button>
            </>
          ) : (
            <div className="space-y-3">
              <label className="text-sm font-medium text-gray-700">초대 링크</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={inviteLink}
                  readOnly
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-50 text-gray-700"
                />
                <button
                  onClick={handleCopy}
                  className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition cursor-pointer"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-gray-500">
                이 링크를 공유하면 상대방이 덱에 접근할 수 있습니다.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
