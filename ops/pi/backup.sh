#!/usr/bin/env bash
set -euo pipefail
umask 077

APP_DIR="${APP_DIR:-/opt/discord-casino}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/discord-casino}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "Error: sqlite3 CLI is required for backups." >&2
  exit 1
fi

if [ -z "${DATABASE_PATH:-}" ] && [ -f "$ENV_FILE" ]; then
  raw_db_path="$(grep -E '^[[:space:]]*DATABASE_PATH=' "$ENV_FILE" | tail -n 1 | cut -d '=' -f 2- || true)"
  raw_db_path="${raw_db_path#"${raw_db_path%%[![:space:]]*}"}"
  raw_db_path="${raw_db_path%"${raw_db_path##*[![:space:]]}"}"
  raw_db_path="${raw_db_path#\"}"
  raw_db_path="${raw_db_path%\"}"
  raw_db_path="${raw_db_path#\'}"
  raw_db_path="${raw_db_path%\'}"
  DATABASE_PATH="$raw_db_path"
fi

DB_PATH="${DATABASE_PATH:-$APP_DIR/data/casino.sqlite}"
if [ "${DB_PATH#/}" = "$DB_PATH" ]; then
  DB_PATH="$APP_DIR/$DB_PATH"
fi

if [ ! -f "$DB_PATH" ]; then
  echo "Error: database file not found at $DB_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

timestamp="$(date -u +%Y%m%d-%H%M%S)"
dest_file="$BACKUP_DIR/casino-${timestamp}.sqlite"
tmp_file="${dest_file}.tmp"

cleanup() {
  rm -f -- "$tmp_file"
}
trap cleanup EXIT

sqlite3 "$DB_PATH" ".timeout 5000" ".backup '$tmp_file'"
mv -- "$tmp_file" "$dest_file"

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'casino-*.sqlite' -mtime "+${RETENTION_DAYS}" -delete

echo "Backup written: $dest_file"
