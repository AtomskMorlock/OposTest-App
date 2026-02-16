#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_FILE="$ROOT_DIR/version.js"
CHANGELOG_FILE="$ROOT_DIR/CHANGELOG.md"

usage() {
  echo "Uso: $0 <patch|minor|major> \"resumen\"" >&2
  echo "Opcional: --dry-run para simular sin escribir archivos." >&2
  exit 1
}

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
  shift
fi

TYPE="${1:-}"
SUMMARY="${2:-}"

if [[ -z "$TYPE" || -z "$SUMMARY" ]]; then
  usage
fi

case "$TYPE" in
  patch|minor|major) ;;
  *) echo "Error: type debe ser patch, minor o major." >&2; exit 1 ;;
esac

# Resumen de una sola linea
SUMMARY="${SUMMARY//$'\n'/ }"
SUMMARY="$(echo "$SUMMARY" | sed 's/[[:space:]]\+/ /g; s/^ //; s/ $//')"
if [[ -z "$SUMMARY" ]]; then
  echo "Error: resumen vacio." >&2
  exit 1
fi

if [[ ! -f "$VERSION_FILE" ]]; then
  echo "Error: no existe $VERSION_FILE" >&2
  exit 1
fi

CURRENT="$(sed -n 's/^window\.APP_VERSION = \"\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\)\";$/\1/p' "$VERSION_FILE")"
if [[ -z "$CURRENT" ]]; then
  echo "Error: no se pudo leer APP_VERSION desde version.js" >&2
  exit 1
fi

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

case "$TYPE" in
  patch)
    PATCH=$((PATCH + 1))
    ;;
  minor)
    MINOR=$((MINOR + 1))
    PATCH=0
    ;;
  major)
    MAJOR=$((MAJOR + 1))
    MINOR=0
    PATCH=0
    ;;
esac

NEXT="${MAJOR}.${MINOR}.${PATCH}"
ENTRY="${NEXT} - ${SUMMARY}"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[DRY-RUN] version actual: $CURRENT"
  echo "[DRY-RUN] version nueva:  $NEXT"
  echo "[DRY-RUN] changelog:      $ENTRY"
  exit 0
fi

printf 'window.APP_VERSION = "%s";\n' "$NEXT" > "$VERSION_FILE"

TMP_FILE="$(mktemp)"
{
  echo "$ENTRY"
  if [[ -f "$CHANGELOG_FILE" ]]; then
    cat "$CHANGELOG_FILE"
  fi
} > "$TMP_FILE"
mv "$TMP_FILE" "$CHANGELOG_FILE"

echo "Version actualizada: $CURRENT -> $NEXT"
echo "Changelog actualizado en: $CHANGELOG_FILE"
