import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ActionColumn, ActionItem, ActionStatus, AppSettings, MeetingMeta, StoredActionItem } from '../../../shared/types'
import { DEFAULT_ACTION_COLUMNS } from '../../../shared/colors'
import Icon from './Icons'
import { useToast } from '../toast'

type ViewMode = 'kanban' | 'list'

interface Props {
  settings: AppSettings
  meetings: MeetingMeta[]
  onOpenMeeting: (meetingId: string, transcriptSec?: number) => void
  onChanged?: () => void
}

function stripStored(item: ActionItem): StoredActionItem {
  const { meetingId: _m, meetingTitle: _t, meetingTags: _tags, ...rest } = item
  return rest
}

export default function ActionsPage({ settings, meetings, onOpenMeeting, onChanged }: Props) {
  const toast = useToast()
  const [items, setItems] = useState<ActionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('kanban')
  const [search, setSearch] = useState('')
  const [meetingFilter, setMeetingFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [showDone, setShowDone] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [addMeetingId, setAddMeetingId] = useState('')
  const [addText, setAddText] = useState('')
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const columns = settings.actionColumns?.length === 3 ? settings.actionColumns : DEFAULT_ACTION_COLUMNS

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setItems(await window.api.listActionItems())
      onChanged?.()
    } catch (err) {
      toast.show(`Could not load actions: ${err instanceof Error ? err.message : err}`, true)
    } finally {
      setLoading(false)
    }
  }, [toast, onChanged])

  useEffect(() => {
    void load()
  }, [load])

  const allTags = useMemo(() => {
    const tags = new Set<string>()
    for (const item of items) {
      for (const t of item.meetingTags ?? []) tags.add(t)
    }
    return [...tags].sort()
  }, [items])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((item) => {
      if (!showDone && (item.done || item.status === 'done')) return false
      if (meetingFilter && item.meetingId !== meetingFilter) return false
      if (tagFilter && !(item.meetingTags ?? []).includes(tagFilter)) return false
      if (!q) return true
      const hay = `${item.text} ${item.owner ?? ''} ${item.notes} ${item.meetingTitle}`.toLowerCase()
      return hay.includes(q)
    })
  }, [items, search, meetingFilter, tagFilter, showDone])

  const saveItem = useCallback(
    async (item: ActionItem) => {
      try {
        const updated = await window.api.updateActionItem(item.meetingId, stripStored(item))
        setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)))
        onChanged?.()
      } catch (err) {
        toast.show(`Could not save: ${err instanceof Error ? err.message : err}`, true)
      }
    },
    [toast, onChanged]
  )

  const setStatus = useCallback(
    (item: ActionItem, status: ActionStatus) => {
      const next = {
        ...item,
        status,
        done: status === 'done',
        updatedAt: new Date().toISOString()
      }
      void saveItem(next)
    },
    [saveItem]
  )

  const toggleDone = useCallback(
    (item: ActionItem) => {
      const done = !item.done
      void saveItem({
        ...item,
        done,
        status: done ? 'done' : item.status === 'done' ? 'todo' : item.status
      })
    },
    [saveItem]
  )

  const scheduleNotesSave = useCallback(
    (item: ActionItem, notes: string) => {
      const next = { ...item, notes }
      setItems((prev) => prev.map((i) => (i.id === item.id ? next : i)))
      if (notesTimer.current) clearTimeout(notesTimer.current)
      notesTimer.current = setTimeout(() => {
        void saveItem(next)
      }, 500)
    },
    [saveItem]
  )

  const handleDrop = useCallback(
    (status: ActionStatus, itemId: string) => {
      const item = items.find((i) => i.id === itemId)
      if (!item || item.status === status) return
      void setStatus(item, status)
      setDraggingId(null)
    },
    [items, setStatus]
  )

  const handleAddTask = useCallback(async () => {
    const meetingId = addMeetingId || meetings[0]?.id
    const text = addText.trim()
    if (!meetingId || !text) {
      toast.show('Pick a meeting and enter task text', true)
      return
    }
    try {
      const created = await window.api.createActionItem(meetingId, { text, source: 'manual' })
      setItems((prev) => [...prev, created])
      setAddText('')
      toast.show('Task added')
      onChanged?.()
    } catch (err) {
      toast.show(`Could not add task: ${err instanceof Error ? err.message : err}`, true)
    }
  }, [addMeetingId, addText, meetings, toast, onChanged])

  const handleDelete = useCallback(
    async (item: ActionItem) => {
      try {
        await window.api.deleteActionItem(item.meetingId, item.id)
        setItems((prev) => prev.filter((i) => i.id !== item.id))
        if (expandedId === item.id) setExpandedId(null)
        onChanged?.()
      } catch (err) {
        toast.show(`Could not delete: ${err instanceof Error ? err.message : err}`, true)
      }
    },
    [expandedId, toast, onChanged]
  )

  const columnColor = (col: ActionColumn) => col.color

  const renderCard = (item: ActionItem, col?: ActionColumn) => (
    <div
      key={item.id}
      className={`action-card${expandedId === item.id ? ' expanded' : ''}`}
      style={{ borderLeftColor: col ? columnColor(col) : undefined }}
      draggable
      onDragStart={() => setDraggingId(item.id)}
      onDragEnd={() => setDraggingId(null)}
    >
      <div className="action-card-main">
        {viewMode === 'list' && (
          <input
            type="checkbox"
            className="action-checkbox"
            checked={item.done || item.status === 'done'}
            onChange={() => toggleDone(item)}
          />
        )}
        <button
          type="button"
          className="action-card-body"
          onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
        >
          <span className="action-card-text">
            {item.owner && <strong>{item.owner}: </strong>}
            {item.text}
          </span>
          <span className="action-card-meta">{item.meetingTitle}</span>
        </button>
      </div>
      {expandedId === item.id && (
        <div className="action-card-detail">
          <label className="action-field-label">Status</label>
          <select
            value={item.status}
            onChange={(e) => setStatus(item, e.target.value as ActionStatus)}
          >
            {columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <label className="action-field-label">Notes</label>
          <textarea
            className="action-notes"
            value={item.notes}
            onChange={(e) => scheduleNotesSave(item, e.target.value)}
            placeholder="Add notes…"
            rows={3}
          />
          <div className="action-card-actions">
            <button
              type="button"
              className="link-btn with-icon"
              onClick={() => onOpenMeeting(item.meetingId, item.transcriptSec)}
            >
              <Icon name="transcript" size={14} /> Open meeting
            </button>
            <button
              type="button"
              className="link-btn danger-link"
              onClick={() => void handleDelete(item)}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div className="actions-page">
      <div className="actions-header">
        <h1 className="actions-title">
          <Icon name="checklist" size={22} /> Actions
        </h1>
        <div className="seg-control actions-view-toggle">
          <button
            type="button"
            className={viewMode === 'kanban' ? 'active' : ''}
            onClick={() => setViewMode('kanban')}
          >
            Kanban
          </button>
          <button
            type="button"
            className={viewMode === 'list' ? 'active' : ''}
            onClick={() => setViewMode('list')}
          >
            List
          </button>
        </div>
      </div>

      <div className="actions-toolbar">
        <input
          type="search"
          className="actions-search"
          placeholder="Search tasks…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={meetingFilter} onChange={(e) => setMeetingFilter(e.target.value)}>
          <option value="">All meetings</option>
          {meetings.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
        {allTags.length > 0 && (
          <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
            <option value="">All tags</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
        <label className="actions-show-done">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
          />
          Show done
        </label>
      </div>

      <div className="actions-add-row">
        <select
          value={addMeetingId || meetings[0]?.id || ''}
          onChange={(e) => setAddMeetingId(e.target.value)}
        >
          {meetings.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
        <input
          placeholder="New task…"
          value={addText}
          onChange={(e) => setAddText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void handleAddTask()}
        />
        <button type="button" className="secondary-btn with-icon" onClick={() => void handleAddTask()}>
          <Icon name="plus" size={14} /> Add
        </button>
      </div>

      {loading ? (
        <p className="actions-loading">
          <span className="spinner" /> Loading actions…
        </p>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <Icon name="checklist" size={36} className="empty-icon" />
          <p>No action items yet. Generate a meeting summary or add a task above.</p>
        </div>
      ) : viewMode === 'kanban' ? (
        <div className="actions-kanban">
          {columns.map((col) => {
            const colItems = filtered.filter((i) => i.status === col.id)
            return (
              <div
                key={col.id}
                className="kanban-column"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => draggingId && handleDrop(col.id, draggingId)}
              >
                <div className="kanban-column-header" style={{ borderColor: col.color }}>
                  <span className="kanban-dot" style={{ background: col.color }} />
                  {col.label}
                  <span className="kanban-count">{colItems.length}</span>
                </div>
                <div className="kanban-column-body">
                  {colItems.map((item) => renderCard(item, col))}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="actions-list">
          {filtered.map((item) => renderCard(item))}
        </div>
      )}
    </div>
  )
}
