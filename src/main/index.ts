import { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, session } from 'electron'
import path from 'path'
import { pathToFileURL } from 'url'
import { Vault } from './vault'
import { SettingsStore } from './settings'
import { SttService } from './stt'
import { generateNotes } from './summarize'
import type { TimelineEntry } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let settings: SettingsStore
let vault: Vault
let stt: SttService

protocol.registerSchemesAsPrivileged([
  { scheme: 'vault', privileges: { standard: true, supportFetchAPI: true, stream: true } }
])

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 860,
    minHeight: 560,
    title: 'Local Transcribe',
    backgroundColor: '#191919',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(() => {
  settings = new SettingsStore()
  vault = new Vault(settings.raw.vaultPath)
  stt = new SttService(settings)

  // Serve meeting assets (images, audio) to the renderer:
  // vault://files/<encoded meeting id>/<encoded relative path>
  protocol.handle('vault', (req) => {
    try {
      const url = new URL(req.url)
      const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
      const id = segments.shift()
      if (!id || segments.length === 0) return new Response('Bad request', { status: 400 })
      const filePath = vault.assetPath(id, path.join(...segments))
      if (!filePath.startsWith(vault.root)) return new Response('Forbidden', { status: 403 })
      return net.fetch(pathToFileURL(filePath).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })

  // Allow microphone access without a prompt (local app). Both handlers are
  // needed: the check handler gates enumerateDevices() labels, the request
  // handler gates getUserMedia().
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media')
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'media'
  })

  stt.onStatus((status) => {
    mainWindow?.webContents.send('stt:status', status)
  })

  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stt.dispose()
  app.quit()
})

function registerIpc(): void {
  // --- Settings ---
  ipcMain.handle('settings:get', () => settings.getPublic())
  ipcMain.handle('settings:update', async (_e, patch) => {
    const updated = await settings.update(patch)
    vault = new Vault(settings.raw.vaultPath)
    return updated
  })
  ipcMain.handle('settings:setApiKey', (_e, provider, key) => settings.setApiKey(provider, key))
  ipcMain.handle('settings:pickVault', async () => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose meetings folder'
    })
    if (res.canceled || !res.filePaths[0]) return null
    await settings.update({ vaultPath: res.filePaths[0] })
    vault = new Vault(res.filePaths[0])
    return res.filePaths[0]
  })

  // --- Vault ---
  ipcMain.handle('vault:list', () => vault.listMeetings())
  ipcMain.handle('vault:create', (_e, title?: string) => vault.createMeeting(title))
  ipcMain.handle('vault:get', (_e, id: string) => vault.getMeeting(id))
  ipcMain.handle('vault:delete', (_e, id: string) => vault.deleteMeeting(id))
  ipcMain.handle('vault:setTitle', (_e, id: string, title: string) => vault.setTitle(id, title))
  ipcMain.handle('vault:setStatus', (_e, id: string, status, durationSec?: number) =>
    vault.setStatus(id, status, durationSec)
  )
  ipcMain.handle('vault:appendEntry', (_e, id: string, entry: TimelineEntry) =>
    vault.appendEntry(id, entry)
  )
  ipcMain.handle('vault:updateEntry', (_e, id: string, index: number, content: string) =>
    vault.updateEntry(id, index, content)
  )
  ipcMain.handle('vault:deleteEntry', (_e, id: string, index: number) => vault.deleteEntry(id, index))
  ipcMain.handle('vault:setSummary', (_e, id: string, summary: string) =>
    vault.setSummary(id, summary)
  )
  ipcMain.handle('vault:setBody', (_e, id: string, summary: string, timeline: import('../shared/types').TimelineEntry[]) =>
    vault.setBody(id, summary, timeline)
  )
  ipcMain.handle('vault:saveImageAsset', (_e, id: string, data: Uint8Array, ext: string) =>
    vault.saveImageAsset(id, data, ext)
  )
  ipcMain.handle('vault:saveImage', (_e, id: string, data: Uint8Array, ext: string, timeSec: number) =>
    vault.saveImage(id, data, ext, timeSec)
  )
  ipcMain.handle('vault:openFolder', (_e, id: string) =>
    shell.openPath(vault.assetPath(id, '.'))
  )
  ipcMain.handle('vault:search', (_e, query: string) => vault.searchMeetings(query))
  ipcMain.handle('vault:setTags', (_e, id: string, tags: string[]) => vault.setTags(id, tags))
  ipcMain.handle('vault:pickImportAudio', async (_e, id: string) => {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Import audio file',
      properties: ['openFile'],
      filters: [
        {
          name: 'Audio',
          extensions: ['webm', 'wav', 'mp3', 'm4a', 'ogg', 'flac', 'aac']
        }
      ]
    })
    if (res.canceled || !res.filePaths[0]) return null
    return vault.importRecording(id, res.filePaths[0])
  })
  ipcMain.handle('vault:exportMeeting', async (_e, id: string) => {
    const m = await vault.getMeeting(id)
    const safe = m.title.replace(/[/\\:*?"<>|]/g, '').trim() || 'meeting'
    const res = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export meeting notes',
      defaultPath: `${safe}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (res.canceled || !res.filePath) return null
    const { promises: fs } = await import('fs')
    await fs.copyFile(vault.meetingMdPath(id), res.filePath)
    return res.filePath
  })

  // --- Recording ---
  ipcMain.handle('rec:start', (_e, id: string) => vault.startRecording(id))
  ipcMain.handle('rec:chunk', (_e, id: string, chunk: Uint8Array) =>
    vault.appendRecordingChunk(id, chunk)
  )

  // --- STT ---
  ipcMain.handle('stt:prepare', () => stt.prepare())
  ipcMain.handle('stt:status', () => stt.getStatus())
  ipcMain.handle('stt:transcribe', async (_e, audio: Float32Array) => {
    // Structured clone delivers a plain object view; ensure Float32Array
    const f32 = audio instanceof Float32Array ? audio : new Float32Array(Object.values(audio))
    return stt.transcribe(f32)
  })

  // --- AI notes ---
  ipcMain.handle('notes:generate', async (_e, id: string) => {
    const meeting = await vault.getMeeting(id)
    const summary = await generateNotes(settings, meeting)
    return vault.setSummary(id, summary, true)
  })
}
