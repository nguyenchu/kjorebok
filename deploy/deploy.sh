#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="/home/nguyen/dev/kjorebok"
NGINX_SITE_SRC="$ROOT_DIR/deploy/nginx/kjorebok.nguyenchu.com.conf"
NGINX_SITE_DEST="/etc/nginx/sites-available/kjorebok.nguyenchu.com"
API_SERVICE_SRC="$ROOT_DIR/deploy/systemd/kjorebok-api.service"
WEB_SERVICE_SRC="$ROOT_DIR/deploy/systemd/kjorebok-web.service"
API_SERVICE_DEST="/etc/systemd/system/kjorebok-api.service"
WEB_SERVICE_DEST="/etc/systemd/system/kjorebok-web.service"
API_ENV_FILE="/etc/kjorebok/api.env"
WEB_ENV_FILE="/etc/kjorebok/web.env"
DOWNLOAD_DIR="/var/www/kjorebok-downloads"
LOCAL_NODE_DIR="$(find "$ROOT_DIR/.tools" -maxdepth 1 -type d -name 'node-*' | head -n 1 || true)"
CP_BIN="/usr/bin/cp"
MKDIR_BIN="/usr/bin/mkdir"
NGINX_BIN="/usr/sbin/nginx"
SYSTEMCTL_BIN="/usr/bin/systemctl"

if [[ -n "$LOCAL_NODE_DIR" && -x "$LOCAL_NODE_DIR/bin/node" ]]; then
  export PATH="$LOCAL_NODE_DIR/bin:$PATH"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Missing Node.js on deploy target." >&2
  exit 1
fi

pnpm_cmd() {
  if command -v corepack >/dev/null 2>&1; then
    corepack pnpm "$@"
    return
  fi

  if command -v pnpm >/dev/null 2>&1; then
    pnpm "$@"
    return
  fi

  echo "Missing pnpm/corepack on deploy target." >&2
  exit 1
}

sudo_cmd() {
  echo "+ sudo $*"
  sudo -n "$@"
}

wait_for_http() {
  local url="$1"
  local attempts="${2:-30}"
  local delay="${3:-1}"

  for ((i = 1; i <= attempts; i++)); do
    if curl -fsS -I "$url" >/dev/null; then
      echo "OK: $url"
      return 0
    fi

    echo "Waiting for $url ($i/$attempts)..."
    sleep "$delay"
  done

  echo "Health check failed for $url after $attempts attempts" >&2
  curl -I "$url" || true
  return 1
}

echo "Deploying kjorebok from $ROOT_DIR"

if [[ ! -f "$API_ENV_FILE" ]]; then
  echo "Missing required env file: $API_ENV_FILE" >&2
  exit 1
fi

if [[ ! -f "$WEB_ENV_FILE" ]]; then
  echo "Missing required env file: $WEB_ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$API_ENV_FILE"
# shellcheck disable=SC1090
source "$WEB_ENV_FILE"
set +a

cd "$ROOT_DIR"

DIRTY_STATUS="$(git status --short -- . ':(exclude).codex')"

if [[ -n "$DIRTY_STATUS" ]]; then
  echo "Working tree is not clean. Commit or stash changes before deploy." >&2
  printf '%s\n' "$DIRTY_STATUS"
  exit 1
fi

git pull
pnpm_cmd install --frozen-lockfile
pnpm_cmd --filter @kjorebok/api db:generate
pnpm_cmd --filter @kjorebok/api exec prisma migrate deploy
pnpm_cmd --filter @kjorebok/api build
pnpm_cmd --filter @kjorebok/web build

sudo_cmd "$MKDIR_BIN" -p /etc/kjorebok
sudo_cmd "$MKDIR_BIN" -p "$DOWNLOAD_DIR"
sudo_cmd "$CP_BIN" "$NGINX_SITE_SRC" "$NGINX_SITE_DEST"
sudo_cmd "$CP_BIN" "$API_SERVICE_SRC" "$API_SERVICE_DEST"
sudo_cmd "$CP_BIN" "$WEB_SERVICE_SRC" "$WEB_SERVICE_DEST"
sudo_cmd "$SYSTEMCTL_BIN" daemon-reload
sudo_cmd "$NGINX_BIN" -t
sudo_cmd "$SYSTEMCTL_BIN" reload nginx
sudo_cmd "$SYSTEMCTL_BIN" restart kjorebok-api
sudo_cmd "$SYSTEMCTL_BIN" restart kjorebok-web

echo
echo "Service status"
sudo_cmd "$SYSTEMCTL_BIN" status kjorebok-api --no-pager
sudo_cmd "$SYSTEMCTL_BIN" status kjorebok-web --no-pager

echo
echo "Health checks"
wait_for_http http://127.0.0.1:3020/api/health 30 1
wait_for_http http://127.0.0.1:3021 30 1
wait_for_http https://kjorebok.nguyenchu.com 30 1
