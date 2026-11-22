#!/usr/bin/env bash
set -euo pipefail

# HUMAX SMS — Safe One-Command VPS Deploy / Update Script (Private GitHub Repo + PM2)
# Usage:
#   bash scripts/deploy-vps.sh [branch]                     -> Normal safe update (keeps all live data)
#   bash scripts/deploy-vps.sh [branch] --reset-owner-only  -> Stop PM2, clear PM2 logs + wipe all non-owner data, pull & restart

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH="main"
RESET_OWNER_ONLY=false
APP_NAME="humex-sms"

for arg in "$@"; do
  if [ "$arg" = "--reset-owner-only" ]; then
    RESET_OWNER_ONLY=true
  elif [[ "$arg" != --* ]]; then
    BRANCH="$arg"
  fi
done

cd "$APP_DIR"

echo "[DEPLOY] Directory: $APP_DIR (branch: $BRANCH, reset_owner_only: $RESET_OWNER_ONLY)"

if [ ! -f ".env" ]; then
  echo "[DEPLOY] ERROR: .env file not found. Run: cp .env.example .env and configure secrets first." >&2
  exit 1
fi

if grep -q "change_me_to_a_strong_random" .env; then
  echo "[DEPLOY] ERROR: Default placeholder secrets detected in .env. Generate random tokens with openssl rand -hex 32." >&2
  exit 1
fi

if [ "$RESET_OWNER_ONLY" = true ]; then
  echo "[DEPLOY] Stopping PM2 and flushing logs before Owner-only reset..."
  pm2 stop "$APP_NAME" 2>/dev/null || true
  pm2 flush || true
fi

if [ -d ".git" ]; then
  echo "[DEPLOY] Pulling latest commits from GitHub..."
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git pull --ff-only origin "$BRANCH"
fi

if [ "$RESET_OWNER_ONLY" = true ]; then
  echo "[DEPLOY] Running Owner-only production data & log reset..."
  node scripts/clear-all-logs.js --owner-only
fi

echo "[DEPLOY] Installing production dependencies..."
npm install --omit=dev

echo "[DEPLOY] Verifying server.js syntax..."
node --check server.js

echo "[DEPLOY] Starting / restarting PM2 process..."
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$APP_NAME" --update-env
else
  pm2 start ecosystem.config.cjs
fi
pm2 save

echo "[DEPLOY] Waiting for health check on http://127.0.0.1:3000/health ..."
sleep 2
HEALTH_OUT="$(curl -fsS http://127.0.0.1:3000/health)"
echo "[DEPLOY] Health OK: $HEALTH_OUT"
