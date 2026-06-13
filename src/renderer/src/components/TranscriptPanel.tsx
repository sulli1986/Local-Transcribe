import { useEffect, useRef } from 'react'
import type { TranscriptLine } from '../../../shared/document'

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function HighlightText({ text, query }: { text: string; query: string }) {
  const q = query.trim()
  if (!q) return <>{text}</>
  const parts = text.split(new RegExp(`(${escapeRegex(q)})`, 'gi'))
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === q.toLowerCase() ? (
          <mark key={i} className="search-hit">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  )
}

interface Props {
  lines: TranscriptLine[]
  query: string
  pendingChunks: number
  isRecording: boolean
  activeTimeSec?: number
  /** Scroll to and briefly highlight this line (e.g. from a summary link). */
  jumpTimeSec?: number
  onSeek?: (timeSec: number) => void
}

export default function TranscriptPanel({
  lines,
  query,
  pendingChunks,
  isRecording,
  activeTimeSec,
  jumpTimeSec,
  onSeek
}: Props) {
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  useEffect(() => {
    if (jumpTimeSec === undefined || lines.length === 0) return
    const closest = lines.reduce((best, line) =>
      Math.abs(line.timeSec - jumpTimeSec) < Math.abs(best.timeSec - jumpTimeSec) ? line : best
    )
    const el = lineRefs.current.get(closest.timeSec)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [jumpTimeSec, lines])

  const q = query.trim().toLowerCase()
  const filtered = q
    ? lines.filter(
        (l) => l.text.toLowerCase().includes(q) || l.timeLabel.includes(q)
      )
    : lines

  const jumpTargetSec =
    jumpTimeSec !== undefined && lines.length > 0
      ? lines.reduce((best, line) =>
          Math.abs(line.timeSec - jumpTimeSec) < Math.abs(best.timeSec - jumpTimeSec)
            ? line
            : best
        ).timeSec
      : undefined

  if (lines.length === 0 && pendingChunks === 0 && !isRecording) {
    return (
      <div className="transcript-panel empty">
        <p>No transcript yet. Start recording, import an audio file, and speech will appear here.</p>
      </div>
    )
  }

  return (
    <div className="transcript-panel">
      {pendingChunks > 0 && (
        <div className="transcribing-banner">
          <span className="spinner" /> Transcribing {pendingChunks} chunk
          {pendingChunks > 1 ? 's' : ''}…
        </div>
      )}
      {q && filtered.length === 0 && (
        <p className="search-no-results">No transcript matches for &ldquo;{query}&rdquo;</p>
      )}
      <div className="transcript-lines">
        {filtered.map((line, i) => {
          const active =
            activeTimeSec !== undefined &&
            activeTimeSec >= line.timeSec &&
            (i + 1 >= filtered.length || activeTimeSec < filtered[i + 1].timeSec)
          const jumped = jumpTargetSec !== undefined && line.timeSec === jumpTargetSec
          return (
            <div
              ref={(el) => {
                if (el) lineRefs.current.set(line.timeSec, el)
                else lineRefs.current.delete(line.timeSec)
              }}
              className={`transcript-line${active ? ' active' : ''}${jumped ? ' jumped' : ''}${onSeek ? ' seekable' : ''}`}
              key={`${line.timeSec}-${i}`}
            >
              <button
                type="button"
                className="transcript-time"
                title="Jump to this moment in the recording"
                disabled={!onSeek}
                onClick={() => onSeek?.(line.timeSec)}
              >
                <HighlightText text={line.timeLabel} query={query} />
              </button>
              <span className="transcript-text">
                <HighlightText text={line.text} query={query} />
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
