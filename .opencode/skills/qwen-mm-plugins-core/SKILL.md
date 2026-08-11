---
name: qwen-mm-plugins-core
description: On-demand local visual understanding for images, video, documents, code, data, and 3D files through Qwen-MM Core MCP tools.
---

# Qwen-MM Core

Use the `qwen-mm-plugins-core` MCP tools only when the current task requires
visual or media understanding. Keep normal text-only sessions free of image
calls and do not attach visual context unless it is needed for the request.

- Use `read_image` for an image. It returns a model-ready image with a
  structured resolution summary.
- Use `visualize` for documents, data, code, diagrams, or other supported
  files.
- Use `media_info` before inspecting video or audio, then use `read_video` when
  frame understanding is required.
- Use `crop` or `draw_bbox` only when the user explicitly needs an image
  derivative or annotation.

The capability is local-only. Cloud/API-based Qwen visual calls are separate
capabilities and are intentionally not configured here.
