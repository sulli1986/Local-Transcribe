import { BlockNoteView } from '@blocknote/mantine'
import '@blocknote/mantine/style.css'
import { SuggestionMenuController, useCreateBlockNote } from '@blocknote/react'
import '@blocknote/react/style.css'
import { autoPlacement, offset, shift } from '@floating-ui/react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { assetUrl } from './Markdown'
import SlashPillMenu, { getSlashPillItems } from './SlashPillMenu'

export interface MeetingEditorHandle {
  appendMarkdown: (markdown: string) => void
  getMarkdown: () => string
  insertImage: (path: string) => void
}

interface Props {
  value: string
  /** Increment to reload editor content from `value` without disturbing normal typing. */
  syncKey: number
  meetingId: string
  onChange: (next: string) => void
  onSaveImage: (file: File | Blob, nameHint?: string) => Promise<string | null>
  placeholder?: string
  disabled?: boolean
  /** Transform markdown before loading into the editor (e.g. transcript links). */
  prepareMarkdown?: (md: string) => string
  /** Transform markdown when exporting from the editor. */
  serializeMarkdown?: (md: string) => string
}

function toEditorMarkdown(md: string, meetingId: string): string {
  return md.replace(/\]\((assets\/[^)]+)\)/g, (_, rel: string) => `](${assetUrl(meetingId, rel)})`)
}

function toStorageMarkdown(md: string, meetingId: string): string {
  const vaultPrefix = `vault://files/${encodeURIComponent(meetingId)}/`
  const escaped = vaultPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return md.replace(new RegExp(`\\]\\(${escaped}([^)]+)\\)`, 'g'), ']($1)')
}

function useAppTheme(): 'light' | 'dark' {
  const read = () =>
    typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark'
      ? 'dark'
      : 'light'
  const [theme, setTheme] = useState<'light' | 'dark'>(read)
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return theme
}

const MeetingEditor = forwardRef<MeetingEditorHandle, Props>(function MeetingEditor(
  {
    value,
    syncKey,
    meetingId,
    onChange,
    onSaveImage,
    placeholder,
    disabled,
    prepareMarkdown,
    serializeMarkdown
  },
  ref
) {
  const suppressChange = useRef(false)
  const meetingIdRef = useRef(meetingId)
  const onSaveImageRef = useRef(onSaveImage)
  const containerRef = useRef<HTMLDivElement>(null)
  meetingIdRef.current = meetingId
  onSaveImageRef.current = onSaveImage

  const editor = useCreateBlockNote({
    uploadFile: async (file) => {
      const path = await onSaveImageRef.current(file)
      if (!path) throw new Error('Could not save image')
      return assetUrl(meetingIdRef.current, path)
    },
    placeholders: {
      default: placeholder ?? 'Write your meeting notes…',
      emptyDocument:
        placeholder ??
        'Write your meeting notes, or type / for headings, lists, tasks, quotes, and more.'
    }
  })

  const prepareRef = useRef(prepareMarkdown)
  const serializeRef = useRef(serializeMarkdown)
  prepareRef.current = prepareMarkdown
  serializeRef.current = serializeMarkdown

  const loadMarkdown = (markdown: string) => {
    suppressChange.current = true
    const prepared = toEditorMarkdown(
      prepareRef.current ? prepareRef.current(markdown) : markdown,
      meetingIdRef.current
    )
    const blocks = editor.tryParseMarkdownToBlocks(prepared)
    editor.replaceBlocks(
      editor.document,
      blocks.length > 0 ? blocks : [{ type: 'paragraph' }]
    )
    suppressChange.current = false
  }

  const insertImage = (path: string) => {
    const url = assetUrl(meetingIdRef.current, path)
    const cursor = editor.getTextCursorPosition()
    editor.insertBlocks([{ type: 'image', props: { url } }], cursor.block, 'after')
  }

  useImperativeHandle(ref, () => ({
    appendMarkdown(markdown: string) {
      const blocks = editor.tryParseMarkdownToBlocks(
        toEditorMarkdown(markdown, meetingIdRef.current)
      )
      const last = editor.document[editor.document.length - 1]
      editor.insertBlocks(blocks, last, 'after')
    },
    getMarkdown() {
      const raw = toStorageMarkdown(editor.blocksToMarkdownLossy(), meetingIdRef.current)
      return serializeRef.current ? serializeRef.current(raw) : raw
    },
    insertImage
  }))

  useEffect(() => {
    loadMarkdown(value)
  }, [syncKey, meetingId])

  // Clipboard image paste fallback
  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    const onPaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (!file) continue
          e.preventDefault()
          e.stopPropagation()
          const path = await onSaveImageRef.current(file)
          if (path) insertImage(path)
          return
        }
      }
    }
    root.addEventListener('paste', onPaste, true)
    return () => root.removeEventListener('paste', onPaste, true)
  }, [editor])

  const theme = useAppTheme()

  const getItems = useCallback(
    (query: string) => Promise.resolve(getSlashPillItems(editor, query)),
    [editor]
  )

  return (
    <div className="meeting-editor" ref={containerRef}>
      <BlockNoteView
        editor={editor}
        theme={theme}
        editable={!disabled}
        slashMenu={false}
        formattingToolbar
        sideMenu
        linkToolbar
        filePanel
        portalElements={{ default: document.body }}
        onChange={() => {
          if (suppressChange.current) return
          const raw = toStorageMarkdown(editor.blocksToMarkdownLossy(), meetingIdRef.current)
          onChange(serializeRef.current ? serializeRef.current(raw) : raw)
        }}
      >
        <SuggestionMenuController
          triggerCharacter="/"
          suggestionMenuComponent={SlashPillMenu}
          getItems={getItems}
          portalElement={document.body}
          floatingUIOptions={{
            elementProps: {
              className: 'slash-pill-portal',
              style: { zIndex: 2000, overflow: 'visible', maxHeight: 'none' }
            },
            useFloatingOptions: {
              placement: 'bottom-start',
              middleware: [
                offset(6),
                autoPlacement({ allowedPlacements: ['bottom-start', 'top-start'], padding: 8 }),
                shift({ padding: 8 })
              ]
            }
          }}
        />
      </BlockNoteView>
      <div className="meeting-editor-hint">
        Type <kbd>/</kbd> for the block picker — hover icons for names and commands
      </div>
    </div>
  )
})

export default MeetingEditor
