#!/usr/bin/env bash
set -u

TOOLS_DIR="${HOME}/.local/share/utku-agent-stack"
export CODEX_HOME="${CODEX_HOME:-${HOME}/.codex-luna-api}"
export PATH="${HOME}/.local/bin:${HOME}/.cargo/bin:${PATH}"

ok=0
warn=0
fail=0

pass() { printf 'OK    %s\n' "$1"; ok=$((ok+1)); }
warning() { printf 'WARN  %s\n' "$1"; warn=$((warn+1)); }
failure() { printf 'FAIL  %s\n' "$1"; fail=$((fail+1)); }

command -v codex >/dev/null 2>&1 && pass "Codex CLI found" || warning "Codex CLI not on PATH; Codex Desktop may still be installed"

for skill in film-production wask-project-council tool-discovery video-use; do
  if [ -e "$CODEX_HOME/skills/$skill/SKILL.md" ]; then
    pass "Codex skill: $skill"
  else
    failure "Missing Codex skill: $skill"
  fi
done

if command -v graphify >/dev/null 2>&1; then
  pass "Graphify CLI"
else
  failure "Graphify CLI missing"
fi

if command -v davinci-resolve-mcp >/dev/null 2>&1; then
  pass "DaVinci Resolve MCP binary"
else
  failure "DaVinci Resolve MCP binary missing"
fi

if command -v codex >/dev/null 2>&1; then
  if codex mcp get davinci-resolve >/dev/null 2>&1; then
    pass "DaVinci MCP registered in Codex"
  else
    failure "DaVinci MCP not registered in Codex"
  fi
fi

if command -v treg >/dev/null 2>&1; then
  pass "Treg CLI"
  if treg config 2>/dev/null | grep -qi 'logged-in\|logged in\|active org'; then
    pass "Treg appears authenticated"
  elif [ -s "${HOME}/.treg/config.json" ]; then
    warning "Treg config exists; authentication was not positively verified"
  else
    warning "Treg is installed but login is still required"
  fi
else
  failure "Treg CLI missing"
fi

if [ -e "$CODEX_HOME/skills/treg/SKILL.md" ]; then
  pass "Treg skill available to Codex"
else
  failure "Treg skill missing from Codex"
fi

if [ -s "$TOOLS_DIR/nosignups/tools.json" ]; then
  pass "NoSignups local discovery catalog"
else
  failure "NoSignups catalog missing"
fi

VIDEO_USE_DIR="$TOOLS_DIR/video-use"
if [ -f "$VIDEO_USE_DIR/.env" ] && grep -Eq '^ELEVENLABS_API_KEY=.+$' "$VIDEO_USE_DIR/.env"; then
  pass "video-use ElevenLabs key configured"
else
  warning "video-use installed, but ElevenLabs transcription is not configured"
fi

if [ -d "/Applications/DaVinci Resolve/DaVinci Resolve.app" ] || [ -d "/Applications/DaVinci Resolve.app" ]; then
  pass "DaVinci Resolve app detected"
else
  warning "DaVinci Resolve app not detected at common macOS paths"
fi

printf '\nSummary: %d OK, %d WARN, %d FAIL\n' "$ok" "$warn" "$fail"
printf 'Runtime note: a live DaVinci connection can only be verified while Resolve is running.\n'
printf 'Grok note: Grok Bot runs on a separate cloud computer and requires the one-time bootstrap in agent-stack/GROK_BOOTSTRAP.md.\n'

[ "$fail" -eq 0 ]
