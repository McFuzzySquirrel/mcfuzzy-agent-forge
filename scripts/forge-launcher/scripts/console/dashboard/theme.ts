// ─── Console theme: system / light / dark ──────────────────────────────────
//
// The palette lives in style.css as custom properties on :root (dark) and
// :root[data-theme="light"]. This module owns the preference: it resolves
// `auto` against the OS, mirrors the result onto <html data-theme>, caches the
// preference for the pre-paint script in index.html, and re-resolves when the
// OS scheme changes.

import type { ThemePreference } from "./types.js";

export type ResolvedTheme = "light" | "dark";

/** Mirrored by the pre-paint script in index.html. */
export const THEME_STORAGE_KEY = "forge-console.theme";

export function parseThemePreference(value: unknown): ThemePreference | null {
  return value === "light" || value === "dark" || value === "auto" ? value : null;
}

/** Pure resolver: `auto` follows the OS; every other value is explicit. */
export function resolveTheme(preference: ThemePreference, prefersLight: boolean): ResolvedTheme {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  return prefersLight ? "light" : "dark";
}

let preference: ThemePreference = "auto";
let media: MediaQueryList | null = null;
let mediaListening = false;
const listeners = new Set<(theme: ResolvedTheme, preference: ThemePreference) => void>();

function systemPrefersLight(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: light)").matches;
}

export function getThemePreference(): ThemePreference {
  return preference;
}

export function getResolvedTheme(): ResolvedTheme {
  return resolveTheme(preference, systemPrefersLight());
}

/**
 * Reads the browser storage object without touching the Node global (which
 * emits an experimental warning when accessed in the test harness).
 */
function localStorageOrNull(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    // Storage can be unavailable (for example in a locked-down browser).
    return null;
  }
}

export function readCachedThemePreference(): ThemePreference | null {
  const storage = localStorageOrNull();
  if (!storage) return null;
  try {
    return parseThemePreference(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return null;
  }
}

function cacheThemePreference(value: ThemePreference): void {
  const storage = localStorageOrNull();
  if (!storage) return;
  try {
    storage.setItem(THEME_STORAGE_KEY, value);
  } catch {
    // A cache miss only costs one flash on the next load.
  }
}

function paint(theme: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  // Test harnesses provide a partial DOM; theme painting is best-effort there.
  if (!root) return;
  if (root.dataset) root.dataset.theme = theme;
  if (root.style) root.style.colorScheme = theme;
}

function notify(): void {
  const theme = getResolvedTheme();
  for (const listener of listeners) listener(theme, preference);
}

function onSystemSchemeChange(): void {
  if (preference !== "auto") return;
  const theme = getResolvedTheme();
  paint(theme);
  notify();
}

function listenForSystemChanges(): void {
  if (mediaListening || typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  media = window.matchMedia("(prefers-color-scheme: light)");
  media.addEventListener("change", onSystemSchemeChange);
  mediaListening = true;
}

/**
 * Applies a preference immediately. `persist: false` is used at startup so the
 * saved settings value can take effect without rewriting the local cache.
 */
export function applyTheme(next: ThemePreference, options: { persist?: boolean } = {}): ResolvedTheme {
  preference = next;
  const theme = getResolvedTheme();
  paint(theme);
  listenForSystemChanges();
  if (options.persist !== false) cacheThemePreference(next);
  notify();
  return theme;
}

/** Subscribes to resolved theme changes, including OS changes under `auto`. */
export function onThemeChange(listener: (theme: ResolvedTheme, preference: ThemePreference) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
