#!/usr/bin/env bash
# Desktop launcher for NixOS: runs the built app with the nixpkgs Electron.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f out/main/index.js ]; then
  npx electron-vite build
fi

exec nix-shell -p electron --run 'electron .'
