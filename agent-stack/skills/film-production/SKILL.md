---
name: film-production
description: Coordinate AI-assisted film editing with video-use for rough cuts and DaVinci Resolve MCP for professional timeline, color, audio, Fusion and render work.
---

# Film Production

Use this skill for the user's film project.

## Capability split
- Use `video-use` first for ingest, transcript-driven analysis, take inventory, rough cuts, silence/filler cleanup, subtitles and rapid review exports.
- Use the `davinci-resolve` MCP server for work that belongs in the real NLE: Media Pool, timelines, markers, multicam/conform where supported, color nodes, Fusion, Fairlight and render queue.
- Use ordinary filesystem/code tools for metadata, shot lists, EDL-like intermediate artifacts, scripts and automation around the edit.

## Workflow
1. Preserve camera originals. Never overwrite source footage.
2. Inventory the media and identify scene/take structure before editing.
3. For subjective editorial changes, propose the edit strategy and create or use a duplicate timeline/version before broad changes.
4. Apply deterministic changes through DaVinci MCP when possible instead of UI clicking.
5. Use computer control only when an operation is unavailable through the scripting/MCP surface.
6. Render a review output and inspect it before declaring the edit complete.

## Good use cases
- Compare takes against script/dialogue continuity.
- Build first assembly and rough cuts.
- Remove dead air and obvious unusable sections.
- Add/repair markers, subtitles and review notes.
- Compare look/node structures between scenes.
- Normalize dialogue workflow and flag audio problems.
- Prepare review and master render queues.

## Boundaries
- Do not make irreversible changes to source media.
- Do not assume an automated cut is the final creative edit.
- Do not perform paid transcription without the configured ElevenLabs key and an explicit user task that needs it.
- Do not publish or deliver a master externally without user approval.
- If DaVinci Resolve is not running or its scripting API is unavailable, report that state and continue with work that does not require it.
