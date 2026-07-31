#!/usr/bin/env bash
set -euo pipefail

VAULT_APP="imansur-api-keys"
CONSUMER_APPS=(
  "sassysolutions-interactive-preso"
  # Add future apps here
)

echo "Reading GEMINI_API_KEY from vault: $VAULT_APP"
KEY=$(heroku config:get GEMINI_API_KEY --app "$VAULT_APP" 2>/dev/null || true)

if [ -z "$KEY" ]; then
  echo "GEMINI_API_KEY not found on $VAULT_APP"
  exit 1
fi

for APP in "${CONSUMER_APPS[@]}"; do
  echo -n "  → $APP ... "
  if heroku config:set GEMINI_API_KEY="$KEY" --app "$APP" >/dev/null 2>&1; then
    echo "done"
  else
    echo "FAILED"
  fi
done
