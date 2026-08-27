import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import semver from "semver";
import { warn } from "./format.ts";

const PKG_NAME = "forge-launcher";
const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const CACHE_TTL_HOURS = Number(process.env.FORGE_UPDATE_CHECK_INTERVAL_HOURS) || 24;
const CACHE_TTL_MS = CACHE_TTL_HOURS * 60 * 60 * 1000;

const nodeRequire = createRequire(import.meta.url);

export interface UpdateInfo {
  current: string;
  latest: string;
  tag: string;
}

interface UpdateCache {
  checkedAt: string;
  latest: string;
}

export interface CheckOptions {
  skip?: boolean;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  cacheFile?: string;
}

/** The installed forge-launcher version (read from package.json at runtime). */
export function currentVersion(): string {
  return (nodeRequire("../package.json") as { version: string }).version;
}

/**
 * Which npm dist-tag to check. A prerelease install (contains `-`, e.g.
 * `1.0.0-beta.2`) checks the `beta` tag; a release install checks `latest`.
 * Override with FORGE_UPDATE_CHECK_TAG.
 */
export function distTagFor(version: string): string {
  const override = process.env.FORGE_UPDATE_CHECK_TAG;
  if (override) return override;
  return semver.prerelease(version) ? "beta" : "latest";
}

/** npm registry endpoint for a package's dist-tag. */
export function registryUrl(tag: string): string {
  const base = (process.env.npm_config_registry || DEFAULT_REGISTRY).replace(/\/+$/, "");
  return `${base}/${PKG_NAME}/${tag}`;
}

/** True when `latest` is a newer semver than `current` (unparseable → false). */
export function isNewer(current: string, latest: string): boolean {
  const cur = semver.valid(current);
  const lat = semver.valid(latest);
  if (!cur || !lat) return false;
  return semver.gt(lat, cur);
}

/** Skips the check when disabled via env or in CI. */
export function shouldCheck(): boolean {
  const skip = process.env.FORGE_SKIP_UPDATE_CHECK;
  if (skip === "1" || skip === "true") return false;
  if (process.env.CI) return false;
  return true;
}

/** User-level cache file so the registry is only hit once per TTL window. */
export function cachePath(): string {
  const base =
    process.platform === "win32"
      ? process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
      : path.join(os.homedir(), ".cache");
  return path.join(base, "forge-launcher", "update-check.json");
}

export function readCache(file = cachePath()): UpdateCache | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as UpdateCache;
  } catch {
    return null;
  }
}

export function writeCache(latest: string, file = cachePath()): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ checkedAt: new Date().toISOString(), latest }, null, 2),
      "utf8",
    );
  } catch {
    // never fail the launcher over a cache write
  }
}

/** A cached result is fresh when it was written within the TTL window. */
export function cacheFresh(cache: UpdateCache | null, now = Date.now()): boolean {
  if (!cache || !cache.checkedAt || !cache.latest) return false;
  const checked = Date.parse(cache.checkedAt);
  if (Number.isNaN(checked)) return false;
  return now - checked < CACHE_TTL_MS;
}

async function fetchLatest(tag: string, opts: CheckOptions): Promise<string | null> {
  const fetcher = opts.fetcher ?? fetch;
  try {
    const res = await fetcher(registryUrl(tag), {
      signal: AbortSignal.timeout(opts.timeoutMs ?? 2000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: unknown };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  }
}

/**
 * Checks the registry for a newer forge-launcher. Returns update info when one
 * exists, null otherwise (or when the check is disabled/offline). Honors a
 * daily cache so repeated invocations are instant and network-free.
 */
export async function checkForUpdate(opts: CheckOptions = {}): Promise<UpdateInfo | null> {
  if (opts.skip || !shouldCheck()) return null;
  const current = currentVersion();
  const tag = distTagFor(current);
  const file = opts.cacheFile ?? cachePath();

  const cached = readCache(file);
  if (cacheFresh(cached)) {
    return cached && isNewer(current, cached.latest)
      ? { current, latest: cached.latest, tag }
      : null;
  }

  const latest = await fetchLatest(tag, opts);
  if (!latest) return null;
  writeCache(latest, file);
  return isNewer(current, latest) ? { current, latest, tag } : null;
}

/** Prints a single-line upgrade notice (best effort). */
export function printUpdateNotice(info: UpdateInfo): void {
  warn(`A new forge-launcher is available: ${info.current} → ${info.latest}`);
  warn(`  Upgrade with: npm install -g forge-launcher@${info.tag}`);
}
