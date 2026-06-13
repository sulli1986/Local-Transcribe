import { useMemo } from 'react'
import { marked } from 'marked'

interface Props {
  source: string
  /** Meeting id, used to resolve relative asset paths to the vault:// protocol. */
  meetingId: string
  /** When provided, task-list checkboxes become clickable and report the new source. */
  onSourceChange?: (next: string) => void
}

export function assetUrl(meetingId: string, rel: string): string {
  const parts = rel.split('/').map(encodeURIComponent).join('/')
  return `vault://files/${encodeURIComponent(meetingId)}/${parts}`
}

const TASK_RE = /^(\s*[-*] \[)([ xX])(\])/gm

export default function Markdown({ source, meetingId, onSourceChange }: Props) {
  const html = useMemo(() => {
    const withAssets = source.replace(
      /\]\(assets\//g,
      `](vault://files/${encodeURIComponent(meetingId)}/assets/`
    )
    let raw = marked.parse(withAssets, { gfm: true, breaks: true, async: false })
    if (onSourceChange) {
      let i = 0
      raw = raw.replace(/<input (checked="" )?disabled="" type="checkbox">/g, (_m, checked) => {
        return `<input type="checkbox" data-task-idx="${i++}"${checked ? ' checked' : ''}>`
      })
    }
    return raw
  }, [source, meetingId, onSourceChange])

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (!onSourceChange || target.tagName !== 'INPUT') return
    const idxAttr = target.getAttribute('data-task-idx')
    if (idxAttr === null) return
    const idx = Number(idxAttr)
    let i = 0
    const next = source.replace(TASK_RE, (m, pre, state, post) => {
      if (i++ !== idx) return m
      return `${pre}${state === ' ' ? 'x' : ' '}${post}`
    })
    onSourceChange(next)
  }

  return <div className="md" onClick={handleClick} dangerouslySetInnerHTML={{ __html: html }} />
}
