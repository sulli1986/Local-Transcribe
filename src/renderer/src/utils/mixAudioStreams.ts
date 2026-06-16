const SAMPLE_RATE = 16000

export interface MixedAudioGraph {
  ctx: AudioContext
  /** Mixed mono stream for MediaRecorder. */
  outputStream: MediaStream
  micGainNode: GainNode
  systemGainNode: GainNode
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
  }

  return {
    ctx,
    outputStream: destination.stream,
    micGainNode,
    systemGainNode,
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

/** Request system audio via Windows share picker. Returns audio-only stream. */
export async function captureSystemAudio(): Promise<MediaStream> {
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
