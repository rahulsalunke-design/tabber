#!/bin/bash
# Screenshot the popup and dashboard with made-up tabs (no real browsing data).
#
# Usage:  docs/screenshots/capture/capture.sh <version-folder>
# Example: docs/screenshots/capture/capture.sh v6.1-popup-glance
#
# Writes PNGs to docs/screenshots/<version-folder>/. Uses headless Google Chrome
# with a throwaway profile; set CHROME=/path/to/chrome to use another binary.
# When the UI changes, update the SHOTS list below to cover the new screens.

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <version-folder>" >&2
  exit 1
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
OUT="$ROOT/docs/screenshots/$1"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Copy the extension pages into a light and a dark folder, injecting the fake chrome
# API before the shared script. Headless Chrome follows the Mac's appearance setting,
# so each copy of popup.css is pinned: the dark copy always applies its dark-mode
# block and the light copy never does.
for theme in light dark; do
  dir="$WORK/$theme"
  mkdir -p "$dir"
  cp "$ROOT"/*.js "$ROOT"/*.css "$HERE/mock-chrome.js" "$dir"/
  for page in popup dashboard; do
    sed 's#<script src="tabs-core.js"></script>#<script src="mock-chrome.js"></script><script src="tabs-core.js"></script>#' \
      "$ROOT/$page.html" > "$dir/$page.html"
  done
done
grep -q '@media (prefers-color-scheme: dark)' "$ROOT/popup.css" \
  || { echo "Dark-mode block not found in popup.css" >&2; exit 1; }
sed 's#@media (prefers-color-scheme: dark)#@media all#' "$ROOT/popup.css" > "$WORK/dark/popup.css"
sed -e 's#@media (prefers-color-scheme: dark)#@media not all#' -e 's#color-scheme: light dark#color-scheme: light#' \
  "$ROOT/popup.css" > "$WORK/light/popup.css"
sed -i '' 's#color-scheme: light dark#color-scheme: dark#' "$WORK/dark/popup.css"

mkdir -p "$OUT"

# name | page | width,height | query string | light/dark
SHOTS=(
  "popup-light|popup|420,250|scenario=stale|light"
  "popup-dark|popup|420,250|scenario=stale|dark"
  "popup-archive-confirm|popup|420,400|scenario=stale&then=confirm-archive|light"
  "popup-nothing-stale|popup|420,250|scenario=fresh|light"
  "dashboard-by-domain-light|dashboard|1440,960|scenario=stale|light"
  "dashboard-by-domain-dark|dashboard|1440,960|scenario=stale|dark"
  "dashboard-by-staleness|dashboard|1440,960|scenario=stale&then=sort-staleness|light"
  "dashboard-sorted-by-title|dashboard|1440,960|scenario=stale&then=sort-staleness,sort-title|light"
)

for shot in "${SHOTS[@]}"; do
  IFS='|' read -r name page size query theme <<< "$shot"
  flags=(
    --headless=new --disable-gpu --hide-scrollbars --no-first-run
    --user-data-dir="$WORK/profile" --force-device-scale-factor=2
    --virtual-time-budget=3000 --window-size="$size"
    --screenshot="$OUT/$name.png"
  )
  "$CHROME" "${flags[@]}" "file://$WORK/$theme/$page.html?$query" > /dev/null 2>&1
  echo "saved $OUT/$name.png"
done
