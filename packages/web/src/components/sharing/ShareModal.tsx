import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Copy, Check } from 'lucide-react'
import { useSharingStore } from '../../stores/sharing-store'
import type { ShareMode } from '../../types/database'

interface ShareModalProps {
  open: boolean
  onClose: () => void
  deckId: string
  deckName: string
}

export function ShareModal({ open, onClose, deckId, deckName }: ShareModalProps) {
  const { t } = useTranslation('sharing')
  const { createShare, error } = useSharingStore()
  const [mode, setMode] = useState<ShareMode>('copy')
  const [loading, setLoading] = useState(false)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const SHARE_MODES: { value: ShareMode; labelKey: string; descKey: string; detailKey: string }[] = [
    {
      value: 'copy',
      labelKey: 'shareMode.copy.label',
      descKey: 'shareMode.copy.desc',
      detailKey: 'shareMode.copy.detail',
    },
    {
      value: 'subscribe',
      labelKey: 'shareMode.subscribe.label',
      descKey: 'shareMode.subscribe.desc',
      detailKey: 'shareMode.subscribe.detail',
    },
    {
      value: 'snapshot',
      labelKey: 'shareMode.snapshot.label',
      descKey: 'shareMode.snapshot.desc',
      detailKey: 'shareMode.snapshot.detail',
    },
  ]

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
      <div className="bg-card rounded-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-lg font-semibold text-foreground">{t('shareDeck')}</h3>
          <button onClick={handleClose} className="p-1 text-content-tertiary hover:text-muted-foreground cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            {t('shareDeckDesc', { name: deckName })}
          </p>

          {!inviteLink ? (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">{t('shareMode.label')}</label>
                {SHARE_MODES.map((m) => (
                  <label
                    key={m.value}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ${
                      mode === m.value
                        ? 'border-brand bg-brand/10'
                        : 'border-border hover:border-border'
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
                      <div className="text-sm font-medium text-foreground">{t(m.labelKey)}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{t(m.descKey)}</div>
                      <div className="text-xs text-content-tertiary mt-1 leading-relaxed">{t(m.detailKey)}</div>
                    </div>
                  </label>
                ))}
              </div>

              {error && <p className="text-sm text-destructive">{t(error)}</p>}

              <button
                onClick={handleCreate}
                disabled={loading}
                className="w-full py-2.5 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand transition disabled:opacity-50 cursor-pointer"
              >
                {loading ? t('creating') : t('createInviteLink')}
              </button>
            </>
          ) : (
            <div className="space-y-3">
              <label className="text-sm font-medium text-foreground">{t('inviteLink')}</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={inviteLink}
                  readOnly
                  className="flex-1 px-3 py-2 text-sm border border-border rounded-lg bg-muted text-foreground"
                />
                <button
                  onClick={handleCopy}
                  className="p-2 bg-brand text-white rounded-lg hover:bg-brand transition cursor-pointer"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('linkShareInfo')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
