#!/bin/bash
cd "$(dirname "$0")/src"
OUT=../out
mkdir -p "$OUT"
C="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for f in mac14-1-cant-open mac14-2-open-anyway mac14-3-password mac14-4-open mac-1-first-open mac-2-privacy-security mac-3-open-anyway-confirm mac-4-local-network win-1-smartscreen win-2-smartscreen-run-anyway win-3-uac win-4-firewall linux-1-allow-executing; do
  h=$(grep -o 'height:[0-9]*px' $f.html | head -1 | grep -o '[0-9]*')
  "$C" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --window-size=600,$h --default-background-color=ffffffff --allow-file-access-from-files --screenshot="$PWD/$OUT/$f.png" "file://$PWD/$f.html" >/dev/null 2>&1
done

