#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_DIR="${HOME}/.local/share/utku-agent-stack"
STACK_SKILLS_DIR="$TOOLS_DIR/stack-skills"
export CODEX_HOME="${CODEX_HOME:-${HOME}/.codex-luna-api}"
export PATH="${HOME}/.local/bin:${HOME}/.cargo/bin:${PATH}"

mkdir -p "$TOOLS_DIR" "$STACK_SKILLS_DIR" "$CODEX_HOME/skills"

log() { printf '\n==> %s\n' "$1"; }
warn() { printf 'WARN: %s\n' "$1"; }
die() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

clone_or_update() {
  local url="$1" dir="$2"
  if [ -d "$dir/.git" ]; then
    git -C "$dir" pull --ff-only
  else
    git clone "$url" "$dir"
  fi
}

link_skill() {
  local source="$1" name="$2"
  [ -f "$source/SKILL.md" ] || die "Skill source missing SKILL.md: $source"
  ln -sfn "$source" "$CODEX_HOME/skills/$name"
}

log "1/9 Prerequisites"
for cmd in git python3; do
  command -v "$cmd" >/dev/null 2>&1 || die "Missing required command: $cmd"
done

if ! command -v uv >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    brew install uv
  else
    die "uv is missing and Homebrew is unavailable. Install uv, then rerun this installer."
  fi
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  command -v brew >/dev/null 2>&1 || die "ffmpeg is missing. Install ffmpeg, then rerun."
  brew install ffmpeg
fi

if ! command -v yt-dlp >/dev/null 2>&1 && command -v brew >/dev/null 2>&1; then
  brew install yt-dlp
fi

log "2/9 Agent Skills"
AGENT_SKILLS_DIR="$TOOLS_DIR/agent-skills"
clone_or_update https://github.com/addyosmani/agent-skills.git "$AGENT_SKILLS_DIR"

agent_skills_native=0
if command -v codex >/dev/null 2>&1; then
  if codex plugin marketplace add addyosmani/agent-skills >/dev/null 2>&1 || codex marketplace add addyosmani/agent-skills >/dev/null 2>&1; then
    if codex plugin add agent-skills@agent-skills >/dev/null 2>&1; then
      agent_skills_native=1
      printf 'Native Codex Agent Skills plugin installed.\n'
    fi
  fi
fi

if [ "$agent_skills_native" -eq 0 ]; then
  warn "Native Codex plugin install was unavailable; using direct skill links instead."
  for skill_dir in "$AGENT_SKILLS_DIR"/skills/*; do
    [ -f "$skill_dir/SKILL.md" ] || continue
    link_skill "$skill_dir" "$(basename "$skill_dir")"
  done
fi

log "3/9 video-use"
VIDEO_USE_DIR="$TOOLS_DIR/video-use"
clone_or_update https://github.com/browser-use/video-use.git "$VIDEO_USE_DIR"
(
  cd "$VIDEO_USE_DIR"
  uv sync
)
link_skill "$VIDEO_USE_DIR" video-use

if [ ! -f "$VIDEO_USE_DIR/.env" ]; then
  if [ -f "$VIDEO_USE_DIR/.env.example" ]; then
    cp "$VIDEO_USE_DIR/.env.example" "$VIDEO_USE_DIR/.env"
    chmod 600 "$VIDEO_USE_DIR/.env" 2>/dev/null || true
  else
    : > "$VIDEO_USE_DIR/.env"
    chmod 600 "$VIDEO_USE_DIR/.env" 2>/dev/null || true
  fi
fi

if ! grep -Eq '^ELEVENLABS_API_KEY=.+$' "$VIDEO_USE_DIR/.env" 2>/dev/null; then
  if [ -t 0 ]; then
    printf 'ElevenLabs API key for video-use transcription (press Enter to configure later): '
    stty -echo 2>/dev/null || true
    IFS= read -r eleven_key || true
    stty echo 2>/dev/null || true
    printf '\n'
    if [ -n "${eleven_key:-}" ]; then
      python3 - "$VIDEO_USE_DIR/.env" "$eleven_key" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); key=sys.argv[2]
lines=p.read_text().splitlines() if p.exists() else []
out=[]; done=False
for line in lines:
    if line.startswith('ELEVENLABS_API_KEY='):
        out.append('ELEVENLABS_API_KEY='+key); done=True
    else:
        out.append(line)
if not done: out.append('ELEVENLABS_API_KEY='+key)
p.write_text('\n'.join(out)+'\n')
PY
    else
      warn "ElevenLabs key not configured; video-use works except paid transcription until you add it."
    fi
  else
    warn "ElevenLabs key not configured; add it later to $VIDEO_USE_DIR/.env"
  fi
fi

log "4/9 Graphify"
uv tool install --upgrade graphifyy
hash -r
command -v graphify >/dev/null 2>&1 || die "Graphify installed but is not on PATH. Run 'uv tool update-shell', restart the shell, then rerun."
graphify install --platform codex
if command -v opencode >/dev/null 2>&1 || [ -d "${HOME}/.config/opencode" ]; then
  graphify install --platform opencode
fi

log "5/9 DaVinci Resolve MCP"
uv tool install --upgrade davinci-resolve-mcp
hash -r
DAVINCI_MCP_BIN="$(command -v davinci-resolve-mcp || true)"
[ -n "$DAVINCI_MCP_BIN" ] || die "davinci-resolve-mcp was installed but is not on PATH"

if command -v codex >/dev/null 2>&1; then
  if codex mcp get davinci-resolve >/dev/null 2>&1; then
    printf 'Codex already has a davinci-resolve MCP entry; leaving it unchanged.\n'
  else
    codex mcp add davinci-resolve -- "$DAVINCI_MCP_BIN"
  fi
else
  warn "Codex CLI not on PATH, so DaVinci MCP could not be registered automatically."
fi

# Add to the global OpenCode config without touching an existing custom entry.
if command -v opencode >/dev/null 2>&1 || [ -d "${HOME}/.config/opencode" ]; then
  OPENCODE_CONFIG="${XDG_CONFIG_HOME:-${HOME}/.config}/opencode/opencode.json"
  mkdir -p "$(dirname "$OPENCODE_CONFIG")"
  python3 - "$OPENCODE_CONFIG" "$DAVINCI_MCP_BIN" <<'PY'
from pathlib import Path
import json, sys
p=Path(sys.argv[1]); binary=sys.argv[2]
try:
    data=json.loads(p.read_text()) if p.exists() else {}
except Exception as e:
    raise SystemExit(f"Refusing to edit invalid OpenCode JSON: {p}: {e}")
if not isinstance(data, dict):
    raise SystemExit(f"Refusing to edit non-object OpenCode config: {p}")
mcp=data.setdefault('mcp', {})
if 'davinci-resolve' not in mcp:
    mcp['davinci-resolve']={'type':'local','command':[binary],'enabled':True}
p.write_text(json.dumps(data, indent=2)+'\n')
PY
fi

log "6/9 Treg"
uv tool install --upgrade --python 3.13 'tools-registry[proxy]'
hash -r
command -v treg >/dev/null 2>&1 || die "Treg installed but is not on PATH"
TREG_SRC="$TOOLS_DIR/treg-source"
clone_or_update https://github.com/superdesigndev/treg.git "$TREG_SRC"
link_skill "$TREG_SRC/skills/treg" treg

# Login is interactive and belongs to the user. If no local config exists, run the official login flow.
if [ ! -s "${HOME}/.treg/config.json" ] && [ -t 0 ]; then
  printf '\nTreg needs one-time authentication. A browser may open now.\n'
  treg login || warn "Treg login was not completed. You can run 'treg login' later."
fi

# This safely configures the clients Treg itself supports automatically (including OpenCode when present).
if [ -s "${HOME}/.treg/config.json" ]; then
  treg mcp install || warn "Treg MCP auto-registration was only partially completed. Codex can still use the installed Treg skill + CLI."
else
  warn "Treg is installed but not authenticated yet."
fi

log "7/9 NoSignups discovery catalog"
NOSIGNUPS_DIR="$TOOLS_DIR/nosignups"
clone_or_update https://github.com/BraveOPotato/FckSignups.git "$NOSIGNUPS_DIR"
[ -s "$NOSIGNUPS_DIR/tools.json" ] || die "NoSignups tools.json is missing"

log "8/9 Custom Film / WASK / discovery skills"
rm -rf "$STACK_SKILLS_DIR"
mkdir -p "$STACK_SKILLS_DIR"
cp -R "$ROOT_DIR/agent-stack/skills/." "$STACK_SKILLS_DIR/"
for name in film-production wask-project-council tool-discovery; do
  link_skill "$STACK_SKILLS_DIR/$name" "$name"
done

log "9/9 Verification"
chmod +x "$ROOT_DIR/agent-stack/verify.sh" 2>/dev/null || true
bash "$ROOT_DIR/agent-stack/verify.sh"

cat <<EOF

Local agent stack installation completed.

Codex/OpenCode layer:
- Agent Skills
- video-use
- Graphify
- DaVinci Resolve MCP
- Treg CLI + Treg skill
- NoSignups local catalog
- Film Production skill
- WASK Project Council skill
- Tool Discovery skill

Important runtime boundaries:
- DaVinci Resolve itself must be installed and running before a live Resolve MCP test can pass.
- video-use transcription needs ELEVENLABS_API_KEY.
- Grok Bot is a separate cloud computer and cannot be configured by this Mac installer. Use:
  $ROOT_DIR/agent-stack/GROK_BOOTSTRAP.md

No production deploy, publish, send or destructive external action is performed by this installer.
EOF
