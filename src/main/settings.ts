import { app, safeStorage } from 'electron'
import { promises as fs, existsSync, readFileSync } from 'fs'
import path from 'path'
import type { ApiKeyProvider, AppSettings } from '../shared/types'
import { DEFAULT_DOT_COLORS, DEFAULT_ACTION_COLUMNS } from '../shared/colors'

interface StoredSettings extends AppSettings {
  // API keys, encrypted with safeStorage when available (base64), else plain text
  openaiKey?: string
  anthropicKey?: string
  openrouterKey?: string
  keysEncrypted?: boolean
}

const defaults = (): StoredSettings => ({
  vaultPath: path.join(app.getPath('home'), 'Meetings'),
  theme: 'system',
  sttEngine: 'local',
  whisperModel: 'base',
  llmProvider: 'openai',
  openaiModel: 'gpt-4o-mini',
  anthropicModel: 'claude-3-5-haiku-latest',
  openrouterModel: 'google/gemini-2.5-flash',
  openrouterSttModel: 'openai/whisper-1',
  ollamaModel: 'llama3.1',
  ollamaUrl: 'http://localhost:11434',
  autoGenerateNotes: true,
  preferredMicId: '',
  recordingMode: 'mic',
  micGain: 1,
  systemAudioGain: 1,
  dotColors: { ...DEFAULT_DOT_COLORS },
  tagCategories: [],
  actionColumns: DEFAULT_ACTION_COLUMNS.map((c) => ({ ...c }))
})

export class SettingsStore {
  private file: string
  private data: StoredSettings

  constructor() {
    this.file = path.join(app.getPath('userData'), 'settings.json')
    this.data = defaults()
    if (existsSync(this.file)) {
      try {
        const parsed = JSON.parse(readFileSync(this.file, 'utf-8')) as Partial<StoredSettings>
        this.data = { ...defaults(), ...parsed }
        this.data.dotColors = { ...defaults().dotColors, ...parsed.dotColors }
        this.data.tagCategories = parsed.tagCategories ?? []
        this.data.actionColumns =
          parsed.actionColumns?.length === 3
            ? parsed.actionColumns
            : defaults().actionColumns
      } catch {
        // Corrupt settings file: fall back to defaults
      }
    }
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    await fs.writeFile(this.file, JSON.stringify(this.data, null, 2), 'utf-8')
  }

  /** Settings safe to send to the renderer (no key material). */
  getPublic(): AppSettings {
    const { openaiKey, anthropicKey, openrouterKey, keysEncrypted, ...pub } = this.data
    return {
      ...pub,
      hasOpenaiKey: Boolean(openaiKey),
      hasAnthropicKey: Boolean(anthropicKey),
      hasOpenrouterKey: Boolean(openrouterKey)
    }
  }

  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const { hasOpenaiKey, hasAnthropicKey, hasOpenrouterKey, ...rest } = patch
    this.data = { ...this.data, ...rest }
    await this.persist()
    return this.getPublic()
  }

  async setApiKey(provider: ApiKeyProvider, key: string): Promise<void> {
    let stored = key
    if (key && safeStorage.isEncryptionAvailable()) {
      stored = safeStorage.encryptString(key).toString('base64')
      this.data.keysEncrypted = true
    } else {
      this.data.keysEncrypted = false
    }
    const field = `${provider}Key` as const
    this.data[field] = key ? stored : undefined
    await this.persist()
  }

  getApiKey(provider: ApiKeyProvider): string | undefined {
    const stored = this.data[`${provider}Key`]
    if (!stored) return undefined
    if (this.data.keysEncrypted && safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(Buffer.from(stored, 'base64'))
      } catch {
        return undefined
      }
    }
    return stored
  }

  get raw(): StoredSettings {
    return this.data
  }
}
