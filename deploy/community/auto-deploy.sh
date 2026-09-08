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

# Build completely while the current container is still serving traffic.
# Keep its image so a bad release can be restored automatically.
CURRENT_CONTAINER="$(docker compose --env-file /opt/lilteam/.env -f "$COMPOSE_FILE" ps -q app)"
OLD_IMAGE_ID=""
OLD_IMAGE_NAME=""
if [[ -n "$CURRENT_CONTAINER" ]]; then
  OLD_IMAGE_ID="$(docker inspect --format '{{.Image}}' "$CURRENT_CONTAINER")"
  OLD_IMAGE_NAME="$(docker inspect --format '{{.Config.Image}}' "$CURRENT_CONTAINER")"
fi

docker compose --env-file /opt/lilteam/.env -f "$COMPOSE_FILE" build app
docker compose --env-file /opt/lilteam/.env -f "$COMPOSE_FILE" up -d --no-build --remove-orphans app

for _ in {1..24}; do
  if curl --fail --silent http://127.0.0.1:3000/health >/dev/null; then
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 5
done

echo "Deployment health check failed" >&2
docker compose --env-file /opt/lilteam/.env -f "$COMPOSE_FILE" logs --tail=100 app >&2

if [[ -n "$OLD_IMAGE_ID" && -n "$OLD_IMAGE_NAME" ]]; then
  echo "Restoring the previous healthy image" >&2
  docker tag "$OLD_IMAGE_ID" "$OLD_IMAGE_NAME"
  docker compose --env-file /opt/lilteam/.env -f "$COMPOSE_FILE" up -d --no-build app
fi
exit 1
