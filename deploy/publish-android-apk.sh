#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_JSON_PATH="$ROOT_DIR/apps/mobile/app.json"
APK_PATH="${1:-}"
DEPLOY_HOST="${DEPLOY_HOST:-kjorebok.nguyenchu.com}"
DEPLOY_USER="${DEPLOY_USER:-$USER}"
TMP_METADATA="$(mktemp)"

if [[ -z "$APK_PATH" ]]; then
  echo "Usage: bash deploy/publish-android-apk.sh /path/to/android.apk" >&2
  exit 1
fi

if [[ ! -f "$APK_PATH" ]]; then
  echo "APK not found: $APK_PATH" >&2
  exit 1
fi

read -r APP_VERSION ANDROID_VERSION_CODE < <(
  APP_JSON_PATH="$APP_JSON_PATH" python3 - <<'PY'
import json
import os
import time

with open(os.environ["APP_JSON_PATH"], "r", encoding="utf-8") as fh:
    config = json.load(fh)

base_version = config["expo"]["version"]
parts = base_version.split(".")
if len(parts) != 3:
    raise SystemExit(f"Expected expo.version in app.json to use semver, got {base_version!r}")

version_code = os.environ.get("ANDROID_VERSION_CODE") or str(int(time.time()))
app_version = os.environ.get("APP_VERSION") or base_version

print(app_version, version_code)
PY
)

cat > "$TMP_METADATA" <<EOF
{
  "version": "$APP_VERSION",
  "versionCode": $ANDROID_VERSION_CODE,
  "publishedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

echo "Publishing Android APK"
echo "  file: $APK_PATH"
echo "  version: $APP_VERSION"
echo "  versionCode: $ANDROID_VERSION_CODE"
echo "  target: $DEPLOY_USER@$DEPLOY_HOST"

scp "$APK_PATH" "$TMP_METADATA" "$DEPLOY_USER@$DEPLOY_HOST:/tmp/"
ssh "$DEPLOY_USER@$DEPLOY_HOST" \
  "sudo mkdir -p /var/www/kjorebok-downloads && \
  sudo cp /tmp/$(basename "$APK_PATH") /var/www/kjorebok-downloads/android.apk && \
  sudo cp /tmp/$(basename "$TMP_METADATA") /var/www/kjorebok-downloads/android-latest.json && \
  sudo chmod 644 /var/www/kjorebok-downloads/android.apk /var/www/kjorebok-downloads/android-latest.json"

rm -f "$TMP_METADATA"
