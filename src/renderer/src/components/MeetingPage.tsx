import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppSettings, Meeting, SttStatus, TimelineEntry } from '../../../shared/types'
import { useRecorder, fmtClock } from '../hooks/useRecorder'
import Markdown, { assetUrl } from './Markdown'
import { useToast } from '../toast'

interface Props {
  id: string
  settings: AppSettings
  recordingId: string | null
  setRecordingId: (id: string | null) => void
  onMetaChanged: () => void
  onDelete: () => void
}

/** Strip Whisper noise artifacts like [BLANK_AUDIO], (keyboard clacking), ♪ etc. */
function cleanTranscript(text: string): string {
  const cleaned = text
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/♪/g, '')
    .trim()
  return cleaned
}

export default function MeetingPage({
  id,
  settings,
  recordingId,
  setRecordingId,
  onMetaChanged,
  onDelete
}: Props) {
  const toast = useToast()
  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [pendingChunks, setPendingChunks] = useState<number[]>([])
  const [generating, setGenerating] = useState(false)
  const [sttStatus, setSttStatus] = useState<SttStatus>({ state: 'idle' })
  const [dragOver, setDragOver] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const queueRef = useRef(Promise.resolve())
  const pidRef = useRef(1)
  const dragDepth = useRef(0)

  const isRecording = recordingId === id

  useEffect(() => {
    window.api.getMeeting(id).then((m) => {
      setMeeting(m)
      setTitle(m.title)
    })
  }, [id])

  useEffect(() => {
    return window.api.onSttStatus(setSttStatus)
  }, [])

  // Keep the timeline pinned to the bottom while recording
  useEffect(() => {
    if (isRecording && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [meeting?.timeline.length, pendingChunks.length, isRecording])

  const recorder = useRecorder({
    onSpeechChunk: (audio, startSec) => {
      const pid = pidRef.current++
      setPendingChunks((p) => [...p, pid])
      queueRef.current = queueRef.current.then(async () => {
        try {
          const text = cleanTranscript(await window.api.transcribe(audio))
          if (text) {
            const m = await window.api.appendEntry(id, {
              kind: 'transcript',
              timeSec: Math.round(startSec),
              content: text
            })
            setMeeting(m)
          }
        } catch (err) {
          toast.show(`Transcription failed: ${err instanceof Error ? err.message : err}`, true)
        } finally {
          setPendingChunks((p) => p.filter((x) => x !== pid))
        }
      })
    },
    onRecordingChunk: (data) => window.api.appendRecordingChunk(id, data)
  })

  const startRecording = useCallback(async () => {
    if (recordingId && recordingId !== id) {
      toast.show('Another meeting is already recording', true)
      return
    }
    try {
      await window.api.startRecordingFile(id)
      window.api.prepareStt().catch((err) => {
        toast.show(`Speech model failed to load: ${err.message ?? err}`, true)
      })
      await recorder.start()
      setRecordingId(id)
    } catch (err) {
      toast.show(`Could not start recording: ${err instanceof Error ? err.message : err}`, true)
    }
  }, [id, recordingId, recorder, setRecordingId, toast])

  const generateNotes = useCallback(async () => {
    setGenerating(true)
    try {
      const m = await window.api.generateNotes(id)
      setMeeting(m)
      onMetaChanged()
      toast.show('Meeting notes generated')
    } catch (err) {
      toast.show(`${err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : err}`, true)
    } finally {
      setGenerating(false)
    }
  }, [id, onMetaChanged, toast])

  const stopRecording = useCallback(async () => {
    const duration = await recorder.stop()
    setRecordingId(null)
    const m = await window.api.setStatus(id, 'recorded', duration)
    setMeeting({ ...m, hasRecording: true })
    onMetaChanged()
    // Wait for in-flight transcription chunks before summarizing
    await queueRef.current
    const fresh = await window.api.getMeeting(id)
    setMeeting(fresh)
    if (fresh.timeline.some((e) => e.kind !== 'image' && e.content.trim())) {
      await generateNotes()
    }
  }, [id, recorder, setRecordingId, onMetaChanged, generateNotes])

  const sendNote = useCallback(async () => {
    const content = note.trim()
    if (!content || !meeting) return
    setNote('')
    const entry: TimelineEntry = {
      kind: 'note',
      timeSec: isRecording ? recorder.elapsedSec : meeting.durationSec,
      content
    }
    const m = await window.api.appendEntry(id, entry)
    setMeeting(m)
  }, [note, meeting, id, isRecording, recorder.elapsedSec])

  const saveImageFile = useCallback(
    async (file: File | Blob, nameHint?: string) => {
      if (!meeting) return
      const ext =
        (nameHint?.split('.').pop() || file.type.split('/')[1] || 'png').toLowerCase()
      const data = new Uint8Array(await file.arrayBuffer())
      const m = await window.api.saveImage(
        id,
        data,
        ext,
        isRecording ? recorder.elapsedSec : meeting.durationSec
      )
      setMeeting(m)
    },
    [meeting, id, isRecording, recorder.elapsedSec]
  )

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      for (const item of e.clipboardData.items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            e.preventDefault()
            saveImageFile(file)
            return
          }
        }
      }
    },
    [saveImageFile]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      dragDepth.current = 0
      setDragOver(false)
      for (const file of Array.from(e.dataTransfer.files)) {
        if (file.type.startsWith('image/')) saveImageFile(file, file.name)
      }
    },
    [saveImageFile]
  )

  const saveTitle = useCallback(async () => {
    if (!meeting || title.trim() === meeting.title) return
    const m = await window.api.setTitle(id, title.trim() || 'Untitled')
    setMeeting(m)
    setTitle(m.title)
    onMetaChanged()
  }, [id, title, meeting, onMetaChanged])

  const updateEntry = useCallback(
    async (index: number, content: string) => {
      const m = content.trim()
        ? await window.api.updateEntry(id, index, content.trim())
        : await window.api.deleteEntry(id, index)
      setMeeting(m)
    },
    [id]
  )

  const setSummary = useCallback(
    async (summary: string) => {
      const m = await window.api.setSummary(id, summary)
      setMeeting(m)
    },
    [id]
  )

  const createdLabel = useMemo(() => {
    if (!meeting) return ''
    return new Date(meeting.createdAt).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    })
  }, [meeting])

  if (!meeting) return null

  const sttPill = (() => {
    if (!isRecording && sttStatus.state !== 'loading-model') return null
    switch (sttStatus.state) {
      case 'loading-model':
        return <span className="stt-pill">{sttStatus.message ?? 'Loading model…'}</span>
      case 'transcribing':
        return <span className="stt-pill">Transcribing…</span>
      case 'ready':
        return <span className="stt-pill">Listening — speech will appear below</span>
      case 'error':
        return <span className="stt-pill error">STT error: {sttStatus.message}</span>
      default:
        return null
    }
  })()

  return (
    <div
      className="meeting-page"
      onDragEnter={(e) => {
        e.preventDefault()
        if (e.dataTransfer.types.includes('Files')) {
          dragDepth.current++
          setDragOver(true)
        }
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragOver(false)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {dragOver && <div className="drop-overlay">Drop image to add it to the meeting</div>}

      <div className="meeting-header">
        <input
          className="meeting-title-input"
          value={title}
          placeholder="Untitled meeting"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <div className="meeting-meta-row">
          <span>{createdLabel}</span>
          {meeting.durationSec > 0 && <span>{fmtClock(meeting.durationSec)}</span>}
          <button className="link-btn" onClick={() => window.api.openFolder(id)}>
            Open folder
          </button>
          <button className="link-btn" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>

      <div className="meeting-scroll" ref={scrollRef}>
        <div className="meeting-scroll-inner">
          {(meeting.summary || generating || (meeting.status !== 'new' && !isRecording)) && (
            <div className="summary-card">
              <div className="summary-card-header">
                <span>AI meeting notes</span>
                <span className="spacer" />
                {!generating && meeting.timeline.length > 0 && (
                  <button className="secondary-btn" onClick={generateNotes}>
                    {meeting.summary ? 'Regenerate' : 'Generate'}
                  </button>
                )}
              </div>
              {generating ? (
                <div className="generating">
                  <div className="spinner" /> Generating meeting notes and action points…
                </div>
              ) : meeting.summary ? (
                <Markdown source={meeting.summary} meetingId={id} onSourceChange={setSummary} />
              ) : (
                <div className="generating">No notes yet.</div>
              )}
            </div>
          )}

          {meeting.hasRecording && !isRecording && (
            <audio
              className="audio-player"
              controls
              src={assetUrl(id, 'recording.webm') + `#${meeting.durationSec}`}
            />
          )}

          <div className="timeline">
            {meeting.timeline.length > 0 && <div className="timeline-divider">Timeline</div>}
            {meeting.timeline.map((entry, i) => (
              <Bubble
                key={`${i}-${entry.timeSec}-${entry.kind}`}
                entry={entry}
                meetingId={id}
                onSave={(content) => updateEntry(i, content)}
                onDelete={() => updateEntry(i, '')}
              />
            ))}
            {pendingChunks.map((pid) => (
              <div className="bubble-row transcript" key={`pending-${pid}`}>
                <div className="bubble bubble-pending">
                  <div className="generating" style={{ padding: 0 }}>
                    <div className="spinner" /> Transcribing…
                  </div>
                </div>
              </div>
            ))}
            {meeting.timeline.length === 0 && pendingChunks.length === 0 && !isRecording && (
              <div className="empty-state" style={{ padding: '40px 0' }}>
                <p>
                  Hit <strong>Start recording</strong> below — the transcript will appear here live,
                  and you can type notes or paste screenshots at any time.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="composer-area">
        <div className="composer-inner">
          <div className="rec-bar">
            {!isRecording ? (
              <>
                <button className="rec-btn start" onClick={startRecording}>
                  ● Start recording
                </button>
                <select
                  value={recorder.deviceId}
                  onChange={(e) => recorder.setDeviceId(e.target.value)}
                  title="Microphone"
                >
                  {recorder.devices.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `Microphone ${i + 1}`}
                    </option>
                  ))}
                  {recorder.devices.length === 0 && <option value="">Default microphone</option>}
                </select>
                <span style={{ fontSize: 12 }}>
                  STT:{' '}
                  {settings.sttEngine === 'local'
                    ? `local Whisper (${settings.whisperModel})`
                    : settings.sttEngine === 'openrouter'
                      ? `OpenRouter (${settings.openrouterSttModel})`
                      : 'OpenAI cloud'}
                </span>
              </>
            ) : (
              <>
                <button className="rec-btn" onClick={stopRecording}>
                  ■ Stop
                </button>
                <span className="rec-indicator">
                  <span className="dot rec" /> {fmtClock(recorder.elapsedSec)}
                </span>
                <div className="level-meter">
                  <div style={{ width: `${Math.min(100, recorder.level * 100)}%` }} />
                </div>
              </>
            )}
            {sttPill}
          </div>

          <div className="composer">
            <textarea
              rows={1}
              placeholder="Type a note… (paste or drop images too)"
              value={note}
              onChange={(e) => {
                setNote(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = `${Math.min(140, e.target.scrollHeight)}px`
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendNote()
                }
              }}
              onPaste={handlePaste}
            />
            <button className="send-btn" onClick={sendNote} disabled={!note.trim()}>
              Add note
            </button>
          </div>
          <div className="composer-hint">
            Enter to add · Shift+Enter for a new line · Markdown supported · Ctrl+V pastes screenshots
          </div>
        </div>
      </div>
    </div>
  )
}

function Bubble({
  entry,
  meetingId,
  onSave,
  onDelete
}: {
  entry: TimelineEntry
  meetingId: string
  onSave: (content: string) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(entry.content)

  const commit = () => {
    setEditing(false)
    if (draft.trim() !== entry.content) onSave(draft)
  }

  return (
    <div className={`bubble-row ${entry.kind}`}>
      {editing ? (
        <textarea
          className="bubble-edit"
          value={draft}
          autoFocus
          rows={Math.min(8, draft.split('\n').length + 1)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              commit()
            }
            if (e.key === 'Escape') {
              setDraft(entry.content)
              setEditing(false)
            }
          }}
        />
      ) : (
        <div className="bubble">
          <Markdown source={entry.content} meetingId={meetingId} />
        </div>
      )}
      <div className="bubble-meta">
        <span>
          {entry.kind === 'transcript' ? 'Transcript' : entry.kind === 'note' ? 'Note' : 'Image'} ·{' '}
          {fmtClock(entry.timeSec)}
        </span>
        {entry.kind !== 'image' && (
          <button
            onClick={() => {
              setDraft(entry.content)
              setEditing(true)
            }}
          >
            Edit
          </button>
        )}
        <button onClick={onDelete}>Delete</button>
      </div>
    </div>
  )
}
