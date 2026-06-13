# Local Transcribe

A local-first meeting transcriber for Linux and Windows. It records meetings from any microphone, shows the transcript live while you talk, lets you take chat-style notes and paste screenshots during the meeting, and generates AI meeting notes with action points when the recording stops.

Every meeting is just a folder of plain files — no database:

```
~/Meetings/
  2026-06-13 Weekly Sync/
    meeting.md        # title, transcript, your notes, AI summary — ordinary Markdown
    recording.webm    # the full audio recording
    assets/           # pasted / dropped images
```

`meeting.md` is readable and editable in any Markdown app (Obsidian, VS Code, ...).

## Features

- Live transcription while recording (local Whisper on CPU, fully offline — or OpenAI / OpenRouter cloud STT)
- Chat-style meeting page: transcript bubbles on the left, your notes on the right
- Paste (Ctrl+V) or drag-drop screenshots straight into the timeline
- AI meeting notes after each recording: summary, key points, and a checkable action-point list
  - Providers: OpenAI, Anthropic, OpenRouter (any model on openrouter.ai), or a fully local Ollama model
- Notion-like sidebar with search, grouped by date
- Dark / light / system theme
- API keys stored encrypted (Electron `safeStorage`); audio never leaves the machine when using local STT

## Launching without a terminal

- **Linux**: run `bash scripts/install-desktop-entry.sh` once — "Local Transcribe" then appears in your application menu and launches with a click.
- **Windows**: build the installer once with `npm run package:win`, run the generated `release/Local Transcribe Setup 0.1.0.exe`, and use the Start Menu / desktop shortcut from then on.

## Running in development

Requires Node.js 20+.

```bash
npm install
npm run dev        # Windows / most Linux distros
npm run dev:nix    # NixOS (uses nixpkgs Electron via nix-shell)
```

To run the production build without packaging:

```bash
npm run start      # Windows / most Linux distros
npm run start:nix  # NixOS
```

## Packaging installers

```bash
npm run package:linux   # AppImage into release/
npm run package:win     # NSIS installer — run this on the Windows laptop
```

The Windows installer must be built on Windows (or CI); everything else is identical across both platforms.

On NixOS, packaging needs an FHS wrapper and the AppImage runs via `appimage-run`:

```bash
NIXPKGS_ALLOW_UNFREE=1 nix-shell -p steam-run --run 'steam-run npx electron-builder --linux'
nix-shell -p appimage-run --run 'appimage-run "release/Local Transcribe-0.1.0.AppImage"'
```

## First run notes

- The Whisper model (~80 MB for `base`) downloads automatically the first time you record, then is cached for offline use. Pick the model size in Settings → Transcription.
- For AI notes, set a provider in Settings → AI meeting notes:
  - OpenAI / Anthropic / OpenRouter: paste an API key under Settings → API keys
  - Ollama: install [Ollama](https://ollama.com), `ollama pull llama3.1`, and keep `ollama serve` running
- OpenRouter can also do cloud transcription (Settings → Transcription → OpenRouter) with models like `openai/whisper-large-v3` or `openai/gpt-4o-mini-transcribe`.
- Your meetings folder defaults to `~/Meetings` and can be changed in Settings → Storage.
- If your internal microphone is missing from the mic list on Linux, the sound card's input profile may be off. Enable it once with: `pactl set-card-profile <card> output:analog-stereo+input:analog-stereo` (find the card name via `pactl list cards short`).

## How live transcription works

Audio is tapped at 16 kHz alongside the WebM recording. A simple voice-activity detector cuts the stream at natural pauses (max 20 s per chunk) and each chunk is transcribed in a worker thread, so the UI stays responsive and the transcript appears within a couple of seconds of you finishing a sentence.
