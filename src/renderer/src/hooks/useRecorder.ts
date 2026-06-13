import { useCallback, useEffect, useRef, useState } from 'react'

export interface RecorderCallbacks {
  /** A VAD-cut chunk of speech, mono 16 kHz PCM, with its start offset in seconds. */
  onSpeechChunk: (audio: Float32Array, startSec: number) => void
  /** Compressed audio data to append to recording.webm. */
  onRecordingChunk: (data: Uint8Array) => void | Promise<void>
}

export interface RecorderHandle {
  recording: boolean
  elapsedSec: number
  level: number
  devices: MediaDeviceInfo[]
  deviceId: string
  setDeviceId: (id: string) => void
  start: () => Promise<void>
  stop: () => Promise<number>
}

const SAMPLE_RATE = 16000
const SPEECH_THRESHOLD = 0.012
const SILENCE_CUT_MS = 900
const MAX_CHUNK_SEC = 20
const MIN_CHUNK_SEC = 0.6
const PREROLL_BLOCKS = 3 // ~0.75s of audio kept before speech onset

export function useRecorder(callbacks: RecorderCallbacks): RecorderHandle {
  const [recording, setRecording] = useState(false)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [level, setLevel] = useState(0)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState('')

  const cb = useRef(callbacks)
  cb.current = callbacks

  const ctxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef(0)

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      const mics = list.filter((d) => d.kind === 'audioinput')
      setDevices(mics)
      setDeviceId((cur) => (cur && mics.some((d) => d.deviceId === cur) ? cur : (mics[0]?.deviceId ?? '')))
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    // Browsers only expose the full device list (and labels) after mic
    // permission has been exercised once, so prime it with a momentary capture.
    let cancelled = false
    ;(async () => {
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
        probe.getTracks().forEach((t) => t.stop())
      } catch {
        // No mic or capture blocked; enumerate anyway for whatever is visible
      }
      if (!cancelled) await refreshDevices()
    })()
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices)
    return () => {
      cancelled = true
      navigator.mediaDevices.removeEventListener('devicechange', refreshDevices)
    }
  }, [refreshDevices])

  const start = useCallback(async () => {
    if (recording) return
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // "ideal" falls back to the default mic if the saved device is gone
        deviceId: deviceId ? { ideal: deviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    })
    streamRef.current = stream
    // Device labels only become available after permission is granted
    refreshDevices()

    // 1. Compressed recording to disk
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'
    const recorder = new MediaRecorder(stream, { mimeType })
    recorder.ondataavailable = async (e) => {
      if (e.data.size > 0) {
        const buf = new Uint8Array(await e.data.arrayBuffer())
        await cb.current.onRecordingChunk(buf)
      }
    }
    recorder.start(3000)
    recorderRef.current = recorder

    // 2. PCM tap for live transcription with simple energy-based VAD
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
    ctxRef.current = ctx
    const source = ctx.createMediaStreamSource(stream)
    const processor = ctx.createScriptProcessor(4096, 1, 1)
    processorRef.current = processor

    let active = false
    let chunkBlocks: Float32Array[] = []
    let preroll: Float32Array[] = []
    let silenceMs = 0
    let chunkStartSec = 0
    const blockMs = (4096 / ctx.sampleRate) * 1000

    const finalizeChunk = () => {
      const totalLen = chunkBlocks.reduce((n, b) => n + b.length, 0)
      const durSec = totalLen / SAMPLE_RATE
      if (durSec >= MIN_CHUNK_SEC) {
        const audio = new Float32Array(totalLen)
        let off = 0
        for (const b of chunkBlocks) {
          audio.set(b, off)
          off += b.length
        }
        cb.current.onSpeechChunk(audio, chunkStartSec)
      }
      chunkBlocks = []
      active = false
      silenceMs = 0
    }

    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0)
      const block = new Float32Array(input)
      let sum = 0
      for (let i = 0; i < block.length; i++) sum += block[i] * block[i]
      const rms = Math.sqrt(sum / block.length)
      setLevel((prev) => Math.max(rms * 6, prev * 0.82))

      const nowSec = (Date.now() - startTimeRef.current) / 1000

      if (rms > SPEECH_THRESHOLD) {
        if (!active) {
          active = true
          chunkBlocks = [...preroll]
          chunkStartSec = Math.max(0, nowSec - (preroll.length * blockMs) / 1000)
        }
        silenceMs = 0
        chunkBlocks.push(block)
      } else if (active) {
        silenceMs += blockMs
        chunkBlocks.push(block)
        if (silenceMs >= SILENCE_CUT_MS) finalizeChunk()
      }

      preroll.push(block)
      if (preroll.length > PREROLL_BLOCKS) preroll.shift()

      if (active && chunkBlocks.length * blockMs >= MAX_CHUNK_SEC * 1000) finalizeChunk()
    }

    source.connect(processor)
    // ScriptProcessor needs to be connected to keep firing; route to a muted gain
    const sink = ctx.createGain()
    sink.gain.value = 0
    processor.connect(sink)
    sink.connect(ctx.destination)

    startTimeRef.current = Date.now()
    setElapsedSec(0)
    setRecording(true)
    timerRef.current = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 500)

    // Stash so stop() can flush the trailing chunk
    ;(processor as unknown as { __finalize: () => void }).__finalize = () => {
      if (active) finalizeChunk()
    }
  }, [recording, deviceId, refreshDevices])

  const stop = useCallback(async (): Promise<number> => {
    const duration = Math.round((Date.now() - startTimeRef.current) / 1000)
    if (timerRef.current) clearInterval(timerRef.current)

    const processor = processorRef.current
    if (processor) {
      ;(processor as unknown as { __finalize?: () => void }).__finalize?.()
      processor.disconnect()
      processorRef.current = null
    }

    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve()
        recorder.stop()
      })
      // ondataavailable fires before onstop; give the final chunk handler a tick
      await new Promise((r) => setTimeout(r, 50))
    }
    recorderRef.current = null

    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    await ctxRef.current?.close().catch(() => {})
    ctxRef.current = null

    setRecording(false)
    setLevel(0)
    return duration
  }, [])

  return { recording, elapsedSec, level, devices, deviceId, setDeviceId, start, stop }
}

export function fmtClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}
