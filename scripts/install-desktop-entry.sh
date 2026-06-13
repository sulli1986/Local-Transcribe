#!/usr/bin/env bash
# Installs a Local Transcribe entry into the Linux application menu,
# pointing at this checkout. Run once: bash scripts/install-desktop-entry.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APPS_DIR="$HOME/.local/share/applications"
mkdir -p "$APPS_DIR"

cat > "$APPS_DIR/local-transcribe.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Local Transcribe
Comment=Record, transcribe and summarize meetings locally
Exec="$ROOT/scripts/launch-nix.sh"
Icon=$ROOT/build/icon.png
Terminal=false
Categories=Office;AudioVideo;
StartupWMClass=local-transcribe
EOF

chmod +x "$ROOT/scripts/launch-nix.sh" "$ROOT/scripts/dev-nix.sh"
update-desktop-database "$APPS_DIR" 2>/dev/null || true
echo "Installed: $APPS_DIR/local-transcribe.desktop"
