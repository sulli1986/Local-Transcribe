import { Worker } from 'worker_threads'
import path from 'path'
import { app } from 'electron'
import type { SettingsStore } from '../settings'
import type { SttStatus } from '../../shared/types'

type StatusListener = (status: SttStatus) => void

interface Pending {
  resolve: (text: string) => void
  reject: (err: Error) => void
}

export class SttService {
  private worker: Worker | null = null
  private loadedModel: string | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private readyPromise: Promise<void> | null = null
  private status: SttStatus = { state: 'idle' }
  private listeners = new Set<StatusListener>()

  constructor(private settings: SettingsStore) {}

  onStatus(fn: StatusListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getStatus(): SttStatus {
    return this.status
  }

  private setStatus(s: SttStatus): void {
    this.status = s
    for (const fn of this.listeners) fn(s)
  }

  /** Pre-load the local model so the first chunk isn't slow. No-op for cloud engine. */
  async prepare(): Promise<void> {
    if (this.settings.raw.sttEngine === 'local') {
      await this.ensureWorker()
    } else {
      this.setStatus({ state: 'ready' })
    }
  }

  async transcribe(audio: Float32Array): Promise<string> {
    const engine = this.settings.raw.sttEngine
    if (engine === 'openai') return this.transcribeOpenAi(audio)
    if (engine === 'openrouter') return this.transcribeOpenRouter(audio)
    return this.transcribeLocal(audio)
  }

  private async ensureWorker(): Promise<void> {
    const model = this.settings.raw.whisperModel
    if (this.worker && this.loadedModel === model) {
      return this.readyPromise ?? Promise.resolve()
    }
    if (this.worker) {
      await this.worker.terminate()
      this.worker = null
    }
    this.loadedModel = model
    this.setStatus({ state: 'loading-model', message: `Loading Whisper (${model})…`, progress: 0 })

    const worker = new Worker(path.join(__dirname, 'whisperWorker.js'), {
      workerData: { cacheDir: path.join(app.getPath('userData'), 'models') }
    })
    this.worker = worker

    this.readyPromise = new Promise<void>((resolve, reject) => {
      worker.on('message', (msg) => {
        if (msg.type === 'ready') {
          this.setStatus({ state: 'ready' })
          resolve()
        } else if (msg.type === 'progress') {
          this.setStatus({
            state: 'loading-model',
            message: `Downloading Whisper model (${msg.progress}%)`,
            progress: msg.progress
          })
        } else if (msg.type === 'result') {
          const p = this.pending.get(msg.id)
          if (p) {
            this.pending.delete(msg.id)
            p.resolve(msg.text)
          }
          if (this.pending.size === 0) this.setStatus({ state: 'ready' })
        } else if (msg.type === 'error') {
          if (msg.id !== undefined) {
            const p = this.pending.get(msg.id)
            if (p) {
              this.pending.delete(msg.id)
              p.reject(new Error(msg.message))
            }
          } else {
            this.setStatus({ state: 'error', message: msg.message })
            reject(new Error(msg.message))
          }
        }
      })
      worker.on('error', (err) => {
        this.setStatus({ state: 'error', message: err.message })
        for (const p of this.pending.values()) p.reject(err)
        this.pending.clear()
        reject(err)
      })
    })
    worker.postMessage({ type: 'init', model })
    return this.readyPromise
  }

  private async transcribeLocal(audio: Float32Array): Promise<string> {
    await this.ensureWorker()
    const id = this.nextId++
    this.setStatus({ state: 'transcribing' })
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      // Transfer the buffer to avoid copying potentially large audio
      this.worker!.postMessage({ type: 'transcribe', id, audio }, [audio.buffer as ArrayBuffer])
    })
  }

  private async transcribeOpenAi(audio: Float32Array): Promise<string> {
    const key = this.settings.getApiKey('openai')
    if (!key) throw new Error('OpenAI API key not set (Settings → API keys)')
    this.setStatus({ state: 'transcribing' })
    const wav = encodeWav(audio, 16000)
    const form = new FormData()
    form.append('file', new Blob([wav as unknown as ArrayBuffer], { type: 'audio/wav' }), 'chunk.wav')
    form.append('model', 'whisper-1')
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form
    })
    if (!res.ok) {
      const body = await res.text()
      this.setStatus({ state: 'error', message: `OpenAI STT failed (${res.status})` })
      throw new Error(`OpenAI STT failed (${res.status}): ${body.slice(0, 300)}`)
    }
    const json = (await res.json()) as { text?: string }
    this.setStatus({ state: 'ready' })
    return (json.text ?? '').trim()
  }

  private async transcribeOpenRouter(audio: Float32Array): Promise<string> {
    const key = this.settings.getApiKey('openrouter')
    if (!key) throw new Error('OpenRouter API key not set (Settings → API keys)')
    this.setStatus({ state: 'transcribing' })
    const wav = encodeWav(audio, 16000)
    const res = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: this.settings.raw.openrouterSttModel,
        input_audio: { data: Buffer.from(wav).toString('base64'), format: 'wav' }
      })
    })
    if (!res.ok) {
      const body = await res.text()
      this.setStatus({ state: 'error', message: `OpenRouter STT failed (${res.status})` })
      throw new Error(`OpenRouter STT failed (${res.status}): ${body.slice(0, 300)}`)
    }
    const json = (await res.json()) as { text?: string }
    this.setStatus({ state: 'ready' })
    return (json.text ?? '').trim()
  }

  async dispose(): Promise<void> {
    if (this.worker) await this.worker.terminate()
    this.worker = null
  }
}

/** Encode mono Float32 PCM as a 16-bit WAV file. */
function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let offset = 44
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Uint8Array(buffer)
}
