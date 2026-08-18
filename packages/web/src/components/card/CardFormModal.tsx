import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../ui/dialog'
import { useCardStore } from '../../stores/card-store'
import { aiHubBus } from '@reeeeecall/shared/lib/ai/hub/events'
import { cardLength } from '@reeeeecall/shared/lib/card-content-limits'
import { useCardLimit } from '@reeeeecall/shared/hooks/useCardLimit'
import { CardLimitBlock } from './CardLimitBlock'
import { useAuthStore } from '../../stores/auth-store'
import { uploadFile, deleteFile, validateFile } from '../../lib/storage'
import { reconcileFieldValues } from '../../lib/card-utils'
import type { Card, CardTemplate, TemplateField } from '../../types/database'

interface CardFormModalProps {
  open: boolean
  onClose: () => void
  deckId: string
  template: CardTemplate | null
  editCard?: Card | null
}

export function CardFormModal({ open, onClose, deckId, template, editCard }: CardFormModalProps) {
  const { t } = useTranslation('cards')
  const navigate = useNavigate()
  const { createCard, updateCard } = useCardStore()
  const limit = useCardLimit()
  const user = useAuthStore((s) => s.user)

  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [uploadingField, setUploadingField] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const fields: TemplateField[] = template?.fields ?? []

  useEffect(() => {
    if (editCard) {
      setFieldValues(reconcileFieldValues(fields, editCard.field_values))
      setTags(editCard.tags ?? [])
    } else {
      setFieldValues(reconcileFieldValues(fields, {}))
      setTags([])
    }
    setTagInput('')
    setFileError(null)
    setUploadingField(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editCard, open])

  /**
   * 카드 전체 글자수 — 지금 몇 자인지, 그리고 몇 자까지인지.
   *
   * 한도는 카드 **한 장**에 걸립니다(필드별이면 필드를 늘려 우회되고, 앞/뒷면 구분은 템플릿
   * 레이아웃이 정하는 것이라 편집만으로 넘나듭니다). 그래서 세는 것도 한 장 단위입니다.
   *
   * 이미지 필드는 데이터 URL 이라 혼자 수만 자입니다. 학습자가 쓴 글이 아니므로 세지
   * 않습니다 — 아니면 사진 한 장이 카드를 통째로 막습니다.
   */
  const cardChars = cardLength(
    fields
      .filter((f) => f.type !== 'image')
      .map((f) => fieldValues[f.key] ?? ''),
  )

  const handleFieldChange = (key: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }))
  }

  const handleAddTag = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && tagInput.trim()) {
      e.preventDefault()
      const newTag = tagInput.trim()
      if (!tags.includes(newTag)) {
        setTags([...tags, newTag])
      }
      setTagInput('')
    }
  }

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag))
  }

  const handleFileUpload = async (field: TemplateField, file: File) => {
    if (!user) return
    setFileError(null)

    const fieldType = field.type as 'image' | 'audio'
    const validation = validateFile(file, fieldType)
    if (!validation.valid) {
      setFileError(validation.error ?? 'cards:fileValidationFailed')
      return
    }

    setUploadingField(field.key)

    try {
      if (editCard) {
        // Edit mode: upload directly
        const oldUrl = fieldValues[field.key]
        if (oldUrl) {
          await deleteFile(oldUrl, fieldType).catch(() => {})
        }
        const url = await uploadFile(file, user.id, deckId, editCard.id, field.key, fieldType)
        handleFieldChange(field.key, url)
      } else {
        // New card: store file temporarily, will upload after card creation
        const tempUrl = URL.createObjectURL(file)
        handleFieldChange(field.key, tempUrl)
        // Store the file object for later upload
        pendingFilesRef.current[field.key] = file
      }
    } catch (e) {
      setFileError(e instanceof Error ? e.message : 'cards:uploadFailed')
    } finally {
      setUploadingField(null)
    }
  }

  const pendingFilesRef = useRef<Record<string, File>>({})

  useEffect(() => {
    if (!open) {
      // Clean up pending blob URLs
      pendingFilesRef.current = {}
    }
  }, [open])

  const handleRemoveFile = async (field: TemplateField) => {
    const fieldType = field.type as 'image' | 'audio'
    const currentUrl = fieldValues[field.key]

    if (currentUrl && editCard && !currentUrl.startsWith('blob:')) {
      await deleteFile(currentUrl, fieldType).catch(() => {})
    }

    // Clean up pending file if exists
    delete pendingFilesRef.current[field.key]

    handleFieldChange(field.key, '')
  }

  const resetForm = () => {
    setFieldValues(reconcileFieldValues(fields, {}))
    setTags([])
    setTagInput('')
    setFileError(null)
    pendingFilesRef.current = {}
  }

  const submitCard = async (keepOpen: boolean) => {
    if (!template || !user) return

    // Minimum 1 field must have a value (excluding blob URLs)
    const hasValue = Object.entries(fieldValues).some(([, v]) => {
      if (!v) return false
      if (v.startsWith('blob:')) return false
      return v.trim() !== ''
    })

    // Also check if pending files exist (new card with files)
    const hasPendingFiles = Object.keys(pendingFilesRef.current).length > 0
    const hasTextValue = Object.entries(fieldValues).some(([key, v]) => {
      if (!v) return false
      const field = fields.find((f) => f.key === key)
      return field?.type === 'text' && v.trim() !== ''
    })

    if (!hasValue && !hasPendingFiles && !hasTextValue) return

    // Owned-card limit pre-flight (mig 116) — only for NEW cards; editing is exempt.
    // Server also enforces at createCard.
    if (!editCard && limit.reached) return

    setLoading(true)

    if (editCard) {
      await updateCard(editCard.id, { field_values: reconcileFieldValues(fields, fieldValues), tags })
    } else {
      // Create card first, then upload pending files
      const textValues: Record<string, string> = {}
      for (const [key, val] of Object.entries(fieldValues)) {
        if (!val.startsWith('blob:')) {
          textValues[key] = val
        }
      }

      const card = await createCard({
        deck_id: deckId,
        template_id: template.id,
        field_values: textValues,
        tags,
      })

      // createCard returns null (does NOT throw) on failure — incl. a card-limit
      // (mig 116) rejection at the boundary. Keep the modal open + show the store
      // error instead of silently closing as if the card was saved.
      if (!card) {
        setLoading(false)
        return
      }

      if (Object.keys(pendingFilesRef.current).length > 0) {
        const updatedValues = { ...textValues }

        for (const [fieldKey, file] of Object.entries(pendingFilesRef.current)) {
          const field = fields.find((f) => f.key === fieldKey)
          if (!field) continue
          const fieldType = field.type as 'image' | 'audio'

          try {
            const url = await uploadFile(file, user.id, deckId, card.id, fieldKey, fieldType)
            updatedValues[fieldKey] = url
          } catch {
            // Skip failed uploads
          }
        }

        await updateCard(card.id, { field_values: updatedValues })
        pendingFilesRef.current = {}
      }
    }

    setLoading(false)

    // "Add & create another" keeps the modal open and clears the form so the
    // user can rapidly enter many cards without reopening the dialog.
    if (keepOpen && !editCard) {
      resetForm()
    } else {
      onClose()
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await submitCard(false)
  }

  // Whatever is typed in the form is abandoned on purpose — the wizard generates from a topic,
  // and half a card is not a prompt.
  const handleAICards = () => {
    aiHubBus.emit({ type: 'ai_hub.generate_requested', mode: 'cards_only', source: 'card_create', deckId })
    onClose()
    const params = new URLSearchParams({ mode: 'cards_only', deckId })
    if (template) params.set('templateId', template.id)
    navigate(`/ai-generate?${params.toString()}`)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editCard ? t('editCard') : t('addCard')}</DialogTitle>
        </DialogHeader>
        {!template ? (
          <p className="text-muted-foreground">{t('noTemplateSet')}</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {!editCard && limit.reached && <CardLimitBlock />}
            {fileError && (
              <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-lg">
                {t(fileError)}
              </div>
            )}

            {/* 지금 몇 자 / 몇 자까지. 저장을 누른 뒤에 알게 되는 한도는 한도가 아닙니다. */}
            <p
              className={`text-right text-xs tabular-nums ${
                cardChars.state === 'too_long' ? 'text-destructive'
                  : cardChars.state === 'near_limit' ? 'text-amber-600'
                    : 'text-content-tertiary'
              }`}
              data-testid="card-length"
              data-state={cardChars.state}
            >
              {t('form.length', { chars: cardChars.count, max: cardChars.max })}
            </p>

            {/* Dynamic fields */}
            {fields.map((field) => (
              <div key={field.key}>
                <label className="block text-sm font-medium text-foreground mb-1">
                  {field.name}
                  {field.order === 0 && <span className="text-destructive ml-1">*</span>}
                </label>
                {field.detail && (
                  <p className="text-xs text-content-tertiary mb-1.5">{field.detail}</p>
                )}
                {field.type === 'text' ? (
                  <input
                    type="text"
                    value={fieldValues[field.key] || ''}
                    onChange={(e) => handleFieldChange(field.key, e.target.value)}
                    placeholder={field.name}
                    className="w-full px-4 py-2.5 rounded-lg border border-border focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none text-foreground"
                  />
                ) : field.type === 'image' ? (
                  <div className="border-2 border-dashed border-border rounded-lg p-4 text-center text-sm text-content-tertiary">
                    {uploadingField === field.key ? (
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
                        <span>{t('uploading')}</span>
                      </div>
                    ) : fieldValues[field.key] ? (
                      <div>
                        <img
                          src={fieldValues[field.key]}
                          alt=""
                          className="max-h-32 mx-auto mb-2 rounded"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveFile(field)}
                          className="text-destructive text-xs cursor-pointer"
                        >
                          {t('remove')}
                        </button>
                      </div>
                    ) : (
                      <div>
                        <p className="mb-2">{t('uploadImage')}</p>
                        <button
                          type="button"
                          onClick={() => fileInputRefs.current[field.key]?.click()}
                          className="px-3 py-1.5 bg-accent text-foreground rounded-lg text-xs hover:bg-accent cursor-pointer"
                        >
                          {t('selectFile')}
                        </button>
                        <p className="text-xs text-content-tertiary mt-1">{t('imageFormats')}</p>
                        <input
                          ref={(el) => { fileInputRefs.current[field.key] = el }}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) handleFileUpload(field, file)
                          }}
                          className="hidden"
                        />
                      </div>
                    )}
                  </div>
                ) : field.type === 'audio' ? (
                  <div className="border-2 border-dashed border-border rounded-lg p-4 text-center text-sm text-content-tertiary">
                    {uploadingField === field.key ? (
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
                        <span>{t('uploading')}</span>
                      </div>
                    ) : fieldValues[field.key] ? (
                      <div className="flex items-center gap-2">
                        <audio controls src={fieldValues[field.key]} className="h-8 flex-1 min-w-0" />
                        <button
                          type="button"
                          onClick={() => handleRemoveFile(field)}
                          className="text-destructive text-xs cursor-pointer"
                        >
                          {t('remove')}
                        </button>
                      </div>
                    ) : (
                      <div>
                        <p className="mb-2">{t('uploadAudio')}</p>
                        <button
                          type="button"
                          onClick={() => fileInputRefs.current[field.key]?.click()}
                          className="px-3 py-1.5 bg-accent text-foreground rounded-lg text-xs hover:bg-accent cursor-pointer"
                        >
                          {t('selectFile')}
                        </button>
                        <p className="text-xs text-content-tertiary mt-1">{t('audioFormats')}</p>
                        <input
                          ref={(el) => { fileInputRefs.current[field.key] = el }}
                          type="file"
                          accept="audio/mpeg,audio/ogg,audio/wav"
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) handleFileUpload(field, file)
                          }}
                          className="hidden"
                        />
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ))}

            {/* Tags */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">{t('tags')}</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-accent text-foreground text-sm rounded-full"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="text-content-tertiary hover:text-muted-foreground cursor-pointer"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleAddTag}
                placeholder={t('tagsPlaceholder')}
                className="w-full px-4 py-2.5 rounded-lg border border-border focus:border-brand focus:ring-2 focus:ring-brand/20 outline-none text-foreground"
              />
            </div>

            {/* Optional hand-off to the AI wizard — deliberately a link, not a button, so it
                never reads as an alternative to saving the card being typed. */}
            {!editCard && (
              <div className="pt-3 border-t border-border text-center">
                <button
                  type="button"
                  onClick={handleAICards}
                  className="text-xs text-purple-600 dark:text-purple-400 hover:underline cursor-pointer"
                >
                  {t('button.aiCards', { ns: 'ai-generate' })}
                </button>
              </div>
            )}

            {/* Buttons */}
            <DialogFooter>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-foreground bg-card border border-border rounded-lg hover:bg-muted cursor-pointer"
              >
                {t('cancel')}
              </button>
              {!editCard && (
                <button
                  type="button"
                  onClick={() => submitCard(true)}
                  disabled={loading || uploadingField !== null || !cardChars.savable}
                  className="px-4 py-2 text-sm text-brand bg-brand/10 rounded-lg hover:bg-brand/20 disabled:opacity-50 cursor-pointer"
                >
                  {t('addAnother')}
                </button>
              )}
              <button
                type="submit"
                // 한도를 넘긴 채 누르면 DB 제약이 그대로 올라옵니다. 숫자를 보여주는 것과
                // 저장을 막는 것은 같은 약속의 두 쪽입니다.
                disabled={loading || uploadingField !== null || !cardChars.savable}
                className="px-4 py-2 text-sm text-white bg-brand rounded-lg hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {loading ? t('saving') : editCard ? t('edit') : t('add')}
              </button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
