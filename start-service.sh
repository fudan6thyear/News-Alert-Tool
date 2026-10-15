#!/bin/bash
cd "$(dirname "$0")/app"

if ! command -v node &> /dev/null; then
    echo "[News Alert] Error: Node.js not found. Install from https://nodejs.org/"
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo "[News Alert] First run: installing dependencies..."
    npm install --no-audit --no-fund
    if [ $? -ne 0 ]; then
        echo "[News Alert] npm install failed, exiting."
        exit 1
    fi
fi

CRASH_COUNT=0
MAX_CRASHES=10

while true; do
    node server.js
    CRASH_COUNT=$((CRASH_COUNT + 1))
    if [ "$CRASH_COUNT" -ge "$MAX_CRASHES" ]; then
        echo "[News Alert] Reached $MAX_CRASHES restarts, stopping."
        exit 1
    fi
    echo "[News Alert] Service exited at $(date), restart $CRASH_COUNT/$MAX_CRASHES in 10s..."
    sleep 10
done
