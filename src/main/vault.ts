import { promises as fs, existsSync } from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { shell } from 'electron'
import type { Meeting, MeetingMeta, MeetingStatus, SearchResult, TimelineEntry, TimelineEntryKind, ActionItem, StoredActionItem, ActionsFile } from '../shared/types'
import { meetingSearchText } from '../shared/document'
import {
  mergeImportedItems,
  parseActionItemsFromSummary,
  syncSummaryActionSection,
  doneFromStatus
} from '../shared/actions'

const MEETING_FILE = 'meeting.md'
const ACTIONS_FILE = 'actions.json'
const RECORDING_FILE = 'recording.webm'
const ASSETS_DIR = 'assets'

function fmtTime(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(sec)}`
}

function parseTime(t: string): number {
  const parts = t.split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return 0
}

const KIND_LABEL: Record<TimelineEntryKind, string> = {
  transcript: 'Transcript',
  note: 'Note',
  image: 'Image'
}

function labelToKind(label: string): TimelineEntryKind | null {
  const l = label.toLowerCase()
  if (l === 'transcript') return 'transcript'
  if (l === 'note') return 'note'
  if (l === 'image') return 'image'
  return null
}

function sanitizeName(name: string): string {
  return name.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '').trim() || 'Untitled'
}

export class Vault {
  constructor(public root: string) {}

  private dir(id: string): string {
    // Prevent escaping the vault via crafted ids
    const p = path.join(this.root, id)
    if (!p.startsWith(this.root)) throw new Error('Invalid meeting id')
    return p
  }

  private mdPath(id: string): string {
    return path.join(this.dir(id), MEETING_FILE)
  }

  private actionsPath(id: string): string {
    return path.join(this.dir(id), ACTIONS_FILE)
  }

  recordingPath(id: string): string {
    return path.join(this.dir(id), RECORDING_FILE)
  }

  assetPath(id: string, rel: string): string {
    return path.join(this.dir(id), rel)
  }

  async ensureRoot(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true })
  }

  async listMeetings(): Promise<MeetingMeta[]> {
    await this.ensureRoot()
    const entries = await fs.readdir(this.root, { withFileTypes: true })
    const metas: MeetingMeta[] = []
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const md = path.join(this.root, e.name, MEETING_FILE)
      if (!existsSync(md)) continue
      try {
        const raw = await fs.readFile(md, 'utf-8')
        const fm = matter(raw).data
        metas.push({
          id: e.name,
          title: String(fm.title ?? e.name),
          createdAt: String(fm.createdAt ?? new Date(0).toISOString()),
          durationSec: Number(fm.durationSec ?? 0),
          status: (fm.status as MeetingStatus) ?? 'new',
          tags: parseTags(fm.tags)
        })
      } catch {
        // Skip unreadable folders rather than failing the whole list
      }
    }
    metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return metas
  }

  async createMeeting(title?: string): Promise<MeetingMeta> {
    await this.ensureRoot()
    const now = new Date()
    const dateStr = now.toISOString().slice(0, 10)
    const name = sanitizeName(title || 'New Meeting')
    let folder = `${dateStr} ${name}`
    let i = 2
    while (existsSync(path.join(this.root, folder))) {
      folder = `${dateStr} ${name} ${i++}`
    }
    const dir = path.join(this.root, folder)
    await fs.mkdir(path.join(dir, ASSETS_DIR), { recursive: true })
    const meta: MeetingMeta = {
      id: folder,
      title: name,
      createdAt: now.toISOString(),
      durationSec: 0,
      status: 'new',
      tags: []
    }
    const meeting: Meeting = {
      ...meta,
      summary: '',
      timeline: [],
      recordingFile: RECORDING_FILE,
      hasRecording: false
    }
    await this.write(folder, meeting, '', [])
    return meta
  }

  async getMeeting(id: string): Promise<Meeting> {
    const raw = await fs.readFile(this.mdPath(id), 'utf-8')
    const { data: fm, content } = matter(raw)
    const { summary, timeline } = parseBody(content)
    const recordingFile = String(fm.recordingFile ?? RECORDING_FILE)
    const recPath = path.join(this.dir(id), recordingFile)
    return {
      id,
      title: String(fm.title ?? id),
      createdAt: String(fm.createdAt ?? new Date(0).toISOString()),
      durationSec: Number(fm.durationSec ?? 0),
      status: (fm.status as MeetingStatus) ?? 'new',
      tags: parseTags(fm.tags),
      summary,
      timeline,
      recordingFile,
      hasRecording: existsSync(recPath)
    }
  }

  async deleteMeeting(id: string): Promise<void> {
    await shell.trashItem(this.dir(id))
  }

  private async write(id: string, m: Meeting, summary: string, timeline: TimelineEntry[]): Promise<void> {
    const lines: string[] = []
    if (summary.trim()) {
      lines.push('## Summary', '', summary.trim(), '')
    }
    lines.push('## Timeline', '')
    for (const t of timeline) {
      lines.push(`### [${fmtTime(t.timeSec)}] ${KIND_LABEL[t.kind]}`, '', t.content.trim(), '')
    }
    const body = lines.join('\n')
    const fm: Record<string, unknown> = {
      title: m.title,
      createdAt: m.createdAt,
      durationSec: m.durationSec,
      status: m.status
    }
    if (m.tags && m.tags.length > 0) fm.tags = m.tags
    if (m.recordingFile && m.recordingFile !== RECORDING_FILE) fm.recordingFile = m.recordingFile
    const md = matter.stringify(body, fm)
    await fs.writeFile(this.mdPath(id), md, 'utf-8')
  }

  private async mutate(
    id: string,
    fn: (m: Meeting) => void | Promise<void>
  ): Promise<Meeting> {
    const m = await this.getMeeting(id)
    await fn(m)
    await this.write(id, m, m.summary, m.timeline)
    return m
  }

  async setTags(id: string, tags: string[]): Promise<Meeting> {
    return this.mutate(id, (m) => {
      m.tags = tags.map((t) => t.trim()).filter(Boolean).slice(0, 12)
    })
  }

  async importRecording(id: string, srcPath: string): Promise<Meeting> {
    const ext = path.extname(srcPath).replace(/^\./, '').toLowerCase() || 'audio'
    const dest = ext === 'webm' ? RECORDING_FILE : `recording.${ext.replace(/[^a-z0-9]/gi, '')}`
    const data = await fs.readFile(srcPath)
    await this.clearAllRecordings(id)
    await fs.writeFile(path.join(this.dir(id), dest), data)
    return this.mutate(id, (m) => {
      m.recordingFile = dest
      m.timeline = m.timeline.filter((e) => e.kind !== 'transcript')
      m.status = 'new'
    })
  }

  meetingMdPath(id: string): string {
    return this.mdPath(id)
  }

  async setTitle(id: string, title: string): Promise<Meeting> {
    return this.mutate(id, (m) => {
      m.title = sanitizeName(title)
    })
  }

  async setStatus(id: string, status: MeetingStatus, durationSec?: number): Promise<Meeting> {
    return this.mutate(id, (m) => {
      m.status = status
      if (durationSec !== undefined) m.durationSec = durationSec
    })
  }

  async appendEntry(id: string, entry: TimelineEntry): Promise<Meeting> {
    return this.mutate(id, (m) => {
      m.timeline.push(entry)
    })
  }

  async setSummary(id: string, summary: string, markSummarized = false): Promise<Meeting> {
    return this.mutate(id, (m) => {
      m.summary = summary
      if (markSummarized) m.status = 'summarized'
    })
  }

  async setBody(id: string, summary: string, timeline: TimelineEntry[]): Promise<Meeting> {
    return this.mutate(id, (m) => {
      m.summary = summary
      m.timeline = timeline
    })
  }

  async saveImageAsset(id: string, data: Uint8Array, ext: string): Promise<string> {
    const safeExt = ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png'
    const file = `img-${Date.now()}.${safeExt}`
    const assetsDir = path.join(this.dir(id), ASSETS_DIR)
    await fs.mkdir(assetsDir, { recursive: true })
    await fs.writeFile(path.join(assetsDir, file), data)
    return `${ASSETS_DIR}/${file}`
  }

  async startRecording(id: string): Promise<void> {
    await this.clearAllRecordings(id)
    await this.mutate(id, (m) => {
      m.recordingFile = RECORDING_FILE
    })
  }

  async appendRecordingChunk(id: string, chunk: Uint8Array): Promise<void> {
    const m = await this.getMeeting(id)
    const file = m.recordingFile || RECORDING_FILE
    await fs.appendFile(path.join(this.dir(id), file), chunk)
  }

  private async clearAllRecordings(id: string): Promise<void> {
    const dir = this.dir(id)
    const entries = await fs.readdir(dir)
    for (const name of entries) {
      if (name === RECORDING_FILE || name.startsWith('recording.')) {
        await fs.rm(path.join(dir, name))
      }
    }
  }

  async searchMeetings(query: string): Promise<SearchResult[]> {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const metas = await this.listMeetings()
    const results: SearchResult[] = []
    for (const meta of metas) {
      try {
        const m = await this.getMeeting(meta.id)
        const tags = m.tags ?? []
        const haystack = `${m.title}\n${tags.join(' ')}\n${meetingSearchText(m)}`.toLowerCase()
        const idx = haystack.indexOf(q)
        if (idx < 0) continue
        results.push({
          id: meta.id,
          title: meta.title,
          createdAt: meta.createdAt,
          snippet: makeSnippet(`${m.title}\n${tags.join(' ')}\n${meetingSearchText(m)}`, q)
        })
      } catch {
        // skip unreadable meetings
      }
    }
    return results
  }

  private async readActionsFile(id: string): Promise<StoredActionItem[]> {
    const p = this.actionsPath(id)
    if (!existsSync(p)) return []
    try {
      const raw = JSON.parse(await fs.readFile(p, 'utf-8')) as ActionsFile
      if (raw.version !== 1 || !Array.isArray(raw.items)) return []
      return raw.items
    } catch {
      return []
    }
  }

  private async writeActionsFile(id: string, items: StoredActionItem[]): Promise<void> {
    const file: ActionsFile = { version: 1, items }
    await fs.writeFile(this.actionsPath(id), JSON.stringify(file, null, 2), 'utf-8')
  }

  /** Lazy-migrate from summary checkboxes if actions.json is missing. */
  private async ensureActionItems(id: string, meeting?: Meeting): Promise<StoredActionItem[]> {
    let items = await this.readActionsFile(id)
    if (items.length > 0) return items

    const m = meeting ?? (await this.getMeeting(id))
    if (!m.summary.trim()) return []

    items = parseActionItemsFromSummary(m.summary, 'ai')
    if (items.length > 0) await this.writeActionsFile(id, items)
    return items
  }

  private async syncSummaryFromActions(id: string, items: StoredActionItem[]): Promise<void> {
    const m = await this.getMeeting(id)
    const summary = syncSummaryActionSection(m.summary, items)
    await this.mutate(id, (meeting) => {
      meeting.summary = summary
    })
  }

  async getActionItems(id: string): Promise<StoredActionItem[]> {
    return this.ensureActionItems(id)
  }

  async importActionItemsFromSummary(id: string): Promise<StoredActionItem[]> {
    const m = await this.getMeeting(id)
    const imported = parseActionItemsFromSummary(m.summary, 'ai')
    const existing = await this.readActionsFile(id)
    const merged =
      existing.length > 0 ? mergeImportedItems(existing, imported) : imported
    await this.writeActionsFile(id, merged)
    return merged
  }

  async listAllActionItems(): Promise<ActionItem[]> {
    const metas = await this.listMeetings()
    const all: ActionItem[] = []
    for (const meta of metas) {
      try {
        const m = await this.getMeeting(meta.id)
        const items = await this.ensureActionItems(meta.id, m)
        for (const item of items) {
          all.push({
            ...item,
            meetingId: meta.id,
            meetingTitle: m.title,
            meetingTags: m.tags ?? []
          })
        }
      } catch {
        // skip unreadable meetings
      }
    }
    return all
  }

  async updateActionItem(id: string, item: StoredActionItem): Promise<ActionItem> {
    const items = await this.ensureActionItems(id)
    const idx = items.findIndex((i) => i.id === item.id)
    if (idx < 0) throw new Error('Action item not found')

    const updated: StoredActionItem = {
      ...item,
      done: doneFromStatus(item.status),
      status: item.done && item.status !== 'done' ? 'done' : item.status,
      updatedAt: new Date().toISOString()
    }
    if (updated.done) updated.status = 'done'

    items[idx] = updated
    await this.writeActionsFile(id, items)
    await this.syncSummaryFromActions(id, items)

    const m = await this.getMeeting(id)
    return { ...updated, meetingId: id, meetingTitle: m.title, meetingTags: m.tags ?? [] }
  }

  async createActionItem(
    id: string,
    partial: Pick<StoredActionItem, 'text'> & Partial<StoredActionItem>
  ): Promise<ActionItem> {
    const ts = new Date().toISOString()
    const item: StoredActionItem = {
      id: partial.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      text: partial.text,
      owner: partial.owner,
      status: partial.status ?? 'todo',
      done: partial.done ?? false,
      notes: partial.notes ?? '',
      transcriptSec: partial.transcriptSec,
      createdAt: ts,
      updatedAt: ts,
      source: partial.source ?? 'manual'
    }
    if (item.done) item.status = 'done'

    const items = await this.ensureActionItems(id)
    items.push(item)
    await this.writeActionsFile(id, items)
    await this.syncSummaryFromActions(id, items)

    const m = await this.getMeeting(id)
    return { ...item, meetingId: id, meetingTitle: m.title, meetingTags: m.tags ?? [] }
  }

  async deleteActionItem(id: string, itemId: string): Promise<void> {
    const items = await this.ensureActionItems(id)
    const next = items.filter((i) => i.id !== itemId)
    if (next.length === items.length) throw new Error('Action item not found')
    await this.writeActionsFile(id, next)
    await this.syncSummaryFromActions(id, next)
  }

  async countOpenActionItems(): Promise<number> {
    const all = await this.listAllActionItems()
    return all.filter((i) => !i.done && i.status !== 'done').length
  }
}

function parseTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map(String).map((t) => t.trim()).filter(Boolean)
}

function parseBody(content: string): { summary: string; timeline: TimelineEntry[] } {
  const timelineIdx = content.indexOf('## Timeline')
  let summarySection = timelineIdx >= 0 ? content.slice(0, timelineIdx) : content
  const timelineSection = timelineIdx >= 0 ? content.slice(timelineIdx + '## Timeline'.length) : ''

  let summary = summarySection.replace(/^\s*## Summary\s*/m, '').trim()

  const timeline: TimelineEntry[] = []
  const re = /^### \[(\d{1,2}:\d{2}(?::\d{2})?)\] (\w+)\s*$/gm
  const matches = [...timelineSection.matchAll(re)]
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    const kind = labelToKind(m[2])
    if (!kind) continue
    const start = (m.index ?? 0) + m[0].length
    const end = i + 1 < matches.length ? matches[i + 1].index : timelineSection.length
    timeline.push({
      kind,
      timeSec: parseTime(m[1]),
      content: timelineSection.slice(start, end).trim()
    })
  }
  return { summary, timeline }
}

function makeSnippet(text: string, query: string, radius = 60): string {
  const lower = text.toLowerCase()
  const idx = lower.indexOf(query.toLowerCase())
  if (idx < 0) return text.slice(0, radius * 2).trim()
  const start = Math.max(0, idx - radius)
  const end = Math.min(text.length, idx + query.length + radius)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return prefix + text.slice(start, end).replace(/\s+/g, ' ').trim() + suffix
}
