#!/bin/bash
#
# SessionStart hook — make a fresh Claude Code on the web session able to run
# `npm run build` and `npm run test` immediately.
#
# Why this exists: web sessions start from a fresh clone with no node_modules,
# so the first thing anyone had to do was install dependencies by hand before
# any gate could run. CLAUDE.md makes those two commands non-negotiable before
# claiming an app change is ready, so the setup belongs here rather than in
# every session's first few minutes.
set -euo pipefail

# Local checkouts already have their dependencies and their own tooling; this
# is only for the remote container.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# Idempotent, and cheap on a cached container: npm writes
# node_modules/.package-lock.json when an install completes, so its presence
# means a previous run finished rather than died halfway.
if [ -d node_modules ] && [ -f node_modules/.package-lock.json ]; then
  echo "session-start: dependencies already present, nothing to do"
  exit 0
fi

# `npm ci`, not `npm install`. ci installs exactly what package-lock.json pins
# and never rewrites it; install can. CLAUDE.md forbids modifying lockfiles
# without explicit instruction, and a hook that quietly edited one on every
# session start would break that rule on every session.
echo "session-start: installing dependencies with npm ci"
npm ci --no-audit --no-fund

echo "session-start: ready — npm run build and npm run test will work"
