#!/usr/bin/env bash
# Dev launcher for NixOS: the npm-downloaded Electron binary cannot run on NixOS
# (hardcoded /lib64 interpreter), so we point electron-vite at the nixpkgs
# Electron binary via ELECTRON_OVERRIDE_DIST_PATH.
set -euo pipefail
cd "$(dirname "$0")/.."

exec nix-shell -p electron --run '
  export ELECTRON_OVERRIDE_DIST_PATH="$(dirname "$(command -v electron)")"
  npx electron-vite dev "$@"
'
