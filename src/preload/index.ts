import { contextBridge, ipcRenderer } from 'electron'
import type {
  ApiKeyProvider,
  AppSettings,
  Meeting,
  MeetingMeta,
  MeetingStatus,
  SttStatus,
  TimelineEntry
} from '../shared/types'

const api = {
  // Settings
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:update', patch),
  setApiKey: (provider: ApiKeyProvider, key: string): Promise<void> =>
    ipcRenderer.invoke('settings:setApiKey', provider, key),
  pickVault: (): Promise<string | null> => ipcRenderer.invoke('settings:pickVault'),

  // Vault
  listMeetings: (): Promise<MeetingMeta[]> => ipcRenderer.invoke('vault:list'),
  createMeeting: (title?: string): Promise<MeetingMeta> => ipcRenderer.invoke('vault:create', title),
  getMeeting: (id: string): Promise<Meeting> => ipcRenderer.invoke('vault:get', id),
  deleteMeeting: (id: string): Promise<void> => ipcRenderer.invoke('vault:delete', id),
  setTitle: (id: string, title: string): Promise<Meeting> =>
    ipcRenderer.invoke('vault:setTitle', id, title),
  setStatus: (id: string, status: MeetingStatus, durationSec?: number): Promise<Meeting> =>
    ipcRenderer.invoke('vault:setStatus', id, status, durationSec),
  appendEntry: (id: string, entry: TimelineEntry): Promise<Meeting> =>
    ipcRenderer.invoke('vault:appendEntry', id, entry),
  updateEntry: (id: string, index: number, content: string): Promise<Meeting> =>
    ipcRenderer.invoke('vault:updateEntry', id, index, content),
  deleteEntry: (id: string, index: number): Promise<Meeting> =>
    ipcRenderer.invoke('vault:deleteEntry', id, index),
  setSummary: (id: string, summary: string): Promise<Meeting> =>
    ipcRenderer.invoke('vault:setSummary', id, summary),
  saveImage: (id: string, data: Uint8Array, ext: string, timeSec: number): Promise<Meeting> =>
    ipcRenderer.invoke('vault:saveImage', id, data, ext, timeSec),
  openFolder: (id: string): Promise<void> => ipcRenderer.invoke('vault:openFolder', id),

  // Recording
  startRecordingFile: (id: string): Promise<void> => ipcRenderer.invoke('rec:start', id),
  appendRecordingChunk: (id: string, chunk: Uint8Array): Promise<void> =>
    ipcRenderer.invoke('rec:chunk', id, chunk),

  // STT
  prepareStt: (): Promise<void> => ipcRenderer.invoke('stt:prepare'),
  getSttStatus: (): Promise<SttStatus> => ipcRenderer.invoke('stt:status'),
  transcribe: (audio: Float32Array): Promise<string> => ipcRenderer.invoke('stt:transcribe', audio),
  onSttStatus: (fn: (status: SttStatus) => void): (() => void) => {
    const handler = (_e: unknown, status: SttStatus) => fn(status)
    ipcRenderer.on('stt:status', handler)
    return () => ipcRenderer.removeListener('stt:status', handler)
  },

  // AI notes
  generateNotes: (id: string): Promise<Meeting> => ipcRenderer.invoke('notes:generate', id)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
