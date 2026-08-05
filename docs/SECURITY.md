# Security & Privacy — PromptForge Local

PromptForge is local-first, but compilation sends selected project context to
an external model API. The security goal is therefore: **nothing sensitive
leaves the machine without passing a visible, deterministic gate.**

## 1. Threat model (MVP)

| Threat | Source | Mitigation |
| --- | --- | --- |
| Secret leakage to the provider API | user selecting files that contain keys/tokens | Blocked-file list + pattern redaction + "Context sent" preview (§3) |
| Plaintext key storage | app writing the API key somewhere | OS keychain only (§2); code review rule: key never in SQLite, files, logs |
| Unwanted writes into user repos | app generating/overwriting docs | Consent system (§4); overwrite requires diff preview |
| Malicious/untrusted model output | provider returns crafted JSON or instructions | Output is data, never executed: no eval, no shell from model content, no auto file writes; strict schema validation |
| Accidental terminal actions | CLI integration | Launch only, no prompt injection into CLIs; explicit confirmation before launch |
| Cross-project leakage | shared DB | Project-scoped repositories; isolation invariant tested (DATA_MODEL.md §2) |

Not in MVP threat model (documented as accepted): a compromised provider
endpoint, OS-level malware with keychain access, multi-user machines.

## 2. API key handling

- Stored in the **OS keychain** (macOS Keychain for MVP) via the Rust `keyring`
  crate, service `promptforge`, one account per provider profile
  (`promptforge/<profile>`).
- The key is read **only inside the Rust `provider_chat` command**, attached
  as `Authorization: Bearer <key>` and never returned to the webview.
- Settings UI captures the key once, hands it to `keychain_set`, and from then
  on displays only a masked placeholder + "stored" state.
- Key rotation = overwrite in keychain. `keychain_delete` on profile removal.
- Logs and error messages are scrubbed: request/response logging in dev builds
  redacts `Authorization` headers unconditionally.
- Connection test reuses the same transport; it never echoes secrets back.

## 3. Redaction pipeline

Runs on **every** outbound payload: raw request text, selected context docs,
attachment descriptions, and blocking-question answers. Pure TypeScript,
deterministic, 100% unit-tested.

### 3.1 Blocked files (never included, spec §13)

```
.env            .env.*          *.pem           *.key
credentials.json                secrets.*
node_modules/   .git/           dist/           build/
.next/          coverage/
```

Additionally: any file under `.promptforge/tasks/` (previous TaskSpecs are
not compile input) and any binary file.

Blocked files cannot be selected in the UI and are dropped defensively if they
appear in any selection list.

### 3.2 Secret patterns (detected → redacted + reported)

| Pattern class | Detector (illustrative regex) |
| --- | --- |
| AWS access key ID | `AKIA[0-9A-Z]{16}` (also `ASIA`) |
| AWS secret access key | labeled assignment `aws_secret_access_key\s*[:=]\s*\S+` |
| Stripe secret key | `sk_(live\|test)_[0-9A-Za-z]{10,}` |
| Supabase service-role / anon keys | labeled `supabase[_-]?(service_role\|anon)[_-]?key` assignments; `eyJ...` JWTs caught below |
| JWT | `eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}` |
| Bearer tokens | `Bearer\s+[A-Za-z0-9._~+/=-]{16,}` |
| Private key blocks | `-----BEGIN (RSA\|EC\|OPENSSH\|PGP\|DSA)? ?PRIVATE KEY( BLOCK)?-----` (entire block) |
| DB connection strings | `(postgres(ql)?\|mysql\|mongodb(\+srv)?\|redis\|amqp)://\S+:\S+@\S+` |
| OAuth client secrets | labeled `client_secret\s*[:=]\s*\S+` |
| Generic API-key assignments | `(?i)(api[_-]?key\|apikey\|auth[_-]?token\|access[_-]?token\|secret[_-]?key)\s*[:=]\s*['"]?[A-Za-z0-9_\-./+=]{16,}` |
| OpenAI-style keys | `sk-[A-Za-z0-9]{20,}` |

Detection behavior:

1. Match → replace the secret span with `[REDACTED:<class>]` (line structure
   preserved so context stays readable).
2. Whole-line redaction when the line is a key=value pair and the value is the
   secret.
3. Every match produces a `RedactionReport` entry: file, line number, class —
   never the matched secret itself.
4. High-entropy long strings that match no class are **flagged, not blocked**
   (shown with a warning in the preview); false-positive avoidance beats
   aggressive blocking in MVP.

The pattern list ships as data (one module, one fixture corpus per pattern),
so extending it never touches pipeline code.

### 3.3 "Context sent" preview (final gate)

Before any compile call leaves the machine, the Result-flow shows the exact
final payload text (system prompt excluded, user content included) with:

- the file list and per-file estimated tokens,
- every redaction applied (`[REDACTED:…]` markers),
- entropy warnings,
- an explicit **Cancel / Send** choice.

The stored `compilations.context_sent` equals byte-for-byte what was sent
(auditability invariant).

## 4. Consent system (spec §13 "İzin sistemi")

These operations always require an explicit, per-action confirmation dialog:

| Operation | Extra requirement |
| --- | --- |
| Modify an existing context doc | show diff |
| Overwrite AGENTS.md / QWEN.md / CLAUDE.md in a target repo | show diff; if the file exists and was not created by PromptForge, warn distinctly |
| Run any terminal command | show full command |
| Launch a CLI / hand off a prompt | show binary + working dir |
| Create a git commit | **not implemented in MVP at all** |
| Run migrations / deploy against target projects | **not implemented in MVP at all** |

Consent is never remembered across operations.

## 5. Model output handling

- Provider responses are parsed with a strict size cap and a JSON parser only.
- TaskSpec content is rendered into markdown by template code; it is never
  interpolated into shell commands, URLs, `eval`, or filesystem paths
  (file references inside TaskSpecs are display-only until the user chooses
  "Write Task File", which goes through the consent flow).
- Repair/critic prompts include only the invalid JSON and the schema — no
  additional project context.

## 6. Filesystem permissions

- Tauri fs access is scoped: scopes are granted per user-selected project
  directory at onboarding time and persisted in app settings. The app holds
  no blanket home-directory access. (Verification item for Phase 3 — if the
  plugin cannot express runtime scopes safely, fs falls back to proxied Rust
  commands with the same scoping.)
- `.promptforge/` content is ordinary text the user may commit; nothing in it
  is secret by construction (redaction applies before anything is written
  there by the app).

## 7. Dependencies & supply chain

- Frontend dependencies are pinned via lockfile (pnpm). New dependencies
  require justification against the "simple and maintainable" rule.
- Rust crates: `tauri`, `tauri-plugin-*`, `keyring`, `reqwest` (or
  tauri-plugin-http if chosen during Phase 1), `serde`, `serde_json`.
  Nothing else without review.
- No telemetry of any kind.

## 8. Success criteria (from spec §18, security rows)

- Cross-project context mixing: **zero.**
- Secret transmission to the provider: **zero** — measured against the
  redaction fixture corpus (100% detection required before Phase 5 completes)
  and by design of the Context-sent gate for everything else.
