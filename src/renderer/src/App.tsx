import { useCallback, useEffect, useState } from 'react'
import type { AppSettings, MeetingMeta } from '../../shared/types'
import { DEFAULT_DOT_COLORS } from '../../shared/colors'
import Sidebar from './components/Sidebar'
import ActionsPage from './components/ActionsPage'
import MeetingPage from './components/MeetingPage'
import SettingsPage from './components/SettingsPage'
import Icon from './components/Icons'
import { ToastContext, useToastState } from './toast'

type View =
  | { kind: 'meeting'; id: string; jumpTimeSec?: number }
  | { kind: 'actions' }
  | { kind: 'settings' }
  | { kind: 'empty' }

export default function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [meetings, setMeetings] = useState<MeetingMeta[]>([])
  const [view, setView] = useState<View>({ kind: 'empty' })
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [openActionCount, setOpenActionCount] = useState(0)
  const toast = useToastState()

  const refreshMeetings = useCallback(async () => {
    setMeetings(await window.api.listMeetings())
  }, [])

  const refreshActionCount = useCallback(async () => {
    try {
      setOpenActionCount(await window.api.countOpenActionItems())
    } catch {
      setOpenActionCount(0)
    }
  }, [])

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshMeetings(), refreshActionCount()])
  }, [refreshMeetings, refreshActionCount])

  useEffect(() => {
    window.api.getSettings().then(setSettings)
    void refreshAll()
  }, [refreshAll])

  // Theme: apply preference, follow OS when set to "system"
  useEffect(() => {
    if (!settings) return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && mql.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    mql.addEventListener('change', apply)
    return () => mql.removeEventListener('change', apply)
  }, [settings])

  // Custom status dot colors
  useEffect(() => {
    if (!settings) return
    const dots = settings.dotColors ?? DEFAULT_DOT_COLORS
    const root = document.documentElement.style
    root.setProperty('--dot-new', dots.new)
    root.setProperty('--dot-recorded', dots.recorded)
    root.setProperty('--dot-summarized', dots.summarized)
    root.setProperty('--dot-rec', dots.rec)
    root.setProperty('--rec', dots.rec)
  }, [settings])

  const createMeeting = useCallback(async () => {
    const meta = await window.api.createMeeting()
    await refreshAll()
    setView({ kind: 'meeting', id: meta.id })
  }, [refreshAll])

  const deleteMeeting = useCallback(
    async (id: string) => {
      if (recordingId === id) {
        toast.show('Stop the recording before deleting this meeting', true)
        return
      }
      await window.api.deleteMeeting(id)
      await refreshAll()
      setView((v) => {
        if (v.kind === 'meeting' && v.id === id) return { kind: 'empty' }
        return v
      })
    },
    [recordingId, refreshAll, toast]
  )

  const openMeeting = useCallback((id: string, jumpTimeSec?: number) => {
    setView({ kind: 'meeting', id, jumpTimeSec })
  }, [])

  if (!settings) return null

  return (
    <ToastContext.Provider value={toast}>
      <div className="app">
        <Sidebar
          meetings={meetings}
          activeId={view.kind === 'meeting' ? view.id : null}
          actionsActive={view.kind === 'actions'}
          openActionCount={openActionCount}
          recordingId={recordingId}
          settingsActive={view.kind === 'settings'}
          tagCategories={settings.tagCategories ?? []}
          onSelect={(id) => setView({ kind: 'meeting', id })}
          onActions={() => setView({ kind: 'actions' })}
          onNew={createMeeting}
          onSettings={() => setView({ kind: 'settings' })}
        />
        <div className="main-pane">
          {view.kind === 'meeting' && (
            <MeetingPage
              key={`${view.id}-${view.jumpTimeSec ?? ''}`}
              id={view.id}
              settings={settings}
              recordingId={recordingId}
              setRecordingId={setRecordingId}
              initialJumpTimeSec={view.jumpTimeSec}
              onMetaChanged={refreshAll}
              onDelete={() => deleteMeeting(view.id)}
            />
          )}
          {view.kind === 'actions' && (
            <ActionsPage
              settings={settings}
              meetings={meetings}
              onOpenMeeting={openMeeting}
              onChanged={refreshActionCount}
            />
          )}
          {view.kind === 'settings' && (
            <SettingsPage settings={settings} onChange={setSettings} />
          )}
          {view.kind === 'empty' && (
            <div className="empty-state">
              <Icon name="logo" size={40} className="empty-icon" />
              <h2>Local Transcribe</h2>
              <p>Record a meeting, watch it transcribe live, and get AI notes when you stop.</p>
              <button className="primary-btn with-icon" onClick={createMeeting}>
                <Icon name="plus" size={16} /> New meeting
              </button>
            </div>
          )}
          {toast.node}
        </div>
      </div>
    </ToastContext.Provider>
  )
}
