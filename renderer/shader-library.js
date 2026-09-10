'use strict';

/**
 * Persistence for the Live Shader editor: a named library of saved shaders,
 * plus a "last applied" slot so the app reopens where you left off. Backed by
 * localStorage — this is a real desktop window (file:// origin), so it
 * survives app restarts on this machine without any main-process/IPC work.
 */

const LIBRARY_KEY = 'afterimage.shaderLibrary.v1';
const LAST_SOURCE_KEY = 'afterimage.shaderLastSource.v1';
const MAX_ENTRIES = 30;

function makeId() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch (_) {}
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Returns all saved shaders, newest first. Never throws. */
export function loadLibrary() {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

function persist(list) {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(list));
  } catch (err) {
    console.error('[shader-library] failed to save library:', err.message);
  }
  return list;
}

/** Saves `source` under `name` (auto-named if blank) and returns the updated library. */
export function addShader(name, source) {
  const list = loadLibrary();
  const trimmedName = (name || '').trim() || `Shader ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  const entry = { id: makeId(), name: trimmedName, source, savedAt: Date.now() };
  list.unshift(entry);
  if (list.length > MAX_ENTRIES) list.length = MAX_ENTRIES;
  return persist(list);
}

/** Removes a saved shader by id and returns the updated library. */
export function removeShader(id) {
  return persist(loadLibrary().filter(entry => entry.id !== id));
}

/** Renames a saved shader (no-op if `name` is blank or the id isn't found). Returns the updated library. */
export function renameShader(id, name) {
  const list = loadLibrary();
  const trimmed = (name || '').trim();
  const entry = list.find(e => e.id === id);
  if (entry && trimmed) entry.name = trimmed;
  return persist(list);
}

/** The shader source last successfully applied, across sessions — or null. */
export function loadLastSource() {
  try {
    return localStorage.getItem(LAST_SOURCE_KEY);
  } catch (_) {
    return null;
  }
}

export function saveLastSource(source) {
  try {
    localStorage.setItem(LAST_SOURCE_KEY, source);
  } catch (err) {
    console.error('[shader-library] failed to remember last shader:', err.message);
  }
}
