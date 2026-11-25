#!/usr/bin/env bash
set -Eeuo pipefail

# Invoke with bash; no executable permission is required.
main() {
    local game=zaizai service=zaizai port=3100
    local game_dir repo_dir node_bin previous current health attempt
    game_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
    repo_dir="$(git -C "$game_dir" rev-parse --show-toplevel)"
    node_bin="${NODE_BIN:-/www/server/nodejs/v26.13.1/bin/node}"

    [[ "$(id -u)" == 0 ]] || { echo 'Run this script as root (or with sudo).' >&2; return 1; }
    for command in git systemctl curl flock runuser; do
        command -v "$command" >/dev/null || { echo "Missing command: $command" >&2; return 1; }
    done
    [[ -x "$node_bin" ]] || { echo "Node not found: $node_bin. Set NODE_BIN to its absolute path." >&2; return 1; }
    exec 9>"$(git -C "$repo_dir" rev-parse --absolute-git-dir)/game-update.lock"
    flock -n 9 || { echo 'Another game update is running; try again later.' >&2; return 1; }
    cd -- "$repo_dir"
    [[ "$(git branch --show-current)" == main ]] || { echo 'Expected branch main; update stopped.' >&2; return 1; }
    git diff --quiet && git diff --cached --quiet || {
        echo 'Tracked files have local changes. Preserve and resolve them before updating:' >&2
        git status --short
        return 1
    }
    # Untracked BaoTa/certificate files are preserved. Git rejects path collisions.
    systemctl cat "$service" >/dev/null
    runuser -u www -- "$node_bin" -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)'
    runuser -u www -- test -r "$game_dir/server/index.js"
    previous="$(git rev-parse HEAD)"
    echo "Updating $game from $previous (shared repository; only $service will restart)."
    git pull --ff-only origin main
    current="$(git rev-parse HEAD)"
    if ! git diff --quiet "$previous" "$current" -- bigarm; then
        echo 'Bigarm files also changed. Run bigarm/update.sh separately to deploy that service.'
    fi

    cd -- "$game_dir"
    # Neither game currently has production dependencies. Install them if added later.
    if "$node_bin" -e 'const p=require("./package.json"); process.exit(Object.keys({...p.dependencies,...p.optionalDependencies}).length ? 0 : 1)'; then
        [[ -f package-lock.json ]] || { echo 'Production dependencies require package-lock.json.' >&2; return 1; }
        PATH="$(dirname -- "$node_bin"):$PATH" npm ci --omit=dev
    fi
    echo 'Running rule and HTTP tests before restart...'
    runuser -u www -- "$node_bin" --test test/game.test.js test/server.test.js test/results.test.js test/arena-fx.test.js
    echo 'Tests passed. Restarting clears the in-memory rooms and scores of this game.'
    systemctl restart "$service"
    for ((attempt=1; attempt<=15; attempt++)); do
        if systemctl is-active --quiet "$service" && health="$(curl -fsS --connect-timeout 1 --max-time 2 "http://127.0.0.1:$port/api/health")" &&
            "$node_bin" -e 'const h=JSON.parse(process.argv[1]); if(h.ok!==true) process.exit(1)' "$health"; then
            systemctl status "$service" --no-pager -l
            echo "SUCCESS: $game at $current, port $port; health: $health"
            return 0
        fi
        sleep 1
    done
    echo 'Health check failed. Code was pulled; inspect the service before retrying.' >&2
    systemctl status "$service" --no-pager -l || true
    journalctl -u "$service" -n 60 --no-pager || true
    return 1
}

trap 'echo "Update failed; no automatic reset or rollback was performed." >&2' ERR
# Parse the whole function before git pull can replace this script on disk.
main "$@"; exit $?
