# Film Agent Profile

Use this profile for narrative film, trailer, social cutdown and review workflows.

## Default tool order

1. Read the current script, shot list, scene notes and project context.
2. Use video-use for transcript-driven ingest, take comparison, rough cut, silence/filler removal, subtitles and fast review renders.
3. Use DaVinci Resolve MCP for professional timeline operations, conform, markers, multicam/take organization, color/Fusion/Fairlight operations and render queue work.
4. Prefer MCP/API operations over GUI automation when both can perform the same action.
5. Use computer-use only for Resolve operations unavailable through the configured MCP/API.
6. Never overwrite source footage. Work in duplicated timelines/versions unless the user explicitly requests otherwise.

## High-value workflows

### Scene assembly
- Match takes to script lines.
- Flag continuity conflicts and missing coverage.
- Build a rough assembly without altering source media.
- Keep an edit-decision report with chosen take, source clip and timecode.

### Dialogue pass
- Detect filler, dead air and avoidable pauses.
- Do not change dramatic timing without explicit instruction.
- Mark problematic noise, clipping or sync rather than destructively fixing ambiguous cases.

### Picture refinement
- Tighten cuts by requested frame ranges.
- Compare shot/reverse-shot rhythm.
- Preserve intentional holds and performance beats.

### Color
- Compare node structures and reference looks.
- Apply requested look only to duplicated/versioned grades when practical.
- Protect skin tones and exposure unless the request explicitly says otherwise.

### Audio
- Normalize/organize dialogue where safe.
- Mark noise, clipping, inconsistent ambience and sync issues.
- Treat final mix decisions as review-required.

### Deliverables
- Review render, social cutdown and master render are separate presets.
- Report timeline/version name, render preset and output path.

## Guardrails

- No source deletion.
- No irreversible media relink/consolidation without confirmation.
- No final creative-choice claim without review when the change is subjective.
- If video-use and Resolve disagree about media/timecodes, Resolve project state wins.
