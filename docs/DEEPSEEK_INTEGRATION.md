# DeepSeek Integration — PromptForge Local

PromptForge's compiler model is a **configurable DeepSeek Flash-compatible
API**. Per the product spec, the model name must never be hardcoded: the
user's service may name it "DeepSeek V2 Flash" while DeepSeek's public list
carries other names. `baseUrl`, `apiKey`, `modelId` are all user settings.

This document separates **facts**, **assumptions**, and **decisions**.
Nothing here invents undocumented API behavior: where the real endpoint
contract is unverified, it is marked as an assumption and covered by the
connection test (Phase 1) and capability fallbacks.

## 1. Provider configuration

```ts
// Stored in SQLite settings (non-secret parts). See DATA_MODEL.md §1.5.
interface ProviderProfile {
  label: string;                  // user-facing name, e.g. "DeepSeek Flash"
  baseUrl: string;                // user-provided, e.g. https://api.example.com/v1
  modelId: string;                // user-provided; validated: non-empty string
  keychainAccount: string;        // where the secret lives (keychain, not here)
  capabilities: {
    jsonMode: 'auto' | 'on' | 'off';
  };
  params: {
    temperature: number;          // default 0.2 (determinism matters for JSON output)
    maxTokens: number;            // default 4096
    timeoutMs: number;            // default 60000
  };
}
```

Validation rules:

- `baseUrl` must be a valid https URL (http allowed only for `localhost`, to
  support a local mock server in development/tests).
- `modelId` is free text: **no hardcoded model names anywhere in code,
  prompts, or defaults.** An empty modelId blocks compilation with a clear
  "configure your provider" error.
- The API key is never part of this object; only `keychainAccount` is.

## 2. Endpoint contract — assumptions to verify

| # | Assumption | Status | Fallback if false |
| --- | --- | --- | --- |
| A1 | OpenAI-compatible chat endpoint at `{baseUrl}/chat/completions` | **Assumption** — standard for DeepSeek-compatible services; must be confirmed by the user's connection test | Provider adapter is isolated; adjust path/shape in one module |
| A2 | Auth via `Authorization: Bearer <key>` | **Assumption** | Same adapter seam |
| A3 | Request supports `response_format: { type: "json_object" }` | **Assumption** — DeepSeek documents JSON mode but warns it can return empty content | `jsonMode: 'off'` → plain chat + strict "respond with JSON only" instruction + code-fence stripping in the parser |
| A4 | Response contains `usage.prompt_tokens` / `usage.completion_tokens` | **Assumption** | Estimate tokens locally and flag `compiler_tokens_estimated = 1` (DATA_MODEL.md §1.3) |
| A5 | Standard chat shape: `messages: [{role: system|user, content}]`, response `choices[0].message.content` | **Assumption** | Adapter seam |
| A6 | Vision/image input | **Not assumed.** MVP never sends images to the compiler (spec §12 flow: filename + user note only) | — |

The connection test (below) exists precisely to confirm A1–A5 against the
user's real endpoint before the first real compile.

## 3. Request shape

All compile traffic goes through the Rust `provider_chat` command
(ARCHITECTURE.md §2.3). Logical request built in TypeScript:

```json
{
  "model": "<modelId from settings>",
  "messages": [
    { "role": "system", "content": "<compiler system prompt + embedded compiler-output JSON Schema>" },
    { "role": "user", "content": "<compile payload>" }
  ],
  "temperature": 0.2,
  "max_tokens": 4096,
  "response_format": { "type": "json_object" }   // only when jsonMode resolves to on
}
```

### 3.1 Compile payload (user message)

```
Task type: <enum>            Execution mode: <enum>
Target provider: <qwen|codex|claude>

## Raw request
<user text, redacted>

## Project context (selected, redacted)
### .promptforge/context/DESIGN.md
…
### .promptforge/context/DATA_MODEL.md
…

## Attachments (descriptions only)
- dashboard-current.png — "current usage screen; keep the nav layout"

## Blocking-question answers (round N)        // if any
…

Return the TaskSpec JSON only.
```

### 3.2 System prompt

The spec §6 system prompt verbatim, plus:

- the full **compiler-output** JSON Schema (from
  `schemas/compiler-output.schema.json`, embedded at build time — single
  source of truth; the canonical `taskspec.schema.json` is never sent to the
  model because it contains client-owned fields the model must not produce),
- field guidance (do **not** emit `task_id`, `project_id` or
  `schema_version` — they are client-owned; empty arrays are acceptable
  where truth is unknown; never invent facts),
- the instruction to keep `blocking_questions` ≤ 3.

Deep mode adds a second call: the **critic** receives the produced compiler
output + the original payload and may only propose JSON patches (spec §6: it
never regenerates from scratch). Critic output is applied and re-validated
through the same pipeline.

## 4. Response handling state machine

```
call ──► HTTP error / timeout ──► ONE network retry (backoff 1s)
                                   └─► still failing: user-visible error
     ──► 200 + content
           ├─ jsonMode on: parse content as JSON
           ├─ jsonMode off: strip code fences, locate first { … last }
           ├─ empty content (known JSON-mode behavior) → treated as invalid
           ▼
        extract & normalize (strip the 3 client-owned keys if present;
        default missing requirements object)
           ▼
        validate against compiler-output.schema.json (unknown fields REJECTED)
           ├─ valid → continue
           └─ invalid → BOUNDED repair: exactly ONE repair call:
                system: same compiler-output schema + "fix this JSON to
                conform; change as little as possible"
                user: <invalid JSON + validation errors>
                ▼
              validate again
                ├─ valid → continue
                └─ invalid → FAILED: show errors; nothing rendered or stored
           ▼
        enrich (task_id, project_id, schema_version, local token estimate)
           ▼
        validate against taskspec.schema.json (must pass — assert)
           ▼
        deterministic rendering → persistence
```

Repair is **bounded**: at most one repair call per compile attempt, never a
retry loop (TASKSPEC.md §4 invariant 9).

Budget: at most **2 provider calls** for standard mode (1 + repair), **3** for
deep mode (compiler + critic + at most 1 repair). The system never silently
produces an unvalidated prompt (spec §6).

## 5. Usage capture

- If the response carries `usage` (A4), store
  `compiler_prompt_tokens` / `compiler_completion_tokens` with
  `compiler_tokens_estimated = 0`.
- Otherwise compute local estimates (chars/4 heuristic, ARCHITECTURE.md R4)
  and store with `compiler_tokens_estimated = 1`.
- Estimates are always labeled as estimates in the UI (spec §14: "Tahmin
  gerçek veri gibi gösterilmez").
- Rendered-prompt size is estimated locally (`final_prompt_tokens_est`);
  the model's `estimated_prompt_tokens` is kept inside the TaskSpec as
  advisory metadata only.

## 6. Error taxonomy (user-visible messages)

| Class | Example | UX |
| --- | --- | --- |
| `config` | missing baseUrl/modelId/key | "Configure provider" deep link |
| `auth` | 401/403 | "API key rejected — check Settings" |
| `network` | timeout, DNS, TLS | retry once, then "Connection failed" |
| `http_api` | 429/5xx with body | show provider message (scrubbed) |
| `empty_response` | 200 with empty content | goes through repair path |
| `validation_failed` | schema-invalid after repair | show first validation errors; keep raw response available for inspection |

Error text never contains the API key or full request headers.

## 7. Connection test protocol (Phase 1)

`Settings → Test connection` sends a tiny fixed prompt
(e.g. `Respond with JSON: {"ok": true}`) with `max_tokens` ~50 and reports:

- reachable / auth ok / model answered,
- whether the answer parsed as JSON (informs `jsonMode: auto` → on/off),
- whether `usage` was present (informs token accounting mode),
- latency.

Results are displayed factually; nothing is persisted as a "capability" until
the user saves the profile.

## 8. Future providers

Adding a provider = new transport adapter (if wire format differs) + renderer
+ enum value. The pipeline, redaction, validation, history are provider-
agnostic by construction. Multiple profiles are already representable in
settings (`DATA_MODEL.md` §1.5); MVP exposes a single active profile.

## 9. Privacy of compile traffic

Only redacted, user-approved content is sent (SECURITY.md §3). The provider
receives: system prompt + schema + raw request + selected context + attachment
descriptions + question answers. It never receives: file contents outside the
selection, images, keys, history, or anything from other projects.
