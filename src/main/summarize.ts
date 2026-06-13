import type { SettingsStore } from './settings'
import type { Meeting } from '../shared/types'

const SYSTEM_PROMPT = `You are an expert meeting assistant. You will receive a meeting transcript interleaved with the attendee's own notes. Produce concise, well-structured meeting notes in Markdown with exactly these sections:

### Summary
A short paragraph (3-6 sentences) capturing what the meeting was about and its outcomes.

### Key Points
Bulleted list of the most important points and decisions.

### Action Points
A Markdown task list ("- [ ] item") of concrete follow-ups. Include an owner in bold if one is identifiable (e.g. "- [ ] **Sam**: send the report"). If there are none, write "- [ ] No action points identified".

Output only the Markdown, no preamble.`

function buildUserPrompt(meeting: Meeting): string {
  const lines: string[] = [`Meeting title: ${meeting.title}`, `Date: ${meeting.createdAt}`, '', 'Timeline:']
  for (const e of meeting.timeline) {
    if (e.kind === 'transcript') lines.push(`[transcript] ${e.content}`)
    else if (e.kind === 'note') lines.push(`[my note] ${e.content}`)
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
  if (provider === 'openai') return callOpenAi(settings, user)
  if (provider === 'anthropic') return callAnthropic(settings, user)
  if (provider === 'openrouter') return callOpenRouter(settings, user)
  return callOllama(settings, user)
}

async function callOpenRouter(settings: SettingsStore, user: string): Promise<string> {
  const key = settings.getApiKey('openrouter')
  if (!key) throw new Error('OpenRouter API key not set (Settings → API keys)')
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: settings.raw.openrouterModel,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: user }
      ]
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
      max_tokens: 2048,
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
