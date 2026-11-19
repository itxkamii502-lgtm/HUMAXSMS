#!/usr/bin/env bash
set -euo pipefail

# HUMEX SMS — Daily Production Backup Script for Linux VPS
# Reads DATA_DIR and BACKUP_DIR from .env (with safe defaults), creates compressed
# tarball backups, and retains the most recent 30 backup archives.

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$APP_DIR/.env"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

DATA_DIR="${DATA_DIR:-/var/lib/humex-sms/data}"
BACKUP_DIR="${BACKUP_DIR:-/var/lib/humex-sms/backups}"
KEEP_BACKUPS="${KEEP_BACKUPS:-30}"

if [ ! -d "$DATA_DIR" ]; then
  echo "[BACKUP] Error: DATA_DIR does not exist: $DATA_DIR" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y-%m-%d_%H%M)"
OUT_FILE="$BACKUP_DIR/humex-data-${STAMP}.tar.gz"
TMP_FILE="${OUT_FILE}.tmp"

tar --exclude='*.tmp*' -czf "$TMP_FILE" -C "$(dirname "$DATA_DIR")" "$(basename "$DATA_DIR")"
mv "$TMP_FILE" "$OUT_FILE"

echo "[BACKUP] Saved: $OUT_FILE ($(du -h "$OUT_FILE" | cut -f1))"

# Prune older archives beyond KEEP_BACKUPS
mapfile -t OLD_ARCHIVES < <(ls -1t "$BACKUP_DIR"/humex-data-*.tar.gz 2>/dev/null | tail -n +"$((KEEP_BACKUPS + 1))" || true)
for f in "${OLD_ARCHIVES[@]}"; do
  rm -f "$f"
  echo "[BACKUP] Pruned old archive: $f"
done
