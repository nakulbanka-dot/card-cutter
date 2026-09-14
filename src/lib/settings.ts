"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_CITE_OPTIONS, type CiteOptions } from "./cite-format";

/**
 * Per-browser settings. No account, no server — these are preferences about
 * how your own cards get formatted, and they belong to the person at the
 * keyboard.
 *
 * Backed by useSyncExternalStore rather than an effect that calls setState:
 * localStorage genuinely is an external store, the server snapshot is the
 * defaults so hydration matches, and subscribing to the `storage` event means
 * changing a setting in one tab updates every other open tab.
 */

export interface Settings extends CiteOptions {
  /** Paragraphs shown per source. */
  passagesPerSource: number;
  /** Sources fetched per query. */
  sourceLimit: number;
}

export const DEFAULT_SETTINGS: Settings = {
  ...DEFAULT_CITE_OPTIONS,
  passagesPerSource: 4,
  sourceLimit: 8,
};

const KEY = "card-cutter:settings";

/**
 * getSnapshot must return a stable reference or React re-renders forever, so
 * the parsed value is cached and only rebuilt when the raw string changes.
 */
let cachedRaw: string | null = null;
let cachedValue: Settings = DEFAULT_SETTINGS;

function readSnapshot(): Settings {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // Private windows and blocked site data throw on access.
    return DEFAULT_SETTINGS;
  }

  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;

  if (!raw) {
    cachedValue = DEFAULT_SETTINGS;
    return cachedValue;
  }
  try {
    // Merge rather than replace, so a setting added later still gets a default.
    cachedValue = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    cachedValue = DEFAULT_SETTINGS;
  }
  return cachedValue;
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Fires when another tab writes; keeps open tabs consistent.
  window.addEventListener("storage", notify);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", notify);
  };
}

/** Server render has no localStorage, so it gets the defaults. */
const serverSnapshot = () => DEFAULT_SETTINGS;

export function useSettings() {
  const settings = useSyncExternalStore(subscribe, readSnapshot, serverSnapshot);

  const update = useCallback((patch: Partial<Settings>) => {
    const next = { ...readSnapshot(), ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Keep the in-memory value so the session still reflects the change.
      cachedRaw = null;
      cachedValue = next;
    }
    notify();
  }, []);

  const reset = useCallback(() => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    cachedRaw = null;
    cachedValue = DEFAULT_SETTINGS;
    notify();
  }, []);

  return { settings, update, reset };
}
