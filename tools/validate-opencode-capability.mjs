#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(join(root, 'opencode.json'), 'utf8'));
const server = config.mcp?.['qwen-mm-plugins-core'];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(server?.type === 'local', 'Qwen-MM Core must use OpenCode local MCP transport.');
assert(server.enabled === true, 'Qwen-MM Core must be available to OpenCode sessions.');
assert(Array.isArray(server.command), 'Qwen-MM Core command must be structured argv.');
assert(server.command[0] === 'uvx', 'Qwen-MM Core must launch through uvx.');
assert(server.command.at(-1) === 'qwen-mm-plugins-core', 'Qwen-MM Core entrypoint is missing.');
assert(server.command.some((value) => value.includes('qwen-mm-plugins[core]')), 'The core capability profile is missing.');
assert(server.command.some((value) => value.includes('github.com/QwenLM/Qwen-MM-Plugins.git@main')), 'The upstream Qwen-MM source is missing.');
assert(!JSON.stringify(config).includes('DASHSCOPE_API_KEY'), 'The local core config must not persist an API key or key placeholder.');

console.log('PASS  OpenCode Qwen-MM Core MCP capability configuration');
