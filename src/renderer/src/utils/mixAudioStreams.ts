const SAMPLE_RATE = 16000

export interface MixedAudioGraph {
  ctx: AudioContext
  /** Mixed mono stream for MediaRecorder. */
  outputStream: MediaStream
  micGainNode: GainNode
  systemGainNode: GainNode
  micAnalyser: AnalyserNode
  systemAnalyser: AnalyserNode
  /** Connect VAD / analysis processor — receives summed mic + system. */
  connectProcessor: (processor: ScriptProcessorNode) => void
  cleanup: () => void
}

/** Mix mic + system (loopback) into one mono stream at 16 kHz for STT and recording. */
export function createMixedAudioGraph(
  micStream: MediaStream,
  systemStream: MediaStream,
  micGain: number,
  systemGain: number
): MixedAudioGraph {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
  const micSource = ctx.createMediaStreamSource(micStream)
  const systemSource = ctx.createMediaStreamSource(systemStream)

  const micGainNode = ctx.createGain()
  const systemGainNode = ctx.createGain()
  micGainNode.gain.value = micGain
  systemGainNode.gain.value = systemGain

  micSource.connect(micGainNode)
  systemSource.connect(systemGainNode)

  const micAnalyser = ctx.createAnalyser()
  micAnalyser.fftSize = 2048
  const systemAnalyser = ctx.createAnalyser()
  systemAnalyser.fftSize = 2048

  micGainNode.connect(micAnalyser)
  systemGainNode.connect(systemAnalyser)

  const destination = ctx.createMediaStreamDestination()
  micGainNode.connect(destination)
  systemGainNode.connect(destination)

  const connectProcessor = (processor: ScriptProcessorNode) => {
    micGainNode.connect(processor)
    systemGainNode.connect(processor)
    const silent = ctx.createGain()
    silent.gain.value = 0
    processor.connect(silent)
    silent.connect(ctx.destination)
  }

  const cleanup = () => {
    micSource.disconnect()
    systemSource.disconnect()
    micGainNode.disconnect()
    systemGainNode.disconnect()
    micAnalyser.disconnect()
    systemAnalyser.disconnect()
  }

  return {
    ctx,
    outputStream: destination.stream,
    micGainNode,
    systemGainNode,
    micAnalyser,
    systemAnalyser,
    connectProcessor,
    cleanup
  }
}

/** Strip video tracks; keep audio from a getDisplayMedia stream. */
export function audioOnlyFromDisplayStream(displayStream: MediaStream): MediaStream {
  displayStream.getVideoTracks().forEach((t) => {
    t.stop()
    displayStream.removeTrack(t)
  })
  return displayStream
}

async function requestSystemAudioStream(): Promise<MediaStream> {
  const displayStream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true
  })
  const audioOnly = audioOnlyFromDisplayStream(displayStream)
  if (audioOnly.getAudioTracks().length === 0) {
    audioOnly.getTracks().forEach((t) => t.stop())
    throw new Error('NO_SYSTEM_AUDIO')
  }
  return audioOnly
}

function isCaptureDenied(err: unknown): boolean {
  return (
    err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError')
  )
}

/** Request system-wide loopback audio (Windows). Returns audio-only stream. */
export async function captureSystemAudio(): Promise<MediaStream> {
  await window.api.enableLoopbackAudio()
  try {
    try {
      return await requestSystemAudioStream()
    } catch (err) {
      if (!isCaptureDenied(err)) throw err
      // Auto loopback failed (often missing screen-recording permission) — try Windows picker.
      await window.api.enableLoopbackPicker()
      return await requestSystemAudioStream()
    }
  } finally {
    await window.api.disableLoopbackAudio()
  }
}
