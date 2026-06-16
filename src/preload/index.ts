import { contextBridge, ipcRenderer } from 'electron'
import type {
  ApiKeyProvider,
  AppSettings,
  Meeting,
  MeetingMeta,
  MeetingStatus,
  SttStatus,
  TimelineEntry,
  ActionItem,
  StoredActionItem
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
  setSummary: (id: string, summary: string): Promise<Meeting> =>
    ipcRenderer.invoke('vault:setSummary', id, summary),
  setBody: (id: string, summary: string, timeline: TimelineEntry[]): Promise<Meeting> =>
    ipcRenderer.invoke('vault:setBody', id, summary, timeline),
  saveImageAsset: (id: string, data: Uint8Array, ext: string): Promise<string> =>
    ipcRenderer.invoke('vault:saveImageAsset', id, data, ext),
  openFolder: (id: string): Promise<void> => ipcRenderer.invoke('vault:openFolder', id),
  searchMeetings: (query: string): Promise<import('../shared/types').SearchResult[]> =>
    ipcRenderer.invoke('vault:search', query),
  setTags: (id: string, tags: string[]): Promise<Meeting> =>
    ipcRenderer.invoke('vault:setTags', id, tags),
  pickImportAudio: (id: string): Promise<Meeting | null> =>
    ipcRenderer.invoke('vault:pickImportAudio', id),
  exportMeeting: (id: string): Promise<string | null> =>
    ipcRenderer.invoke('vault:exportMeeting', id),

  // Recording
  startRecordingFile: (id: string): Promise<void> => ipcRenderer.invoke('rec:start', id),
  appendRecordingChunk: (id: string, chunk: Uint8Array): Promise<void> =>
    ipcRenderer.invoke('rec:chunk', id, chunk),
  isSystemAudioSupported: (): Promise<{ supported: boolean }> =>
    ipcRenderer.invoke('recording:isSystemAudioSupported'),

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
  generateNotes: (id: string): Promise<Meeting> => ipcRenderer.invoke('notes:generate', id),

  // Action items
  listActionItems: (): Promise<ActionItem[]> => ipcRenderer.invoke('actions:list'),
  countOpenActionItems: (): Promise<number> => ipcRenderer.invoke('actions:countOpen'),
  updateActionItem: (meetingId: string, item: StoredActionItem): Promise<ActionItem> =>
    ipcRenderer.invoke('actions:update', meetingId, item),
  createActionItem: (
    meetingId: string,
    partial: Pick<StoredActionItem, 'text'> & Partial<StoredActionItem>
  ): Promise<ActionItem> => ipcRenderer.invoke('actions:create', meetingId, partial),
  deleteActionItem: (meetingId: string, itemId: string): Promise<void> =>
    ipcRenderer.invoke('actions:delete', meetingId, itemId)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
