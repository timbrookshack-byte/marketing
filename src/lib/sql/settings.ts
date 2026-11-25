/**
 * Operator settings: gross margin, target ROAS, the thresholds the diagnostics
 * judge against. One small key/value table, read far more often than written.
 */

import { getDatabase } from "./index";

export async function getSetting(key: string): Promise<string | null> {
  const value = await getDatabase()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .pluck<string>([key]);
  return value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await getDatabase()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run([key, value]);
}

export async function getJsonSetting<T>(key: string, fallback: T): Promise<T> {
  const raw = await getSetting(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // A corrupted value should not take the whole page down with it.
    return fallback;
  }
}

export async function setJsonSetting(key: string, value: unknown): Promise<void> {
  await setSetting(key, JSON.stringify(value));
}
