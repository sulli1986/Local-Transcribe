import type { DotColorsSettings, TagCategory } from './types'

export const DEFAULT_DOT_COLORS: DotColorsSettings = {
  new: '#9b9a97',
  recorded: '#2383e2',
  summarized: '#3fb950',
  rec: '#eb5757'
}

export const TAG_COLOR_PALETTE = [
  '#2383e2',
  '#3fb950',
  '#d97706',
  '#9333ea',
  '#db2777',
  '#0891b2',
  '#ca8a04',
  '#6366f1'
]

export function hashTag(tag: string): number {
  let h = 0
  for (let i = 0; i < tag.length; i++) h = tag.charCodeAt(i) + ((h << 5) - h)
  return Math.abs(h)
}

/** Resolve a tag's display color from configured categories or the default palette. */
export function colorForTag(tag: string, categories: TagCategory[]): string {
  const lower = tag.toLowerCase()
  const cat = categories.find((c) => c.name.toLowerCase() === lower)
  if (cat) return cat.color
  return TAG_COLOR_PALETTE[hashTag(tag) % TAG_COLOR_PALETTE.length]
}

export type TagStyle = {
  color: string
  background: string
  borderColor: string
}

export function tagStylePlain(tag: string, categories: TagCategory[]): TagStyle {
  const color = colorForTag(tag, categories)
  return {
    color,
    background: `${color}22`,
    borderColor: `${color}44`
  }
}
