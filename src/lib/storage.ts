import { supabase } from './supabase'
import { guard } from './rate-limit-instance'

const IMAGE_MAX_SIZE = 5 * 1024 * 1024 // 5MB
const AUDIO_MAX_SIZE = 10 * 1024 * 1024 // 10MB
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const AUDIO_TYPES = ['audio/mpeg', 'audio/ogg', 'audio/wav']

export function getStoragePath(
  userId: string,
  deckId: string,
  cardId: string,
  fieldKey: string,
  ext: string
): string {
  return `${userId}/${deckId}/${cardId}/${fieldKey}.${ext}`
}

export function getStorageBucket(fieldType: 'image' | 'audio'): string {
  return fieldType === 'image' ? 'card-images' : 'card-audio'
}

export function validateFile(
  file: File,
  fieldType: 'image' | 'audio'
): { valid: boolean; error?: string } {
  if (fieldType === 'image') {
    if (file.size > IMAGE_MAX_SIZE) {
      return { valid: false, error: '이미지 파일은 5MB 이하만 가능합니다.' }
    }
    if (!IMAGE_TYPES.includes(file.type)) {
      return { valid: false, error: '지원하는 이미지 형식: jpg, png, webp' }
    }
  } else {
    if (file.size > AUDIO_MAX_SIZE) {
      return { valid: false, error: '오디오 파일은 10MB 이하만 가능합니다.' }
    }
    if (!AUDIO_TYPES.includes(file.type)) {
      return { valid: false, error: '지원하는 오디오 형식: mp3, ogg, wav' }
    }
  }
  return { valid: true }
}

function getExtFromMime(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
  }
  return map[mime] ?? 'bin'
}

export async function uploadFile(
  file: File,
  userId: string,
  deckId: string,
  cardId: string,
  fieldKey: string,
  fieldType: 'image' | 'audio'
): Promise<string> {
  const check = guard.check('storage_upload', 'storage_bytes', file.size)
  if (!check.allowed) {
    throw new Error(check.message ?? '업로드 제한에 도달했습니다.')
  }

  const validation = validateFile(file, fieldType)
  if (!validation.valid) {
    throw new Error(validation.error)
  }

  const bucket = getStorageBucket(fieldType)
  const ext = getExtFromMime(file.type)
  const path = getStoragePath(userId, deckId, cardId, fieldKey, ext)

  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: true,
  })

  if (error) {
    throw new Error(`업로드 실패: ${error.message}`)
  }

  guard.recordSuccess('storage_bytes', file.size)
  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path)
  return urlData.publicUrl
}

export async function deleteFile(url: string, fieldType: 'image' | 'audio'): Promise<void> {
  const bucket = getStorageBucket(fieldType)

  // Extract path from public URL
  const bucketUrl = `/storage/v1/object/public/${bucket}/`
  const idx = url.indexOf(bucketUrl)
  if (idx === -1) return

  const path = url.substring(idx + bucketUrl.length)
  await supabase.storage.from(bucket).remove([path])
}
