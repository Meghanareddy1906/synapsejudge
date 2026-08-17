#!/usr/bin/env bash
#
# SynapseJudge — deploy / redeploy on the app host.
#
#   ./deploy/deploy.sh              # pull, install, build, migrate infra, restart
#   ./deploy/deploy.sh --no-pull    # same without touching git (local changes)
#   ./deploy/deploy.sh --seed       # also (re)seed problems and arenas
#
# Safe to re-run. Every step is idempotent.

set -euo pipefail

PULL=1
SEED=0
for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    --seed)    SEED=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

# ---------------------------------------------------------------- preflight --

say "Preflight"
command -v node   >/dev/null || { echo "node is not installed"; exit 1; }
command -v npm    >/dev/null || { echo "npm is not installed"; exit 1; }
command -v docker >/dev/null || { echo "docker is not installed"; exit 1; }

docker info >/dev/null 2>&1 || {
  echo "Docker daemon is not reachable by $(whoami)."
  echo "Fix: sudo usermod -aG docker \$USER && newgrp docker"
  exit 1
}

[ -f .env ] || { echo "No .env found. Copy .env.production.example to .env and fill it in."; exit 1; }

# A default JWT_SECRET in production is a full authentication bypass — refuse.
if grep -qE '^JWT_SECRET=(replace-me|\s*)$' .env; then
  echo "JWT_SECRET is unset or still the placeholder in .env. Generate one with:"
  echo "  node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
  exit 1
fi

node -e "process.exit(parseInt(process.versions.node) >= 20 ? 0 : 1)" || {
  echo "Node 20+ is required (found $(node -v))."; exit 1;
}

# ------------------------------------------------------------------- source --

if [ "$PULL" = "1" ] && [ -d .git ]; then
  say "Pulling latest"
  git pull --ff-only
fi

say "Installing dependencies"
npm ci --omit=dev --workspaces --include-workspace-root 2>/dev/null || npm install

# The client needs its dev dependencies (vite) to build, so install those too.
npm install --workspace client

# -------------------------------------------------------------------- infra --

say "Starting MongoDB and Redis"
docker compose up -d
# Mongo needs a moment before the seed or the API will fail its first connect.
for _ in $(seq 1 30); do
  docker compose exec -T mongo mongosh --quiet --eval 'db.runCommand({ ping: 1 })' >/dev/null 2>&1 && break
  sleep 1
done

say "Building language runner images"
npm run runners:build

# -------------------------------------------------------------------- build --

say "Building the client"
npm run build

if [ "$SEED" = "1" ]; then
  say "Seeding problems and arenas"
  npm run seed
fi

# ------------------------------------------------------------------ restart --

mkdir -p logs "${SANDBOX_HOST_DIR:-.tmp-submissions}"

say "Restarting processes"
if command -v pm2 >/dev/null; then
  # `startOrReload` is a zero-downtime restart when the app is already up, and a
  # plain start when it is not — so the same command works on first deploy.
  pm2 startOrReload ecosystem.config.cjs --update-env
  pm2 save
  pm2 status
else
  echo "pm2 is not installed. Install it with: sudo npm i -g pm2"
  exit 1
fi

say "Health check"
sleep 2
curl -fsS http://127.0.0.1:4000/api/health && echo

say "Done — $ROOT deployed"
echo "If Nginx config changed: sudo nginx -t && sudo systemctl reload nginx"
