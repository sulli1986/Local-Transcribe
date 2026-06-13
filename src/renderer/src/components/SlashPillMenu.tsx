import type { BlockNoteEditor } from '@blocknote/core'
import { filterSuggestionItems, getDefaultSlashMenuItems } from '@blocknote/core/extensions'
import {
  getDefaultReactSlashMenuItems,
  type DefaultReactSuggestionItem,
  type SuggestionMenuProps
} from '@blocknote/react'

type PillItem = DefaultReactSuggestionItem & { key: string }

/** Most-used blocks shown in the pill when `/` is typed with no filter. */
const PILL_KEYS = new Set([
  'paragraph',
  'heading',
  'heading_2',
  'heading_3',
  'bullet_list',
  'numbered_list',
  'check_list',
  'quote',
  'image',
  'divider'
])

function getPillItems(editor: BlockNoteEditor): PillItem[] {
  const core = getDefaultSlashMenuItems(editor)
  const react = getDefaultReactSlashMenuItems(editor)
  return core.map((item, i) => ({ ...react[i], key: item.key }))
}

export function getSlashPillItems(editor: BlockNoteEditor, query: string): PillItem[] {
  const all = getPillItems(editor)
  const filtered = filterSuggestionItems(all, query)
  if (!query.trim()) {
    return filtered.filter((item) => PILL_KEYS.has(item.key))
  }
  return filtered
}

function commandLabel(item: PillItem): string {
  const alias = item.aliases?.[0]
  if (alias) return `/${alias}`
  return `/${item.key.replace(/_/g, '-')}`
}

export default function SlashPillMenu(props: SuggestionMenuProps<PillItem>) {
  const { items, selectedIndex, onItemClick, loadingState } = props

  if (loadingState === 'loading-initial' || loadingState === 'loading') {
    return (
      <div className="slash-pill-menu" role="listbox">
        <span className="slash-pill-loading" />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="slash-pill-menu slash-pill-menu-empty" role="listbox">
        <span className="slash-pill-empty-label">No match</span>
      </div>
    )
  }

  return (
    <div className="slash-pill-menu" role="listbox" aria-label="Insert block">
      {items.map((item, i) => (
        <button
          key={`${item.key}-${i}`}
          type="button"
          role="option"
          aria-selected={i === selectedIndex}
          aria-label={item.title}
          className={`slash-pill-btn${i === selectedIndex ? ' selected' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onItemClick?.(item)}
        >
          <span className="slash-pill-icon">{item.icon}</span>
          <span className="slash-pill-tooltip" role="tooltip">
            <span className="slash-pill-tooltip-title">{item.title}</span>
            <span className="slash-pill-tooltip-cmd">{commandLabel(item)}</span>
          </span>
        </button>
      ))}
    </div>
  )
}
