import { invoke } from '@tauri-apps/api/core';

/**
 * Typed seam over Tauri's invoke. Services depend on this module (never on
 * @tauri-apps/api directly) so tests can mock the IPC boundary in one place.
 */
export async function invokeIpc<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args ?? {});
}
