import { useCallback, useEffect, useRef, useState } from 'react'
import type { RecordingMode } from '../../../shared/types'
import {
  captureSystemAudio,
  createMixedAudioGraph,
  type MixedAudioGraph
} from '../utils/mixAudioStreams'

export interface RecorderCallbacks {
  /** A VAD-cut chunk of speech, mono 16 kHz PCM, with its start offset in seconds. */
  onSpeechChunk: (audio: Float32Array, startSec: number) => void
  /** Compressed audio data to append to recording.webm. */
  onRecordingChunk: (data: Uint8Array) => void | Promise<void>
}

export interface RecorderOptions {
  preferredMicId?: string
  recordingMode?: RecordingMode
  micGain?: number
  systemAudioGain?: number
}

export interface RecorderHandle {
  recording: boolean
  paused: boolean
  elapsedSec: number
  level: number
  devices: MediaDeviceInfo[]
  deviceId: string
  setDeviceId: (id: string) => void
  refreshDevices: () => Promise<void>
  start: () => Promise<void>
  pause: () => void
  resume: () => void
  stop: () => Promise<number>
}

const SAMPLE_RATE = 16000
const SPEECH_THRESHOLD = 0.012
const SILENCE_CUT_MS = 900
const MAX_CHUNK_SEC = 20
const MIN_CHUNK_SEC = 0.6
const PREROLL_BLOCKS = 3 // ~0.75s of audio kept before speech onset

export function useRecorder(
  callbacks: RecorderCallbacks,
  options: RecorderOptions = {}
): RecorderHandle {
  const [recording, setRecording] = useState(false)
  const [paused, setPaused] = useState(false)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [level, setLevel] = useState(0)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState(options.preferredMicId ?? '')

  const cb = useRef(callbacks)
  cb.current = callbacks
  const optionsRef = useRef(options)
  optionsRef.current = options

  const ctxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const displayStreamRef = useRef<MediaStream | null>(null)
  const mixedGraphRef = useRef<MixedAudioGraph | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef(0)
  const pausedRef = useRef(false)
  const totalPausedMsRef = useRef(0)
  const pauseStartedRef = useRef(0)

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      const mics = list.filter((d) => d.kind === 'audioinput')
      setDevices(mics)
      setDeviceId((cur) => {
        const preferred = optionsRef.current.preferredMicId
        if (preferred && mics.some((d) => d.deviceId === preferred)) return preferred
        return cur && mics.some((d) => d.deviceId === cur) ? cur : (mics[0]?.deviceId ?? '')
      })
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
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

  useEffect(() => {
    if (options.preferredMicId) {
      setDeviceId((cur) => cur || options.preferredMicId!)
    }
  }, [options.preferredMicId])

  const elapsedMs = () =>
    Date.now() -
    startTimeRef.current -
    totalPausedMsRef.current -
    (pausedRef.current ? Date.now() - pauseStartedRef.current : 0)

  const releaseCapture = useCallback(async () => {
    mixedGraphRef.current?.cleanup()
    mixedGraphRef.current = null
    displayStreamRef.current?.getTracks().forEach((t) => t.stop())
    displayStreamRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    await ctxRef.current?.close().catch(() => {})
    ctxRef.current = null
  }, [])

  const start = useCallback(async () => {
    if (recording) return

    const { recordingMode = 'mic', micGain = 1, systemAudioGain = 1 } = optionsRef.current
    const useSystem = recordingMode === 'mic_and_system'

    let micStream: MediaStream | null = null
    let displayStream: MediaStream | null = null
    let mixedGraph: MixedAudioGraph | null = null
    let ctx: AudioContext | null = null
    let recordingStream: MediaStream

    const audioConstraints: MediaTrackConstraints = {
      deviceId: deviceId ? { ideal: deviceId } : undefined,
      echoCancellation: !useSystem,
      noiseSuppression: !useSystem,
      autoGainControl: !useSystem
    }

    try {
      if (useSystem) {
        displayStream = await captureSystemAudio()
        displayStreamRef.current = displayStream
        micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
        streamRef.current = micStream
        mixedGraph = createMixedAudioGraph(micStream, displayStream, micGain, systemAudioGain)
        mixedGraphRef.current = mixedGraph
        ctx = mixedGraph.ctx
        ctxRef.current = ctx
        recordingStream = mixedGraph.outputStream
      } else {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
        streamRef.current = micStream
        recordingStream = micStream
        ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
        ctxRef.current = ctx
      }

      refreshDevices()

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const recorder = new MediaRecorder(recordingStream, { mimeType })
      recorder.ondataavailable = async (e) => {
        if (e.data.size > 0) {
          const buf = new Uint8Array(await e.data.arrayBuffer())
          await cb.current.onRecordingChunk(buf)
        }
      }
      recorder.start(3000)
      recorderRef.current = recorder

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
        if (pausedRef.current) return

        const input = e.inputBuffer.getChannelData(0)
        const block = new Float32Array(input)
        let sum = 0
        for (let i = 0; i < block.length; i++) sum += block[i] * block[i]
        const rms = Math.sqrt(sum / block.length)
        setLevel((prev) => Math.max(rms * 6, prev * 0.82))

        const nowSec = elapsedMs() / 1000

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

      if (mixedGraph) {
        mixedGraph.connectProcessor(processor)
      } else {
        const source = ctx.createMediaStreamSource(recordingStream)
        source.connect(processor)
        const sink = ctx.createGain()
        sink.gain.value = 0
        processor.connect(sink)
        sink.connect(ctx.destination)
      }

      startTimeRef.current = Date.now()
      totalPausedMsRef.current = 0
      pausedRef.current = false
      setPaused(false)
      setElapsedSec(0)
      setRecording(true)
      timerRef.current = setInterval(() => {
        setElapsedSec(Math.floor(elapsedMs() / 1000))
      }, 500)

      ;(processor as unknown as { __finalize: () => void }).__finalize = () => {
        if (active) finalizeChunk()
      }
    } catch (err) {
      await releaseCapture()
      throw err
    }
  }, [recording, deviceId, refreshDevices, releaseCapture])

  const pause = useCallback(() => {
    if (!recording || pausedRef.current) return
    pausedRef.current = true
    pauseStartedRef.current = Date.now()
    setPaused(true)
    setLevel(0)
    const recorder = recorderRef.current
    if (recorder?.state === 'recording') recorder.pause()
  }, [recording])

  const resume = useCallback(() => {
    if (!recording || !pausedRef.current) return
    totalPausedMsRef.current += Date.now() - pauseStartedRef.current
    pausedRef.current = false
    setPaused(false)
    const recorder = recorderRef.current
    if (recorder?.state === 'paused') recorder.resume()
  }, [recording])

  const stop = useCallback(async (): Promise<number> => {
    const duration = Math.round(elapsedMs() / 1000)
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
      await new Promise((r) => setTimeout(r, 50))
    }
    recorderRef.current = null

    await releaseCapture()

    pausedRef.current = false
    totalPausedMsRef.current = 0
    setRecording(false)
    setPaused(false)
    setLevel(0)
    return duration
  }, [releaseCapture])

  return {
    recording,
    paused,
    elapsedSec,
    level,
    devices,
    deviceId,
    setDeviceId,
    refreshDevices,
    start,
    pause,
    resume,
    stop
  }
}

export function fmtClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}
