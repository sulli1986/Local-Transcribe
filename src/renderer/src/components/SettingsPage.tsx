import { useEffect, useState } from 'react'
import type {
  ApiKeyProvider,
  AppSettings,
  ActionColumn,
  DotColorsSettings,
  LlmProvider,
  RecordingMode,
  SttEngine,
  TagCategory,
  ThemePref,
  WhisperModel
} from '../../../shared/types'
import { DEFAULT_DOT_COLORS, DEFAULT_ACTION_COLUMNS } from '../../../shared/colors'
import Icon from './Icons'
import { useToast } from '../toast'

interface Props {
  settings: AppSettings
  onChange: (s: AppSettings) => void
}

export default function SettingsPage({ settings, onChange }: Props) {
  const toast = useToast()
  const [systemAudioSupported, setSystemAudioSupported] = useState(false)
  const [keys, setKeys] = useState<Record<ApiKeyProvider, string>>({
    openai: '',
    anthropic: '',
    openrouter: ''
  })

  const update = async (patch: Partial<AppSettings>) => {
    onChange(await window.api.updateSettings(patch))
  }

  useEffect(() => {
    window.api.isSystemAudioSupported().then(({ supported }) => setSystemAudioSupported(supported))
  }, [])

  const saveKey = async (provider: ApiKeyProvider, key: string) => {
    await window.api.setApiKey(provider, key.trim())
    onChange(await window.api.getSettings())
    setKeys((k) => ({ ...k, [provider]: '' }))
    toast.show(key.trim() ? 'API key saved' : 'API key removed')
  }

  const pickVault = async () => {
    const picked = await window.api.pickVault()
    if (picked) onChange(await window.api.getSettings())
  }

  const dotColors = settings.dotColors ?? DEFAULT_DOT_COLORS
  const tagCategories = settings.tagCategories ?? []
  const actionColumns = settings.actionColumns ?? DEFAULT_ACTION_COLUMNS

  const updateDotColor = (key: keyof DotColorsSettings, color: string) => {
    void update({ dotColors: { ...dotColors, [key]: color } })
  }

  const updateCategory = (index: number, patch: Partial<TagCategory>) => {
    const next = tagCategories.map((c, i) => (i === index ? { ...c, ...patch } : c))
    void update({ tagCategories: next })
  }

  const addCategory = () => {
    void update({
      tagCategories: [...tagCategories, { name: 'New category', color: '#2383e2' }]
    })
  }

  const removeCategory = (index: number) => {
    void update({ tagCategories: tagCategories.filter((_, i) => i !== index) })
  }

  const updateActionColumn = (index: number, patch: Partial<ActionColumn>) => {
    const next = actionColumns.map((c, i) => (i === index ? { ...c, ...patch } : c))
    void update({ actionColumns: next })
  }

  return (
    <div className="settings-page">
      <div className="settings-inner">
        <h1 className="settings-title">
          <Icon name="settings" size={22} /> Settings
        </h1>

        <div className="settings-section">
          <h3><Icon name="tag" size={16} /> Categories &amp; colors</h3>
          <p className="hint" style={{ marginTop: 0 }}>
            Status dots appear in the sidebar. Tag categories color-code meeting tags — use the
            same name when tagging a meeting.
          </p>

          <div className="color-grid">
            <label className="color-field">
              <span className="color-field-label">
                <span className="dot new preview-dot" /> New
              </span>
              <input
                type="color"
                value={dotColors.new}
                onChange={(e) => updateDotColor('new', e.target.value)}
              />
            </label>
            <label className="color-field">
              <span className="color-field-label">
                <span className="dot recorded preview-dot" /> Recorded
              </span>
              <input
                type="color"
                value={dotColors.recorded}
                onChange={(e) => updateDotColor('recorded', e.target.value)}
              />
            </label>
            <label className="color-field">
              <span className="color-field-label">
                <span className="dot summarized preview-dot" /> Summarized
              </span>
              <input
                type="color"
                value={dotColors.summarized}
                onChange={(e) => updateDotColor('summarized', e.target.value)}
              />
            </label>
            <label className="color-field">
              <span className="color-field-label">
                <span className="dot rec preview-dot" /> Recording
              </span>
              <input
                type="color"
                value={dotColors.rec}
                onChange={(e) => updateDotColor('rec', e.target.value)}
              />
            </label>
          </div>

          <div className="field" style={{ marginTop: 16 }}>
            <label>Tag categories</label>
            {tagCategories.length === 0 && (
              <p className="hint">No categories yet — tags still get automatic colors.</p>
            )}
            <div className="category-list">
              {tagCategories.map((cat, i) => (
                <div className="category-row" key={`${cat.name}-${i}`}>
                  <span className="tag-dot" style={{ background: cat.color }} />
                  <input
                    value={cat.name}
                    onChange={(e) => updateCategory(i, { name: e.target.value })}
                    placeholder="Category name"
                  />
                  <input
                    type="color"
                    value={cat.color}
                    onChange={(e) => updateCategory(i, { color: e.target.value })}
                    title="Category color"
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => removeCategory(i)}
                    title="Remove category"
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="secondary-btn with-icon" onClick={addCategory}>
              <Icon name="plus" size={14} /> Add category
            </button>
          </div>

          <div className="field" style={{ marginTop: 20 }}>
            <label>Action board columns</label>
            <p className="hint" style={{ marginTop: 0 }}>
              Kanban column labels and colors on the Actions page.
            </p>
            <div className="category-list">
              {actionColumns.map((col, i) => (
                <div className="category-row" key={col.id}>
                  <span className="tag-dot" style={{ background: col.color }} />
                  <input
                    value={col.label}
                    onChange={(e) => updateActionColumn(i, { label: e.target.value })}
                    placeholder="Column label"
                  />
                  <input
                    type="color"
                    value={col.color}
                    onChange={(e) => updateActionColumn(i, { color: e.target.value })}
                    title="Column color"
                  />
                  <span className="hint" style={{ fontSize: 11, minWidth: 72 }}>
                    {col.id.replace('_', ' ')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="settings-section">
          <h3>Appearance</h3>
          <div className="field">
            <label>Theme</label>
            <div className="seg-control">
              {(['light', 'dark', 'system'] as ThemePref[]).map((t) => (
                <button
                  key={t}
                  className={settings.theme === t ? 'active' : ''}
                  onClick={() => update({ theme: t })}
                >
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="settings-section">
          <h3>Storage</h3>
          <div className="field">
            <label>Meetings folder</label>
            <div className="field-row">
              <input value={settings.vaultPath} readOnly />
              <button className="secondary-btn" onClick={pickVault}>
                Change…
              </button>
            </div>
            <span className="hint">
              Each meeting is a folder with a plain meeting.md, the audio recording, and pasted
              images. No database — the files are yours.
            </span>
          </div>
        </div>

        <div className="settings-section">
          <h3>Transcription</h3>
          <div className="field">
            <label>Engine</label>
            <div className="seg-control">
              {(
                [
                  ['local', 'Local Whisper'],
                  ['openai', 'OpenAI'],
                  ['openrouter', 'OpenRouter']
                ] as [SttEngine, string][]
              ).map(([v, label]) => (
                <button
                  key={v}
                  className={settings.sttEngine === v ? 'active' : ''}
                  onClick={() => update({ sttEngine: v })}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="hint">
              Local runs fully offline on the CPU. Cloud engines are more accurate but send audio
              to the provider and need an API key.
            </span>
          </div>
          {settings.sttEngine === 'openrouter' && (
            <div className="field">
              <label>OpenRouter transcription model</label>
              <input
                value={settings.openrouterSttModel}
                onChange={(e) => update({ openrouterSttModel: e.target.value })}
              />
              <span className="hint">
                e.g. openai/whisper-1, openai/whisper-large-v3, openai/gpt-4o-mini-transcribe
              </span>
            </div>
          )}
          {settings.sttEngine === 'local' && (
            <div className="field">
              <label>Whisper model</label>
              <select
                value={settings.whisperModel}
                onChange={(e) => update({ whisperModel: e.target.value as WhisperModel })}
              >
                <option value="tiny">tiny — fastest, least accurate (~50 MB)</option>
                <option value="base">base — good balance (~80 MB)</option>
                <option value="small">small — most accurate, slow on CPU (~250 MB)</option>
              </select>
              <span className="hint">Downloaded automatically on first use, then cached offline.</span>
            </div>
          )}
        </div>

        <div className="settings-section">
          <h3>Recording</h3>
          <div className="field">
            <label>Recording source</label>
            <div className="seg-control">
              {(
                [
                  ['mic', 'Mic only'],
                  ['mic_and_system', 'Mic + system audio (Windows)']
                ] as [RecordingMode, string][]
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  className={settings.recordingMode === v ? 'active' : ''}
                  disabled={v === 'mic_and_system' && !systemAudioSupported}
                  title={
                    v === 'mic_and_system' && !systemAudioSupported
                      ? 'System audio capture coming later on this platform'
                      : undefined
                  }
                  onClick={() => update({ recordingMode: v })}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="hint">
              Mic + system audio automatically captures everything playing on your PC (Teams, Zoom,
              browser, etc.) via Windows loopback. Use headphones to avoid echo.
            </span>
          </div>
          {settings.recordingMode === 'mic_and_system' && systemAudioSupported && (
            <>
              <div className="field">
                <label>Microphone level ({Math.round((settings.micGain ?? 1) * 100)}%)</label>
                <input
                  type="range"
                  min={0}
                  max={200}
                  value={Math.round((settings.micGain ?? 1) * 100)}
                  onChange={(e) => update({ micGain: Number(e.target.value) / 100 })}
                />
              </div>
              <div className="field">
                <label>
                  System audio level ({Math.round((settings.systemAudioGain ?? 1) * 100)}%)
                </label>
                <input
                  type="range"
                  min={0}
                  max={200}
                  value={Math.round((settings.systemAudioGain ?? 1) * 100)}
                  onChange={(e) => update({ systemAudioGain: Number(e.target.value) / 100 })}
                />
              </div>
            </>
          )}
        </div>

        <div className="settings-section">
          <h3>AI meeting notes</h3>
          <div className="field">
            <label>Provider</label>
            <div className="seg-control">
              {(
                [
                  ['openai', 'OpenAI'],
                  ['anthropic', 'Anthropic'],
                  ['openrouter', 'OpenRouter'],
                  ['ollama', 'Ollama (local)']
                ] as [LlmProvider, string][]
              ).map(([v, label]) => (
                <button
                  key={v}
                  className={settings.llmProvider === v ? 'active' : ''}
                  onClick={() => update({ llmProvider: v })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {settings.llmProvider === 'openai' && (
            <div className="field">
              <label>OpenAI model</label>
              <input
                value={settings.openaiModel}
                onChange={(e) => update({ openaiModel: e.target.value })}
              />
            </div>
          )}
          {settings.llmProvider === 'anthropic' && (
            <div className="field">
              <label>Anthropic model</label>
              <input
                value={settings.anthropicModel}
                onChange={(e) => update({ anthropicModel: e.target.value })}
              />
            </div>
          )}
          {settings.llmProvider === 'openrouter' && (
            <div className="field">
              <label>OpenRouter model</label>
              <input
                value={settings.openrouterModel}
                onChange={(e) => update({ openrouterModel: e.target.value })}
              />
              <span className="hint">
                Current default: google/gemini-2.5-flash — good speed/quality for most meetings.
                For very long, dense meetings (60+ min), try google/gemini-2.5-pro or
                anthropic/claude-sonnet-4.
              </span>
            </div>
          )}
          {settings.llmProvider === 'ollama' && (
            <>
              <div className="field">
                <label>Ollama URL</label>
                <input
                  value={settings.ollamaUrl}
                  onChange={(e) => update({ ollamaUrl: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Ollama model</label>
                <input
                  value={settings.ollamaModel}
                  onChange={(e) => update({ ollamaModel: e.target.value })}
                />
                <span className="hint">Pull it first: ollama pull {settings.ollamaModel}</span>
              </div>
            </>
          )}
          <div className="field checkbox-field">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={settings.autoGenerateNotes}
                onChange={(e) => update({ autoGenerateNotes: e.target.checked })}
              />
              Generate AI summary automatically when recording stops or audio is imported
            </label>
            <span className="hint">
              When off, use &ldquo;Generate summary&rdquo; on the Summary tab manually.
            </span>
          </div>
        </div>

        <div className="settings-section">
          <h3>API keys</h3>
          {(
            [
              ['openai', 'OpenAI API key', 'sk-…', settings.hasOpenaiKey],
              ['anthropic', 'Anthropic API key', 'sk-ant-…', settings.hasAnthropicKey],
              ['openrouter', 'OpenRouter API key', 'sk-or-…', settings.hasOpenrouterKey]
            ] as [ApiKeyProvider, string, string, boolean | undefined][]
          ).map(([provider, label, placeholder, isSet]) => (
            <div className="field" key={provider}>
              <label>
                {label}{' '}
                <span className={`key-status ${isSet ? 'set' : 'unset'}`}>
                  {isSet ? '— saved' : '— not set'}
                </span>
              </label>
              <div className="field-row">
                <input
                  type="password"
                  placeholder={placeholder}
                  value={keys[provider]}
                  onChange={(e) => setKeys((k) => ({ ...k, [provider]: e.target.value }))}
                />
                <button className="secondary-btn" onClick={() => saveKey(provider, keys[provider])}>
                  Save
                </button>
              </div>
            </div>
          ))}
          <span className="hint">Keys are stored encrypted on this machine and never leave it.</span>
        </div>
      </div>
    </div>
  )
}
