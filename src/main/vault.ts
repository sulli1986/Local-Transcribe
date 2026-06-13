import { promises as fs, existsSync } from 'fs'
import path from 'path'
import matter from 'gray-matter'
import { shell } from 'electron'
import type { Meeting, MeetingMeta, MeetingStatus, TimelineEntry, TimelineEntryKind } from '../shared/types'

const MEETING_FILE = 'meeting.md'
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
          status: (fm.status as MeetingStatus) ?? 'new'
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
      status: 'new'
    }
    await this.write(folder, meta, '', [])
    return meta
  }

  async getMeeting(id: string): Promise<Meeting> {
    const raw = await fs.readFile(this.mdPath(id), 'utf-8')
    const { data: fm, content } = matter(raw)
    const { summary, timeline } = parseBody(content)
    return {
      id,
      title: String(fm.title ?? id),
      createdAt: String(fm.createdAt ?? new Date(0).toISOString()),
      durationSec: Number(fm.durationSec ?? 0),
      status: (fm.status as MeetingStatus) ?? 'new',
      summary,
      timeline,
      hasRecording: existsSync(this.recordingPath(id))
    }
  }

  async deleteMeeting(id: string): Promise<void> {
    await shell.trashItem(this.dir(id))
  }

  private async write(id: string, meta: MeetingMeta, summary: string, timeline: TimelineEntry[]): Promise<void> {
    const lines: string[] = []
    if (summary.trim()) {
      lines.push('## Summary', '', summary.trim(), '')
    }
    lines.push('## Timeline', '')
    for (const t of timeline) {
      lines.push(`### [${fmtTime(t.timeSec)}] ${KIND_LABEL[t.kind]}`, '', t.content.trim(), '')
    }
    const body = lines.join('\n')
    const md = matter.stringify(body, {
      title: meta.title,
      createdAt: meta.createdAt,
      durationSec: meta.durationSec,
      status: meta.status
    })
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

  async updateEntry(id: string, index: number, content: string): Promise<Meeting> {
    return this.mutate(id, (m) => {
      if (m.timeline[index]) m.timeline[index].content = content
    })
  }

  async deleteEntry(id: string, index: number): Promise<Meeting> {
    return this.mutate(id, (m) => {
      m.timeline.splice(index, 1)
    })
  }

  async setSummary(id: string, summary: string, markSummarized = false): Promise<Meeting> {
    return this.mutate(id, (m) => {
      m.summary = summary
      if (markSummarized) m.status = 'summarized'
    })
  }

  async saveImage(id: string, data: Uint8Array, ext: string, timeSec: number): Promise<Meeting> {
    const safeExt = ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png'
    const file = `img-${Date.now()}.${safeExt}`
    const assetsDir = path.join(this.dir(id), ASSETS_DIR)
    await fs.mkdir(assetsDir, { recursive: true })
    await fs.writeFile(path.join(assetsDir, file), data)
    return this.appendEntry(id, {
      kind: 'image',
      timeSec,
      content: `![image](${ASSETS_DIR}/${file})`
    })
  }

  async appendRecordingChunk(id: string, chunk: Uint8Array): Promise<void> {
    await fs.appendFile(this.recordingPath(id), chunk)
  }

  async clearRecording(id: string): Promise<void> {
    if (existsSync(this.recordingPath(id))) await fs.rm(this.recordingPath(id))
  }
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
