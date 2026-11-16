export interface TtsResult {
  duration: number
  buffer: AudioBuffer
  blob: Blob
}
export async function generateSpeechFromText(_options: unknown): Promise<TtsResult> {
  throw new Error('配音功能将在后续接入')
}
export async function generateAndInsertSpeech(_options: unknown): Promise<{ duration: number }> {
  throw new Error('配音功能将在后续接入')
}
