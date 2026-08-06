import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

/**
 * Typed seam over Tauri's invoke. Services depend on this module (never on
 * @tauri-apps/api directly) so tests can mock the IPC boundary in one place.
 */
export async function invokeIpc<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args ?? {});
}

/** Native folder picker. Returns the selected absolute path, or null when cancelled. */
export async function pickDirectory(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false, title: 'Select project folder' });
  return typeof selected === 'string' ? selected : null;
}
