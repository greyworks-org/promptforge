#!/usr/bin/env node
/**
 * PromptForge mock provider — a deterministic OpenAI-compatible stand-in for
 * a DeepSeek Flash endpoint. Zero dependencies.
 *
 * Usage:
 *   node tools/mock-provider/server.mjs            # port 4141
 *   PORT=5005 MOCK_PROVIDER_KEY=xyz node tools/mock-provider/server.mjs
 *
 * Behavior is selected via the request's `model` field:
 *   (default)      200 + JSON content '{"ok":true}' + usage
 *   *invalid-json* 200 + non-JSON content + usage
 *   *no-usage*     200 + JSON content, no usage field
 *   *empty*        200 + empty content
 *   *slow*         200 after a 4 s delay (for timeout tests)
 *   *http-error*   500 with a provider-style error body
 * Auth: Authorization: Bearer <MOCK_PROVIDER_KEY> is required; anything else
 * gets a 401. The mock key is a public fixture, not a secret.
 */
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 4141);
const EXPECTED_KEY = process.env.MOCK_PROVIDER_KEY ?? 'pf-mock-key-0001';

function log(line) {
  process.stdout.write(`[mock-provider] ${line}\n`);
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function completion(content, { usage = true } = {}) {
  const body = {
    id: 'mock-completion-1',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
  };
  if (usage) {
    body.usage = { prompt_tokens: 9, completion_tokens: 4, total_tokens: 13 };
  }
  return body;
}

const server = http.createServer((req, res) => {
  const remote = `${req.method} ${req.url}`;
  log(remote);

  if (req.method === 'GET' && req.url === '/health') {
    send(res, 200, { ok: true });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    send(res, 404, { error: { message: 'not found', type: 'invalid_request_error' } });
    return;
  }

  const auth = req.headers.authorization ?? '';
  if (auth !== `Bearer ${EXPECTED_KEY}`) {
    log('auth rejected (bad or missing bearer token)');
    send(res, 401, { error: { message: 'invalid api key', type: 'authentication_error' } });
    return;
  }

  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 1_000_000) req.destroy();
  });
  req.on('end', () => {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      send(res, 400, { error: { message: 'invalid JSON body', type: 'invalid_request_error' } });
      return;
    }
    const model = typeof body.model === 'string' ? body.model : '';
    log(`model="${model}" jsonMode=${body.response_format ? 'requested' : 'not requested'}`);

    const respond = () => {
      if (model.includes('http-error')) {
        send(res, 500, { error: { message: 'simulated provider failure', type: 'server_error' } });
      } else if (model.includes('invalid-json')) {
        send(res, 200, completion('Sure! Here is { broken'));
      } else if (model.includes('no-usage')) {
        send(res, 200, completion('{"ok":true}', { usage: false }));
      } else if (model.includes('empty')) {
        send(res, 200, completion(''));
      } else {
        send(res, 200, completion('{"ok":true}'));
      }
    };

    if (model.includes('slow')) {
      setTimeout(respond, 4000);
    } else {
      respond();
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  log(`listening on http://127.0.0.1:${PORT} (expected bearer key: ${EXPECTED_KEY})`);
});
