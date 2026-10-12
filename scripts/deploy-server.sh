#!/usr/bin/env bash
set -euo pipefail
task_sha="${1:?Commit SHA required}"
[[ "$task_sha" =~ ^[a-f0-9]{40}$ ]] || exit 1
task_root="/srv/atoms-workbench"
task_release="$task_root/releases/$task_sha"
task_previous="$(readlink "$task_root/current" || true)"
export ATOMS_ENV_FILE="$task_root/shared/server.env"
export BUILD_SHA="$task_sha"
cd "$task_release"
docker compose --env-file "$ATOMS_ENV_FILE" -f deploy/compose.yml build sandbox-image api worker web
if ! docker compose --env-file "$ATOMS_ENV_FILE" -f deploy/compose.yml up -d --wait api worker web || ! docker compose --env-file "$ATOMS_ENV_FILE" -f deploy/compose.yml exec -T api node -e "fetch('http://localhost:8787/api/health').then(async r=>{let s=await r.json();process.exit(r.ok && s.persistence && s.model && s.build===process.env.BUILD_SHA?0:1)}).catch(()=>process.exit(1))"; then
  if [[ -n "$task_previous" && -d "$task_previous" ]]; then
    cd "$task_previous"
    export BUILD_SHA="$(basename "$task_previous")"
    docker compose --env-file "$ATOMS_ENV_FILE" -f deploy/compose.yml build sandbox-image api worker web
    docker compose --env-file "$ATOMS_ENV_FILE" -f deploy/compose.yml up -d --wait api worker web
  fi
  exit 1
fi
ln -sfn "$task_release" "$task_root/current"
printf 'Deployment revision verified: %s\n' "$task_sha"
