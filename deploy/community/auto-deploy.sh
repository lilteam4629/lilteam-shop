#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR=/opt/lilteam/app
COMPOSE_FILE="$APP_DIR/deploy/community/compose.yml"
LOCK_FILE=/run/lilteam-auto-deploy.lock
RUNTIME_DIR=/opt/lilteam/runtime
ACTIVE_FILE="$RUNTIME_DIR/active-slot"

exec 9>"$LOCK_FILE"
flock -n 9 || exit 0
cd "$APP_DIR"
git fetch --quiet origin main

CURRENT_COMMIT="$(git rev-parse HEAD)"
TARGET_COMMIT="$(git rev-parse origin/main)"
mkdir -p "$RUNTIME_DIR"
ACTIVE_SLOT="$(cat "$ACTIVE_FILE" 2>/dev/null || echo blue)"
[[ "$ACTIVE_SLOT" == blue ]] && NEXT_SLOT=green || NEXT_SLOT=blue
NEXT_SERVICE="app-$NEXT_SLOT"
NEXT_CONTAINER="lilteam-app-$NEXT_SLOT"

if [[ "$CURRENT_COMMIT" == "$TARGET_COMMIT" ]] \
  && docker ps --format '{{.Names}}' | grep -qx lilteam-proxy \
  && docker ps --format '{{.Names}}' | grep -qx "lilteam-app-$ACTIVE_SLOT"; then
  exit 0
fi

# Keep the active release serving while the candidate builds and starts.
git reset --hard "$TARGET_COMMIT"
export LILTEAM_IMAGE_TAG="$TARGET_COMMIT"
docker compose --env-file /opt/lilteam/.env -f "$COMPOSE_FILE" build "$NEXT_SERVICE"
docker compose --env-file /opt/lilteam/.env -f "$COMPOSE_FILE" up -d --no-deps "$NEXT_SERVICE"

healthy=false
for _ in {1..60}; do
  if [[ "$(docker inspect --format '{{.State.Health.Status}}' "$NEXT_CONTAINER" 2>/dev/null || true)" == healthy ]]; then
    healthy=true
    break
  fi
  sleep 2
done
if [[ "$healthy" != true ]]; then
  echo "Candidate $NEXT_SLOT failed health checks; $ACTIVE_SLOT remains active" >&2
  docker logs --tail 120 "$NEXT_CONTAINER" >&2 || true
  docker rm -f "$NEXT_CONTAINER" >/dev/null 2>&1 || true
  git reset --hard "$CURRENT_COMMIT"
  exit 1
fi

if [[ -f "$RUNTIME_DIR/upstream.conf" ]]; then cp "$RUNTIME_DIR/upstream.conf" "$RUNTIME_DIR/upstream.conf.previous"; fi
printf 'upstream active_app { server %s:3000; keepalive 32; }\n' "$NEXT_CONTAINER" > "$RUNTIME_DIR/upstream.conf.new"
mv "$RUNTIME_DIR/upstream.conf.new" "$RUNTIME_DIR/upstream.conf"

if docker ps --format '{{.Names}}' | grep -qx lilteam-proxy; then
  if ! docker exec lilteam-proxy nginx -t || ! docker exec lilteam-proxy nginx -s reload; then
    if [[ -f "$RUNTIME_DIR/upstream.conf.previous" ]]; then
      mv "$RUNTIME_DIR/upstream.conf.previous" "$RUNTIME_DIR/upstream.conf"
      docker exec lilteam-proxy nginx -t && docker exec lilteam-proxy nginx -s reload
    fi
    echo "Proxy rejected candidate configuration; $ACTIVE_SLOT remains active" >&2
    exit 1
  fi
else
  # One-time migration: the candidate is healthy before the legacy process
  # releases port 3000 and nginx takes ownership of it.
  docker compose --env-file /opt/lilteam/.env -f "$COMPOSE_FILE" pull proxy
  LEGACY_ID="$(docker ps --filter publish=3000 --format '{{.ID}}' | head -n1)"
  if [[ -n "$LEGACY_ID" ]]; then docker stop --time 25 "$LEGACY_ID" >/dev/null; fi
  docker compose --env-file /opt/lilteam/.env -f "$COMPOSE_FILE" up -d --no-deps proxy
fi

for _ in {1..30}; do
  if curl --fail --silent --max-time 5 http://127.0.0.1:3000/health >/dev/null; then
    printf '%s\n' "$NEXT_SLOT" > "$ACTIVE_FILE"
    OLD_CONTAINER="lilteam-app-$ACTIVE_SLOT"
    sleep 10
    if [[ "$OLD_CONTAINER" != "$NEXT_CONTAINER" ]]; then docker stop --time 25 "$OLD_CONTAINER" >/dev/null 2>&1 || true; fi
    docker image prune --force >/dev/null
    exit 0
  fi
  sleep 1
done

echo "Proxy verification failed after switching to $NEXT_SLOT" >&2
OLD_CONTAINER="lilteam-app-$ACTIVE_SLOT"
if docker ps --format '{{.Names}}' | grep -qx "$OLD_CONTAINER"; then
  printf 'upstream active_app { server %s:3000; keepalive 32; }\n' "$OLD_CONTAINER" > "$RUNTIME_DIR/upstream.conf.new"
  mv "$RUNTIME_DIR/upstream.conf.new" "$RUNTIME_DIR/upstream.conf"
  docker exec lilteam-proxy nginx -t
  docker exec lilteam-proxy nginx -s reload
fi
exit 1
