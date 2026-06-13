import type { SettingsStore } from './settings'
import type { Meeting } from '../shared/types'
import { normalizeSummary } from '../shared/document'

const MAX_OUTPUT_TOKENS = 8192

/** Passed through to Gemini via OpenRouter when supported — reduces output censorship. */
const GEMINI_SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
]

const SYSTEM_PROMPT = `You are an expert meeting-notes assistant producing **internal, confidential** meeting notes for the people who were in the room.

These are private operational notes — not a public document. Your job is **faithful capture**, not sanitization.

## Fidelity (critical)
- **Never redact, censor, or omit** discussed facts, names, clients, numbers, or strong language.
- **Never** use asterisks (***), "[REDACTED]", "[profanity removed]", or similar placeholders.
- You may paraphrase into clear professional prose, but the meaning must stay complete — if someone was angry, said something blunt, or used strong language, reflect that honestly without softening into vagueness.
- Include **every client, person, and topic** that received meaningful discussion. Do not skip sections to save space.

## Output structure (Markdown only, no preamble)

### Action Items
Use this exact heading once — the only place with checkboxes.

- Include ONLY follow-ups **explicitly assigned** or **clearly agreed**.
- **Consolidate** related work into one item; do not duplicate the same task.
- Target **8–12 items** for a long meeting; **3–6** for a short one.
- Format: \`- [ ] **Owner**: outcome in one line\`
- Optional source link: [N](transcript:SECONDS) where N is a small reference number (1, 2, 3…). **Never** use timestamps or times as link text — numbers only.
- **Never** put \`- [ ]\` checkboxes in any other section.

### Meeting Overview
One paragraph, 3–5 sentences. Headline outcomes only.

### Thematic sections
Use **4–8 sections** as needed. Polished titles with an em dash when helpful:
\`Client Updates — Losses & New Business\`, \`Client Escalations\`, \`Staffing & HR\`, \`Finance & Subscriptions\`, \`Operations & Process\`, \`Org Structure\`

Section style:
- Plain bullets only (\`-\`), no checkboxes
- **Bold** label per client/person, then nested sub-bullets with full context
- Cover decisions, reasoning, numbers, and status — not just headlines
- Do not restate Action Items here; add context instead
- Timestamp links sparingly when timestamps exist — use numbered links [N](transcript:SECONDS), not times

## Ground rules
- Every fact must come from the transcript or notes. Never invent.
- Output Markdown only.`

function fmtTime(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}

function buildUserPrompt(meeting: Meeting): string {
  const transcripts = meeting.timeline.filter((e) => e.kind === 'transcript')
  const notes = meeting.timeline.filter((e) => e.kind === 'note')

  const lines: string[] = [
    `Meeting title: ${meeting.title}`,
    `Date: ${meeting.createdAt}`,
    ''
  ]

  if (transcripts.length > 0) {
    lines.push('Transcript (chronological; use transcript:SECONDS for links):')
    for (const e of transcripts) {
      lines.push(`[${fmtTime(e.timeSec)} / transcript:${e.timeSec}] ${e.content}`)
    }
    lines.push('')
  }

  if (notes.length > 0) {
    lines.push('Manual notes from attendee:')
    for (const e of notes) {
      const label = e.content.length > 2000 ? 'pasted notes/transcript' : 'note'
      lines.push(`[${label}] ${e.content}`)
    }
    lines.push('')
  }

  if (transcripts.length === 0 && notes.length > 0) {
    lines.push(
      '(No timestamps available — treat manual notes as the full source; do not add transcript: links.)'
    )
  }

  return lines.join('\n')
}

export async function generateNotes(settings: SettingsStore, meeting: Meeting): Promise<string> {
  const hasContent = meeting.timeline.some((e) => e.kind !== 'image' && e.content.trim())
  if (!hasContent) {
    throw new Error('Nothing to summarize yet — the meeting has no transcript or notes.')
  }
  const provider = settings.raw.llmProvider
  const user = buildUserPrompt(meeting)
  let raw: string
  if (provider === 'openai') raw = await callOpenAi(settings, user)
  else if (provider === 'anthropic') raw = await callAnthropic(settings, user)
  else if (provider === 'openrouter') raw = await callOpenRouter(settings, user)
  else raw = await callOllama(settings, user)
  return normalizeSummary(raw.trim())
}

async function callOpenRouter(settings: SettingsStore, user: string): Promise<string> {
  const key = settings.getApiKey('openrouter')
  if (!key) throw new Error('OpenRouter API key not set (Settings → API keys)')
  const model = settings.raw.openrouterModel
  const isGemini = model.toLowerCase().includes('gemini')
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: user }
      ],
      ...(isGemini
        ? {
            safety_settings: GEMINI_SAFETY_SETTINGS,
            provider: { require_parameters: false }
          }
        : {})
    })
  })
  if (!res.ok) throw new Error(`OpenRouter request failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return (json.choices?.[0]?.message?.content ?? '').trim()
}

async function callOpenAi(settings: SettingsStore, user: string): Promise<string> {
  const key = settings.getApiKey('openai')
  if (!key) throw new Error('OpenAI API key not set (Settings → API keys)')
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: settings.raw.openaiModel,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: user }
      ]
    })
  })
  if (!res.ok) throw new Error(`OpenAI request failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return (json.choices?.[0]?.message?.content ?? '').trim()
}

async function callAnthropic(settings: SettingsStore, user: string): Promise<string> {
  const key = settings.getApiKey('anthropic')
  if (!key) throw new Error('Anthropic API key not set (Settings → API keys)')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: settings.raw.anthropicModel,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: user }]
    })
  })
  if (!res.ok) throw new Error(`Anthropic request failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  const json = (await res.json()) as { content?: { text?: string }[] }
  const text = Array.isArray(json.content)
    ? json.content.map((c: { text?: string }) => c.text ?? '').join('')
    : ''
  return text.trim()
}

async function callOllama(settings: SettingsStore, user: string): Promise<string> {
  const base = settings.raw.ollamaUrl.replace(/\/$/, '')
  let res: Response
  try {
    res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: settings.raw.ollamaModel,
        stream: false,
        options: { num_predict: MAX_OUTPUT_TOKENS },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: user }
        ]
      })
    })
  } catch {
    throw new Error(`Could not reach Ollama at ${base}. Is it running? (ollama serve)`)
  }
  if (!res.ok) throw new Error(`Ollama request failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  const json = (await res.json()) as { message?: { content?: string } }
  return (json.message?.content ?? '').trim()
}
