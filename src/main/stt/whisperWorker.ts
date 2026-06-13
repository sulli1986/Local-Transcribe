// Runs Whisper (transformers.js / ONNX on CPU) in a worker thread so the
// Electron main process and UI never block during transcription.
import { parentPort, workerData } from 'worker_threads'

type InMsg =
  | { type: 'init'; model: string }
  | { type: 'transcribe'; id: number; audio: Float32Array }

const MODEL_IDS: Record<string, string> = {
  tiny: 'onnx-community/whisper-tiny',
  base: 'onnx-community/whisper-base',
  small: 'onnx-community/whisper-small'
}

let transcriber: ((audio: Float32Array, opts: object) => Promise<{ text: string }>) | null = null

async function init(model: string): Promise<void> {
  const { pipeline, env } = await import('@huggingface/transformers')
  if (workerData?.cacheDir) {
    env.cacheDir = workerData.cacheDir
  }
  const fileProgress = new Map<string, { loaded: number; total: number }>()
  const pipe = await pipeline('automatic-speech-recognition', MODEL_IDS[model] ?? MODEL_IDS.base, {
    dtype: 'q8',
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status === 'progress' && p.file && p.total) {
        fileProgress.set(p.file, { loaded: p.loaded ?? 0, total: p.total })
        let loaded = 0
        let total = 0
        for (const f of fileProgress.values()) {
          loaded += f.loaded
          total += f.total
        }
        parentPort!.postMessage({
          type: 'progress',
          progress: total ? Math.round((loaded / total) * 100) : 0
        })
      }
    }
  })
  transcriber = pipe as unknown as NonNullable<typeof transcriber>
  parentPort!.postMessage({ type: 'ready' })
}

parentPort!.on('message', async (msg: InMsg) => {
  try {
    if (msg.type === 'init') {
      await init(msg.model)
    } else if (msg.type === 'transcribe') {
      if (!transcriber) throw new Error('Model not loaded')
      const out = await transcriber(msg.audio, {
        // Chunks are short (VAD-cut, <=20s) so no chunking config needed
        language: undefined,
        task: 'transcribe'
      })
      parentPort!.postMessage({ type: 'result', id: msg.id, text: (out.text ?? '').trim() })
    }
  } catch (err) {
    parentPort!.postMessage({
      type: 'error',
      id: msg.type === 'transcribe' ? msg.id : undefined,
      message: err instanceof Error ? err.message : String(err)
    })
  }
})
