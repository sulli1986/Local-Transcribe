import { useMemo, useState } from 'react'
import type { MeetingMeta } from '../../../shared/types'

interface Props {
  meetings: MeetingMeta[]
  activeId: string | null
  recordingId: string | null
  settingsActive: boolean
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

export default function Sidebar({
  meetings,
  activeId,
  recordingId,
  settingsActive,
  onSelect,
  onNew,
  onSettings
}: Props) {
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const filtered = query
      ? meetings.filter((m) => m.title.toLowerCase().includes(query.toLowerCase()))
      : meetings
    const out: { label: string; items: MeetingMeta[] }[] = []
    for (const m of filtered) {
      const label = groupLabel(m.createdAt)
      const last = out[out.length - 1]
      if (last && last.label === label) last.items.push(m)
      else out.push({ label, items: [m] })
    }
    return out
  }, [meetings, query])

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="app-name">Local Transcribe</span>
      </div>
      <div className="sidebar-search">
        <input
          placeholder="Search meetings…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <button className="new-meeting-btn" onClick={onNew}>
        <span>＋</span> New meeting
      </button>
      <div className="meeting-list">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="meeting-group-label">{g.label}</div>
            {g.items.map((m) => (
              <div
                key={m.id}
                className={`meeting-item${m.id === activeId && !settingsActive ? ' active' : ''}`}
                onClick={() => onSelect(m.id)}
              >
                <span className={`dot ${m.id === recordingId ? 'rec' : m.status}`} />
                <span className="title">{m.title}</span>
              </div>
            ))}
          </div>
        ))}
        {groups.length === 0 && (
          <div className="meeting-group-label">{query ? 'No matches' : 'No meetings yet'}</div>
        )}
      </div>
      <div className="sidebar-footer">
        <button
          className="icon-btn"
          onClick={onSettings}
          title="Settings"
          style={settingsActive ? { background: 'var(--bg-active)', color: 'var(--text)' } : undefined}
        >
          ⚙ Settings
        </button>
      </div>
    </div>
  )
}
