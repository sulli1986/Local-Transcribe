const SAMPLE_RATE = 16000
const CHUNK_SEC = 20

export interface TranscribeProgress {
  done: number
  total: number
}

/** Decode an audio URL and transcribe it in fixed-size chunks. Returns duration in seconds. */
export async function transcribeAudioFromUrl(
  url: string,
  transcribe: (audio: Float32Array) => Promise<string>,
  onTranscript: (text: string, startSec: number) => Promise<void>,
  onProgress?: (p: TranscribeProgress) => void
): Promise<number> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not load audio (${res.status})`)
  const buf = await res.arrayBuffer()

  const decodeCtx = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await decodeCtx.decodeAudioData(buf.slice(0))
  } finally {
    await decodeCtx.close().catch(() => {})
  }

  const durationSec = decoded.duration
  const offline = new OfflineAudioContext(
    1,
    Math.ceil(durationSec * SAMPLE_RATE),
    SAMPLE_RATE
  )
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start(0)
  const rendered = await offline.startRendering()
  const pcm = rendered.getChannelData(0)

  const chunkSamples = CHUNK_SEC * SAMPLE_RATE
  const totalChunks = Math.ceil(pcm.length / chunkSamples) || 1

  for (let i = 0; i < pcm.length; i += chunkSamples) {
    const slice = pcm.subarray(i, Math.min(i + chunkSamples, pcm.length))
    const startSec = Math.round(i / SAMPLE_RATE)
    const text = (await transcribe(new Float32Array(slice))).trim()
    if (text) await onTranscript(text, startSec)
    onProgress?.({ done: Math.floor(i / chunkSamples) + 1, total: totalChunks })
  }

  return Math.round(durationSec)
}
