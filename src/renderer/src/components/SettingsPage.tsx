import { useState } from 'react'
import type {
  ApiKeyProvider,
  AppSettings,
  LlmProvider,
  SttEngine,
  ThemePref,
  WhisperModel
} from '../../../shared/types'
import { useToast } from '../toast'

interface Props {
  settings: AppSettings
  onChange: (s: AppSettings) => void
}

export default function SettingsPage({ settings, onChange }: Props) {
  const toast = useToast()
  const [keys, setKeys] = useState<Record<ApiKeyProvider, string>>({
    openai: '',
    anthropic: '',
    openrouter: ''
  })

  const update = async (patch: Partial<AppSettings>) => {
    onChange(await window.api.updateSettings(patch))
  }

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

  return (
    <div className="settings-page">
      <div className="settings-inner">
        <h1>Settings</h1>

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
                Any chat model on openrouter.ai, e.g. openai/gpt-4o-mini or
                anthropic/claude-3.5-haiku
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
