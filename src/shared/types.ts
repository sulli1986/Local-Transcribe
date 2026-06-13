export type MeetingStatus = 'new' | 'recorded' | 'summarized'

export type TimelineEntryKind = 'transcript' | 'note' | 'image'

export interface TimelineEntry {
  kind: TimelineEntryKind
  /** Seconds from meeting start (recording time) or wall-clock seconds for notes taken outside recording. */
  timeSec: number
  /** Markdown content. For images this is the relative path inside the meeting folder. */
  content: string
}

export interface MeetingMeta {
  id: string // folder name
  title: string
  createdAt: string // ISO
  durationSec: number
  status: MeetingStatus
}

export interface Meeting extends MeetingMeta {
  summary: string // markdown, empty if not generated
  timeline: TimelineEntry[]
  hasRecording: boolean
}

export type SttEngine = 'local' | 'openai' | 'openrouter'
export type WhisperModel = 'tiny' | 'base' | 'small'
export type LlmProvider = 'openai' | 'anthropic' | 'openrouter' | 'ollama'
export type ThemePref = 'light' | 'dark' | 'system'
export type ApiKeyProvider = 'openai' | 'anthropic' | 'openrouter'

export interface AppSettings {
  vaultPath: string
  theme: ThemePref
  sttEngine: SttEngine
  whisperModel: WhisperModel
  llmProvider: LlmProvider
  openaiModel: string
  anthropicModel: string
  openrouterModel: string
  openrouterSttModel: string
  ollamaModel: string
  ollamaUrl: string
  /** Which API keys are currently stored (values never leave the main process). */
  hasOpenaiKey?: boolean
  hasAnthropicKey?: boolean
  hasOpenrouterKey?: boolean
}

export interface TranscriptResult {
  text: string
}

export interface SttStatus {
  state: 'idle' | 'loading-model' | 'ready' | 'transcribing' | 'error'
  message?: string
  /** 0-100 while downloading the model */
  progress?: number
}
