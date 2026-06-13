# Local Transcribe

A local-first meeting transcriber for Linux and Windows. Record from any microphone, watch the transcript update live, take notes during the meeting, and generate an editable AI summary when you're done.

> **Note:** This project was built almost entirely with AI assistance (Cursor, etc.). Expect some rough edges, redundant code, or other “AI slop” — it’s a personal tool I use day to day, not a polished commercial product. Issues and PRs welcome, but no promises on roadmap or support.

Every meeting is a folder of plain files — no database:

```
~/Meetings/
  2026-06-13 Weekly Sync/
    meeting.md        # YAML frontmatter + ## Summary + ## Timeline (transcript, notes, images)
    recording.webm    # full audio recording
    assets/           # pasted / dropped images
```

`meeting.md` is readable and editable in any Markdown app (Obsidian, VS Code, …).

## Features

### Recording & transcription
- Live transcription while recording (local Whisper on CPU, fully offline — or OpenAI / OpenRouter cloud STT)
- Pause / resume recording
- Import an existing audio file and transcribe it
- Voice-activity chunking (~20 s max) in a worker thread so the UI stays responsive

### Meeting page (three tabs)
- **Summary** — AI-generated meeting notes (action items first, themed sections). Editable in the same BlockNote editor as Notes. Numbered circle links jump to that moment in the transcript.
- **Notes** — your manual notes during the meeting (Notion-style BlockNote editor, type `/` for headings, lists, tasks, quotes, images)
- **Transcript** — full timestamped transcript; click a line to seek the audio player

### AI summaries
- Generate or regenerate from the Summary tab (or auto-generate when recording stops — toggle in Settings)
- Providers: OpenAI, Anthropic, OpenRouter (any model on openrouter.ai), or a local Ollama model
- Default OpenRouter model: `google/gemini-2.5-flash`

### Organization
- Sidebar with global search across titles, summaries, notes, and transcripts
- Meetings grouped by date with status dots (customizable colors)
- Tags with optional category colors
- Copy summary / notes / transcript; export meeting as `.md`
- Dark / light / system theme

### Privacy
- API keys stored locally in Electron `userData` (encrypted with `safeStorage` when the OS supports it) — **not** in this git repo
- Audio never leaves the machine when using local Whisper STT

## Launching without a terminal

- **Linux**: run `bash scripts/install-desktop-entry.sh` once — "Local Transcribe" then appears in your application menu.
- **Windows**: build the installer with `npm run package:win`, run `release/Local Transcribe Setup 0.1.0.exe`, then use the Start Menu / desktop shortcut.

## Running in development

Requires Node.js 20+.

```bash
npm install
npm run dev        # Windows / most Linux distros
npm run dev:nix    # NixOS (uses nixpkgs Electron via nix-shell)
```

Production build without packaging:

```bash
npm run start      # Windows / most Linux distros
npm run start:nix  # NixOS
```

## Packaging installers

```bash
npm run package:linux   # AppImage into release/
npm run package:win     # NSIS installer — build on Windows
```

On NixOS, packaging needs an FHS wrapper and the AppImage runs via `appimage-run`:

```bash
NIXPKGS_ALLOW_UNFREE=1 nix-shell -p steam-run --run 'steam-run npx electron-builder --linux'
nix-shell -p appimage-run --run 'appimage-run "release/Local Transcribe-0.1.0.AppImage"'
```

## First run

- The Whisper `base` model (~80 MB) downloads on first record, then caches offline. Change model size in **Settings → Transcription**.
- For AI summaries, pick a provider in **Settings → AI meeting notes**:
  - OpenAI / Anthropic / OpenRouter: paste an API key under **Settings → API keys**
  - Ollama: install [Ollama](https://ollama.com), `ollama pull llama3.1`, keep `ollama serve` running
- OpenRouter can also do cloud STT (**Settings → Transcription → OpenRouter**) with models like `openai/whisper-large-v3`.
- Meetings folder defaults to `~/Meetings` — change in **Settings → Storage**.
- Toggle **auto-generate summary when recording stops** in Settings.
- On Linux, if the internal mic is missing: `pactl set-card-profile <card> output:analog-stereo+input:analog-stereo` (find the card with `pactl list cards short`).

## How live transcription works

Audio is captured at 16 kHz alongside the WebM recording. A voice-activity detector cuts the stream at natural pauses (max 20 s per chunk); each chunk is transcribed in a worker thread. New lines appear on the **Transcript** tab within a couple of seconds of you finishing a sentence.
