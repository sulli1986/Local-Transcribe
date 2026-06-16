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
  tags?: string[]
}

export interface Meeting extends MeetingMeta {
  summary: string // markdown, empty if not generated
  timeline: TimelineEntry[]
  hasRecording: boolean
  /** Relative path to audio inside the meeting folder. */
  recordingFile: string
}

export type SttEngine = 'local' | 'openai' | 'openrouter'
export type WhisperModel = 'tiny' | 'base' | 'small'
export type LlmProvider = 'openai' | 'anthropic' | 'openrouter' | 'ollama'
export type ThemePref = 'light' | 'dark' | 'system'
export type ApiKeyProvider = 'openai' | 'anthropic' | 'openrouter'
export type RecordingMode = 'mic' | 'mic_and_system'

export interface DotColorsSettings {
  new: string
  recorded: string
  summarized: string
  rec: string
}

export interface TagCategory {
  name: string
  color: string
}

export type ActionStatus = 'todo' | 'in_progress' | 'done'

export interface ActionColumn {
  id: ActionStatus
  label: string
  color: string
}

/** Stored per meeting in actions.json; meetingId/title filled when aggregating. */
export interface StoredActionItem {
  id: string
  text: string
  owner?: string
  status: ActionStatus
  done: boolean
  notes: string
  transcriptSec?: number
  createdAt: string
  updatedAt: string
  source: 'ai' | 'manual'
}

/** Action item with meeting context for the global Actions page. */
export interface ActionItem extends StoredActionItem {
  meetingId: string
  meetingTitle: string
  meetingTags?: string[]
}

export interface ActionsFile {
  version: 1
  items: StoredActionItem[]
}

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
  /** Generate AI notes automatically when recording stops. */
  autoGenerateNotes: boolean
  /** Last selected microphone deviceId (browser media device id). */
  preferredMicId: string
  /** Mic only, or mic + system loopback (Windows). */
  recordingMode: RecordingMode
  /** Input gain when mixing mic + system (0–2). */
  micGain: number
  systemAudioGain: number
  /** Sidebar status dot colors. */
  dotColors: DotColorsSettings
  /** Named tag categories — tags matching a name use that color. */
  tagCategories: TagCategory[]
  /** Kanban column labels and colors for action items. */
  actionColumns: ActionColumn[]
  /** Which API keys are currently stored (values never leave the main process). */
  hasOpenaiKey?: boolean
  hasAnthropicKey?: boolean
  hasOpenrouterKey?: boolean
}

export interface SttStatus {
  state: 'idle' | 'loading-model' | 'ready' | 'transcribing' | 'error'
  message?: string
  /** 0-100 while downloading the model */
  progress?: number
}

export interface SearchResult {
  id: string
  title: string
  createdAt: string
  /** Short excerpt around the first match. */
  snippet: string
}
