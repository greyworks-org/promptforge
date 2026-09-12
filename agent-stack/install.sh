#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_DIR="${HOME}/.local/share/utku-agent-stack"
CODEX_HOME="${CODEX_HOME:-${HOME}/.codex-luna-api}"

mkdir -p "$TOOLS_DIR"

echo "[1/6] Checking prerequisites"
for cmd in git python3; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Missing required command: $cmd"; exit 1; }
done

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is not installed. Install it first (recommended for Graphify and DaVinci MCP isolation)."
  echo "See: https://docs.astral.sh/uv/getting-started/installation/"
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is missing. video-use requires ffmpeg. On macOS: brew install ffmpeg"
  exit 1
fi

echo "[2/6] Installing/updating Agent Skills for Codex"
if command -v codex >/dev/null 2>&1; then
  codex plugin marketplace add addyosmani/agent-skills || true
  codex plugin add agent-skills@agent-skills || true
else
  echo "Codex CLI not found on PATH. Skipping native plugin install."
fi

echo "[3/6] Installing/updating video-use"
VIDEO_USE_DIR="$TOOLS_DIR/video-use"
if [ -d "$VIDEO_USE_DIR/.git" ]; then
  git -C "$VIDEO_USE_DIR" pull --ff-only
else
  git clone https://github.com/browser-use/video-use.git "$VIDEO_USE_DIR"
fi
mkdir -p "$CODEX_HOME/skills/video-use"
cp "$VIDEO_USE_DIR/SKILL.md" "$CODEX_HOME/skills/video-use/SKILL.md"
rm -rf "$CODEX_HOME/skills/video-use/helpers"
cp -R "$VIDEO_USE_DIR/helpers" "$CODEX_HOME/skills/video-use/helpers"
if [ ! -f "$VIDEO_USE_DIR/.env" ]; then
  cp "$VIDEO_USE_DIR/.env.example" "$VIDEO_USE_DIR/.env" 2>/dev/null || true
  echo "video-use needs an ElevenLabs API key in: $VIDEO_USE_DIR/.env"
fi

echo "[4/6] Installing Graphify"
uv tool install --upgrade 'graphifyy[mcp]'
if command -v graphify >/dev/null 2>&1; then
  graphify install --platform codex || true
  graphify install --platform opencode || true
else
  echo "Graphify installed but not yet on PATH. Run: uv tool update-shell"
fi

echo "[5/6] Installing DaVinci Resolve MCP"
uv tool install --upgrade davinci-resolve-mcp
cat <<'EOF'
DaVinci Resolve MCP binary is installed. It must run on the same Mac as DaVinci Resolve.
Resolve 19+ is required; some features require newer versions or Resolve Studio.
Register the command `davinci-resolve-mcp` in each MCP-capable runtime you want to use.
EOF

echo "[6/6] Syncing shared local policies/profiles"
mkdir -p "$CODEX_HOME/skills/utku-agent-stack"
cp "$ROOT_DIR/agent-stack/policies/TOOL_DISCOVERY.md" "$CODEX_HOME/skills/utku-agent-stack/TOOL_DISCOVERY.md"
cp "$ROOT_DIR/agent-stack/profiles/FILM.md" "$CODEX_HOME/skills/utku-agent-stack/FILM.md"
cp "$ROOT_DIR/agent-stack/profiles/WASK_LABS.md" "$CODEX_HOME/skills/utku-agent-stack/WASK_LABS.md"

cat <<EOF

Installed/configured:
- Agent Skills: Codex plugin (when Codex CLI supports plugins)
- video-use: $VIDEO_USE_DIR and $CODEX_HOME/skills/video-use
- Graphify: Codex + OpenCode discovery (when graphify is on PATH)
- DaVinci Resolve MCP: davinci-resolve-mcp command
- Film/WASK/tool-discovery policies: $CODEX_HOME/skills/utku-agent-stack

Not auto-configured for safety:
- ElevenLabs API key for video-use
- Treg token / provider credentials
- Grok Bot configuration
- DaVinci project operations

No credentials were written by this installer.
EOF
