import type { Meeting, TimelineEntry } from './types'

const ACTION_SECTION_KEYWORDS = ['action items', 'action points', 'action item']
const OVERVIEW_SECTION_KEYWORDS = ['meeting overview', 'overview', 'summary']

type SummarySection = { title: string; body: string; order: number }

function splitSummarySections(summary: string): SummarySection[] {
  const trimmed = summary.trim()
  const re = /^### (.+)$/gm
  const matches = [...trimmed.matchAll(re)]
  if (matches.length === 0) return [{ title: '', body: trimmed, order: 0 }]

  const sections: SummarySection[] = []
  for (let i = 0; i < matches.length; i++) {
    const title = matches[i][1].trim()
    const start = (matches[i].index ?? 0) + matches[i][0].length
    const end = i + 1 < matches.length ? matches[i + 1].index! : trimmed.length
    sections.push({ title, body: trimmed.slice(start, end).trim(), order: i })
  }
  return sections
}

/** Pin Action Items first, then Meeting Overview; preserve relative order of other sections. */
function reorderSummarySections(summary: string): string {
  const trimmed = summary.trim()
  if (!trimmed) return trimmed

  const sections = splitSummarySections(trimmed)
  if (sections.length === 1 && !sections[0].title) return trimmed

  const rank = (title: string) => {
    const lower = title.toLowerCase()
    if (ACTION_SECTION_KEYWORDS.some((k) => lower.includes(k))) return 0
    if (OVERVIEW_SECTION_KEYWORDS.some((k) => lower === k || lower.startsWith(k))) return 1
    return 2
  }

  sections.sort((a, b) => {
    const dr = rank(a.title) - rank(b.title)
    return dr !== 0 ? dr : a.order - b.order
  })

  return sections.map((s) => `### ${s.title}\n\n${s.body}`).join('\n\n')
}

function isActionSection(title: string): boolean {
  const lower = title.toLowerCase()
  return ACTION_SECTION_KEYWORDS.some((k) => lower.includes(k))
}

function parseSummarySections(summary: string): SummarySection[] {
  return splitSummarySections(summary.trim())
}

function normalizeTaskKey(line: string): string {
  return line
    .replace(/^-\s*\[[ xX]\]\s*/, '')
    .replace(/\*\*[^*]+\*\*:?\s*/g, '')
    .replace(/\[.*?\]\(transcript:\d+\)/g, '')
    .replace(/[^\w\s]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function tasksSimilar(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const shorter = a.length < b.length ? a : b
  const longer = a.length < b.length ? b : a
  // Only merge near-duplicates — avoid dropping distinct tasks
  if (shorter.length >= 20 && longer.includes(shorter)) return true
  const wordsA = new Set(a.split(' ').filter((w) => w.length > 4))
  const wordsB = new Set(b.split(' ').filter((w) => w.length > 4))
  if (wordsA.size < 3 || wordsB.size < 3) return false
  let overlap = 0
  for (const w of wordsA) if (wordsB.has(w)) overlap++
  return overlap / Math.min(wordsA.size, wordsB.size) >= 0.85
}

function dedupeActionItems(body: string): string {
  const lines = body.split('\n')
  const kept: string[] = []
  const keys: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!/^-\s*\[[ xX]\]/.test(trimmed)) {
      kept.push(line)
      continue
    }
    const key = normalizeTaskKey(trimmed)
    if (keys.some((k) => tasksSimilar(k, key))) continue
    keys.push(key)
    kept.push(line)
  }
  return kept.join('\n').trim()
}

function stripCheckboxesFromSection(body: string): string {
  return body
    .replace(/^(\s*)-\s*\[[ xX]\]\s+/gm, '$1- ')
    .trim()
}

/** Reorder sections, merge duplicate action blocks, dedupe tasks, clean body sections. */
export function normalizeSummary(summary: string): string {
  let sections = parseSummarySections(reorderSummarySections(summary))

  const actionBodies: string[] = []
  const rest: typeof sections = []
  for (const s of sections) {
    if (isActionSection(s.title)) actionBodies.push(s.body)
    else rest.push(s)
  }

  if (actionBodies.length > 0) {
    const merged = dedupeActionItems(actionBodies.join('\n'))
    rest.unshift({ title: 'Action Items', body: merged, order: -1 })
  }

  sections = rest.map((s, i) => ({
    ...s,
    body: isActionSection(s.title) ? dedupeActionItems(s.body) : stripCheckboxesFromSection(s.body),
    order: i
  }))

  return renumberTranscriptLinks(
    sections
      .filter((s) => s.title || s.body)
      .map((s) => (s.title ? `### ${s.title}\n\n${s.body}` : s.body))
      .join('\n\n')
      .trim()
  )
}

function fmtTime(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(sec)}`
}

function formatNoteEntry(entry: TimelineEntry): string {
  return entry.content
}

const IMAGE_RE = /^!\[[^\]]*\]\(assets\//

/** Manual notes/images only — excludes AI summary and transcripts. */
export function meetingToNotesDocument(m: Pick<Meeting, 'timeline'>): string {
  const notes = m.timeline.filter((e) => e.kind !== 'transcript')
  if (notes.length === 0) return ''
  return notes.map(formatNoteEntry).join('\n\n') + '\n'
}

/** Parse manual notes editor content into note/image timeline entries. */
export function notesDocumentToTimeline(doc: string): TimelineEntry[] {
  const text = doc.trim()
  if (!text) return []

  const timeline: TimelineEntry[] = []
  const blocks = text.split(/\n\n+/).filter((b) => b.trim())
  for (const block of blocks) {
    const trimmed = block.trim()
    if (IMAGE_RE.test(trimmed)) {
      timeline.push({ kind: 'image', timeSec: 0, content: trimmed })
    } else {
      timeline.push({ kind: 'note', timeSec: 0, content: trimmed })
    }
  }
  return timeline
}

/** Merge edited manual notes into a meeting, preserving summary and transcripts. */
export function mergeNotesIntoMeeting(
  meeting: Pick<Meeting, 'summary' | 'timeline'>,
  doc: string
): { summary: string; timeline: TimelineEntry[] } {
  const noteEntries = notesDocumentToTimeline(doc)
  const transcripts = meeting.timeline.filter((e) => e.kind === 'transcript')
  return { summary: meeting.summary, timeline: [...transcripts, ...noteEntries] }
}

export interface TranscriptLine {
  timeSec: number
  timeLabel: string
  text: string
}

export function getTranscriptLines(m: Pick<Meeting, 'timeline'>): TranscriptLine[] {
  return m.timeline
    .filter((e) => e.kind === 'transcript')
    .map((e) => ({
      timeSec: e.timeSec,
      timeLabel: fmtTime(e.timeSec),
      text: e.content
    }))
}

export function formatTranscriptPlain(m: Pick<Meeting, 'timeline'>): string {
  return getTranscriptLines(m)
    .map((l) => `[${l.timeLabel}] ${l.text}`)
    .join('\n\n')
}

/** Searchable plain text for a meeting (title excluded — caller adds that). */
export function meetingSearchText(m: Pick<Meeting, 'summary' | 'timeline'>): string {
  return [m.summary, ...m.timeline.map((e) => e.content)].filter(Boolean).join('\n')
}

/** Fake https URL prefix so BlockNote preserves transcript links (it only accepts http(s) links). */
export const TRANSCRIPT_LINK_URL_PREFIX = 'https://local-transcript.link/'

const TRANSCRIPT_LINK_RE = /\[([^\]]*)\]\(transcript:(\d+)\)/g

/** Renumber transcript link labels 1, 2, 3… in document order (replaces timestamp labels). */
export function renumberTranscriptLinks(summary: string): string {
  let n = 0
  return summary.replace(TRANSCRIPT_LINK_RE, (_m, _label, sec) => {
    n++
    return `[${n}](transcript:${sec})`
  })
}

/** Convert stored transcript links for BlockNote editor display. */
export function transcriptLinksToEditor(md: string): string {
  let n = 0
  return md.replace(TRANSCRIPT_LINK_RE, (_m, _label, sec) => {
    n++
    return `[${n}](${TRANSCRIPT_LINK_URL_PREFIX}${sec})`
  })
}

/** Convert BlockNote editor links back to stored transcript:SECONDS format. */
export function transcriptLinksToStorage(md: string): string {
  const escaped = TRANSCRIPT_LINK_URL_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const converted = md.replace(
    new RegExp(`\\[([^\\]]*)\\]\\(${escaped}(\\d+)\\)`, 'g'),
    (_m, _label, sec) => `[0](transcript:${sec})`
  )
  return renumberTranscriptLinks(converted)
}

/** Parse transcript link href from storage or editor formats. */
export function parseTranscriptLinkHref(href: string): number | null {
  const trimmed = href.trim()
  let m = trimmed.match(/^transcript:(\d+)$/)
  if (m) return Number(m[1])
  m = trimmed.match(/^https:\/\/local-transcript\.link\/(\d+)$/)
  return m ? Number(m[1]) : null
}
