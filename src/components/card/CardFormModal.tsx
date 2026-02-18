import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../ui/dialog'
import { useCardStore } from '../../stores/card-store'
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
  const { createCard, updateCard } = useCardStore()
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
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

      if (card && Object.keys(pendingFilesRef.current).length > 0) {
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
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editCard ? t('editCard') : t('addCard')}</DialogTitle>
        </DialogHeader>
        {!template ? (
          <p className="text-gray-500">{t('noTemplateSet')}</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {fileError && (
              <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg">
                {t(fileError)}
              </div>
            )}

            {/* Dynamic fields */}
            {fields.map((field) => (
              <div key={field.key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {field.name}
                  {field.order === 0 && <span className="text-red-500 ml-1">*</span>}
                </label>
                {field.detail && (
                  <p className="text-xs text-gray-400 mb-1.5">{field.detail}</p>
                )}
                {field.type === 'text' ? (
                  <input
                    type="text"
                    value={fieldValues[field.key] || ''}
                    onChange={(e) => handleFieldChange(field.key, e.target.value)}
                    placeholder={field.name}
                    className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-gray-900"
                  />
                ) : field.type === 'image' ? (
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center text-sm text-gray-400">
                    {uploadingField === field.key ? (
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
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
                          className="text-red-500 text-xs cursor-pointer"
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
                          className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs hover:bg-gray-200 cursor-pointer"
                        >
                          {t('selectFile')}
                        </button>
                        <p className="text-xs text-gray-400 mt-1">{t('imageFormats')}</p>
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
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center text-sm text-gray-400">
                    {uploadingField === field.key ? (
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                        <span>{t('uploading')}</span>
                      </div>
                    ) : fieldValues[field.key] ? (
                      <div className="flex items-center justify-center gap-2">
                        <audio controls src={fieldValues[field.key]} className="h-8" />
                        <button
                          type="button"
                          onClick={() => handleRemoveFile(field)}
                          className="text-red-500 text-xs cursor-pointer"
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
                          className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs hover:bg-gray-200 cursor-pointer"
                        >
                          {t('selectFile')}
                        </button>
                        <p className="text-xs text-gray-400 mt-1">{t('audioFormats')}</p>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('tags')}</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-gray-100 text-gray-700 text-sm rounded-full"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="text-gray-400 hover:text-gray-600 cursor-pointer"
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
                className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none text-gray-900"
              />
            </div>

            {/* Buttons */}
            <DialogFooter>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer"
              >
                {t('cancel')}
              </button>
              <button
                type="submit"
                disabled={loading || uploadingField !== null}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
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
