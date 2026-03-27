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

echo "Deploying kjorebok from $ROOT_DIR"

if [[ ! -f "$API_ENV_FILE" ]]; then
  echo "Missing required env file: $API_ENV_FILE" >&2
  exit 1
fi

if [[ ! -f "$WEB_ENV_FILE" ]]; then
  echo "Missing required env file: $WEB_ENV_FILE" >&2
  exit 1
fi

cd "$ROOT_DIR"

if [[ -n "$(git status --short)" ]]; then
  echo "Working tree is not clean. Commit or stash changes before deploy." >&2
  git status --short
  exit 1
fi

git pull
pnpm install
pnpm --filter @kjorebok/api db:generate
pnpm --filter @kjorebok/api build
pnpm --filter @kjorebok/web build

sudo mkdir -p /etc/kjorebok
sudo cp "$NGINX_SITE_SRC" "$NGINX_SITE_DEST"
sudo cp "$API_SERVICE_SRC" "$API_SERVICE_DEST"
sudo cp "$WEB_SERVICE_SRC" "$WEB_SERVICE_DEST"
sudo systemctl daemon-reload
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl restart kjorebok-api
sudo systemctl restart kjorebok-web

echo
echo "Service status"
sudo systemctl status kjorebok-api --no-pager
sudo systemctl status kjorebok-web --no-pager

echo
echo "Health checks"
curl -I http://127.0.0.1:3001/api/health
curl -I http://127.0.0.1:3002
curl -I https://kjorebok.nguyenchu.com
