import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppSettings, Meeting, SttStatus } from '../../../shared/types'
import {
  formatTranscriptPlain,
  getTranscriptLines,
  meetingToNotesDocument,
  mergeNotesIntoMeeting,
  normalizeSummary
} from '../../../shared/document'
import { tagStylePlain } from '../../../shared/colors'
import { useRecorder, fmtClock } from '../hooks/useRecorder'
import { assetUrl } from '../utils/assetUrl'
import MeetingEditor, { type MeetingEditorHandle } from './MeetingEditor'
import SummaryPanel from './SummaryPanel'
import TranscriptPanel from './TranscriptPanel'
import Icon from './Icons'
import { useToast } from '../toast'
import { transcribeAudioFromUrl } from '../utils/transcribeAudioFile'

interface Props {
  id: string
  settings: AppSettings
  recordingId: string | null
  setRecordingId: (id: string | null) => void
  onMetaChanged: () => void
  onDelete: () => void
}

type Tab = 'summary' | 'notes' | 'transcript'

/** Strip Whisper noise artifacts like [BLANK_AUDIO], (keyboard clacking), ♪ etc. */
function cleanTranscript(text: string): string {
  const cleaned = text
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/♪/g, '')
    .trim()
  return cleaned
}

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
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
  const [docText, setDocText] = useState('')
  const [syncKey, setSyncKey] = useState(0)
  const [summaryText, setSummaryText] = useState('')
  const [summarySyncKey, setSummarySyncKey] = useState(0)
  const [tab, setTab] = useState<Tab>('notes')
  const [searchQuery, setSearchQuery] = useState('')
  const [pendingChunks, setPendingChunks] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(
    null
  )
  const [sttStatus, setSttStatus] = useState<SttStatus>({ state: 'idle' })
  const [dragOver, setDragOver] = useState(false)
  const [tagDraft, setTagDraft] = useState('')
  const [audioTimeSec, setAudioTimeSec] = useState<number | undefined>()
  const [jumpTimeSec, setJumpTimeSec] = useState<number | undefined>()

  const queueRef = useRef(Promise.resolve())
  const pidRef = useRef(1)
  const dragDepth = useRef(0)
  const dirtyRef = useRef(false)
  const summaryDirtyRef = useRef(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const summarySaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const docTextRef = useRef(docText)
  const summaryTextRef = useRef(summaryText)
  const meetingRef = useRef(meeting)
  docTextRef.current = docText
  summaryTextRef.current = summaryText
  meetingRef.current = meeting
  const editorRef = useRef<MeetingEditorHandle>(null)
  const summaryEditorRef = useRef<MeetingEditorHandle>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  const isRecording = recordingId === id

  const loadDocument = useCallback((m: Meeting, reloadNotes = true, reloadSummary = true) => {
    setMeeting(m)
    setDocText(meetingToNotesDocument(m))
    setSummaryText(m.summary)
    dirtyRef.current = false
    summaryDirtyRef.current = false
    if (reloadNotes) setSyncKey((k) => k + 1)
    if (reloadSummary) setSummarySyncKey((k) => k + 1)
  }, [])

  useEffect(() => {
    window.api.getMeeting(id).then((m) => {
      loadDocument(m)
      setTitle(m.title)
      setTab(m.summary.trim() ? 'summary' : 'notes')
      setSearchQuery('')
      setTagDraft('')
    })
  }, [id, loadDocument])

  useEffect(() => {
    return window.api.onSttStatus(setSttStatus)
  }, [])

  const saveDocument = useCallback(
    async (text: string) => {
      const current = meetingRef.current
      if (!current) return
      const { summary, timeline } = mergeNotesIntoMeeting(current, text)
      const m = await window.api.setBody(id, summary, timeline)
      setMeeting(m)
      dirtyRef.current = false
      onMetaChanged()
    },
    [id, onMetaChanged]
  )

  const scheduleSave = useCallback(
    (text: string) => {
      dirtyRef.current = true
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        saveDocument(text).catch((err) =>
          toast.show(`Could not save: ${err instanceof Error ? err.message : err}`, true)
        )
      }, 500)
    },
    [saveDocument, toast]
  )

  const handleDocChange = useCallback(
    (next: string) => {
      setDocText(next)
      scheduleSave(next)
    },
    [scheduleSave]
  )

  const saveSummaryNow = useCallback(
    async (text: string) => {
      const m = await window.api.setSummary(id, text)
      setMeeting(m)
      summaryDirtyRef.current = false
      onMetaChanged()
    },
    [id, onMetaChanged]
  )

  const scheduleSummarySave = useCallback(
    (text: string) => {
      summaryDirtyRef.current = true
      if (summarySaveTimerRef.current) clearTimeout(summarySaveTimerRef.current)
      summarySaveTimerRef.current = setTimeout(() => {
        saveSummaryNow(text).catch((err) =>
          toast.show(`Could not save summary: ${err instanceof Error ? err.message : err}`, true)
        )
      }, 500)
    },
    [saveSummaryNow, toast]
  )

  const handleSummaryChange = useCallback(
    (next: string) => {
      setSummaryText(next)
      scheduleSummarySave(next)
    },
    [scheduleSummarySave]
  )

  const persistMic = useCallback(
    (micId: string) => {
      window.api.updateSettings({ preferredMicId: micId }).catch(() => {})
    },
    []
  )

  const recorder = useRecorder(
    {
      onSpeechChunk: (audio, startSec) => {
        const pid = pidRef.current++
        setPendingChunks((p) => p + 1)
        queueRef.current = queueRef.current.then(async () => {
          try {
            const text = cleanTranscript(await window.api.transcribe(audio))
            if (text) {
              const m = await window.api.appendEntry(id, {
                kind: 'transcript',
                timeSec: Math.round(startSec),
                content: text
              })
              loadDocument(m, !dirtyRef.current, !summaryDirtyRef.current)
            }
          } catch (err) {
            toast.show(`Transcription failed: ${err instanceof Error ? err.message : err}`, true)
          } finally {
            setPendingChunks((p) => p - 1)
          }
        })
      },
      onRecordingChunk: (data) => window.api.appendRecordingChunk(id, data)
    },
    { preferredMicId: settings.preferredMicId }
  )

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
      setTab('transcript')
    } catch (err) {
      toast.show(`Could not start recording: ${err instanceof Error ? err.message : err}`, true)
    }
  }, [id, recordingId, recorder, setRecordingId, toast])

  const generateNotes = useCallback(async () => {
    setGenerating(true)
    try {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (summarySaveTimerRef.current) clearTimeout(summarySaveTimerRef.current)
      const current = editorRef.current?.getMarkdown() ?? docTextRef.current
      await saveDocument(current)
      const currentSummary = summaryEditorRef.current?.getMarkdown() ?? summaryTextRef.current
      await saveSummaryNow(currentSummary)
      const m = await window.api.generateNotes(id)
      setMeeting(m)
      setSummaryText(m.summary)
      setSummarySyncKey((k) => k + 1)
      setTab('summary')
      onMetaChanged()
      toast.show('Summary generated')
    } catch (err) {
      toast.show(`${err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : err}`, true)
    } finally {
      setGenerating(false)
    }
  }, [id, onMetaChanged, saveDocument, saveSummaryNow, toast])

  const stopRecording = useCallback(async () => {
    const duration = await recorder.stop()
    setRecordingId(null)
    const m = await window.api.setStatus(id, 'recorded', duration)
    setMeeting({ ...m, hasRecording: true })
    onMetaChanged()
    await queueRef.current
    const fresh = await window.api.getMeeting(id)
    loadDocument(fresh, !dirtyRef.current, !summaryDirtyRef.current)
    const hasContent =
      fresh.timeline.some((e) => e.kind === 'transcript') ||
      fresh.timeline.some((e) => e.kind === 'note' && e.content.trim())
    if (settings.autoGenerateNotes && hasContent) {
      await generateNotes()
    } else if (meetingRef.current?.summary.trim()) {
      setTab('summary')
    }
  }, [id, recorder, setRecordingId, onMetaChanged, generateNotes, loadDocument, settings.autoGenerateNotes])

  const importAudio = useCallback(async () => {
    if (isRecording) return
    setImporting(true)
    setImportProgress(null)
    try {
      const m = await window.api.pickImportAudio(id)
      if (!m) return
      loadDocument(m, !dirtyRef.current, !summaryDirtyRef.current)
      onMetaChanged()
      setTab('transcript')
      window.api.prepareStt().catch(() => {})
      const url = assetUrl(id, m.recordingFile)
      const duration = await transcribeAudioFromUrl(
        url,
        (audio) => window.api.transcribe(audio),
        async (text, startSec) => {
          const cleaned = cleanTranscript(text)
          if (!cleaned) return
          const updated = await window.api.appendEntry(id, {
            kind: 'transcript',
            timeSec: startSec,
            content: cleaned
          })
          loadDocument(updated, !dirtyRef.current, !summaryDirtyRef.current)
        },
        setImportProgress
      )
      const updated = await window.api.setStatus(id, 'recorded', duration)
      setMeeting({ ...updated, hasRecording: true })
      onMetaChanged()
      toast.show('Audio imported and transcribed')
      if (settings.autoGenerateNotes) {
        await generateNotes()
      }
    } catch (err) {
      toast.show(`Import failed: ${err instanceof Error ? err.message : err}`, true)
    } finally {
      setImporting(false)
      setImportProgress(null)
    }
  }, [
    id,
    isRecording,
    loadDocument,
    onMetaChanged,
    settings.autoGenerateNotes,
    generateNotes,
    toast
  ])

  const saveImageFile = useCallback(
    async (file: File | Blob, nameHint?: string): Promise<string | null> => {
      const ext = (nameHint?.split('.').pop() || file.type.split('/')[1] || 'png').toLowerCase()
      const data = new Uint8Array(await file.arrayBuffer())
      try {
        return await window.api.saveImageAsset(id, data, ext)
      } catch (err) {
        toast.show(`Could not save image: ${err instanceof Error ? err.message : err}`, true)
        return null
      }
    },
    [id, toast]
  )

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      if (tab !== 'notes' && tab !== 'summary') return
      e.preventDefault()
      dragDepth.current = 0
      setDragOver(false)
      const activeEditor = tab === 'summary' ? summaryEditorRef : editorRef
      const onChange = tab === 'summary' ? handleSummaryChange : handleDocChange
      const textRef = tab === 'summary' ? summaryTextRef : docTextRef
      for (const file of Array.from(e.dataTransfer.files)) {
        if (file.type.startsWith('image/')) {
          const path = await saveImageFile(file, file.name)
          if (path) {
            activeEditor.current?.insertImage(path)
            const next = activeEditor.current?.getMarkdown() ?? textRef.current
            onChange(next)
          }
        }
      }
    },
    [saveImageFile, handleDocChange, handleSummaryChange, tab]
  )

  const saveTitle = useCallback(async () => {
    if (!meeting || title.trim() === meeting.title) return
    const m = await window.api.setTitle(id, title.trim() || 'Untitled')
    setMeeting(m)
    setTitle(m.title)
    onMetaChanged()
  }, [id, title, meeting, onMetaChanged])

  const saveTags = useCallback(
    async (tags: string[]) => {
      const m = await window.api.setTags(id, tags)
      setMeeting(m)
      onMetaChanged()
    },
    [id, onMetaChanged]
  )

  const addTag = useCallback(() => {
    const next = tagDraft.trim().replace(/^#/, '')
    if (!next || !meeting) return
    const tags = [...(meeting.tags ?? [])]
    if (tags.some((t) => t.toLowerCase() === next.toLowerCase())) {
      setTagDraft('')
      return
    }
    void saveTags([...tags, next])
    setTagDraft('')
  }, [tagDraft, meeting, saveTags])

  const removeTag = useCallback(
    (tag: string) => {
      if (!meeting?.tags) return
      void saveTags(meeting.tags.filter((t) => t !== tag))
    },
    [meeting, saveTags]
  )

  const seekToTime = useCallback((timeSec: number) => {
    const audio = audioRef.current
    if (audio) audio.currentTime = timeSec
  }, [])

  const seekAudio = useCallback(
    (timeSec: number) => {
      seekToTime(timeSec)
      void audioRef.current?.play().catch(() => {})
    },
    [seekToTime]
  )

  const goToTranscript = useCallback(
    (timeSec: number) => {
      setTab('transcript')
      setJumpTimeSec(timeSec)
      seekToTime(timeSec)
      window.setTimeout(() => setJumpTimeSec(undefined), 2500)
    },
    [seekToTime]
  )

  const copyTranscript = useCallback(async () => {
    if (!meeting) return
    const text = formatTranscriptPlain(meeting)
    if (!text.trim()) {
      toast.show('No transcript to copy', true)
      return
    }
    await copyText(text)
    toast.show('Transcript copied')
  }, [meeting, toast])

  const copySummary = useCallback(async () => {
    if (!meeting?.summary.trim()) {
      toast.show('No summary to copy', true)
      return
    }
    await copyText(normalizeSummary(meeting.summary))
    toast.show('Summary copied')
  }, [meeting, toast])


  const tagCategoryNames = useMemo(
    () => settings.tagCategories?.map((c) => c.name) ?? [],
    [settings.tagCategories]
  )

  const copyNotes = useCallback(async () => {
    const text = docTextRef.current.trim()
    if (!text) {
      toast.show('No notes to copy', true)
      return
    }
    await copyText(text)
    toast.show('Notes copied')
  }, [toast])

  const exportMeeting = useCallback(async () => {
    const path = await window.api.exportMeeting(id)
    if (path) toast.show(`Exported to ${path}`)
  }, [id, toast])

  const transcriptLines = useMemo(
    () => (meeting ? getTranscriptLines(meeting) : []),
    [meeting]
  )

  const transcriptCount = transcriptLines.length

  const notesSearchHaystack = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q || tab !== 'notes') return true
    return docText.toLowerCase().includes(q)
  }, [docText, searchQuery, tab])

  const createdLabel = useMemo(() => {
    if (!meeting) return ''
    return new Date(meeting.createdAt).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    })
  }, [meeting])

  if (!meeting) return null

  const sttPill = (() => {
    if (!isRecording && !importing && sttStatus.state !== 'loading-model') return null
    switch (sttStatus.state) {
      case 'loading-model':
        return <span className="stt-pill">{sttStatus.message ?? 'Loading model…'}</span>
      case 'transcribing':
        return <span className="stt-pill">Transcribing…</span>
      case 'ready':
        return <span className="stt-pill">Listening — transcript updating live</span>
      case 'error':
        return <span className="stt-pill error">STT error: {sttStatus.message}</span>
      default:
        return null
    }
  })()

  const hasNotes = docText.trim().length > 0
  const hasSummary = Boolean(summaryText.trim() || meeting.summary.trim())
  const canSeek = meeting.hasRecording && !isRecording
  const canGenerate =
    transcriptCount > 0 ||
    meeting.timeline.some((e) => e.kind === 'note' && e.content.trim())

  return (
    <div
      className="meeting-page"
      onDragEnter={(e) => {
        if (tab !== 'notes' && tab !== 'summary') return
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
      onDragOver={(e) => (tab === 'notes' || tab === 'summary') && e.preventDefault()}
      onDrop={handleDrop}
    >
      {dragOver && (tab === 'notes' || tab === 'summary') && (
        <div className="drop-overlay">
          Drop image to insert into your {tab === 'summary' ? 'summary' : 'notes'}
        </div>
      )}

      <div className="meeting-header">
        <input
          className="meeting-title-input"
          value={title}
          placeholder="Untitled meeting"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <div className="meeting-tags-row">
          {(meeting.tags ?? []).map((tag) => {
            const style = tagStylePlain(tag, settings.tagCategories ?? [])
            return (
              <span
                key={tag}
                className="meeting-tag"
                style={{
                  color: style.color,
                  background: style.background,
                  borderColor: style.borderColor
                }}
              >
                <span className="tag-dot" style={{ background: style.color }} />
                {tag}
                <button
                  type="button"
                  className="tag-remove"
                  onClick={() => removeTag(tag)}
                  aria-label={`Remove ${tag}`}
                >
                  ×
                </button>
              </span>
            )
          })}
          <Icon name="tag" size={14} className="tag-input-icon" />
          <input
            className="tag-input"
            placeholder="Add tag…"
            list="tag-category-suggestions"
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addTag()
              }
            }}
            onBlur={addTag}
          />
          <datalist id="tag-category-suggestions">
            {tagCategoryNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
        <div className="meeting-meta-row">
          <span>{createdLabel}</span>
          {meeting.durationSec > 0 && <span>{fmtClock(meeting.durationSec)}</span>}
          <button className="link-btn with-icon" onClick={() => window.api.openFolder(id)}>
            <Icon name="folder" size={14} /> Open folder
          </button>
          <button className="link-btn with-icon danger-link" onClick={onDelete}>
            <Icon name="trash" size={14} /> Delete
          </button>
        </div>
      </div>

      <div className="meeting-scroll">
        <div className="meeting-scroll-inner">
          <div className="meeting-tabs-row">
            <div className="meeting-tabs">
              <button
                type="button"
                className={`meeting-tab${tab === 'summary' ? ' active' : ''}`}
                onClick={() => setTab('summary')}
              >
                <Icon name="summary" size={15} /> Summary
                {hasSummary && <span className="tab-badge">✓</span>}
              </button>
              <button
                type="button"
                className={`meeting-tab${tab === 'notes' ? ' active' : ''}`}
                onClick={() => setTab('notes')}
              >
                <Icon name="notes" size={15} /> Notes
              </button>
              <button
                type="button"
                className={`meeting-tab${tab === 'transcript' ? ' active' : ''}`}
                onClick={() => setTab('transcript')}
              >
                <Icon name="transcript" size={15} /> Transcript
                {transcriptCount > 0 && <span className="tab-badge">{transcriptCount}</span>}
                {isRecording && <span className="tab-rec-dot" />}
              </button>
            </div>
            <div className="meeting-actions">
              {tab === 'summary' && hasSummary && (
                <button
                  type="button"
                  className="secondary-btn with-icon"
                  onClick={copySummary}
                  title="Copy summary"
                >
                  <Icon name="copy" size={14} /> Copy
                </button>
              )}
              {tab === 'transcript' && transcriptCount > 0 && (
                <button
                  type="button"
                  className="secondary-btn with-icon"
                  onClick={copyTranscript}
                  title="Copy transcript"
                >
                  <Icon name="copy" size={14} /> Copy
                </button>
              )}
              {tab === 'notes' && hasNotes && (
                <button
                  type="button"
                  className="secondary-btn with-icon"
                  onClick={copyNotes}
                  title="Copy notes"
                >
                  <Icon name="copy" size={14} /> Copy
                </button>
              )}
              <button
                type="button"
                className="secondary-btn with-icon"
                onClick={exportMeeting}
                title="Export meeting as markdown"
              >
                <Icon name="download" size={14} /> Export
              </button>
              {generating ? (
                <span className="generating-inline">
                  <span className="spinner" /> Generating…
                </span>
              ) : (
                canGenerate && (
                  <button
                    className="secondary-btn with-icon"
                    onClick={generateNotes}
                    title={hasSummary ? 'Regenerate summary' : 'Generate summary'}
                  >
                    <Icon name="sparkles" size={14} />
                    {hasSummary ? 'Regenerate' : 'Generate'}
                  </button>
                )
              )}
            </div>
          </div>

          <div className="meeting-search">
            <input
              type="search"
              placeholder={
                tab === 'summary'
                  ? 'Search summary…'
                  : tab === 'notes'
                    ? 'Search notes…'
                    : 'Search transcript…'
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {meeting.hasRecording && !isRecording && (
            <audio
              ref={audioRef}
              className="audio-player"
              controls
              src={assetUrl(id, meeting.recordingFile)}
              onTimeUpdate={(e) => setAudioTimeSec(e.currentTarget.currentTime)}
            />
          )}

          {importing && importProgress && (
            <div className="transcribing-banner">
              <span className="spinner" /> Transcribing import ({importProgress.done}/
              {importProgress.total})…
            </div>
          )}

          {tab === 'summary' ? (
            <SummaryPanel
              meetingId={id}
              value={summaryText}
              syncKey={summarySyncKey}
              query={searchQuery}
              onChange={handleSummaryChange}
              onSaveImage={saveImageFile}
              onTranscriptLink={goToTranscript}
              disabled={generating}
              editorRef={summaryEditorRef}
              showEmptyHint={!hasSummary && !isRecording && !generating}
            />
          ) : tab === 'notes' ? (
            <>
              {searchQuery.trim() && (
                <p className={`search-match-banner${notesSearchHaystack ? ' hit' : ''}`}>
                  {notesSearchHaystack
                    ? `Found "${searchQuery}" in notes`
                    : `No matches for "${searchQuery}" in notes`}
                </p>
              )}
              <MeetingEditor
                ref={editorRef}
                value={docText}
                syncKey={syncKey}
                meetingId={id}
                onChange={handleDocChange}
                onSaveImage={saveImageFile}
                disabled={generating}
                placeholder="Your manual notes during the meeting…"
              />
              {!hasNotes && !isRecording && (
                <div className="empty-state" style={{ padding: '20px 0 0' }}>
                  <p>
                    Jot down your own notes here during the meeting — type <strong>/</strong>{' '}
                    for headings, lists, and tasks. Paste images directly. The AI summary lives
                    on the <strong>Summary</strong> tab.
                  </p>
                </div>
              )}
            </>
          ) : (
            <TranscriptPanel
              lines={transcriptLines}
              query={searchQuery}
              pendingChunks={pendingChunks}
              isRecording={isRecording}
              activeTimeSec={canSeek ? audioTimeSec : undefined}
              jumpTimeSec={jumpTimeSec}
              onSeek={canSeek ? seekAudio : undefined}
            />
          )}
        </div>
      </div>

      <div className="composer-area">
        <div className="composer-inner">
          <div className="rec-bar">
            {!isRecording ? (
              <>
                <button className="rec-btn start with-icon" onClick={startRecording} disabled={importing}>
                  <Icon name="mic" size={14} /> Start recording
                </button>
                <button
                  className="secondary-btn with-icon"
                  onClick={importAudio}
                  disabled={importing}
                  title="Import an audio file and transcribe it"
                >
                  <Icon name="upload" size={14} />
                  {importing ? 'Importing…' : 'Import audio'}
                </button>
                <select
                  value={recorder.deviceId}
                  onChange={(e) => {
                    recorder.setDeviceId(e.target.value)
                    persistMic(e.target.value)
                  }}
                  title="Microphone"
                >
                  {recorder.devices.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `Microphone ${i + 1}`}
                    </option>
                  ))}
                  {recorder.devices.length === 0 && <option value="">Default microphone</option>}
                </select>
                <button
                  type="button"
                  className="icon-btn mic-refresh"
                  title="Refresh microphone list"
                  onClick={() => recorder.refreshDevices()}
                >
                  <Icon name="refresh" size={14} />
                </button>
                {recorder.devices.length === 0 && (
                  <span className="mic-hint">No mics listed — grant permission or click refresh</span>
                )}
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
                {recorder.paused ? (
                  <button className="rec-btn start with-icon" onClick={recorder.resume}>
                    <Icon name="play" size={14} /> Resume
                  </button>
                ) : (
                  <button className="secondary-btn with-icon" onClick={recorder.pause}>
                    <Icon name="pause" size={14} /> Pause
                  </button>
                )}
                <button className="rec-btn with-icon" onClick={stopRecording}>
                  <Icon name="stop" size={14} /> Stop
                </button>
                <span className="rec-indicator">
                  <span className={`dot ${recorder.paused ? '' : 'rec'}`} />{' '}
                  {recorder.paused ? 'Paused' : fmtClock(recorder.elapsedSec)}
                </span>
                {!recorder.paused && (
                  <div className="level-meter">
                    <div style={{ width: `${Math.min(100, recorder.level * 100)}%` }} />
                  </div>
                )}
              </>
            )}
            {sttPill}
          </div>
        </div>
      </div>
    </div>
  )
}
