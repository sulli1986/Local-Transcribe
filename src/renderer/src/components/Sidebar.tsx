import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppSettings, MeetingMeta, SearchResult, TagCategory } from '../../../shared/types'
import { tagStylePlain } from '../../../shared/colors'
import Icon from './Icons'

interface Props {
  meetings: MeetingMeta[]
  activeId: string | null
  recordingId: string | null
  settingsActive: boolean
  tagCategories: TagCategory[]
  onSelect: (id: string) => void
  onNew: () => void
  onSettings: () => void
}

function groupLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / 86400000)
  if (dayDiff <= 0) return 'Today'
  if (dayDiff === 1) return 'Yesterday'
  if (dayDiff < 7) return 'This week'
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(undefined, { month: 'long' })
  }
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function HighlightSnippet({ text, query }: { text: string; query: string }) {
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

export default function Sidebar({
  meetings,
  activeId,
  recordingId,
  settingsActive,
  tagCategories,
  onSelect,
  onNew,
  onSettings
}: Props) {
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setSearchResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    const timer = setTimeout(() => {
      window.api
        .searchMeetings(q)
        .then(setSearchResults)
        .finally(() => setSearching(false))
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  const isSearching = query.trim().length > 0

  const groups = useMemo(() => {
    const filtered = isSearching
      ? searchResults.map(
          (r) =>
            meetings.find((m) => m.id === r.id) ?? {
              id: r.id,
              title: r.title,
              createdAt: r.createdAt,
              durationSec: 0,
              status: 'new' as const
            }
        )
      : meetings
    const out: { label: string; items: MeetingMeta[] }[] = []
    for (const m of filtered) {
      const label = groupLabel(m.createdAt)
      const last = out[out.length - 1]
      if (last && last.label === label) last.items.push(m)
      else out.push({ label, items: [m] })
    }
    return out
  }, [meetings, searchResults, isSearching])

  const snippetById = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of searchResults) map.set(r.id, r.snippet)
    return map
  }, [searchResults])

  const dotClass = useCallback(
    (m: MeetingMeta) => {
      if (m.id === recordingId) return 'rec'
      return m.status
    },
    [recordingId]
  )

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <Icon name="logo" size={18} className="app-logo-icon" />
        <span className="app-name">Local Transcribe</span>
      </div>
      <div className="sidebar-search">
        <Icon name="search" size={15} className="search-field-icon" />
        <input
          placeholder="Search all meetings…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {searching && (
          <span className="sidebar-search-status">
            <Icon name="refresh" size={12} className="spin" /> Searching…
          </span>
        )}
      </div>
      <button className="new-meeting-btn" onClick={onNew}>
        <Icon name="plus" size={16} /> New meeting
      </button>
      <div className="meeting-list">
        {isSearching && !searching && searchResults.length === 0 && (
          <div className="meeting-group-label">No matches in any meeting</div>
        )}
        {groups.map((g) => (
          <div key={g.label}>
            <div className="meeting-group-label">{isSearching ? 'Results' : g.label}</div>
            {g.items.map((m) => (
              <div
                key={m.id}
                className={`meeting-item${m.id === activeId && !settingsActive ? ' active' : ''}`}
                onClick={() => onSelect(m.id)}
              >
                <span className={`dot ${dotClass(m)}`} />
                <div className="meeting-item-body">
                  <span className="title">{m.title}</span>
                  {m.tags && m.tags.length > 0 && (
                    <span className="meeting-item-tags">
                      {m.tags.slice(0, 3).map((t) => {
                        const style = tagStylePlain(t, tagCategories)
                        return (
                          <span
                            key={t}
                            className="sidebar-tag"
                            style={{
                              color: style.color,
                              background: style.background,
                              border: `1px solid ${style.borderColor}`
                            }}
                          >
                            <span className="tag-dot" style={{ background: style.color }} />
                            {t}
                          </span>
                        )
                      })}
                    </span>
                  )}
                  {isSearching && snippetById.get(m.id) && (
                    <span className="snippet">
                      <HighlightSnippet text={snippetById.get(m.id)!} query={query} />
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
        {!isSearching && groups.length === 0 && (
          <div className="meeting-group-label">No meetings yet</div>
        )}
      </div>
      <div className="sidebar-footer">
        <button
          className="icon-btn with-icon"
          onClick={onSettings}
          title="Settings"
          style={settingsActive ? { background: 'var(--bg-active)', color: 'var(--text)' } : undefined}
        >
          <Icon name="settings" size={16} /> Settings
        </button>
      </div>
    </div>
  )
}
