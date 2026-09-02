#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR=/opt/lilteam/app
COMPOSE_FILE="$APP_DIR/deploy/community/compose.yml"
LOCK_FILE=/run/lilteam-auto-deploy.lock

exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

cd "$APP_DIR"
git fetch --quiet origin main

CURRENT_COMMIT="$(git rev-parse HEAD)"
TARGET_COMMIT="$(git rev-parse origin/main)"
if [[ "$CURRENT_COMMIT" == "$TARGET_COMMIT" ]] && docker compose --env-file /opt/lilteam/.env -f "$COMPOSE_FILE" ps --status running app | grep -q app; then
  exit 0
fi

git reset --hard "$TARGET_COMMIT"
docker compose --env-file /opt/lilteam/.env -f "$COMPOSE_FILE" up -d --build --remove-orphans

for _ in {1..24}; do
  if curl --fail --silent http://127.0.0.1:3000/health >/dev/null; then
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 5
done

echo "Deployment health check failed" >&2
docker compose --env-file /opt/lilteam/.env -f "$COMPOSE_FILE" logs --tail=100 app >&2
exit 1
