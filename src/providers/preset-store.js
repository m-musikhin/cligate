/**
 * User-defined preset persistence (~/.cligate/provider-presets.json).
 *
 * Pure file I/O: reads the raw entries (no validation — that lives in
 * provider-presets.js userPresetProblem) and writes them back atomically
 * (temp file + rename). The file is the raw source of truth: entries the
 * loader skips as invalid stay on disk untouched, so fixing a typo in the
 * file (or via the API) doesn't lose sibling entries.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';
import { CONFIG_DIR } from '../account-manager.js';

export const USER_PRESETS_FILE = join(CONFIG_DIR, 'provider-presets.json');

/**
 * Raw entries from the user presets file.
 * @returns {Array|null} parsed array, [] when the file is absent,
 *   null when it is unreadable, malformed JSON, or not an array / {presets: []}.
 */
export function readUserPresetsFile() {
  if (!existsSync(USER_PRESETS_FILE)) return [];
  try {
    const parsed = JSON.parse(readFileSync(USER_PRESETS_FILE, 'utf8'));
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.presets)) return parsed.presets;
    return null;
  } catch {
    return null;
  }
}

/**
 * Atomically persist the raw entries array (temp file + rename).
 */
export function writeUserPresetsFile(entries) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const tmp = `${USER_PRESETS_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(entries, null, 2), { mode: 0o600 });
  renameSync(tmp, USER_PRESETS_FILE);
}

/**
 * Insert or replace one entry by id, preserving the rest of the file as-is.
 */
export function upsertUserPreset(entry) {
  const entries = readUserPresetsFile();
  if (entries === null) {
    return { success: false, error: `${USER_PRESETS_FILE} is malformed — fix or remove it before saving presets` };
  }
  const index = entries.findIndex((e) => e?.id === entry.id);
  if (index >= 0) entries[index] = entry;
  else entries.push(entry);

  try {
    writeUserPresetsFile(entries);
  } catch (err) {
    return { success: false, error: `failed to write ${USER_PRESETS_FILE}: ${err.message}` };
  }
  return { success: true, replaced: index >= 0 };
}

/**
 * Remove one entry by id.
 */
export function removeUserPreset(id) {
  const entries = readUserPresetsFile();
  if (entries === null) {
    return { success: false, error: `${USER_PRESETS_FILE} is malformed — fix or remove it before editing presets` };
  }
  const index = entries.findIndex((e) => e?.id === id);
  if (index < 0) return { success: false, error: 'not found' };

  entries.splice(index, 1);
  try {
    writeUserPresetsFile(entries);
  } catch (err) {
    return { success: false, error: `failed to write ${USER_PRESETS_FILE}: ${err.message}` };
  }
  return { success: true };
}
