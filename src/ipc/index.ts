import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

/**
 * Normalize any thrown value into a safe, useful Error. Never leaks
 * raw objects, secrets, or "[object Object]" into user-facing messages.
 */
function normalizeError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === 'string') return new Error(err);

  // Tauri wraps Rust Err(ProviderFailure) as { class, message }.
  // Try to extract a useful message without exposing raw payloads.
  try {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === 'string') {
      return new Error(obj.message as string);
    }
    // Tauri sometimes wraps errors as a stringified JSON.
    const str = String(err);
    if (str !== '[object Object]') return new Error(str);
    return new Error('Provider request failed.');
  } catch {
    return new Error('Provider request failed.');
  }
}

/**
 * Typed seam over Tauri's invoke. All errors are normalized to proper
 * Error objects — callers never see raw Tauri error shapes.
 */
export async function invokeIpc<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args ?? {});
  } catch (err) {
    throw normalizeError(err);
  }
}

/** Native folder picker. Returns the selected absolute path, or null when cancelled. */
export async function pickDirectory(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false, title: 'Select project folder' });
  return typeof selected === 'string' ? selected : null;
}
