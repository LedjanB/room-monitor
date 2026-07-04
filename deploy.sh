#!/usr/bin/env bash
# Deploy to Firebase Hosting, stamping a fresh version marker first so that
# every open tab notices the new deploy (within a few minutes) and shows the
# "please refresh" bar. See startVersionWatch() in the interaction module.
#
# Usage:
#   ./deploy.sh                      # stamp + deploy hosting
#   ./deploy.sh --only database,hosting   # extra args pass through to firebase
set -euo pipefail

PROJECT="room-monitor-6902b"
STAMP="$(date -u +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
printf '{ "version": "%s" }\n' "$STAMP" > version.json
echo "Stamped version.json -> $STAMP"

if [ "$#" -gt 0 ]; then
  npx firebase-tools@13 deploy --project "$PROJECT" "$@"
else
  npx firebase-tools@13 deploy --only hosting --project "$PROJECT"
fi
