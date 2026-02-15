import { describe, it, expect } from 'vitest'
import { getStoragePath, getStorageBucket, validateFile } from '../storage'

describe('getStoragePath', () => {
  it('should generate correct path for image', () => {
    const path = getStoragePath('user-1', 'deck-1', 'card-1', 'front_image', 'jpg')
    expect(path).toBe('user-1/deck-1/card-1/front_image.jpg')
  })

  it('should generate correct path for audio', () => {
    const path = getStoragePath('user-1', 'deck-1', 'card-1', 'pronunciation', 'mp3')
    expect(path).toBe('user-1/deck-1/card-1/pronunciation.mp3')
  })
})

describe('getStorageBucket', () => {
  it('should return card-images for image type', () => {
    expect(getStorageBucket('image')).toBe('card-images')
  })

  it('should return card-audio for audio type', () => {
    expect(getStorageBucket('audio')).toBe('card-audio')
  })
})

describe('validateFile', () => {
  function mockFile(name: string, size: number, type: string): File {
    const blob = new Blob(['x'.repeat(Math.min(size, 100))], { type })
    Object.defineProperty(blob, 'size', { value: size })
    Object.defineProperty(blob, 'name', { value: name })
    return blob as File
  }

  describe('image validation', () => {
    it('should accept valid jpg under 5MB', () => {
      const file = mockFile('test.jpg', 1024 * 1024, 'image/jpeg')
      const result = validateFile(file, 'image')
      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('should accept png', () => {
      const file = mockFile('test.png', 1024, 'image/png')
      expect(validateFile(file, 'image').valid).toBe(true)
    })

    it('should accept webp', () => {
      const file = mockFile('test.webp', 1024, 'image/webp')
      expect(validateFile(file, 'image').valid).toBe(true)
    })

    it('should reject file over 5MB', () => {
      const file = mockFile('big.jpg', 6 * 1024 * 1024, 'image/jpeg')
      const result = validateFile(file, 'image')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('5MB')
    })

    it('should reject unsupported image type', () => {
      const file = mockFile('test.gif', 1024, 'image/gif')
      const result = validateFile(file, 'image')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('jpg')
    })
  })

  describe('audio validation', () => {
    it('should accept valid mp3 under 10MB', () => {
      const file = mockFile('test.mp3', 1024 * 1024, 'audio/mpeg')
      const result = validateFile(file, 'audio')
      expect(result.valid).toBe(true)
    })

    it('should accept ogg', () => {
      const file = mockFile('test.ogg', 1024, 'audio/ogg')
      expect(validateFile(file, 'audio').valid).toBe(true)
    })

    it('should accept wav', () => {
      const file = mockFile('test.wav', 1024, 'audio/wav')
      expect(validateFile(file, 'audio').valid).toBe(true)
    })

    it('should reject file over 10MB', () => {
      const file = mockFile('big.mp3', 11 * 1024 * 1024, 'audio/mpeg')
      const result = validateFile(file, 'audio')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('10MB')
    })

    it('should reject unsupported audio type', () => {
      const file = mockFile('test.flac', 1024, 'audio/flac')
      const result = validateFile(file, 'audio')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('mp3')
    })
  })
})
