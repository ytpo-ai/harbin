#!/bin/bash

set -e

LOG_DIR="/tmp/harbin-logs"
mkdir -p "$LOG_DIR"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

(lsof -ti :3001; lsof -ti :3002; lsof -ti :3003; lsof -ti :3100; lsof -ti :3004; lsof -ti :3201) 2>/dev/null | sort -u | xargs -r kill
sleep 2

bash "$SCRIPT_DIR/start.sh" development

sleep 8
lsof -nP -i :3001 -i :3002 -i :3003 -i :3100 -i :3004 -i :3201 | grep LISTEN
