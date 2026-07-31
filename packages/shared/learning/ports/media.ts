/** Future-only audio/speech contracts. No device, network, or provider implementation. */
export interface AudioResponseRef {
  readonly storageRef: string
  readonly mimeType: string
  readonly durationMs: number
  readonly language: string | null
}

export interface SpeechRecognitionOptions {
  readonly language: string
  readonly punctuation?: boolean
  readonly alternatives?: number
}

export interface TranscriptResult {
  readonly transcript: string
  readonly confidence: number | null
  readonly alternatives: readonly string[]
  readonly providerVersion: string
}

export interface PronunciationInput {
  readonly audio: AudioResponseRef
  readonly expectedText: string
  readonly language: string
}

export interface PronunciationResult {
  readonly normalizedScore: number | null
  readonly transcript: string | null
  readonly phonemeFeedback: readonly Record<string, unknown>[]
  readonly providerVersion: string
}

export interface SpeechRecognitionPort {
  transcribe(input: AudioResponseRef, options: SpeechRecognitionOptions): Promise<TranscriptResult>
}

export interface PronunciationEvaluationPort {
  evaluatePronunciation(input: PronunciationInput): Promise<PronunciationResult>
}
