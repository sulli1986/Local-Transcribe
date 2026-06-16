import { parseTranscriptLinkHref } from './document'
import type { ActionStatus, StoredActionItem } from './types'

const ACTION_SECTION_KEYWORDS = ['action items', 'action points', 'action item']
const CHECKBOX_LINE = /^(\s*)-\s*\[([ xX])\]\s*(.+)$/

function isActionSection(title: string): boolean {
  const lower = title.toLowerCase()
  return ACTION_SECTION_KEYWORDS.some((k) => lower.includes(k))
}

function extractActionSectionBody(summary: string): string {
  const trimmed = summary.trim()
  if (!trimmed) return ''

  const re = /^### (.+)$/gm
  const matches = [...trimmed.matchAll(re)]
  if (matches.length === 0) return ''

  const bodies: string[] = []
  for (let i = 0; i < matches.length; i++) {
    const title = matches[i][1].trim()
    if (!isActionSection(title)) continue
    const start = (matches[i].index ?? 0) + matches[i][0].length
    const end = i + 1 < matches.length ? matches[i + 1].index! : trimmed.length
    bodies.push(trimmed.slice(start, end).trim())
  }
  return bodies.join('\n')
}

function parseOwnerAndText(rest: string): { owner?: string; text: string } {
  const ownerMatch = rest.match(/^\*\*([^*]+)\*\*:?\s*(.*)$/)
  if (ownerMatch) {
    return { owner: ownerMatch[1].trim(), text: ownerMatch[2].trim() }
  }
  return { text: rest.trim() }
}

function extractTranscriptSec(line: string): number | undefined {
  const linkMatch = line.match(/\[([^\]]*)\]\(([^)]+)\)/)
  if (!linkMatch) return undefined
  const sec = parseTranscriptLinkHref(linkMatch[2])
  return sec ?? undefined
}

function stripTranscriptLinks(line: string): string {
  return line.replace(/\s*\[[^\]]*\]\([^)]+\)/g, '').trim()
}

function normalizeTaskKey(text: string, owner?: string): string {
  return `${owner ?? ''} ${text}`
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
  if (shorter.length >= 20 && longer.includes(shorter)) return true
  const wordsA = new Set(a.split(' ').filter((w) => w.length > 4))
  const wordsB = new Set(b.split(' ').filter((w) => w.length > 4))
  if (wordsA.size < 3 || wordsB.size < 3) return false
  let overlap = 0
  for (const w of wordsA) if (wordsB.has(w)) overlap++
  return overlap / Math.min(wordsA.size, wordsB.size) >= 0.85
}

function newId(): string {
  if (typeof globalThis.crypto !== 'undefined' && 'randomUUID' in globalThis.crypto) {
    return globalThis.crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Parse checkbox lines from the Action Items section of a summary. */
export function parseActionItemsFromSummary(
  summary: string,
  source: 'ai' | 'manual' = 'ai'
): StoredActionItem[] {
  const body = extractActionSectionBody(summary)
  if (!body) return []

  const items: StoredActionItem[] = []
  const ts = nowIso()

  for (const line of body.split('\n')) {
    const m = line.match(CHECKBOX_LINE)
    if (!m) continue

    const done = m[2].toLowerCase() === 'x'
    const raw = m[3].trim()
    const transcriptSec = extractTranscriptSec(raw)
    const withoutLinks = stripTranscriptLinks(raw)
    const { owner, text } = parseOwnerAndText(withoutLinks)
    if (!text) continue

    items.push({
      id: newId(),
      text,
      owner,
      status: done ? 'done' : 'todo',
      done,
      notes: '',
      transcriptSec,
      createdAt: ts,
      updatedAt: ts,
      source
    })
  }
  return items
}

/** Build the Action Items markdown body (without heading). */
export function actionItemsToSummaryBody(items: StoredActionItem[]): string {
  if (items.length === 0) return ''

  const lines = items.map((item, idx) => {
    const check = item.done || item.status === 'done' ? 'x' : ' '
    const ownerPart = item.owner ? `**${item.owner}**: ` : ''
    let line = `- [${check}] ${ownerPart}${item.text}`
    if (item.transcriptSec !== undefined) {
      line += ` [${idx + 1}](transcript:${item.transcriptSec})`
    }
    return line
  })
  return lines.join('\n')
}

/** Replace or insert the Action Items section in a full summary markdown string. */
export function syncSummaryActionSection(summary: string, items: StoredActionItem[]): string {
  const body = actionItemsToSummaryBody(items)
  const trimmed = summary.trim()

  const re = /^### (.+)$/gm
  const matches = [...trimmed.matchAll(re)]

  if (matches.length === 0) {
    if (!body) return trimmed
    return `### Action Items\n\n${body}${trimmed ? `\n\n${trimmed}` : ''}`
  }

  let actionIdx = -1
  let actionEnd = trimmed.length
  for (let i = 0; i < matches.length; i++) {
    if (isActionSection(matches[i][1])) {
      actionIdx = i
      actionEnd = i + 1 < matches.length ? matches[i + 1].index! : trimmed.length
      break
    }
  }

  if (actionIdx < 0) {
    if (!body) return trimmed
    return `### Action Items\n\n${body}\n\n${trimmed}`
  }

  const sectionStart = matches[actionIdx].index!
  const before = trimmed.slice(0, sectionStart).trimEnd()
  const after = trimmed.slice(actionEnd).trim()

  if (!body) {
    const parts = [before, after].filter(Boolean)
    return parts.join('\n\n').trim()
  }

  const section = `### Action Items\n\n${body}`
  const parts = [before, section, after].filter(Boolean)
  return parts.join('\n\n').trim()
}

/** Merge AI-imported items into existing store, preserving user state on matches. */
export function mergeImportedItems(
  existing: StoredActionItem[],
  imported: StoredActionItem[]
): StoredActionItem[] {
  const result = [...existing]
  const keys = existing.map((e) => normalizeTaskKey(e.text, e.owner))

  for (const imp of imported) {
    const key = normalizeTaskKey(imp.text, imp.owner)
    const idx = keys.findIndex((k) => tasksSimilar(k, key))
    if (idx >= 0) {
      const prev = result[idx]
      result[idx] = {
        ...prev,
        text: imp.text,
        owner: imp.owner ?? prev.owner,
        transcriptSec: imp.transcriptSec ?? prev.transcriptSec,
        updatedAt: nowIso()
      }
    } else {
      result.push(imp)
      keys.push(key)
    }
  }
  return result
}

export function statusFromDone(done: boolean, status?: ActionStatus): ActionStatus {
  if (done) return 'done'
  if (status === 'in_progress') return 'in_progress'
  return status ?? 'todo'
}

export function doneFromStatus(status: ActionStatus): boolean {
  return status === 'done'
}
