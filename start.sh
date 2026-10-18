#!/bin/sh
set -e
cd "$(dirname "$0")"

APP=dist/DesignStudio.app
BIN=$APP/Contents/MacOS/DesignStudio
if [ ! -x "$BIN" ] || [ menubar/DesignStudioBar.swift -nt "$BIN" ] || [ start.sh -nt "$BIN" ]; then
  mkdir -p "$APP/Contents/MacOS"
  cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>io.github.richasridesign.designstudio</string>
  <key>CFBundleName</key><string>DesignStudio</string>
  <key>CFBundleExecutable</key><string>DesignStudio</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST
  swiftc -O menubar/DesignStudioBar.swift -o "$BIN"
  codesign --force --sign - --identifier io.github.richasridesign.designstudio "$APP"
fi

pkill -x designstudio-bar 2>/dev/null || true
if pgrep -xq DesignStudio; then
  echo "Design Studio is running. Use the menu bar icon to restart the server, or quit it and run this again."
else
  open "$APP"
  echo "Design Studio is starting on http://localhost:5174 (logs in ~/.designstudio/logs)"
fi
