import { useEffect, useRef, type Ref } from 'react'
import {
  parseTranscriptLinkHref,
  transcriptLinksToEditor,
  transcriptLinksToStorage
} from '../../../shared/document'
import MeetingEditor, { type MeetingEditorHandle } from './MeetingEditor'

interface Props {
  meetingId: string
  value: string
  syncKey: number
  query: string
  onChange: (next: string) => void
  onSaveImage: (file: File | Blob, nameHint?: string) => Promise<string | null>
  onTranscriptLink: (timeSec: number) => void
  disabled?: boolean
  editorRef?: Ref<MeetingEditorHandle>
  showEmptyHint?: boolean
}

/** Summary tab — BlockNote editor with numbered transcript reference links. */
export default function SummaryPanel({
  meetingId,
  value,
  syncKey,
  query,
  onChange,
  onSaveImage,
  onTranscriptLink,
  disabled,
  editorRef,
  showEmptyHint
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const q = query.trim().toLowerCase()
  const matchesSearch = !q || value.toLowerCase().includes(q)

  useEffect(() => {
    const root = wrapRef.current
    if (!root) return

    const handleLink = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest('a')
      if (!anchor || !root.contains(anchor)) return
      const sec = parseTranscriptLinkHref(anchor.getAttribute('href') ?? '')
      if (sec === null) return
      e.preventDefault()
      e.stopPropagation()
      onTranscriptLink(sec)
    }

    root.addEventListener('mousedown', handleLink, true)
    root.addEventListener('click', handleLink, true)
    return () => {
      root.removeEventListener('mousedown', handleLink, true)
      root.removeEventListener('click', handleLink, true)
    }
  }, [onTranscriptLink])

  return (
    <>
      {q && (
        <p className={`search-match-banner${matchesSearch ? ' hit' : ''}`}>
          {matchesSearch
            ? `Found "${query}" in summary`
            : `No matches for "${query}" in summary`}
        </p>
      )}
      <div className="summary-editor-wrap" ref={wrapRef}>
        <MeetingEditor
          ref={editorRef}
          value={value}
          syncKey={syncKey}
          meetingId={meetingId}
          onChange={onChange}
          onSaveImage={onSaveImage}
          disabled={disabled}
          prepareMarkdown={transcriptLinksToEditor}
          serializeMarkdown={transcriptLinksToStorage}
          placeholder="AI meeting summary — type / for headings, lists, and tasks…"
        />
      </div>
      {showEmptyHint && (
        <div className="empty-state" style={{ padding: '20px 0 0' }}>
          <p>
            Generate a summary from the transcript, or start writing here — type{' '}
            <strong>/</strong> for headings, lists, and tasks.
          </p>
        </div>
      )}
    </>
  )
}
