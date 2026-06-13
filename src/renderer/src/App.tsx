import { useCallback, useEffect, useState } from 'react'
import type { AppSettings, MeetingMeta } from '../../shared/types'
import Sidebar from './components/Sidebar'
import MeetingPage from './components/MeetingPage'
import SettingsPage from './components/SettingsPage'
import { ToastContext, useToastState } from './toast'

type View = { kind: 'meeting'; id: string } | { kind: 'settings' } | { kind: 'empty' }

export default function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [meetings, setMeetings] = useState<MeetingMeta[]>([])
  const [view, setView] = useState<View>({ kind: 'empty' })
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const toast = useToastState()

  const refreshMeetings = useCallback(async () => {
    setMeetings(await window.api.listMeetings())
  }, [])

  useEffect(() => {
    window.api.getSettings().then(setSettings)
    refreshMeetings()
  }, [refreshMeetings])

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

  const createMeeting = useCallback(async () => {
    const meta = await window.api.createMeeting()
    await refreshMeetings()
    setView({ kind: 'meeting', id: meta.id })
  }, [refreshMeetings])

  const deleteMeeting = useCallback(
    async (id: string) => {
      if (recordingId === id) {
        toast.show('Stop the recording before deleting this meeting', true)
        return
      }
      await window.api.deleteMeeting(id)
      await refreshMeetings()
      setView((v) => (v.kind === 'meeting' && v.id === id ? { kind: 'empty' } : v))
    },
    [recordingId, refreshMeetings, toast]
  )

  if (!settings) return null

  return (
    <ToastContext.Provider value={toast}>
      <div className="app">
        <Sidebar
          meetings={meetings}
          activeId={view.kind === 'meeting' ? view.id : null}
          recordingId={recordingId}
          settingsActive={view.kind === 'settings'}
          onSelect={(id) => setView({ kind: 'meeting', id })}
          onNew={createMeeting}
          onSettings={() => setView({ kind: 'settings' })}
        />
        <div className="main-pane">
          {view.kind === 'meeting' && (
            <MeetingPage
              key={view.id}
              id={view.id}
              settings={settings}
              recordingId={recordingId}
              setRecordingId={setRecordingId}
              onMetaChanged={refreshMeetings}
              onDelete={() => deleteMeeting(view.id)}
            />
          )}
          {view.kind === 'settings' && (
            <SettingsPage settings={settings} onChange={setSettings} />
          )}
          {view.kind === 'empty' && (
            <div className="empty-state">
              <h2>Local Transcribe</h2>
              <p>Record a meeting, watch it transcribe live, and get AI notes when you stop.</p>
              <button className="primary-btn" onClick={createMeeting}>
                + New meeting
              </button>
            </div>
          )}
          {toast.node}
        </div>
      </div>
    </ToastContext.Provider>
  )
}
